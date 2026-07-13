import React from "react";
import { useState, useEffect, useCallback, useRef, Component } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { tempDir, sep } from "@tauri-apps/api/path";
import URLDownloader from "./components/URLDownloader";
import FileConverter from "./components/FileConverter";
import BlurSettings from "./components/BlurSettings";
import QueueManager from "./components/QueueManager";
import DebugConsole from "./components/DebugConsole";
import SettingsPanel from "./components/Settings";
import useDebugConsole from "./hooks/useDebugConsole";
import {
  startDownload,
  startConvert,
  startBlur,
  compressFile,
  cancelOperation,
  getSettings,
} from "./lib/tauri-commands";
import type { AppSettings } from "./lib/tauri-commands";
import type { QueueItem } from "./lib/queue-types";
import type { BlurSettings as BlurSettingsType } from "./components/BlurSettings";
import { Download, ArrowRightLeft, Zap, Film, Sun, Moon, Terminal, Settings } from "lucide-react";

type Mode = "download" | "convert" | "blur";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      return (
        <div className="glass-panel p-6 m-4 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 mb-3">
            <Zap size={20} className="text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-glass-text mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-glass-text-muted mb-4">
            {err?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="glass-btn px-4 py-2 text-sm text-glass-text hover:bg-glass-surface-hover"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

let nextId = 0;
function genId() {
  return `q-${Date.now()}-${++nextId}`;
}

function getInitialTheme(): "dark" | "light" {
  const saved = localStorage.getItem("app_theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyAutoSave(outputPath: string, autoSave: boolean, outputDir: string): string {
  if (!autoSave || !outputDir) return outputPath;
  const baseName = outputPath.split(/[\\/]/).pop() || outputPath;
  return outputDir.replace(/[\\/]+$/, "") + sep + baseName;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("download");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const [showConsole, setShowConsole] = useState(() => {
    return localStorage.getItem("debug_console_open") === "true";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    downloadDir: "",
    outputDir: "",
    autoSave: false,
    overwriteExisting: false,
  });
  const processingRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const debugConsole = useDebugConsole({ maxLogs: 500 });

  // Load settings on mount
  useEffect(() => {
    getSettings()
      .then(setAppSettings)
      .catch(() => {});
  }, []);

  // Keyboard shortcut: Ctrl+, to toggle settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Keep queueRef in sync
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

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
      console.log(`[event] download-progress: ${e.payload}%`);
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
      console.log(`[event] download-finished: ok=${e.payload.ok}, msg="${e.payload.message}", path="${e.payload.file_path}"`);
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
      console.log(`[event] convert-progress: ${e.payload}%`);
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
      console.log(`[event] convert-finished: ok=${e.payload.ok}, msg="${e.payload.message}", path="${e.payload.file_path}"`);
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
      console.log(`[event] blur-progress: ${e.payload}%`);
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
      console.log(`[event] blur-finished: ok=${e.payload.ok}, msg="${e.payload.message}", path="${e.payload.file_path}"`);
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

    const nextItem = queueRef.current.find((i) => i.status === "pending");
    if (!nextItem) return;

    console.log(`[queue] Processing: "${nextItem.label}" (${nextItem.type})`);
    processingRef.current = true;

    // Mark as active
    setQueue((prev) =>
      prev.map((item) =>
        item.id === nextItem.id ? { ...item, status: "active", progress: 0 } : item
      )
    );

    try {
      if (nextItem.type === "download") {
        const outputDir = nextItem.outputDir || appSettings.downloadDir || (await tempDir());
        await startDownload({
          url: nextItem.url!,
          format_type: nextItem.formatType || "bestvideo+bestaudio/best",
          output_dir: outputDir,
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
        processingRef.current = false;
        setQueue((prev) =>
          prev.map((item) =>
            item.id === nextItem.id
              ? { ...item, status: "completed", progress: 100, resultPath: nextItem.outputPath }
              : item
          )
        );
      } else if (nextItem.type === "blur") {
        await startBlur({
          input: nextItem.inputPath!,
          output: nextItem.outputPath!,
          settings: nextItem.blurSettings!,
        });
      }
    } catch (err) {
      console.error(`[queue] Failed: "${nextItem.label}"`, err);
      setQueue((prev) =>
        prev.map((item) =>
          item.id === nextItem.id
            ? { ...item, status: "failed", error: String(err) }
            : item
        )
      );
      processingRef.current = false;
    }
  }, [appSettings]);

  // Auto-process queue when items change
  useEffect(() => {
    const timer = setTimeout(() => processNext(), 100);
    return () => clearTimeout(timer);
  }, [queue, processNext]);

  const addToQueue = useCallback((item: QueueItem) => {
    console.log(`[queue] Added: "${item.label}" (${item.type}, status=${item.status})`);
    setQueue((prev) => [...prev, item]);
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue((prev) =>
      prev.filter((i) => i.status === "pending" || i.status === "active")
    );
  }, []);

  const handleDownloadAdd = useCallback((url: string, formatType: string) => {
    const isYoutube = url.toLowerCase().includes("youtube.com") || url.toLowerCase().includes("youtu.be");
    const label = isYoutube ? url.replace(/https?:\/\/(www\.)?/, "").substring(0, 50) : url.split("/").pop()?.substring(0, 50) || url;
    addToQueue({
      id: genId(),
      type: "download",
      status: "pending",
      progress: 0,
      url,
      formatType,
      outputDir: appSettings.downloadDir || undefined,
      label: `${label}${formatType === "mp3" ? " (MP3)" : formatType === "mp4" ? " (MP4)" : ""}`,
      createdAt: Date.now(),
    });
  }, [addToQueue, appSettings]);

  const handleConvertAdd = useCallback((
    inputPath: string,
    outputPath: string,
    outputFormat: string,
    devMode: boolean,
    compressSize?: number,
    _compressUnit?: string
  ) => {
    const fileName = inputPath.split(/[\\/]/).pop() || inputPath;

    const finalOutputPath = applyAutoSave(outputPath, appSettings.autoSave, appSettings.outputDir);

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
        outputPath: finalOutputPath,
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
        outputPath: finalOutputPath,
        outputFormat,
        devMode,
        label: `${fileName} → ${outputFormat.toUpperCase()}`,
        createdAt: Date.now(),
      });
    }
  }, [addToQueue, appSettings]);

  const handleBlurAdd = useCallback((inputPath: string, outputPath: string, blurSettings: BlurSettingsType) => {
    const fileName = inputPath.split(/[\\/]/).pop() || inputPath;

    const finalOutputPath = applyAutoSave(outputPath, appSettings.autoSave, appSettings.outputDir);

    addToQueue({
      id: genId(),
      type: "blur",
      status: "pending",
      progress: 0,
      inputPath,
      outputPath: finalOutputPath,
      blurSettings: blurSettings,
      label: `${fileName} → Blur`,
      createdAt: Date.now(),
    });
  }, [addToQueue, appSettings]);

  const handleCancel = useCallback(async () => {
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
  }, []);

  const isProcessing = queue.some((i) => i.status === "active");

  return (
    <>
      <div className="grain-overlay" />
      <ErrorBoundary>
        <div className="h-full overflow-y-auto p-6">
          <div className="max-w-[700px] mx-auto space-y-5 pb-8">
            {/* Top-right controls */}
            <div className="top-right-controls">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`settings-toggle ${showSettings ? "active" : ""}`}
                title={showSettings ? "Close settings (Ctrl+,)" : "Open settings (Ctrl+,)"}
              >
                <Settings size={18} className={showSettings ? "text-glass-accent" : "text-glass-text-muted"} />
                {appSettings.autoSave && (
                  <span className="settings-badge" />
                )}
              </button>
              <button onClick={toggleTheme} className="theme-toggle">
                {theme === "dark" ? (
                  <Sun size={18} className="text-glass-accent-text" />
                ) : (
                  <Moon size={18} className="text-glass-accent" />
                )}
              </button>
              <button
                onClick={() => {
                  const next = !showConsole;
                  setShowConsole(next);
                  localStorage.setItem("debug_console_open", String(next));
                }}
                className={`console-toggle ${showConsole ? "active" : ""}`}
                title={showConsole ? "Hide debug console" : "Show debug console"}
              >
                <Terminal size={18} className={showConsole ? "text-glass-accent" : "text-glass-text-muted"} />
              </button>
            </div>

            {/* Header */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-glass-accent-dim border border-glass-accent/30 mb-3">
                <Zap size={24} className="text-glass-accent" />
              </div>
              <h1 className="text-3xl font-display text-glass-text tracking-tight">Converter</h1>
              <p className="text-xs text-glass-text-muted mt-1">Download, convert & blur media files</p>
            </motion.div>

            {/* Mode Tabs */}
            {!showSettings && (
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
            )}

            {/* Input Area */}
            <AnimatePresence mode="wait">
              {showSettings ? (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                >
                  <div className="glass-panel p-4 mb-2">
                    <h2 className="text-sm font-semibold text-glass-text flex items-center gap-2">
                      <Settings size={14} className="text-glass-accent" />
                      Application Settings
                    </h2>
                  </div>
                  <SettingsPanel
                    onSettingsChanged={setAppSettings}
                    disabled={isProcessing}
                  />
                </motion.div>
              ) : (
                <>
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
                </>
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

            {/* Debug Console */}
            <AnimatePresence>
              {showConsole && (
                <DebugConsole
                  logs={debugConsole.logs}
                  onClear={debugConsole.clearLogs}
                  isCapturing={debugConsole.isCapturing}
                  onToggleCapture={() => debugConsole.setIsCapturing(!debugConsole.isCapturing)}
                />
              )}
            </AnimatePresence>

            {/* Queue */}
            <QueueManager
              items={queue}
              onRemove={removeFromQueue}
              onClearCompleted={clearCompleted}
            />
          </div>
        </div>
      </ErrorBoundary>
    </>
  );
}
