import { useState, useCallback, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { QueueItem, QueueItemStatus } from "./queue-types";

type QueueEventType = "download" | "convert" | "blur";

interface QueueEventHandlers {
  onProgress: (id: string, progress: number) => void;
  onFinished: (id: string, ok: boolean, message: string, filePath: string) => void;
}

export function useQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const queueIdRef = useRef(0);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const registerListeners = useCallback(
    (type: QueueEventType, handlers: QueueEventHandlers) => {
      const prefix = type === "download" ? "download" : type === "convert" ? "convert" : "blur";

      const unlistenProgress = listen<number>(`${prefix}-progress`, (e) => {
        const id = queueRef.current.find((i) => i.status === "active" && i.type === type)?.id;
        if (id) handlers.onProgress(id, e.payload);
      });

      const unlistenFinished = listen<{ ok: boolean; message: string; file_path: string }>(
        `${prefix}-finished`,
        (e) => {
          const id = queueRef.current.find((i) => i.status === "active" && i.type === type)?.id;
          if (id) handlers.onFinished(id, e.payload.ok, e.payload.message, e.payload.file_path);
          processingRef.current = false;
        }
      );

      return () => {
        unlistenProgress.then((fn) => fn());
        unlistenFinished.then((fn) => fn());
      };
    },
    []
  );

  const processNext = useCallback(
    (onProcess: (item: QueueItem) => Promise<void>) => {
      if (processingRef.current) return;
      const nextItem = queueRef.current.find((i) => i.status === "pending");
      if (!nextItem) return;

      processingRef.current = true;
      setQueue((prev) =>
        prev.map((item) =>
          item.id === nextItem.id ? { ...item, status: "active" as QueueItemStatus, progress: 0 } : item
        )
      );

      onProcess(nextItem).catch((err) => {
        setQueue((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? { ...item, status: "failed" as QueueItemStatus, error: String(err) }
              : item
          )
        );
        processingRef.current = false;
      });
    },
    []
  );

  const enqueue = useCallback((item: QueueItem) => {
    setQueue((prev) => [...prev, item]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((i) => i.status === "pending" || i.status === "active"));
  }, []);

  const cancelActive = useCallback(() => {
    setQueue((prev) =>
      prev.map((item) =>
        item.status === "active" ? { ...item, status: "cancelled" as QueueItemStatus } : item
      )
    );
    processingRef.current = false;
  }, []);

  const updateItemStatus = useCallback((id: string, status: QueueItemStatus, extra?: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status, ...extra } : item
      )
    );
  }, []);

  const isProcessing = queue.some((i) => i.status === "active");
  const hasQueue = queue.length > 0;
  const activeCount = queue.filter((i) => i.status === "active").length;
  const completedCount = queue.filter((i) => i.status === "completed" || i.status === "failed" || i.status === "cancelled").length;

  return {
    queue,
    isProcessing,
    hasQueue,
    activeCount,
    completedCount,
    enqueue,
    removeItem,
    clearCompleted,
    cancelActive,
    updateItemStatus,
    processNext,
    registerListeners,
    queueRef,
    processingRef,
    queueIdRef,
  };
}
