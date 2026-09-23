import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError, api } from "./client";
import type {
  AssetListParams,
  AssetUpload,
  AuditLogParams,
  BatchCsvCreate,
  BatchImagesCreate,
  BudgetUpdate,
  EstimatePreviewRequest,
  JobCreate,
  JobDetail,
  JobListParams,
  ReviewRequest,
  SceneRegenerateTarget,
  SceneUpdate,
  TemplateCreate,
  TemplateUpdate,
  UserCreate,
  UserUpdate,
} from "./types";

export const queryKeys = {
  me: ["auth", "me"] as const,
  meta: ["meta"] as const,
  users: ["users"] as const,
  templates: (includeInactive: boolean) => ["templates", { includeInactive }] as const,
  templatesAll: ["templates"] as const,
  jobs: (params: JobListParams) => ["jobs", params] as const,
  jobsAll: ["jobs"] as const,
  job: (id: string) => ["job", id] as const,
  estimate: (id: string) => ["job", id, "estimate"] as const,
  estimatePreview: (body: EstimatePreviewRequest | null) => ["estimate-preview", body] as const,
  calls: (id: string) => ["job", id, "calls"] as const,
  reviewQueue: ["reviews", "queue"] as const,
  batches: ["batches"] as const,
  batch: (id: string) => ["batches", id] as const,
  assets: (params: AssetListParams) => ["assets", params] as const,
  assetsAll: ["assets"] as const,
  usage: (days: number) => ["usage", days] as const,
  modelsConfig: ["config", "models"] as const,
  auditLogs: (params: AuditLogParams) => ["audit-logs", params] as const,
};

/** 把後端回傳的最新 JobDetail 寫回快取，並讓列表類查詢過期 */
export function applyJobDetail(client: QueryClient, job: JobDetail): void {
  client.setQueryData(queryKeys.job(job.id), job);
  void client.invalidateQueries({ queryKey: queryKeys.jobsAll });
  void client.invalidateQueries({ queryKey: queryKeys.reviewQueue });
  void client.invalidateQueries({ queryKey: queryKeys.estimate(job.id) });
  void client.invalidateQueries({ queryKey: queryKeys.calls(job.id) });
}

// ---- 認證 ----

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.login,
    onSuccess: (user) => {
      client.setQueryData(queryKeys.me, user);
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      client.clear();
    },
  });
}

// ---- 平台資訊 ----

/** 區域、TTS 是否可用、每秒旁白字數；一個會話內不會變，只取一次 */
export function useMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: api.meta,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

// ---- 用戶 ----

export function useUsers(enabled = true) {
  return useQuery({ queryKey: queryKeys.users, queryFn: api.listUsers, enabled });
}

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UserCreate) => api.createUser(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserUpdate }) => api.updateUser(id, body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

// ---- 模板 ----

export function useTemplates(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.templates(includeInactive),
    queryFn: () => api.listTemplates(includeInactive),
  });
}

export function useCreateTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TemplateCreate) => api.createTemplate(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.templatesAll }),
  });
}

export function useUpdateTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TemplateUpdate }) =>
      api.updateTemplate(id, body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.templatesAll }),
  });
}

// ---- 任務 ----

export function useJobs(params: JobListParams) {
  return useQuery({
    queryKey: queryKeys.jobs(params),
    queryFn: () => api.listJobs(params),
    placeholderData: keepPreviousData,
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.job(id ?? ""),
    queryFn: () => api.getJob(id ?? ""),
    enabled: Boolean(id),
  });
}

export function useEstimate(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.estimate(id),
    queryFn: () => api.getEstimate(id),
    enabled,
  });
}

/** 開新片的即時預估；body 為 null 時不查詢，重算期間保留上一次結果，數字不閃爍 */
export function useEstimatePreview(body: EstimatePreviewRequest | null) {
  return useQuery({
    queryKey: queryKeys.estimatePreview(body),
    queryFn: () => api.estimatePreview(body as EstimatePreviewRequest),
    enabled: body !== null,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
  });
}

export function useCalls(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.calls(id), queryFn: () => api.listCalls(id), enabled });
}

export function useCreateJob() {
  return useMutation({ mutationFn: (body: JobCreate) => api.createJob(body) });
}

/** 對單個任務的狀態類操作（回傳新的 JobDetail） */
export type JobCommand =
  | { type: "submit" }
  | { type: "regenerate_script" }
  | { type: "confirm_storyboard" }
  | { type: "render_final" }
  | { type: "cancel" }
  | { type: "resume" }
  | { type: "regenerate_scene"; sceneId: string; target: SceneRegenerateTarget }
  | { type: "preview_keyframe"; sceneId: string; force?: boolean }
  | { type: "update_scene"; sceneId: string; body: SceneUpdate }
  | { type: "review"; body: ReviewRequest };

export function runJobCommand(id: string, command: JobCommand): Promise<JobDetail> {
  switch (command.type) {
    case "submit":
      return api.submitJob(id);
    case "regenerate_script":
      return api.regenerateScript(id);
    case "confirm_storyboard":
      return api.confirmStoryboard(id);
    case "render_final":
      return api.renderFinal(id);
    case "cancel":
      return api.cancelJob(id);
    case "resume":
      return api.resumeJob(id);
    case "regenerate_scene":
      return api.regenerateScene(id, command.sceneId, command.target);
    case "preview_keyframe":
      return api.previewKeyframe(id, command.sceneId, command.force ?? false);
    case "update_scene":
      return api.updateScene(id, command.sceneId, command.body);
    case "review":
      return api.reviewJob(id, command.body);
  }
}

export function useJobCommand(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: JobCommand) => runJobCommand(id, command),
    onSuccess: (job) => applyJobDetail(client, job),
  });
}

// ---- 審核 ----

export function useReviewQueue(enabled = true) {
  return useQuery({ queryKey: queryKeys.reviewQueue, queryFn: api.reviewQueue, enabled });
}

// ---- 批量 ----

export function useBatches() {
  return useQuery({ queryKey: queryKeys.batches, queryFn: api.listBatches });
}

export function useBatch(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.batch(id ?? ""),
    queryFn: () => api.getBatch(id ?? ""),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5000 : false),
  });
}

export function useCreateBatchCsv() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BatchCsvCreate) => api.createBatchCsv(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.batches }),
  });
}

export function useCreateBatchImages() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BatchImagesCreate) => api.createBatchImages(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.batches }),
  });
}

// ---- 素材 ----

export function useAssets(params: AssetListParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.assets(params),
    queryFn: () => api.listAssets(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAsset(id: string | null | undefined) {
  return useQuery({
    queryKey: ["asset", id ?? ""],
    queryFn: () => api.getAsset(id ?? ""),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

export function useUploadAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: AssetUpload) => api.uploadAsset(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.assetsAll }),
  });
}

export function useDeleteAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAsset(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.assetsAll }),
  });
}

// ---- 用量與配置 ----

export function useUsage(days: number) {
  return useQuery({ queryKey: queryKeys.usage(days), queryFn: () => api.usageSummary(days) });
}

export function useModelsConfig() {
  return useQuery({ queryKey: queryKeys.modelsConfig, queryFn: api.modelsConfig });
}

export function useUpdateBudget() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: BudgetUpdate) => api.updateBudget(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.modelsConfig }),
  });
}

export function useAuditLogs(params: AuditLogParams) {
  return useQuery({
    queryKey: queryKeys.auditLogs(params),
    queryFn: () => api.auditLogs(params),
    placeholderData: keepPreviousData,
  });
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
