// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQueue } from "../src/lib/useQueue";
import { useQueueEvents } from "../src/hooks/useQueueEvents";
import type { QueueItem } from "../src/lib/queue-types";

const events = vi.hoisted(() => ({ handlers: new Map<string, (event: { payload: unknown }) => void>(), cleanups: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name, handler) => {
  events.handlers.set(name, handler);
  const dispose = vi.fn(() => events.handlers.delete(name));
  events.cleanups.push(dispose);
  return dispose;
}) }));

function item(id: string, type: QueueItem["type"] = "convert"): QueueItem {
  return { id, type, label: id, status: "pending", progress: 0, createdAt: 0 };
}

afterEach(cleanup);
beforeEach(() => { events.handlers.clear(); events.cleanups.length = 0; });

describe("media queue", () => {
  it.each([undefined, "one"])("records cancellation before native cleanup emits events (%s)", async (id) => {
    const notify = vi.fn();
    const view = renderHook(() => { const queue = useQueue(); useQueueEvents(queue, notify); return queue; });
    await act(async () => {});
    act(() => {
      view.result.current.enqueue(item("one"));
      view.result.current.enqueue(item("two", "download"));
      view.result.current.updateItemStatus("one", "active");
      view.result.current.updateItemStatus("two", "active");
    });
    const nativeCancel = vi.fn(async () => {
      expect(view.result.current.queueRef.current[0].status).toBe("cancelled");
      events.handlers.get("convert-finished")!({ payload: { id: "one", ok: false, message: "Cancelled", file_path: "" } });
    });
    await act(async () => view.result.current.requestCancel(nativeCancel, id));
    expect(nativeCancel).toHaveBeenCalledOnce();
    expect(view.result.current.queue[0].status).toBe("cancelled");
    expect(view.result.current.queue[1].status).toBe(id ? "active" : "cancelled");
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "completed", "failed"] as const)("ignores late events for %s jobs", async (status) => {
    const notify = vi.fn();
    const view = renderHook(() => { const queue = useQueue(); useQueueEvents(queue, notify); return queue; });
    await act(async () => {});
    act(() => {
      view.result.current.enqueue(item("job", "download"));
      view.result.current.updateItemStatus("job", status, { progress: 42 });
    });
    const before = view.result.current.queue;
    act(() => {
      events.handlers.get("download-progress")!({ payload: { id: "job", percent: 90 } });
      events.handlers.get("download-status")!({ payload: { id: "job", status: "downloading", speed: 100 } });
      events.handlers.get("download-finished")!({ payload: { id: "job", ok: true, message: "Done", file_path: "out.mp4" } });
    });
    expect(view.result.current.queue).toBe(before);
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores events for another engine or unknown jobs and duplicate completions", async () => {
    const notify = vi.fn();
    const view = renderHook(() => { const queue = useQueue(); useQueueEvents(queue, notify); return queue; });
    await act(async () => {});
    act(() => {
      view.result.current.enqueue(item("job"));
      view.result.current.updateItemStatus("job", "active");
    });
    const finished = { id: "job", ok: true, message: "Done", file_path: "out.mp4" };
    act(() => {
      events.handlers.get("download-finished")!({ payload: finished });
      events.handlers.get("convert-finished")!({ payload: { ...finished, id: "unknown" } });
    });
    expect(view.result.current.queue[0].status).toBe("active");
    expect(notify).not.toHaveBeenCalled();
    act(() => {
      events.handlers.get("convert-finished")!({ payload: finished });
      events.handlers.get("convert-finished")!({ payload: finished });
    });
    expect(view.result.current.queue[0].status).toBe("completed");
    expect(notify).toHaveBeenCalledOnce();
  });

  it("keeps download resolve and retry phases visible to the queue", async () => {
    const view = renderHook(() => { const queue = useQueue(); useQueueEvents(queue, vi.fn()); return queue; });
    await act(async () => {});
    act(() => view.result.current.enqueue(item("tiktok", "download")));
    act(() => view.result.current.updateItemStatus("tiktok", "active"));
    for (const phase of ["resolving", "retrying", "downloading"]) {
      act(() => events.handlers.get('download-status')!({ payload: { id: 'tiktok', status: phase } }));
      expect(view.result.current.queue[0].downloadPhase).toBe(phase);
    }
  });
  it("registers one listener set per engine across rerenders and disposes them all", async () => {
    const notify = vi.fn();
    const view = renderHook(() => { const queue = useQueue(); useQueueEvents(queue, notify); return queue; });
    await act(async () => {});
    act(() => { view.result.current.enqueue(item("one")); });
    view.rerender();
    expect(events.cleanups).toHaveLength(15);
    view.unmount();
    expect(events.cleanups.every((fn) => fn.mock.calls.length === 1)).toBe(true);
  });

  it("keeps jobs serial and recovers after command rejection", async () => {
    const view = renderHook(useQueue);
    act(() => { view.result.current.enqueue(item("one")); view.result.current.enqueue(item("two")); });
    let reject!: (reason: Error) => void;
    const process = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    act(() => { view.result.current.processNextBatch(process); view.result.current.processNextBatch(process); });
    expect(process).toHaveBeenCalledOnce();
    await act(async () => { reject(new Error("Encoder failed")); });
    expect(view.result.current.queue[0]).toMatchObject({ status: "failed", error: "Error: Encoder failed" });
    const next = vi.fn().mockResolvedValue(undefined);
    await act(async () => { view.result.current.processNextBatch(next); });
    expect(next.mock.calls[0][0].id).toBe("two");
    expect(view.result.current.queue[1].status).toBe("completed");
  });

  it("waits for process cleanup after cancellation before starting the next job", async () => {
    const view = renderHook(useQueue);
    let finish!: () => void;
    const process = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    act(() => { view.result.current.enqueue(item("one")); view.result.current.enqueue(item("two")); view.result.current.processNextBatch(process); });
    act(() => { view.result.current.cancelActive(); view.result.current.processNextBatch(process); });
    expect(process).toHaveBeenCalledOnce();
    expect(view.result.current.isProcessing).toBe(true);
    await act(async () => { finish(); });
    expect(view.result.current.queue[0].status).toBe("cancelled");
    expect(view.result.current.isProcessing).toBe(false);
    await act(async () => { view.result.current.processNextBatch(async () => {}); });
    expect(view.result.current.queue[1].status).toBe("completed");
  });

  it.each(["convert", "upscale"] as const)("routes %s events and skips duplicate rounded progress updates", async (type) => {
    const view = renderHook(() => { const queue = useQueue(); useQueueEvents(queue, vi.fn()); return queue; });
    await act(async () => {});
    act(() => { view.result.current.enqueue(item("job", type)); view.result.current.updateItemStatus("job", "active"); });
    act(() => events.handlers.get(`${type}-progress`)!({ payload: { id: "job", percent: 25.1 } }));
    const before = view.result.current.queue;
    act(() => events.handlers.get(`${type}-progress`)!({ payload: { id: "job", percent: 25.2 } }));
    expect(view.result.current.queue).toBe(before);
    act(() => events.handlers.get(`${type}-finished`)!({ payload: { id: "job", ok: true, message: "", file_path: "out.mp4" } }));
    expect(view.result.current.queue[0]).toMatchObject({ status: "completed", resultPath: "out.mp4" });
  });
});

const gpuLimits = { download: 2, convert: 4, transcoder: 4, upscale: 2, activeDownload: 0, activeConvert: 0, activeTranscoder: 0, activeUpscale: 0 };
const video = (id: string): QueueItem => ({ ...item(id), outputFormat: "mp4" });

it("reserves different GPUs across task types and reuses the first freed GPU", async () => {
  const view = renderHook(useQueue);
  const done = new Map<string, () => void>();
  const process = vi.fn((job: QueueItem) => new Promise<void>(resolve => done.set(job.id, resolve)));
  const pool = ["h264_nvenc", "h264_amf"];
  act(() => {
    view.result.current.setConcurrency(gpuLimits);
    view.result.current.enqueue(video("one"));
    view.result.current.enqueue({ ...item("two", "transcoder"), transcoderFileType: "video" });
    view.result.current.enqueue(video("three"));
    view.result.current.processNextBatch(process, pool);
    view.result.current.processNextBatch(process, pool);
  });
  expect(process.mock.calls.map(([job]) => job.assignedGpu)).toEqual(pool);
  // A finished event must not free the GPU until process cleanup completes.
  act(() => { view.result.current.updateItemStatus("two", "completed"); view.result.current.processNextBatch(process, pool); });
  expect(process).toHaveBeenCalledTimes(2);
  await act(async () => done.get("two")!());
  act(() => view.result.current.processNextBatch(process, pool));
  expect(process.mock.calls[2][0]).toMatchObject({ id: "three", assignedGpu: "h264_amf" });
  await act(async () => { done.get("one")!(); done.get("three")!(); });
});

it("keeps GPU reservations during cancellation cleanup and frees them after failure", async () => {
  const view = renderHook(useQueue);
  let reject!: (error: Error) => void;
  const process = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  act(() => {
    view.result.current.setConcurrency(gpuLimits);
    view.result.current.enqueue(video("one")); view.result.current.enqueue(video("two"));
    view.result.current.processNextBatch(process, ["h264_amf"]);
    view.result.current.cancelActive();
    view.result.current.processNextBatch(process, ["h264_amf"]);
  });
  expect(process).toHaveBeenCalledOnce();
  await act(async () => reject(new Error("cancelled")));
  const next = vi.fn().mockResolvedValue(undefined);
  await act(async () => view.result.current.processNextBatch(next, ["h264_amf"]));
  expect(next.mock.calls[0][0]).toMatchObject({ id: "two", assignedGpu: "h264_amf" });
});

it("fails clearly when no GPU is available but continues non-video jobs", async () => {
  const view = renderHook(useQueue);
  const process = vi.fn().mockResolvedValue(undefined);
  await act(async () => {
    view.result.current.enqueue(video("one")); view.result.current.enqueue(item("download", "download"));
    view.result.current.processNextBatch(process, []);
  });
  expect(view.result.current.queue[0].status).toBe("failed");
  expect(process).toHaveBeenCalledOnce();
  expect(process.mock.calls[0][0].assignedGpu).toBeUndefined();
});
