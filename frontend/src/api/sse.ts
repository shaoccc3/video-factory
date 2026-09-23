import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { jobEventsUrl } from "./client";
import { applyJobDetail } from "./hooks";
import type { JobDetail } from "./types";

export type EventSourceFactory = (url: string) => EventSource;

const defaultFactory: EventSourceFactory = (url) => new EventSource(url, { withCredentials: true });

function isJobDetail(value: unknown): value is JobDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "status" in value &&
    "allowed_actions" in value
  );
}

/**
 * 訂閱 /jobs/{id}/events（event: job，data: JobDetail），
 * 收到後直接寫回該任務的查詢快取。瀏覽器不支援 EventSource 時不做事（頁面仍可手動刷新）。
 */
export function subscribeJobEvents(
  id: string,
  onJob: (job: JobDetail) => void,
  factory: EventSourceFactory = defaultFactory,
): () => void {
  if (typeof EventSource === "undefined" && factory === defaultFactory) return () => {};
  const source = factory(jobEventsUrl(id));
  const listener = (event: MessageEvent<string>) => {
    try {
      const data: unknown = JSON.parse(event.data);
      if (isJobDetail(data) && data.id === id) onJob(data);
    } catch {
      // 忽略無法解析的事件
    }
  };
  source.addEventListener("job", listener);
  return () => {
    source.removeEventListener("job", listener);
    source.close();
  };
}

export function useJobEvents(id: string | undefined, enabled = true): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!id || !enabled) return;
    return subscribeJobEvents(id, (job) => applyJobDetail(client, job));
  }, [client, id, enabled]);
}
