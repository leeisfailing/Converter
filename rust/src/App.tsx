import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { tempDir } from "@tauri-apps/api/path";
import URLDownloader from "./components/URLDownloader";
import FileConverter from "./components/FileConverter";
import BlurSettings from "./components/BlurSettings";
import QueueManager from "./components/QueueManager";
import {
  startDownload,
  startConvert,
  startBlur,
  compressFile,
  cancelOperation,
} from "./lib/tauri-commands";
import type { QueueItem } from "./lib/queue-types";
import type { BlurSettings as BlurSettingsType } from "./components/BlurSettings";
import { Download, ArrowRightLeft, Zap, Film, Sun, Moon } from "lucide-react";

type Mode = "download" | "convert" | "blur";

let nextId = 0;
function genId() {
  return `q-${Date.now()}-${++nextId}`;
}

function getInitialTheme(): "dark" | "light" {
  const saved = localStorage.getItem("app_theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function App() {
  const [mode, setMode] = useState<Mode>("download");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const processingRef = useRef(false);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

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

    // Blur events
    const unlistenBlurProgress = listen<number>("blur-progress", (e) => {
      setQueue((prev) =>
        prev.map((item) =>
          item.status === "active" ? { ...item, progress: e.payload } : item
        )
      );
    });
    const unlistenBlurFinished = listen<{
      ok: boolean;
      message: string;
      file_path: string;
    }>("blur-finished", (e) => {
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
      unlistenBlurProgress.then((fn) => fn());
      unlistenBlurFinished.then((fn) => fn());
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
      } else if (nextItem.type === "compress") {
        await compressFile({
          input: nextItem.inputPath!,
          output: nextItem.outputPath!,
          target_size_bytes: nextItem.targetSizeBytes!,
        });
      } else if (nextItem.type === "blur") {
        await startBlur({
          input: nextItem.inputPath!,
          output: nextItem.outputPath!,
          settings: nextItem.blurSettings!,
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
    devMode: boolean,
    compressSize?: number,
    compressUnit?: string
  ) => {
    const fileName = inputPath.split(/[\\/]/).pop() || inputPath;

    if (outputFormat === "compress" && compressSize) {
      const sizeLabel = compressSize >= 1073741824
        ? `${(compressSize / 1073741824).toFixed(1)} GB`
        : compressSize >= 1048576
        ? `${(compressSize / 1048576).toFixed(1)} MB`
        : `${(compressSize / 1024).toFixed(1)} KB`;
      addToQueue({
        id: genId(),
        type: "compress",
        status: "pending",
        progress: 0,
        inputPath,
        outputPath,
        targetSizeBytes: compressSize,
        label: `${fileName} → ${sizeLabel}`,
        createdAt: Date.now(),
      });
    } else {
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
    }
  };

  const handleBlurAdd = (inputPath: string, outputPath: string, blurSettings: BlurSettingsType) => {
    const fileName = inputPath.split(/[\\/]/).pop() || inputPath;
    addToQueue({
      id: genId(),
      type: "blur",
      status: "pending",
      progress: 0,
      inputPath,
      outputPath,
      blurSettings: blurSettings as unknown as Record<string, unknown>,
      label: `${fileName} → Blur`,
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
    <>
      <div className="grain-overlay" />
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-[700px] mx-auto space-y-5 pb-8">
          {/* Theme Toggle */}
          <button onClick={toggleTheme} className="theme-toggle">
            {theme === "dark" ? (
              <Sun size={18} className="text-glass-accent-text" />
            ) : (
              <Moon size={18} className="text-glass-accent" />
            )}
          </button>

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-glass-accent-dim border border-glass-accent/30 mb-3">
              <Zap size={24} className="text-glass-accent" />
            </div>
            <h1 className="text-3xl font-display text-glass-text tracking-tight">Converter</h1>
            <p className="text-xs text-glass-text-muted mt-1">Download, convert & blur media files</p>
          </motion.div>

          {/* Mode Tabs */}
          <div className="glass-panel p-1.5 flex gap-1">
            {([
              { id: "download" as Mode, label: "Download", icon: Download },
              { id: "convert" as Mode, label: "Convert", icon: ArrowRightLeft },
              { id: "blur" as Mode, label: "Blur", icon: Film },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => !isProcessing && setMode(id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  mode === id
                    ? "bg-glass-accent text-white shadow-glow"
                    : "text-glass-text-dim hover:text-glass-text hover:bg-glass-surface-hover"
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          {/* Input Area */}
          <AnimatePresence mode="wait">
            {mode === "download" && (
              <motion.div key="download" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <URLDownloader onAdd={handleDownloadAdd} disabled={isProcessing} />
              </motion.div>
            )}
            {mode === "convert" && (
              <motion.div key="convert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <FileConverter onAdd={handleConvertAdd} disabled={isProcessing} />
              </motion.div>
            )}
            {mode === "blur" && (
              <motion.div key="blur" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <BlurSettings onAdd={handleBlurAdd} disabled={isProcessing} />
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
              className="w-full glass-btn py-2.5 bg-glass-danger-dim border-glass-danger/30 text-glass-danger hover:bg-glass-danger/20 text-sm"
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
    </>
  );
}
