import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { tempDir, sep } from "@tauri-apps/api/path";
import URLDownloader from "./components/URLDownloader";
import FileConverter from "./components/FileConverter";
const BlurSettings = lazy(() => import("./components/BlurSettings"));
import QueueManager from "./components/QueueManager";
import DebugConsole from "./components/DebugConsole";
const SettingsPanel = lazy(() => import("./components/Settings"));
import ToastContainer from "./components/Toast";
import useDebugConsole from "./hooks/useDebugConsole";
import useToast from "./lib/useToast";
import { useQueueEvents } from "./hooks/useQueueEvents";
import { useQueue } from "./lib/useQueue";
import { useKeyboardShortcuts } from "./lib/useKeyboardShortcuts";
import {
  startDownload,
  startConvert,
  startBlur,
  compressFile,
  cancelOperation,
  getSettings,
  sanitizePath,
  sanitizeUrl,
  sanitizeFormat,
} from "./lib/tauri-commands";
import type { AppSettings } from "./lib/tauri-commands";
import type { QueueItem } from "./lib/queue-types";
import type { BlurSettings as BlurSettingsType } from "./components/BlurSettings";
import { Download, ArrowRightLeft, Zap, Film, Sun, Moon, Terminal, Settings, Info } from "lucide-react";
const About = lazy(() => import("./components/About"));
import { loadAppVersion, useAppVersion } from "./lib/updater";

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

const modeTransition = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1] as const,
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

export default function App() {
  const [mode, setMode] = useState<Mode>("download");
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const [showConsole, setShowConsole] = useState(() => localStorage.getItem("debug_console_open") === "true");
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    downloadDir: "",
    outputDir: "",
    autoSave: false,
    overwriteExisting: false,
  });

  const debugConsole = useDebugConsole({ maxLogs: 500 });
  const toast = useToast();
  const queue = useQueue();
  const appVersion = useAppVersion();
  useQueueEvents(queue, toast.addToast);

  useEffect(() => { void loadAppVersion(); }, []);

  const processNextCallback = useCallback(async (item: QueueItem) => {
    try {
      const currentSettings = appSettings;
      if (item.type === "download") {
        const outputDir = item.outputDir || currentSettings.downloadDir || (await tempDir());
        const url = await sanitizeUrl(item.url!);
        const formatType = await sanitizeFormat(item.formatType || "bestvideo+bestaudio/best");
        const dir = await sanitizePath(outputDir);
        await startDownload({ url, format_type: formatType, output_dir: dir });
      } else if (item.type === "compress") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        await compressFile({ input, output, target_size_bytes: item.targetSizeBytes! });
      } else if (item.type === "convert") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        const format = await sanitizeFormat(item.outputFormat!);
        await startConvert({ input, output, format, dev_mode: item.devMode || false });
      } else if (item.type === "blur") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        await startBlur({ input, output, settings: item.blurSettings! });
      }
    } catch (err) {
      console.error(`[queue] Failed: "${item.label}"`, err);
      throw err;
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
    queue.processNext(processNextCallback);
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

  const handleDownloadAdd = useCallback(async (url: string, formatType: string) => {
    const safeUrl = await sanitizeUrl(url);
    const safeFormat = await sanitizeFormat(formatType);
    const isYoutube = safeUrl.toLowerCase().includes("youtube.com") || safeUrl.toLowerCase().includes("youtu.be");
    const label = isYoutube ? safeUrl.replace(/https?:\/\/(www\.)?/, "").substring(0, 50) : safeUrl.split("/").pop()?.substring(0, 50) || safeUrl;
    addToQueue({
      id: genId(),
      type: "download",
      status: "pending",
      progress: 0,
      url: safeUrl,
      formatType: safeFormat,
      outputDir: appSettings.downloadDir || undefined,
      label: `${label}${safeFormat === "mp3" ? " (MP3)" : safeFormat === "mp4" ? " (MP4)" : ""}`,
      createdAt: Date.now(),
    });
    toast.addToast("info", "Added to queue", `${label} (${safeFormat.toUpperCase()})`);
  }, [addToQueue, appSettings]);

  const handleConvertAdd = useCallback(async (
    inputPath: string, outputPath: string, outputFormat: string,
    devMode: boolean, compressSize?: number
  ) => {
    const safeInput = await sanitizePath(inputPath);
    const safeOutput = await sanitizePath(outputPath);
    const safeFormat = await sanitizeFormat(outputFormat);
    const fileName = safeInput.split(/[\\/]/).pop() || safeInput;
    const finalOutputPath = applyAutoSave(safeOutput, appSettings.autoSave, appSettings.outputDir);

    if (safeFormat === "compress" && compressSize) {
      const sizeLabel = compressSize >= 1073741824
        ? `${(compressSize / 1073741824).toFixed(1)} GB`
        : compressSize >= 1048576 ? `${(compressSize / 1048576).toFixed(1)} MB`
        : `${(compressSize / 1024).toFixed(1)} KB`;
      addToQueue({
        id: genId(),
        type: "compress",
        status: "pending",
        progress: 0,
        inputPath: safeInput, outputPath: finalOutputPath, targetSizeBytes: compressSize,
        label: `${fileName} → ${sizeLabel}`,
        createdAt: Date.now(),
      });
    } else {
      addToQueue({
        id: genId(),
        type: "convert",
        status: "pending",
        progress: 0,
        inputPath: safeInput, outputPath: finalOutputPath, outputFormat: safeFormat, devMode,
        label: `${fileName} → ${safeFormat.toUpperCase()}`,
        createdAt: Date.now(),
      });
    }
    toast.addToast("info", "Added to queue", `${fileName} → ${safeFormat.toUpperCase()}`);
  }, [addToQueue, appSettings]);

  const handleBlurAdd = useCallback(async (inputPath: string, outputPath: string, blurSettings: BlurSettingsType) => {
    const safeInput = await sanitizePath(inputPath);
    const safeOutput = await sanitizePath(outputPath);
    const fileName = safeInput.split(/[\\/]/).pop() || safeInput;
    const finalOutputPath = applyAutoSave(safeOutput, appSettings.autoSave, appSettings.outputDir);
    addToQueue({
      id: genId(),
      type: "blur",
      status: "pending",
      progress: 0,
      inputPath: safeInput, outputPath: finalOutputPath, blurSettings,
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
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <>
      <ErrorBoundary>
        <div className="h-full flex flex-col bg-app-bg">
          <header className="flex items-center justify-between px-5 py-3 border-b border-app-border bg-app-surface">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-app-accent-dim">
                <Zap size={16} className="text-app-accent" />
              </div>
              <h1 className="text-base font-semibold text-app-text tracking-tight">Converter</h1>
              <span className="text-[10px] text-app-text-muted bg-app-surface-hover px-1.5 py-0.5 rounded">v{appVersion}</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowAbout(true)} className="btn-icon" title="About & Updates" aria-label="About & Updates">
                <Info size={16} aria-hidden="true" />
              </button>
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
                  <motion.div
                    className="radio-group"
                    initial="hidden"
                    animate="visible"
                    variants={staggerContainer}
                  >
                    {MODE_CONFIG.map(({ id, label, icon: Icon }) => (
                      <motion.button
                        key={id}
                        variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        onClick={() => !isProcessing && setMode(id)}
                        className={`radio-pill ${mode === id ? "active" : ""}`}
                        disabled={isProcessing}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <Icon size={15} />
                        {label}
                      </motion.button>
                    ))}
                  </motion.div>
                )}

                <Suspense fallback={<p className="text-sm text-app-text-secondary">Loading tools...</p>}>
                <AnimatePresence mode="wait">
                  {showSettings ? (
                    <motion.div
                      key="settings"
                      initial={{ opacity: 0, y: 12, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.98 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <Settings size={14} className="text-app-accent" />
                        <h2 className="text-sm font-semibold text-app-text">Application Settings</h2>
                      </div>
                      <SettingsPanel onSettingsChanged={setAppSettings} disabled={isProcessing} onOpenAbout={() => setShowAbout(true)} />
                    </motion.div>
                  ) : (
                    <>
                      {mode === "download" && (
                        <motion.div key="download" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                          <URLDownloader onAdd={handleDownloadAdd} disabled={isProcessing} />
                        </motion.div>
                      )}
                      {mode === "convert" && (
                        <motion.div key="convert" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                          <FileConverter onAdd={handleConvertAdd} disabled={isProcessing} />
                        </motion.div>
                      )}
                      {mode === "blur" && (
                        <motion.div key="blur" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                          <BlurSettings onAdd={handleBlurAdd} disabled={isProcessing} />
                        </motion.div>
                      )}
                    </>
                  )}
                </AnimatePresence>
                </Suspense>

                {isProcessing && (
                  <motion.button
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.01 }}
                    onClick={handleCancel}
                    className="w-full btn btn-danger py-2.5 text-sm"
                  >
                    Cancel Current
                  </motion.button>
                )}

                <AnimatePresence>
                  {showConsole && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                    >
                      <DebugConsole
                      logs={debugConsole.logs}
                      onClear={debugConsole.clearLogs}
                      isCapturing={debugConsole.isCapturing}
                      onToggleCapture={() => debugConsole.setIsCapturing(!debugConsole.isCapturing)}
                    />
                    </motion.div>
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
      {showAbout && (
        <Suspense fallback={null}><About onClose={() => setShowAbout(false)} hasPendingWork={queue.processingRef.current || queue.queue.some((item) => item.status === "pending" || item.status === "active")} /></Suspense>
      )}
    </>
  );
}
