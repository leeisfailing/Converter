import { useEffect } from "react";
import type { useQueue } from "../lib/useQueue";
import type useToast from "../lib/useToast";

export function useQueueEvents(
  { registerListeners, updateItemStatus }: ReturnType<typeof useQueue>,
  addToast: ReturnType<typeof useToast>["addToast"],
) {
  useEffect(() => {
    const cleanup = (["download", "convert", "blur"] as const).map((type) =>
      registerListeners(type, {
        onProgress: (id, progress) => updateItemStatus(id, "active", { progress }),
        onFinished: (id, ok, message, filePath) => {
          updateItemStatus(id, ok ? "completed" : "failed", {
            ...(ok ? { progress: 100 } : {}), resultPath: filePath || undefined, error: ok ? undefined : message,
          });
          const title = type === "convert" ? "Conversion" : type === "blur" ? "Blur" : "Download";
          addToast(ok ? "success" : "error", `${title} ${ok ? "complete" : "failed"}`, message);
        },
      }),
    );
    return () => cleanup.forEach((dispose) => dispose());
  }, [registerListeners, updateItemStatus, addToast]);
}
