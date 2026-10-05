import { formatFileSize } from "./lib/file-size";
import { gpuSelection, gpuStatus, parallelGpuEncoders } from "./lib/gpu-selection";
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import AppHeader from "./components/AppHeader";
import { tempDir, sep } from "@tauri-apps/api/path";
import URLDownloader from "./components/URLDownloader";
const FileConverter = lazy(() => import("./components/FileConverter"));
const FileTranscoder = lazy(() => import("./components/FileTranscoder"));
const Upscaler = lazy(() => import("./components/Upscaler"));
const Enhancer = lazy(() => import("./components/Enhancer"));
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
  startUpscale,
  startEnhance,
  startConvertNative,
  startTranscoderNative,
  cancelOperationById,
  getSettings,
  getConcurrency,
  sanitizePath,
  sanitizeUrl,
  sanitizeFormat,
  detectGpu,
  probeFile,
  checkUpscale,
} from "./lib/tauri-commands";
import { prefersLightScheme, readStorage, writeStorage } from "./lib/storage";
import type { AppSettings } from "./lib/tauri-commands";
import type { QueueItem } from "./lib/queue-types";
import { Download, ArrowRightLeft, Minimize2, ArrowUp, Sparkles, Zap, Settings } from "lucide-react";
const About = lazy(() => import("./components/About"));
const BugReport = lazy(() => import("./components/BugReport"));
import { loadAppVersion, useAppVersion, checkForUpdate } from "./lib/updater";
import UpdatePrompt from "./components/UpdatePrompt";

type Mode = "download" | "convert" | "transcoder" | "upscale" | "enhance";

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

interface PanelBoundaryProps {
  area: string;
  children: React.ReactNode;
}

interface PanelBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Scoped to the tool workspace so one failed dynamic import cannot replace the
 * whole shell. Switching tools re-arms it, which lets the user reach the other
 * panels even when a single chunk refuses to load.
 */
export class PanelBoundary extends React.Component<PanelBoundaryProps, PanelBoundaryState> {
  constructor(props: PanelBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PanelBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[PanelBoundary] Tool panel failed to render:", error);
  }

  componentDidUpdate(prevProps: PanelBoundaryProps) {
    if (prevProps.area !== this.props.area && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error;
      return (
        <div role="alert" className="panel p-5 text-center">
          <h2 className="text-sm font-semibold text-app-text mb-1">
            This tool could not be loaded
          </h2>
          <p className="text-xs text-app-text-muted mb-4 break-words">
            {err?.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn px-4 py-2 text-sm"
          >
            Reload Converter
          </button>
          <p className="mt-3 text-[11px] text-app-text-muted">
            The rest of Converter keeps working — reload to try again.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

function getInitialTheme(): "dark" | "light" {
  const saved = readStorage("app_theme");
  if (saved === "light" || saved === "dark") return saved;
  return prefersLightScheme() ? "light" : "dark";
}


let nextId = 0;
function genId(): string {
  return `q-${Date.now()}-${++nextId}`;
}

const MODE_CONFIG = [
  { id: "download" as Mode, label: "Download", icon: Download },
  { id: "convert" as Mode, label: "Convert", icon: ArrowRightLeft },
  { id: "transcoder" as Mode, label: "Transcoder", icon: Minimize2 },
  { id: "upscale" as Mode, label: "Upscale", icon: ArrowUp },
  { id: "enhance" as Mode, label: "Enhance", icon: Sparkles, badge: "BETA" },
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
  const [showConsole, setShowConsole] = useState(() => readStorage("debug_console_open") === "true");
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    downloadDir: "",
    outputDir: "",
    useGpu: true,
    preferredEncoder: "",
    autoDetectGpu: true,
    selectedGpu: "",
  });
  const [parallelEncoders, setParallelEncoders] = useState<string[] | null>(null);
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
      const currentSettings = {
        ...appSettings,
        ...gpuSelection(appSettings),
        ...(item.assignedGpu ? { useGpu: true, selectedGpu: item.assignedGpu, preferredEncoder: "" } : {}),
      };
      if (item.type === "download") {
        const outputDir = item.outputDir || currentSettings.downloadDir || (await tempDir());
        const url = await sanitizeUrl(item.url!);
        const formatType = await sanitizeFormat(item.formatType || "bestvideo+bestaudio/best");
        const dir = await sanitizePath(outputDir);
        await startDownload({
          id: item.id, url, format_type: formatType, output_dir: dir,
          write_subtitles: item.writeSubtitles,
          write_thumbnail: item.writeThumbnail,
          use_browser_cookies: item.useBrowserCookies,
        });
      } else if (item.type === "convert") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        const format = await sanitizeFormat(item.outputFormat!);
        console.log(`[convert] processNext: item.outputPath="${item.outputPath}", output="${output}", format="${format}"`);
        await startConvertNative({ id: item.id, input, output, format, dev_mode: item.devMode || false, use_gpu: currentSettings.useGpu, preferred_encoder: currentSettings.preferredEncoder, selected_gpu: currentSettings.selectedGpu });
      } else if (item.type === "transcoder") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        await startTranscoderNative({
          id: item.id, input, output,
          quality: item.transcoderQuality || 50,
          target_bytes: item.transcoderTargetBytes ?? null,
          file_type: item.transcoderFileType || "video",
          use_gpu: currentSettings.useGpu,
          preferred_encoder: currentSettings.preferredEncoder,
          selected_gpu: currentSettings.selectedGpu,
        });
      } else if (item.type === "upscale") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        const target = item.upscaleTarget || "4k";

        // Check system capability before attempting upscale
        const capability = await checkUpscale(target);
        if (!capability.canUpscale) {
          console.error(`[queue] Upscale blocked: ${capability.message}`);
          toast.addToast("error", "Insufficient Resources", capability.message);
          throw new Error(capability.message);
        }
        if (capability.message.startsWith("Warning")) {
          toast.addToast("warning", "Resource Warning", capability.message);
        }

        await startUpscale({
          id: item.id, input, output,
          target,
          file_type: item.upscaleFileType || "video",
          use_gpu: currentSettings.useGpu,
          preferred_encoder: currentSettings.preferredEncoder,
          selected_gpu: currentSettings.selectedGpu,
        });
      } else if (item.type === "enhance") {
        const input = await sanitizePath(item.inputPath!);
        const output = await sanitizePath(item.outputPath!);
        await startEnhance({
          id: item.id, input, output,
          file_type: item.enhanceFileType || "video",
          model: item.enhanceModel || "realesrgan-x4plus",
          tile_size: item.enhanceTileSize || 256,
          use_gpu: currentSettings.useGpu,
          selected_gpu: currentSettings.selectedGpu,
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

  useEffect(() => {
    getConcurrency()
      .then(queue.setConcurrency)
      .catch((err) => console.warn("[app] Failed to load concurrency:", err));
  }, []);

  useKeyboardShortcuts([
    { key: ",", ctrl: true, action: () => setShowSettings((prev) => !prev) },
    { key: "d", ctrl: true, shift: true, action: () => setShowConsole((prev) => !prev) },
    { key: "q", ctrl: true, action: () => {
      // Only the job that is actually running is stopped; other job types
      // continue (they run concurrently by design).
      const active = queue.queueRef.current.find((i) => i.status === "active");
      if (active) {
        void queue.requestCancel(() => cancelOperationById(active.id), active.id)
          .catch((err) => toast.addToast("error", "Cancellation failed", String(err)));
      }
    }},
    { key: "Escape", action: () => {
      if (showSettings) setShowSettings(false);
      else if (showConsole) setShowConsole(false);
    }, enabled: showSettings || showConsole },
  ]);

  useEffect(() => {
    detectGpu()
      .then((info) => {
        setParallelEncoders(parallelGpuEncoders(info.allEncoders ?? []));
        setNativeGpuInfo({ available: info.available, encoder: info.encoder || "", vendor: info.vendor || "" });
      })
      .catch(() => { setNativeGpuInfo(null); setParallelEncoders([]); });
  }, []);

  useEffect(() => {
    const parallel = !appSettings.autoDetectGpu && appSettings.selectedGpu === "parallel";
    if (parallel && parallelEncoders === null) return;
    queue.processNextBatch(processNextCallback, parallel ? parallelEncoders ?? [] : undefined);
  }, [queue.queue, queue.paused, processNextCallback, queue.processNextBatch, parallelEncoders, appSettings.autoDetectGpu, appSettings.selectedGpu]);

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

  const handleTranscoderAdd = useCallback(async (
    inputPath: string, outputPath: string, quality: number,
    fileType: "video" | "photo" | "audio",
    targetBytes: number | null, mode: "compress" | "reduce",
  ) => {
    const safeInput = await sanitizePath(inputPath);
    const safeOutput = await sanitizePath(outputPath);
    const fileName = safeInput.split(/[\\/]/).pop() || safeInput;
    const finalOutputPath = appSettings.outputDir
      ? `${appSettings.outputDir}${sep()}${safeOutput.split(/[\\/]/).pop()}` : safeOutput;
    const modeLabel = mode === "reduce" ? `under ${formatFileSize(targetBytes!)}` : `${quality}% quality`;
    addToQueue({
      id: genId(),
      type: "transcoder",
      status: "pending",
      progress: 0,
      inputPath: safeInput, outputPath: finalOutputPath,
      transcoderMode: mode,
      transcoderQuality: quality, transcoderFileType: fileType,
      transcoderTargetBytes: targetBytes ?? undefined,
      label: `${fileName} → ${modeLabel}`,
      createdAt: Date.now(),
    });
    toast.addToast("info", "Added to queue", `${fileName} → ${modeLabel}`);
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

  const handleEnhanceAdd = useCallback(async (
    inputPath: string, outputPath: string,
    fileType: "video" | "photo",
    model: string, tileSize: number,
  ) => {
    const safeInput = await sanitizePath(inputPath);
    const safeOutput = await sanitizePath(outputPath);
    const fileName = safeInput.split(/[\\/]/).pop() || safeInput;
    const sepVal = sep();
    const finalOutputPath = appSettings.outputDir
      ? `${appSettings.outputDir}${sepVal}${safeOutput.split(/[\\/]/).pop()}` : safeOutput;
    const modelLabel = model.replace("realesrgan-", "").replace("realesr-", "").toUpperCase();
    addToQueue({
      id: genId(),
      type: "enhance",
      status: "pending",
      progress: 0,
      inputPath: safeInput, outputPath: finalOutputPath,
      enhanceModel: model, enhanceTileSize: tileSize, enhanceFileType: fileType,
      label: `${fileName} → AI ${modelLabel}`,
      createdAt: Date.now(),
    });
    toast.addToast("info", "Added to queue", `${fileName} → AI ${modelLabel}`);
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
    const active = queue.queueRef.current.find((item) => item.status === "active");
    if (!active) {
      toast.addToast("info", "Nothing to cancel", "No operation is running right now.");
      return;
    }
    try {
      // Cancel just this job: other job types keep running concurrently.
      await queue.requestCancel(() => cancelOperationById(active.id), active.id);
      toast.addToast("warning", "Cancelled", "Current operation stopped");
    } catch (err) {
      console.error(err);
      toast.addToast("error", "Cancellation failed", String(err));
    }
  }, [queue]);

  const handleCancelItem = useCallback(async (id: string) => {
    try {
      await queue.requestCancel(() => cancelOperationById(id), id);
      toast.addToast("warning", "Cancelled", "Operation stopped");
    } catch (err) {
      console.error(err);
      toast.addToast("error", "Cancellation failed", String(err));
    }
  }, [queue]);

  const isProcessing = queue.isProcessing;
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    writeStorage("app_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <>
      <MotionConfig reducedMotion="user">
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
              writeStorage("debug_console_open", String(next));
            }}
            onSettings={() => setShowSettings((prev) => !prev)}
            onTheme={toggleTheme}
            onWindowError={(message) => toast.addToast("error", "Window action failed", message)}
          />
          <nav className="workspace-nav" aria-label="Media tools">
            {MODE_CONFIG.map(({ id, label, icon: Icon, badge }) => (
              <button type="button" key={id}
                className="workspace-tab"
                aria-current={!showSettings && mode === id ? "page" : undefined}
                onClick={() => { setMode(id); setShowSettings(false); }}>
                <Icon size={16} aria-hidden="true" />{label}
                {badge && <span className="ml-1.5 inline-flex items-center rounded-md workspace-badge">{badge}</span>}
              </button>
            ))}
          </nav>

          <div className="workspace-layout flex-1 flex overflow-hidden">
            <div className="workspace-main flex-1 overflow-y-auto">
              <div className="workspace-content mx-auto space-y-5">
                <div className="workspace-intro">
                  <p className="workspace-eyebrow">{showSettings ? "Preferences" : "Media workspace"}</p>
                  <h1>{showSettings ? "Make it yours" : mode === "download" ? "Save from a link" : mode === "convert" ? "Convert your media" : mode === "upscale" ? "See every detail" : mode === "enhance" ? "Give your media new life" : "Make room for more"}</h1>
                  <p>{showSettings ? "Choose how Converter works for you." : mode === "download" ? "Paste a link, choose a format, and add it to your queue." : mode === "convert" ? "Choose a file and the format you need. We\u2019ll handle the rest." : mode === "upscale" ? "Enhance resolution with GPU-accelerated upscaling." : mode === "enhance" ? "Super-resolution and denoising using Real-ESRGAN neural networks." : "Find the right balance between file size and quality."}</p>
                  {!showSettings && mode !== "download" && mode !== "enhance" && (
                    <p className="text-[11px] text-app-success mt-1">
                      {gpuStatus(appSettings, nativeGpuInfo)}
                    </p>
                  )}
                </div>
                <Suspense fallback={<p className="text-sm text-app-text-secondary">Loading tools...</p>}>
                <PanelBoundary area={showSettings ? "settings" : mode}>
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
                      {mode === "transcoder" && (
                        <motion.div key="transcoder" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                          <FileTranscoder onAdd={handleTranscoderAdd} disabled={isProcessing} />
                        </motion.div>
                      )}
                      {mode === "upscale" && (
                        <motion.div key="upscale" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                          <Upscaler onAdd={handleUpscaleAdd} disabled={isProcessing} />
                        </motion.div>
                      )}
                      {mode === "enhance" && (
                        <motion.div key="enhance" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2, ease: "easeInOut" }}>
                          <Enhancer onAdd={handleEnhanceAdd} disabled={isProcessing} />
                        </motion.div>
                      )}
                    </>
                  )}
                </AnimatePresence>
                </PanelBoundary>
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

            <aside aria-label="Job queue" className={`workspace-queue overflow-hidden flex flex-col ${queue.hasQueue || queue.paused ? "" : "workspace-queue-empty"}`}>
                <QueueManager
                  items={queue.queue}
                  onRemove={removeFromQueue}
                  onCancel={handleCancelItem}
                  onClearCompleted={clearCompleted}
                  paused={queue.paused}
                  onPauseToggle={queue.togglePaused}
                  onRetry={queue.retryItem}
                  onRetryFailed={queue.retryFailed}
                />
              </aside>
          </div>

          <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
          <UpdatePrompt onOpenAbout={() => setShowAbout(true)} />
        </div>
      </ErrorBoundary>
      </MotionConfig>
      {showAbout && (
        <Suspense fallback={null}><PanelBoundary area="about"><About onClose={() => setShowAbout(false)} hasPendingWork={queue.isProcessing || queue.queue.some((item) => item.status === "pending" || item.status === "active")} onOpenBugReport={() => { setShowAbout(false); setShowBugReport(true); }} /></PanelBoundary></Suspense>
      )}
      {showBugReport && (
        <Suspense fallback={null}><PanelBoundary area="bug-report"><BugReport onClose={() => setShowBugReport(false)} /></PanelBoundary></Suspense>
      )}
    </>
  );
}
