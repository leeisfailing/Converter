import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { tempDir, sep } from "@tauri-apps/api/path";
import URLDownloader from "./components/URLDownloader";
import FileConverter from "./components/FileConverter";
import BlurSettings from "./components/BlurSettings";
import QueueManager from "./components/QueueManager";
import DebugConsole from "./components/DebugConsole";
import SettingsPanel from "./components/Settings";
import ToastContainer from "./components/Toast";
import useDebugConsole from "./hooks/useDebugConsole";
import useToast from "./lib/useToast";
import { useQueue } from "./lib/useQueue";
import { useKeyboardShortcuts } from "./lib/useKeyboardShortcuts";
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

class ErrorBoundary extends React.Component<
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
        <div className="panel p-6 m-4 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-app-danger-dim mb-3">
            <Zap size={20} className="text-app-danger" />
          </div>
          <h2 className="text-lg font-semibold text-app-text mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-app-text-muted mb-4">
            {err?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn px-4 py-2 text-sm"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
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

let nextId = 0;
function genId(): string {
  return `q-${Date.now()}-${++nextId}`;
}

const MODE_CONFIG = [
  { id: "download" as Mode, label: "Download", icon: Download },
  { id: "convert" as Mode, label: "Convert", icon: ArrowRightLeft },
  { id: "blur" as Mode, label: "Blur", icon: Film },
];

export default function App() {
  const [mode, setMode] = useState<Mode>("download");
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const [showConsole, setShowConsole] = useState(() => localStorage.getItem("debug_console_open") === "true");
  const [showSettings, setShowSettings] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    downloadDir: "",
    outputDir: "",
    autoSave: false,
    overwriteExisting: false,
  });

  const debugConsole = useDebugConsole({ maxLogs: 500 });
  const toast = useToast();
  const queue = useQueue();

  const processNextCallback = useCallback(async (item: QueueItem) => {
    try {
      const currentSettings = appSettings;
      if (item.type === "download") {
        const outputDir = item.outputDir || currentSettings.downloadDir || (await tempDir());
        await startDownload({ url: item.url!, format_type: item.formatType || "bestvideo+bestaudio/best", output_dir: outputDir });
      } else if (item.type === "compress") {
        await compressFile({ input: item.inputPath!, output: item.outputPath!, target_size_bytes: item.targetSizeBytes! });
      } else if (item.type === "convert") {
        await startConvert({ input: item.inputPath!, output: item.outputPath!, format: item.outputFormat!, dev_mode: item.devMode || false });
      } else if (item.type === "blur") {
        await startBlur({ input: item.inputPath!, output: item.outputPath!, settings: item.blurSettings! });
      }
    } catch (err) {
      console.error(`[queue] Failed: "${item.label}"`, err);
    }
  }, [appSettings]);

  useEffect(() => {
    getSettings()
      .then(setAppSettings)
      .catch((err) => console.warn("[app] Failed to load settings:", err));
  }, []);

  useKeyboardShortcuts([
    { key: ",", ctrl: true, action: () => setShowSettings((prev) => !prev) },
    { key: "d", ctrl: true, shift: true, action: () => setShowConsole((prev) => !prev) },
    { key: "q", ctrl: true, action: () => {
      const active = queue.queueRef.current.find((i) => i.status === "active");
      if (active) cancelOperation().then(() => queue.cancelActive());
    }},
    { key: "Escape", action: () => {
      if (showSettings) setShowSettings(false);
      else if (showConsole) setShowConsole(false);
    }, enabled: showSettings || showConsole },
  ]);

  useEffect(() => {
    queue.registerListeners("download", {
      onProgress: (id, progress) => queue.updateItemStatus(id, "active", { progress }),
      onFinished: (id, ok, message, filePath) => {
        queue.updateItemStatus(id, ok ? "completed" : "failed", { progress: ok ? 100 : undefined, resultPath: filePath || undefined, error: ok ? undefined : message });
        toast.addToast(ok ? "success" : "error", ok ? "Download complete" : "Download failed", message);
      },
    });

    queue.registerListeners("convert", {
      onProgress: (id, progress) => queue.updateItemStatus(id, "active", { progress }),
      onFinished: (id, ok, message, filePath) => {
        queue.updateItemStatus(id, ok ? "completed" : "failed", { progress: ok ? 100 : undefined, resultPath: filePath || undefined, error: ok ? undefined : message });
        toast.addToast(ok ? "success" : "error", ok ? "Conversion complete" : "Conversion failed", message);
      },
    });

    queue.registerListeners("blur", {
      onProgress: (id, progress) => queue.updateItemStatus(id, "active", { progress }),
      onFinished: (id, ok, message, filePath) => {
        queue.updateItemStatus(id, ok ? "completed" : "failed", { progress: ok ? 100 : undefined, resultPath: filePath || undefined, error: ok ? undefined : message });
        toast.addToast(ok ? "success" : "error", ok ? "Blur complete" : "Blur failed", message);
      },
    });
  }, [queue, toast]);

  useEffect(() => {
    const timer = setTimeout(() => queue.processNext(processNextCallback), 100);
    return () => clearTimeout(timer);
  }, [queue.queue, processNextCallback, queue.processNext]);

  const addToQueue = useCallback((item: QueueItem) => {
    queue.enqueue(item);
  }, [queue.enqueue]);

  const removeFromQueue = useCallback((id: string) => {
    queue.removeItem(id);
  }, [queue.removeItem]);

  const clearCompleted = useCallback(() => {
    queue.clearCompleted();
  }, [queue.clearCompleted]);

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
    toast.addToast("info", "Added to queue", `${label} (${formatType.toUpperCase()})`);
  }, [addToQueue, appSettings]);

  const handleConvertAdd = useCallback((
    inputPath: string, outputPath: string, outputFormat: string,
    devMode: boolean, compressSize?: number
  ) => {
    const fileName = inputPath.split(/[\\/]/).pop() || inputPath;
    const finalOutputPath = applyAutoSave(outputPath, appSettings.autoSave, appSettings.outputDir);

    if (outputFormat === "compress" && compressSize) {
      const sizeLabel = compressSize >= 1073741824
        ? `${(compressSize / 1073741824).toFixed(1)} GB`
        : compressSize >= 1048576 ? `${(compressSize / 1048576).toFixed(1)} MB`
        : `${(compressSize / 1024).toFixed(1)} KB`;
      addToQueue({
        id: genId(),
        type: "compress",
        status: "pending",
        progress: 0,
        inputPath, outputPath: finalOutputPath, targetSizeBytes: compressSize,
        label: `${fileName} → ${sizeLabel}`,
        createdAt: Date.now(),
      });
    } else {
      addToQueue({
        id: genId(),
        type: "convert",
        status: "pending",
        progress: 0,
        inputPath, outputPath: finalOutputPath, outputFormat, devMode,
        label: `${fileName} → ${outputFormat.toUpperCase()}`,
        createdAt: Date.now(),
      });
    }
    toast.addToast("info", "Added to queue", `${fileName} → ${outputFormat.toUpperCase()}`);
  }, [addToQueue, appSettings]);

  const handleBlurAdd = useCallback((inputPath: string, outputPath: string, blurSettings: BlurSettingsType) => {
    const fileName = inputPath.split(/[\\/]/).pop() || inputPath;
    const finalOutputPath = applyAutoSave(outputPath, appSettings.autoSave, appSettings.outputDir);
    addToQueue({
      id: genId(),
      type: "blur",
      status: "pending",
      progress: 0,
      inputPath, outputPath: finalOutputPath, blurSettings,
      label: `${fileName} → Blur`,
      createdAt: Date.now(),
    });
    toast.addToast("info", "Added to queue", `${fileName} → Blur`);
  }, [addToQueue, appSettings]);

  const handleCancel = useCallback(async () => {
    try {
      await cancelOperation();
      queue.cancelActive();
      toast.addToast("warning", "Cancelled", "Current operation stopped");
    } catch (err) {
      console.error(err);
    }
  }, [queue]);

  const isProcessing = queue.isProcessing;
  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <ErrorBoundary>
      <div className="h-full flex flex-col bg-app-bg">
        <header className="flex items-center justify-between px-5 py-3 border-b border-app-border bg-app-surface">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-app-accent-dim">
              <Zap size={16} className="text-app-accent" />
            </div>
            <h1 className="text-base font-semibold text-app-text tracking-tight">Converter</h1>
            <span className="text-[10px] text-app-text-muted bg-app-surface-hover px-1.5 py-0.5 rounded">v3.0</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const next = !showConsole;
                setShowConsole(next);
                localStorage.setItem("debug_console_open", String(next));
              }}
              className={`btn-icon ${showConsole ? "active" : ""}`}
              title={showConsole ? "Hide console (Ctrl+Shift+D)" : "Show console"}
            >
              <Terminal size={16} />
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`btn-icon ${showSettings ? "active" : ""}`}
              title={showSettings ? "Close settings" : "Settings (Ctrl+,)"}
            >
              <Settings size={16} />
              {appSettings.autoSave && <span className="settings-badge" />}
            </button>
            <button onClick={toggleTheme} className="btn-icon" title="Toggle theme">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-[600px] mx-auto space-y-4">
              {!showSettings && (
                <div className="radio-group">
                  {MODE_CONFIG.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => !isProcessing && setMode(id)}
                      className={`radio-pill ${mode === id ? "active" : ""}`}
                      disabled={isProcessing}
                    >
                      <Icon size={15} />
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <AnimatePresence mode="wait">
                {showSettings ? (
                  <motion.div key="settings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Settings size={14} className="text-app-accent" />
                      <h2 className="text-sm font-semibold text-app-text">Application Settings</h2>
                    </div>
                    <SettingsPanel onSettingsChanged={setAppSettings} disabled={isProcessing} />
                  </motion.div>
                ) : (
                  <>
                    {mode === "download" && (
                      <motion.div key="download" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                        <URLDownloader onAdd={handleDownloadAdd} disabled={isProcessing} />
                      </motion.div>
                    )}
                    {mode === "convert" && (
                      <motion.div key="convert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                        <FileConverter onAdd={handleConvertAdd} disabled={isProcessing} />
                      </motion.div>
                    )}
                    {mode === "blur" && (
                      <motion.div key="blur" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                        <BlurSettings onAdd={handleBlurAdd} disabled={isProcessing} />
                      </motion.div>
                    )}
                  </>
                )}
              </AnimatePresence>

              {isProcessing && (
                <motion.button
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCancel}
                  className="w-full btn btn-danger py-2.5 text-sm"
                >
                  Cancel Current
                </motion.button>
              )}

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
            </div>
          </div>

          {queue.hasQueue && (
            <div className="w-[300px] border-l border-app-border bg-app-surface overflow-hidden flex flex-col">
              <QueueManager
                items={queue.queue}
                onRemove={removeFromQueue}
                onClearCompleted={clearCompleted}
              />
            </div>
          )}
        </div>

        <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      </div>
    </ErrorBoundary>
  );
}
