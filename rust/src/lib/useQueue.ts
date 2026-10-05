import { isParallelVideoTask } from "./gpu-selection";
import { useState, useCallback, useRef } from "react";
import { subscribeToEvent } from "./tauri-events";
import type { QueueItem, QueueItemStatus } from "./queue-types";
import type { FinishedEvent, ConcurrencySnapshot } from "./tauri-commands";

type QueueEventType = "download" | "convert" | "transcoder" | "upscale" | "enhance";
interface QueueEventHandlers {
  onProgress: (id: string, progress: number) => void;
  onDownloadStatus: (id: string, speed: number, eta: number, isLive: boolean, phase?: string) => void;
  onFinished: (id: string, ok: boolean, message: string, filePath: string) => void;
}

function freshAttempt(item: QueueItem): QueueItem {
  return {
    ...item,
    id: crypto.randomUUID(),
    status: "pending",
    progress: 0,
    createdAt: Date.now(),
    assignedGpu: undefined,
    error: undefined,
    resultPath: undefined,
    downloadSpeed: undefined,
    downloadEta: undefined,
    downloadIsLive: undefined,
    downloadPhase: undefined,
  };
}

export function useQueue(onPauseChange?: (paused: boolean) => Promise<void>) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [pausePending, setPausePending] = useState(false);
  const pauseTransition = useRef(false);
  const concurrencyRef = useRef<ConcurrencySnapshot>({
    download: 1, convert: 1, transcoder: 1, upscale: 1,
    activeDownload: 0, activeConvert: 0, activeTranscoder: 0, activeUpscale: 0,
  });
  const gpuReservations = useRef(new Map<string, string>());
  const inFlightIds = useRef(new Set<string>());
  const retryWaitsFor = useRef(new Map<string, string>());
  const activeByType = useRef<Record<string, number>>({ download: 0, convert: 0, transcoder: 0, upscale: 0, enhance: 0 });

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

  interface DownloadStatusPayload { id?: string; percent: number; speed: number; eta: number; is_live: boolean; status: string; }

  const registerListeners = useCallback((type: QueueEventType, handlers: QueueEventHandlers) => {
    // Native events may arrive after cancellation or command completion.
    const isActiveItem = (id: string) => queueRef.current.some((item) => item.id === id && item.type === type && item.status === "active");
    const progress = subscribeToEvent<{ id?: string; percent?: number } | number>(`${type}-progress`, ({ payload }) => {
      let id: string | undefined;
      let percent: number;
      if (typeof payload === "number") {
        percent = payload;
      } else {
        id = payload?.id;
        percent = payload?.percent ?? 0;
      }
      if (!id || !isActiveItem(id)) return;
      if (Number.isFinite(percent)) handlers.onProgress(id, percent);
    });
    const status = subscribeToEvent<DownloadStatusPayload>(`${type}-status`, ({ payload }) => {
      const id = payload?.id;
      if (!id || !isActiveItem(id)) return;
      handlers.onDownloadStatus(id, payload.speed ?? 0, payload.eta ?? 0, payload.is_live ?? false, payload.status);
    });
    const finished = subscribeToEvent<FinishedEvent & { id?: string }>(`${type}-finished`, ({ payload }) => {
      const id = payload?.id;
      if (!id || !isActiveItem(id)) return;
      handlers.onFinished(id, payload.ok, payload.message, payload.file_path);
    });
    return () => { progress(); status(); finished(); };
  }, []);

  const maxForType = useCallback((type: string): number => {
    const snap = concurrencyRef.current;
    switch (type) {
      case "download": return snap.download;
      case "convert": return snap.convert;
      case "transcoder": return snap.transcoder;
      case "upscale": return snap.upscale;
      default: return 1;
    }
  }, []);

  const processNextBatch = useCallback((onProcess: (item: QueueItem) => Promise<void>, gpuEncoders?: string[]) => {
    if (pausedRef.current) return;
    const pending = queueRef.current.filter((entry) => entry.status === "pending");
    for (const item of pending) {
      if (pausedRef.current) break;
      if (!queueRef.current.some((entry) => entry.id === item.id && entry.status === "pending")) continue;
      if (retryWaitsFor.current.has(item.id)) continue;
      const type = item.type;
      const limit = maxForType(type);
      const current = activeByType.current[type] ?? 0;
      if (current >= limit) continue;
      let assignedGpu: string | undefined;
      if (gpuEncoders && isParallelVideoTask(item)) {
        if (!gpuEncoders.length) {
          updateItemStatus(item.id, "failed", { error: "No working GPU is available for parallel tasks. Choose another mode in Settings." });
          continue;
        }
        assignedGpu = gpuEncoders.find(encoder => ![...gpuReservations.current.values()].includes(encoder));
        if (!assignedGpu) continue;
        gpuReservations.current.set(item.id, assignedGpu);
      }
      inFlightIds.current.add(item.id);
      activeByType.current[type] = current + 1;
      updateItemStatus(item.id, "active", { progress: 0, assignedGpu });
      void (async () => {
        try {
          await onProcess({ ...item, assignedGpu });
          if (queueRef.current.find((entry) => entry.id === item.id)?.status === "active") {
            updateItemStatus(item.id, "completed", { progress: 100, resultPath: item.outputPath });
          }
        } catch (error) {
          if (queueRef.current.find((entry) => entry.id === item.id)?.status === "active") {
            updateItemStatus(item.id, "failed", { error: String(error) });
          }
        } finally {
          gpuReservations.current.delete(item.id);
          inFlightIds.current.delete(item.id);
          for (const [retryId, previousId] of retryWaitsFor.current) {
            if (previousId === item.id) retryWaitsFor.current.delete(retryId);
          }
          activeByType.current[type] = Math.max(0, (activeByType.current[type] ?? 1) - 1);
          commit((items) => [...items]);
        }
      })();
    }
  }, [commit, updateItemStatus, maxForType]);

  const setConcurrency = useCallback((snapshot: ConcurrencySnapshot) => {
    concurrencyRef.current = snapshot;
    commit((items) => [...items]);
  }, [commit]);

  const togglePaused = useCallback(async () => {
    if (pauseTransition.current) return;
    const previous = pausedRef.current;
    const next = !previous;
    pauseTransition.current = true;
    // Stop admission immediately, including while resume is being confirmed.
    pausedRef.current = true;
    setPausePending(true);
    try {
      if (onPauseChange) await onPauseChange(next);
      pausedRef.current = next;
      setPaused(next);
    } catch (error) {
      pausedRef.current = previous;
      commit((items) => [...items]);
      throw error;
    } finally {
      pauseTransition.current = false;
      setPausePending(false);
    }
  }, [commit, onPauseChange]);

  // Each attempt needs its own ID: events and cleanup from a previous attempt
  // must never complete, fail, or release resources belonging to its retry.
  const retryItem = useCallback((id: string) => {
    commit((items) => items.map((item) => {
      if (item.id !== id || (item.status !== "failed" && item.status !== "cancelled")) return item;
      const retry = freshAttempt(item);
      if (inFlightIds.current.has(item.id)) retryWaitsFor.current.set(retry.id, item.id);
      return retry;
    }));
  }, [commit]);

  const retryFailed = useCallback(() => {
    commit((items) => items.map((item) => {
      if (item.status !== "failed") return item;
      const retry = freshAttempt(item);
      if (inFlightIds.current.has(item.id)) retryWaitsFor.current.set(retry.id, item.id);
      return retry;
    }));
  }, [commit]);

  const enqueue = useCallback((item: QueueItem) => commit((items) => [...items, item]), [commit]);
  const removeItem = useCallback((id: string) => commit((items) => items.filter((item) => item.id !== id || item.status === "active")), [commit]);
  const clearCompleted = useCallback(() => commit((items) => items.filter((item) => item.status === "pending" || item.status === "active")), [commit]);
  const cancelActive = useCallback(() => commit((items) => items.map((item) => item.status === "active" ? { ...item, status: "cancelled" } : item)), [commit]);
  const cancelItem = useCallback((id: string) => commit((items) => items.map((item) => item.id === id && item.status === "active" ? { ...item, status: "cancelled" } : item)), [commit]);
  const requestCancel = useCallback(async (cancel: () => Promise<void>, id?: string) => {
    // Record user intent before native cleanup emits its terminal events.
    if (id === undefined) cancelActive();
    else cancelItem(id);
    await cancel();
  }, [cancelActive, cancelItem]);

  return {
    queue, queueRef, paused, pausePending, togglePaused, retryItem, retryFailed,
    processNextBatch, enqueue, removeItem, clearCompleted,
    cancelActive, cancelItem, requestCancel, updateItemStatus, registerListeners, setConcurrency, concurrencyRef,
    isProcessing: queue.some((item) => item.status === "active") || Object.values(activeByType.current).some((count) => count > 0),
    hasQueue: queue.length > 0,
  };
}
