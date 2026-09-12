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
  it("registers only six listeners across rerenders and disposes them all", async () => {
    const notify = vi.fn();
    const view = renderHook(() => { const queue = useQueue(); useQueueEvents(queue, notify); return queue; });
    await act(async () => {});
    act(() => { view.result.current.enqueue(item("one")); });
    view.rerender();
    expect(events.cleanups).toHaveLength(6);
    view.unmount();
    expect(events.cleanups.every((fn) => fn.mock.calls.length === 1)).toBe(true);
  });

  it("keeps jobs serial and recovers after command rejection", async () => {
    const view = renderHook(useQueue);
    act(() => { view.result.current.enqueue(item("one")); view.result.current.enqueue(item("two")); });
    let reject!: (reason: Error) => void;
    const process = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    act(() => { view.result.current.processNext(process); view.result.current.processNext(process); });
    expect(process).toHaveBeenCalledOnce();
    await act(async () => { reject(new Error("Encoder failed")); });
    expect(view.result.current.queue[0]).toMatchObject({ status: "failed", error: "Error: Encoder failed" });
    const next = vi.fn().mockResolvedValue(undefined);
    await act(async () => { view.result.current.processNext(next); });
    expect(next.mock.calls[0][0].id).toBe("two");
    expect(view.result.current.queue[1].status).toBe("completed");
  });

  it("waits for process cleanup after cancellation before starting the next job", async () => {
    const view = renderHook(useQueue);
    let finish!: () => void;
    const process = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    act(() => { view.result.current.enqueue(item("one")); view.result.current.enqueue(item("two")); view.result.current.processNext(process); });
    act(() => { view.result.current.cancelActive(); view.result.current.processNext(process); });
    expect(process).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(view.result.current.queue[0].status).toBe("cancelled");
    await act(async () => { view.result.current.processNext(async () => {}); });
    expect(view.result.current.queue[1].status).toBe("completed");
  });

  it("routes compression events and skips duplicate rounded progress updates", async () => {
    const view = renderHook(() => { const queue = useQueue(); useQueueEvents(queue, vi.fn()); return queue; });
    await act(async () => {});
    act(() => { view.result.current.enqueue(item("compress", "compress")); view.result.current.updateItemStatus("compress", "active"); });
    act(() => events.handlers.get("convert-progress")!({ payload: 25.1 }));
    const before = view.result.current.queue;
    act(() => events.handlers.get("convert-progress")!({ payload: 25.2 }));
    expect(view.result.current.queue).toBe(before);
    act(() => events.handlers.get("convert-finished")!({ payload: { ok: true, message: "", file_path: "out.mp4" } }));
    expect(view.result.current.queue[0]).toMatchObject({ status: "completed", resultPath: "out.mp4" });
  });
});
