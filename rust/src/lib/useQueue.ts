import { useState, useCallback, useRef } from "react";
import { subscribeToEvent } from "./tauri-events";
import type { QueueItem, QueueItemStatus } from "./queue-types";
import type { FinishedEvent } from "./tauri-commands";

type QueueEventType = "download" | "convert" | "reduce";
interface QueueEventHandlers {
  onProgress: (id: string, progress: number) => void;
  onFinished: (id: string, ok: boolean, message: string, filePath: string) => void;
}

export function useQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);

  const commit = useCallback((change: (items: QueueItem[]) => QueueItem[]) => {
    const next = change(queueRef.current);
    if (next !== queueRef.current) {
      queueRef.current = next;
      setQueue(next);
    }
  }, []);

  const updateItemStatus = useCallback((id: string, status: QueueItemStatus, extra?: Partial<QueueItem>) => {
    commit((items) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) return items;
      const patch = { ...extra, status };
      if (patch.progress !== undefined) patch.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
      if (Object.entries(patch).every(([key, value]) => item[key as keyof QueueItem] === value)) return items;
      return items.map((entry) => entry.id === id ? { ...entry, ...patch } : entry);
    });
  }, [commit]);

  const registerListeners = useCallback((type: QueueEventType, handlers: QueueEventHandlers) => {
    const active = () => queueRef.current.find((item) =>
      item.status === "active" && item.type === type
    );
    const progress = subscribeToEvent<number>(`${type}-progress`, ({ payload }) => {
      const item = active();
      if (item && Number.isFinite(payload)) handlers.onProgress(item.id, payload);
    });
    const finished = subscribeToEvent<FinishedEvent>(`${type}-finished`, ({ payload }) => {
      const item = active();
      if (item) handlers.onFinished(item.id, payload.ok, payload.message, payload.file_path);
    });
    return () => { progress(); finished(); };
  }, []);

  const processNext = useCallback((onProcess: (item: QueueItem) => Promise<void>) => {
    if (processingRef.current) return;
    const item = queueRef.current.find((entry) => entry.status === "pending");
    if (!item) return;
    processingRef.current = true;
    updateItemStatus(item.id, "active", { progress: 0 });
    void (async () => {
      try {
        await onProcess(item);
        if (queueRef.current.find((entry) => entry.id === item.id)?.status === "active") {
          updateItemStatus(item.id, "completed", { progress: 100, resultPath: item.outputPath });
        }
      } catch (error) {
        if (queueRef.current.find((entry) => entry.id === item.id)?.status === "active") {
          updateItemStatus(item.id, "failed", { error: String(error) });
        }
      } finally {
        // Commands resolve after their child processes are reaped. Cancellation must
        // retain this lock until then so an old job cannot overlap the next one.
        processingRef.current = false;
        commit((items) => [...items]);
      }
    })();
  }, [commit, updateItemStatus]);

  const enqueue = useCallback((item: QueueItem) => commit((items) => [...items, item]), [commit]);
  const removeItem = useCallback((id: string) => commit((items) => items.filter((item) => item.id !== id || item.status === "active")), [commit]);
  const clearCompleted = useCallback(() => commit((items) => items.filter((item) => item.status === "pending" || item.status === "active")), [commit]);
  const cancelActive = useCallback(() => commit((items) => items.map((item) => item.status === "active" ? { ...item, status: "cancelled" } : item)), [commit]);

  return {
    queue, queueRef, processingRef, processNext, enqueue, removeItem, clearCompleted,
    cancelActive, updateItemStatus, registerListeners,
    isProcessing: queue.some((item) => item.status === "active"),
    hasQueue: queue.length > 0,
  };
}
