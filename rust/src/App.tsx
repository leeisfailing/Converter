import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { tempDir } from "@tauri-apps/api/path";
import URLDownloader from "./components/URLDownloader";
import FileConverter from "./components/FileConverter";
import QueueManager from "./components/QueueManager";
import { startDownload, startConvert, cancelOperation } from "./lib/tauri-commands";
import type { QueueItem } from "./lib/queue-types";
import { Download, ArrowRightLeft, Zap } from "lucide-react";

type Mode = "download" | "convert";

let nextId = 0;
function genId() {
  return `q-${Date.now()}-${++nextId}`;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("download");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const processingRef = useRef(false);

  // Listen for progress events
  useEffect(() => {
    const unlistenDlProgress = listen<number>("download-progress", (e) => {
      setQueue((prev) =>
        prev.map((item) =>
          item.status === "active" ? { ...item, progress: e.payload } : item
        )
      );
    });
    const unlistenDlFinished = listen<{
      ok: boolean;
      message: string;
      file_path: string;
    }>("download-finished", (e) => {
      setQueue((prev) =>
        prev.map((item) =>
          item.status === "active"
            ? {
                ...item,
                status: e.payload.ok ? "completed" : "failed",
                progress: e.payload.ok ? 100 : item.progress,
                resultPath: e.payload.file_path || undefined,
                error: e.payload.ok ? undefined : e.payload.message,
              }
            : item
        )
      );
      processingRef.current = false;
    });
    const unlistenCvProgress = listen<number>("convert-progress", (e) => {
      setQueue((prev) =>
        prev.map((item) =>
          item.status === "active" ? { ...item, progress: e.payload } : item
        )
      );
    });
    const unlistenCvFinished = listen<{
      ok: boolean;
      message: string;
      file_path: string;
    }>("convert-finished", (e) => {
      setQueue((prev) =>
        prev.map((item) =>
          item.status === "active"
            ? {
                ...item,
                status: e.payload.ok ? "completed" : "failed",
                progress: e.payload.ok ? 100 : item.progress,
                resultPath: e.payload.file_path || undefined,
                error: e.payload.ok ? undefined : e.payload.message,
              }
            : item
        )
      );
      processingRef.current = false;
    });

    return () => {
      unlistenDlProgress.then((fn) => fn());
      unlistenDlFinished.then((fn) => fn());
      unlistenCvProgress.then((fn) => fn());
      unlistenCvFinished.then((fn) => fn());
    };
  }, []);

  // Process next item in queue
  const processNext = useCallback(async () => {
    if (processingRef.current) return;

    const currentQueue = await new Promise<QueueItem[]>((resolve) => {
      setQueue((prev) => {
        resolve(prev);
        return prev;
      });
    });

    const nextItem = currentQueue.find((i) => i.status === "pending");
    if (!nextItem) return;

    processingRef.current = true;

    // Mark as active
    setQueue((prev) =>
      prev.map((item) =>
        item.id === nextItem.id ? { ...item, status: "active", progress: 0 } : item
      )
    );

    try {
      if (nextItem.type === "download") {
        await startDownload({
          url: nextItem.url!,
          format_type: nextItem.formatType || "bestvideo+bestaudio/best",
          output_dir: nextItem.outputDir || (await tempDir()),
        });
      } else if (nextItem.type === "convert") {
        await startConvert({
          input: nextItem.inputPath!,
          output: nextItem.outputPath!,
          format: nextItem.outputFormat!,
          dev_mode: nextItem.devMode || false,
        });
      }
    } catch (err) {
      setQueue((prev) =>
        prev.map((item) =>
          item.id === nextItem.id
            ? { ...item, status: "failed", error: String(err) }
            : item
        )
      );
      processingRef.current = false;
    }
  }, []);

  // Auto-process queue when items change
  useEffect(() => {
    const timer = setTimeout(() => processNext(), 100);
    return () => clearTimeout(timer);
  }, [queue, processNext]);

  const addToQueue = (item: QueueItem) => {
    setQueue((prev) => [...prev, item]);
  };

  const removeFromQueue = (id: string) => {
    setQueue((prev) => prev.filter((i) => i.id !== id));
  };

  const clearCompleted = () => {
    setQueue((prev) =>
      prev.filter((i) => i.status === "pending" || i.status === "active")
    );
  };

  const handleDownloadAdd = (url: string, formatType: string) => {
    const isYoutube = url.toLowerCase().includes("youtube.com") || url.toLowerCase().includes("youtu.be");
    const label = isYoutube ? url.replace(/https?:\/\/(www\.)?/, "").substring(0, 50) : url.split("/").pop()?.substring(0, 50) || url;
    addToQueue({
      id: genId(),
      type: "download",
      status: "pending",
      progress: 0,
      url,
      formatType,
      label: `${label}${formatType === "mp3" ? " (MP3)" : formatType === "mp4" ? " (MP4)" : ""}`,
      createdAt: Date.now(),
    });
  };

  const handleConvertAdd = (
    inputPath: string,
    outputPath: string,
    outputFormat: string,
    devMode: boolean
  ) => {
    const fileName = inputPath.split(/[\\/]/).pop() || inputPath;
    addToQueue({
      id: genId(),
      type: "convert",
      status: "pending",
      progress: 0,
      inputPath,
      outputPath,
      outputFormat,
      devMode,
      label: `${fileName} → ${outputFormat.toUpperCase()}`,
      createdAt: Date.now(),
    });
  };

  const handleCancel = async () => {
    try {
      await cancelOperation();
      setQueue((prev) =>
        prev.map((item) =>
          item.status === "active" ? { ...item, status: "cancelled" } : item
        )
      );
      processingRef.current = false;
    } catch (err) {
      console.error(err);
    }
  };

  const isProcessing = queue.some((i) => i.status === "active");

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-[700px] mx-auto space-y-5 pb-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-glass-accent/10 border border-glass-accent/20 mb-3">
            <Zap size={24} className="text-glass-accent" />
          </div>
          <h1 className="text-2xl font-bold text-white/95 tracking-tight">Converter</h1>
          <p className="text-xs text-white/30 mt-1">Download & convert media files</p>
        </motion.div>

        {/* Mode Tabs */}
        <div className="glass-panel p-1.5 flex gap-1">
          {([
            { id: "download" as Mode, label: "Download", icon: Download },
            { id: "convert" as Mode, label: "Convert", icon: ArrowRightLeft },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => !isProcessing && setMode(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                mode === id
                  ? "bg-glass-accent/15 text-glass-accent border border-glass-accent/20"
                  : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* Input Area */}
        <AnimatePresence mode="wait">
          {mode === "download" ? (
            <motion.div key="download" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <URLDownloader onAdd={handleDownloadAdd} disabled={isProcessing} />
            </motion.div>
          ) : (
            <motion.div key="convert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <FileConverter onAdd={handleConvertAdd} disabled={isProcessing} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cancel Button */}
        {isProcessing && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCancel}
            className="w-full glass-btn py-2.5 bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25 text-sm"
          >
            Cancel Current
          </motion.button>
        )}

        {/* Queue */}
        <QueueManager
          items={queue}
          onRemove={removeFromQueue}
          onClearCompleted={clearCompleted}
        />
      </div>
    </div>
  );
}
