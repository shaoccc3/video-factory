import { describe, expect, it, vi } from "vitest";
import { makeJob } from "../test/fixtures";
import { subscribeJobEvents } from "./sse";

class FakeEventSource extends EventTarget {
  url: string;
  closed = false;
  constructor(url: string) {
    super();
    this.url = url;
  }
  close() {
    this.closed = true;
  }
  emit(data: string) {
    this.dispatchEvent(new MessageEvent("job", { data }));
  }
}

describe("subscribeJobEvents", () => {
  it("收到 job 事件時回呼最新的 JobDetail，取消時關閉連線", () => {
    let source: FakeEventSource | null = null;
    const onJob = vi.fn();
    const unsubscribe = subscribeJobEvents("job-1", onJob, (url) => {
      source = new FakeEventSource(url);
      return source as unknown as EventSource;
    });
    const es = source as unknown as FakeEventSource;
    expect(es.url).toBe("/api/v1/jobs/job-1/events");

    es.emit(JSON.stringify(makeJob({ id: "job-1", status: "generating" })));
    expect(onJob).toHaveBeenCalledTimes(1);
    expect(onJob.mock.calls[0]?.[0]).toMatchObject({ status: "generating" });

    // 其他任務或無法解析的資料被忽略
    es.emit(JSON.stringify(makeJob({ id: "job-2" })));
    es.emit("not json");
    expect(onJob).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(es.closed).toBe(true);
    es.emit(JSON.stringify(makeJob({ id: "job-1" })));
    expect(onJob).toHaveBeenCalledTimes(1);
  });
});
