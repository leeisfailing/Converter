import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AppHeader from "./components/AppHeader";
import { tempDir, sep } from "@tauri-apps/api/path";
import URLDownloader from "./components/URLDownloader";
import FileConverter from "./components/FileConverter";
import FileReducer from "./components/FileReducer";
import Upscaler from "./components/Upscaler";
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
  startReduce,
  startUpscale,
  startConvertNative,
  startReduceNative,
  cancelOperation,
  getSettings,
  sanitizePath,
  sanitizeUrl,
  sanitizeFormat,
  detectGpusNative,
  probeFile,
} from "./lib/tauri-commands";
import type { AppSettings } from "./lib/tauri-commands";
import type { QueueItem } from "./lib/queue-types";
import { Download, ArrowRightLeft, Minimize2, ArrowUp, Zap, Settings } from "lucide-react";
const About = lazy(() => import("./components/About"));
const BugReport = lazy(() => import("./components/BugReport"));
import { loadAppVersion, useAppVersion, checkForUpdate } from "./lib/updater";
import UpdatePrompt from "./components/UpdatePrompt";

type Mode = "download" | "convert" | "reduce" | "upscale";

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let nextId = 0;
function genId(): string {
  return `q-${Date.now()}-${++nextId}`;
}

const MODE_CONFIG = [
  { id: "download" as Mode, label: "Download", icon: Download },
  { id: "convert" as Mode, label: "Convert", icon: ArrowRightLeft },
  { id: "reduce" as Mode, label: "Reduce", icon: Minimize2 },
  { id: "upscale" as Mode, label: "Upscale", icon: ArrowUp },
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
  const [showBugReport, setShowBugReport] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    downloadDir: "",
    outputDir: "",
    useGpu: true,
    preferredEncoder: "",
  });
  const [nativeGpuInfo, setNativeGpuInfo] = useState<{ available: boolean; encoder: string; vendor: string } | null>(null);

  const debugConsole = useDebugConsole({ maxLogs: 500 });
  const toast = useToast();
  const queue = useQueue();
  const appVersion = useAppVersion();
  useQueueEvents(queue, toast.addToast);

  useEffect(() => { void loadAppVersion(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void checkForUpdate(); }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const processNextCallback = useCallback(async (item: QueueItem) => {
    try {
      const currentSettings = appSettings;
      if (item.type === "download") {
        const outputDir = item.outputDir || currentSettings.downloadDir || (await tempDir());
        const url = await sanitizeUrl(item.url!);
        const formatType = await sanitizeFormat(item.formatType || "bestvideo+bestaudio/best");
        const dir = await sanitizePath(outputDir);
        await startDownload({
          url, format_type: formatType, output_dir: dir,
          write_subtitles: item.writeSubtitles,
          write_thumbnail: item.writeThumbnail,
          use_browser_cookies: item.useBrowserCookies,
        });
      } else if (item.type === "convert") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        const format = await sanitizeFormat(item.outputFormat!);
        console.log(`[convert] processNext: item.outputPath="${item.outputPath}", output="${output}", format="${format}"`);
        try {
          await startConvertNative({ input, output, format, dev_mode: item.devMode || false, use_gpu: currentSettings.useGpu, preferred_encoder: currentSettings.preferredEncoder });
        } catch (nativeErr) {
          console.warn("[queue] Native convert failed, falling back to Python:", nativeErr);
          await startConvert({ input, output, format, dev_mode: item.devMode || false, use_gpu: currentSettings.useGpu, preferred_encoder: currentSettings.preferredEncoder });
        }
      } else if (item.type === "reduce") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        try {
          await startReduceNative({
            input, output,
            quality: item.reduceQuality || 50,
            target_bytes: item.reduceTargetBytes ?? null,
            max_width: item.reduceMaxWidth || null,
            file_type: item.reduceFileType || "video",
            use_gpu: currentSettings.useGpu,
            preferred_encoder: currentSettings.preferredEncoder,
          });
        } catch (nativeErr) {
          console.warn("[queue] Native reduce failed, falling back to Python:", nativeErr);
          await startReduce({
            input, output,
            quality: item.reduceQuality || 50,
            target_bytes: item.reduceTargetBytes ?? null,
            max_width: item.reduceMaxWidth || null,
            file_type: item.reduceFileType || "video",
            use_gpu: currentSettings.useGpu,
            preferred_encoder: currentSettings.preferredEncoder,
          });
        }
      } else if (item.type === "upscale") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        await startUpscale({
          input, output,
          target: item.upscaleTarget || "4k",
          file_type: item.upscaleFileType || "video",
          use_gpu: currentSettings.useGpu,
          preferred_encoder: currentSettings.preferredEncoder,
        });
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
    detectGpusNative()
      .then((caps) => {
        const best = caps.find(c => c.works);
        if (best) {
          setNativeGpuInfo({ available: true, encoder: best.encoder, vendor: best.vendor });
        } else {
          setNativeGpuInfo({ available: false, encoder: "", vendor: "" });
        }
      })
      .catch(() => setNativeGpuInfo(null));
  }, []);

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

  const handleDownloadAdd = useCallback(async (url: string, formatType: string, options?: { writeSubtitles?: boolean; writeThumbnail?: boolean; useBrowserCookies?: boolean }) => {
    const safeUrl = await sanitizeUrl(url);
    const safeFormat = await sanitizeFormat(formatType);
    const isYoutube = safeUrl.toLowerCase().includes("youtube.com") || safeUrl.toLowerCase().includes("youtu.be");
    const label = isYoutube ? safeUrl.replace(/https?:\/\/(www\.)?/, "").substring(0, 50) : safeUrl.split("/").pop()?.substring(0, 50) || safeUrl;
    const fmtLabel = safeFormat.startsWith("mp3") ? " (MP3)" : safeFormat.startsWith("mp4") ? " (MP4)" : safeFormat.startsWith("webm") ? " (WebM)" : safeFormat.startsWith("mkv") ? " (MKV)" : safeFormat.startsWith("aac") ? " (AAC)" : safeFormat === "flac" ? " (FLAC)" : safeFormat === "wav" ? " (WAV)" : safeFormat.startsWith("ogg") ? " (OGG)" : "";
    addToQueue({
      id: genId(),
      type: "download",
      status: "pending",
      progress: 0,
      url: safeUrl,
      formatType: safeFormat,
      outputDir: appSettings.downloadDir || undefined,
      writeSubtitles: options?.writeSubtitles,
      writeThumbnail: options?.writeThumbnail,
      useBrowserCookies: options?.useBrowserCookies,
      label: `${label}${fmtLabel}`,
      createdAt: Date.now(),
    });
    toast.addToast("info", "Added to queue", `${label} (${safeFormat.toUpperCase()})`);
  }, [addToQueue, appSettings]);

  const handleReduceAdd = useCallback(async (
    inputPath: string, outputPath: string, quality: number,
    maxWidth: number | null, fileType: "video" | "photo" | "audio",
    targetBytes: number | null,
  ) => {
    const safeInput = await sanitizePath(inputPath);
    const safeOutput = await sanitizePath(outputPath);
    const fileName = safeInput.split(/[\\/]/).pop() || safeInput;
    const finalOutputPath = appSettings.outputDir
      ? `${appSettings.outputDir}${sep()}${safeOutput.split(/[\\/]/).pop()}` : safeOutput;
    const reductionLabel = targetBytes ? `under ${(targetBytes / 1_000_000).toLocaleString()} MB` : `${quality}% quality`;
    addToQueue({
      id: genId(),
      type: "reduce",
      status: "pending",
      progress: 0,
      inputPath: safeInput, outputPath: finalOutputPath,
      reduceQuality: quality, reduceMaxWidth: maxWidth || undefined, reduceFileType: fileType,
      reduceTargetBytes: targetBytes ?? undefined,
      label: `${fileName} → ${reductionLabel}`,
      createdAt: Date.now(),
    });
    toast.addToast("info", "Added to queue", `${fileName} → ${reductionLabel}`);
  }, [addToQueue, appSettings]);

  const handleUpscaleAdd = useCallback(async (
    inputPath: string, outputPath: string, target: string,
    fileType: "video" | "photo",
  ) => {
    const safeInput = await sanitizePath(inputPath);
    const safeOutput = await sanitizePath(outputPath);
    const fileName = safeInput.split(/[\\/]/).pop() || safeInput;
    const sepVal = sep();
    const finalOutputPath = appSettings.outputDir
      ? `${appSettings.outputDir}${sepVal}${safeOutput.split(/[\\/]/).pop()}` : safeOutput;
    addToQueue({
      id: genId(),
      type: "upscale",
      status: "pending",
      progress: 0,
      inputPath: safeInput, outputPath: finalOutputPath,
      upscaleTarget: target, upscaleFileType: fileType,
      label: `${fileName} → ${target.toUpperCase()}`,
      createdAt: Date.now(),
    });
    toast.addToast("info", "Added to queue", `${fileName} → ${target.toUpperCase()}`);
  }, [addToQueue, appSettings]);

  const handleConvertAdd = useCallback(async (
    inputPath: string, outputPath: string, outputFormat: string,
    devMode: boolean,
  ) => {
    const safeInput = await sanitizePath(inputPath);
    const safeOutput = await sanitizePath(outputPath);
    const safeFormat = await sanitizeFormat(outputFormat);
    const fileName = safeInput.split(/[\\/]/).pop() || safeInput;
    const sepVal = sep();
    const finalOutputPath = appSettings.outputDir
      ? `${appSettings.outputDir}${sepVal}${safeOutput.split(/[\\/]/).pop()}` : safeOutput;

    console.log(`[convert] handleConvertAdd: outputDir="${appSettings.outputDir}", sep="${sepVal}", safeOutput="${safeOutput}", fileName="${safeOutput.split(/[\\/]/).pop()}", finalOutputPath="${finalOutputPath}"`);

    addToQueue({
      id: genId(),
      type: "convert",
      status: "pending",
      progress: 0,
      inputPath: safeInput, outputPath: finalOutputPath, outputFormat: safeFormat, devMode,
      label: `${fileName} → ${safeFormat.toUpperCase()}`,
      createdAt: Date.now(),
    });
    toast.addToast("info", "Added to queue", `${fileName} → ${safeFormat.toUpperCase()}`);
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
        <div className="app-shell h-full flex flex-col bg-app-bg">
          <AppHeader
            theme={theme}
            showConsole={showConsole}
            showSettings={showSettings}
            onAbout={() => setShowAbout(true)}
            onConsole={() => {
              const next = !showConsole;
              setShowConsole(next);
              localStorage.setItem("debug_console_open", String(next));
            }}
            onSettings={() => setShowSettings((prev) => !prev)}
            onTheme={toggleTheme}
            onWindowError={(message) => toast.addToast("error", "Window action failed", message)}
          />
          <nav className="workspace-nav" aria-label="Media tools">
            {MODE_CONFIG.map(({ id, label, icon: Icon }) => (
              <button type="button" key={id}
                className="workspace-tab"
                aria-current={!showSettings && mode === id ? "page" : undefined}
                disabled={isProcessing}
                onClick={() => { setMode(id); setShowSettings(false); }}>
                <Icon size={16} aria-hidden="true" />{label}
              </button>
            ))}
          </nav>

          <div className="workspace-layout flex-1 flex overflow-hidden">
            <div className="workspace-main flex-1 overflow-y-auto">
              <div className="workspace-content mx-auto space-y-5">
                <div className="workspace-intro">
                  <p className="workspace-eyebrow">{showSettings ? "Preferences" : "Media workspace"}</p>
                  <h1>{showSettings ? "Make it yours" : mode === "download" ? "Save from a link" : mode === "convert" ? "A new format. Same content." : mode === "upscale" ? "Higher resolution. Same quality." : "Less size. More space."}</h1>
                  <p>{showSettings ? "Choose how Converter works for you." : mode === "download" ? "Paste a link, choose a format, and add it to your queue." : mode === "convert" ? "Choose a file and the format you need. We\u2019ll handle the rest." : mode === "upscale" ? "Enhance resolution with GPU-accelerated upscaling." : "Find the right balance between file size and quality."}</p>
                  {nativeGpuInfo?.available && (
                    <p className="text-[11px] text-green-400 mt-1">
                      GPU: {nativeGpuInfo.vendor} ({nativeGpuInfo.encoder})
                    </p>
                  )}
                </div>
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
                      {mode === "reduce" && (
                        <motion.div key="reduce" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                          <FileReducer onAdd={handleReduceAdd} disabled={isProcessing} />
                        </motion.div>
                      )}
                      {mode === "upscale" && (
                        <motion.div key="upscale" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                          <Upscaler onAdd={handleUpscaleAdd} disabled={isProcessing} />
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
              <div className="workspace-queue border-l border-app-border bg-app-surface overflow-hidden flex flex-col">
                <QueueManager
                  items={queue.queue}
                  onRemove={removeFromQueue}
                  onClearCompleted={clearCompleted}
                />
              </div>
            )}
          </div>

          <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
          <UpdatePrompt onOpenAbout={() => setShowAbout(true)} />
        </div>
      </ErrorBoundary>
      {showAbout && (
        <Suspense fallback={null}><About onClose={() => setShowAbout(false)} hasPendingWork={queue.processingRef.current || queue.queue.some((item) => item.status === "pending" || item.status === "active")} onOpenBugReport={() => { setShowAbout(false); setShowBugReport(true); }} /></Suspense>
      )}
      {showBugReport && (
        <Suspense fallback={null}><BugReport onClose={() => setShowBugReport(false)} /></Suspense>
      )}
    </>
  );
}
