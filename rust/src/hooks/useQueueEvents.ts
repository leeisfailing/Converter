import { useEffect } from "react";
import type { useQueue } from "../lib/useQueue";
import type useToast from "../lib/useToast";

export function useQueueEvents(
  { registerListeners, updateItemStatus }: ReturnType<typeof useQueue>,
  addToast: ReturnType<typeof useToast>["addToast"],
) {
  useEffect(() => {
    const cleanup = (["download", "convert", "reduce"] as const).map((type) =>
      registerListeners(type, {
        onProgress: (id, progress) => updateItemStatus(id, "active", { progress }),
        onDownloadStatus: (id, speed, eta, isLive) =>
          updateItemStatus(id, "active", { downloadSpeed: speed, downloadEta: eta, downloadIsLive: isLive }),
        onFinished: (id, ok, message, filePath) => {
          updateItemStatus(id, ok ? "completed" : "failed", {
            ...(ok ? { progress: 100 } : {}), resultPath: filePath || undefined, error: ok ? undefined : message,
            downloadSpeed: 0, downloadEta: 0,
          });
          const title = type === "convert" ? "Conversion" : type === "reduce" ? "Size Reduction" : "Download";
          addToast(ok ? "success" : "error", `${title} ${ok ? "complete" : "failed"}`, message);
        },
      }),
    );
    return () => cleanup.forEach((dispose) => dispose());
  }, [registerListeners, updateItemStatus, addToast]);
}
