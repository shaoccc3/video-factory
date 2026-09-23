import type {
  Asset,
  AssetListParams,
  AssetUpload,
  AuditLog,
  AuditLogParams,
  Batch,
  BatchCsvCreate,
  BatchDetail,
  BatchImagesCreate,
  BudgetConfig,
  BudgetUpdate,
  CostEstimate,
  GenerationCall,
  JobCreate,
  JobDetail,
  JobListParams,
  JobSummary,
  LoginRequest,
  ModelsConfig,
  Page,
  PlatformMeta,
  ReviewRequest,
  SceneRegenerateTarget,
  SceneUpdate,
  Template,
  TemplateCreate,
  TemplateUpdate,
  UsageSummary,
  User,
  UserCreate,
  UserUpdate,
} from "./types";

export const API_BASE = "/api/v1";

/** 422 時 FastAPI 的預設錯誤項 */
export interface ValidationErrorItem {
  loc: (string | number)[];
  msg: string;
}

export class ApiError extends Error {
  readonly status: number;
  /** 後端的 detail；422 時為校驗錯誤陣列 */
  readonly detail: string | ValidationErrorItem[] | null;

  constructor(status: number, detail: string | ValidationErrorItem[] | null) {
    super(ApiError.describe(status, detail));
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }

  static describe(status: number, detail: string | ValidationErrorItem[] | null): string {
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((d) => {
          const field = d.loc.filter((part) => part !== "body").join(".");
          return field ? `${field}: ${d.msg}` : d.msg;
        })
        .join("; ");
    }
    return `HTTP ${status}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidationItem(value: unknown): value is ValidationErrorItem {
  return isRecord(value) && Array.isArray(value.loc) && typeof value.msg === "string";
}

function parseDetail(body: unknown): string | ValidationErrorItem[] | null {
  if (!isRecord(body)) return null;
  const { detail } = body;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.filter(isValidationItem);
  return null;
}

type QueryValue = string | number | boolean | undefined | null;

export function buildQuery(params: Record<string, QueryValue | QueryValue[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") search.append(key, String(item));
      }
      continue;
    }
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal | undefined;
}

/**
 * 所有請求的入口：帶 Cookie、JSON 編碼，非 2xx 丟 ApiError。
 * 204 或空回應回傳 undefined（呼叫端的型別應為 void）。
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }

  const init: RequestInit = {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    credentials: "include",
    headers,
  };
  if (body !== undefined) init.body = body;
  if (options.signal) init.signal = options.signal;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, error instanceof Error ? error.message : null);
  }

  const text = response.status === 204 ? "" : await response.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = parseDetail(data) ?? (typeof data === "string" ? data : null);
    throw new ApiError(response.status, detail);
  }
  return data as T;
}

export function assetContentUrl(id: string): string {
  return `${API_BASE}/assets/${id}/content`;
}

export function assetThumbnailUrl(id: string): string {
  return `${API_BASE}/assets/${id}/thumbnail`;
}

export function assetDownloadUrl(id: string): string {
  return `${API_BASE}/assets/${id}/download`;
}

export function jobEventsUrl(id: string): string {
  return `${API_BASE}/jobs/${id}/events`;
}

const post = <T>(path: string, json?: unknown) =>
  request<T>(path, json === undefined ? { method: "POST" } : { method: "POST", json });
const patch = <T>(path: string, json: unknown) => request<T>(path, { method: "PATCH", json });

export const api = {
  // 認證
  login: (body: LoginRequest) => post<User>("/auth/login", body),
  logout: () => post<void>("/auth/logout"),
  me: () => request<User>("/auth/me"),

  // 用戶
  listUsers: () => request<User[]>("/users"),
  createUser: (body: UserCreate) => post<User>("/users", body),
  updateUser: (id: string, body: UserUpdate) => patch<User>(`/users/${id}`, body),

  // 模板
  listTemplates: (includeInactive = false) =>
    request<Template[]>(`/templates${buildQuery({ include_inactive: includeInactive })}`),
  getTemplate: (id: string) => request<Template>(`/templates/${id}`),
  createTemplate: (body: TemplateCreate) => post<Template>("/templates", body),
  updateTemplate: (id: string, body: TemplateUpdate) => patch<Template>(`/templates/${id}`, body),

  // 任務
  createJob: (body: JobCreate) => post<JobDetail>("/jobs", body),
  listJobs: (params: JobListParams = {}) =>
    request<Page<JobSummary>>(`/jobs${buildQuery({ ...params })}`),
  getJob: (id: string) => request<JobDetail>(`/jobs/${id}`),
  submitJob: (id: string) => post<JobDetail>(`/jobs/${id}/submit`),
  regenerateScript: (id: string) => post<JobDetail>(`/jobs/${id}/regenerate-script`),
  updateScene: (jobId: string, sceneId: string, body: SceneUpdate) =>
    patch<JobDetail>(`/jobs/${jobId}/scenes/${sceneId}`, body),
  getEstimate: (id: string) => request<CostEstimate>(`/jobs/${id}/estimate`),
  confirmStoryboard: (id: string) => post<JobDetail>(`/jobs/${id}/confirm-storyboard`),
  regenerateScene: (jobId: string, sceneId: string, target: SceneRegenerateTarget) =>
    post<JobDetail>(`/jobs/${jobId}/scenes/${sceneId}/regenerate`, { target }),
  renderFinal: (id: string) => post<JobDetail>(`/jobs/${id}/render-final`),
  cancelJob: (id: string) => post<JobDetail>(`/jobs/${id}/cancel`),
  resumeJob: (id: string) => post<JobDetail>(`/jobs/${id}/resume`),
  listCalls: (id: string) => request<GenerationCall[]>(`/jobs/${id}/calls`),
  reviewJob: (id: string, body: ReviewRequest) => post<JobDetail>(`/jobs/${id}/review`, body),

  // 審核
  reviewQueue: () => request<JobSummary[]>("/reviews/queue"),

  // 批量
  createBatchCsv: (body: BatchCsvCreate) => {
    const form = new FormData();
    form.set("template_id", body.template_id);
    form.set("file", body.file);
    form.set("max_parallel", String(body.max_parallel));
    form.set("draft_mode", String(body.draft_mode));
    return request<Batch>("/batches/csv", { method: "POST", form });
  },
  createBatchImages: (body: BatchImagesCreate) => {
    const form = new FormData();
    form.set("template_id", body.template_id);
    for (const file of body.files) form.append("files", file);
    form.set("topic", body.topic);
    form.set("max_parallel", String(body.max_parallel));
    form.set("draft_mode", String(body.draft_mode));
    return request<Batch>("/batches/images", { method: "POST", form });
  },
  listBatches: () => request<Batch[]>("/batches"),
  getBatch: (id: string) => request<BatchDetail>(`/batches/${id}`),

  // 素材
  uploadAsset: (body: AssetUpload) => {
    const form = new FormData();
    form.set("file", body.file);
    form.set("kind", body.kind);
    form.set("tags", body.tags.join(","));
    return request<Asset>("/assets", { method: "POST", form });
  },
  listAssets: (params: AssetListParams = {}) =>
    request<Page<Asset>>(`/assets${buildQuery({ ...params })}`),
  getAsset: (id: string) => request<Asset>(`/assets/${id}`),
  deleteAsset: (id: string) => request<void>(`/assets/${id}`, { method: "DELETE" }),

  // 平台資訊（v1.1）
  meta: () => request<PlatformMeta>("/meta"),

  // 用量與配置
  usageSummary: (days = 30) => request<UsageSummary>(`/usage/summary${buildQuery({ days })}`),
  modelsConfig: () => request<ModelsConfig>("/config/models"),
  updateBudget: (body: BudgetUpdate) => patch<BudgetConfig>("/config/budget", body),
  auditLogs: (params: AuditLogParams = {}) =>
    request<Page<AuditLog>>(`/audit-logs${buildQuery({ ...params })}`),
};
