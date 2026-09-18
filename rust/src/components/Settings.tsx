import { parallelGpuEncoders } from "../lib/gpu-selection";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getSettings,
  saveSettings,
  resetSettings,
  getDefaultDownloadDir,
  getDefaultOutputDir,
  detectGpu,
  detectGpusNative,
  getCacheStats,
  clearCache,
  getPersistentCacheStats,
  clearPersistentCache,
} from "../lib/tauri-commands";
import type { AppSettings, GpuInfo, GpuCapability, CacheStats, PersistentCacheStats } from "../lib/tauri-commands";
import {
  FolderOpen,
  Download,
  ArrowRightLeft,
  RotateCcw,
  Check,
  AlertCircle,
  Info,
  Monitor,
  HardDrive,
} from "lucide-react";

interface Props {
  onSettingsChanged: (settings: AppSettings) => void;
  disabled: boolean;
  onOpenAbout: () => void;
}

function isValidPath(p: string): boolean {
  if (!p.trim()) return true;
  return !/[<>"|?*]/.test(p);
}

export default function Settings({ onSettingsChanged, disabled, onOpenAbout }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    downloadDir: "",
    outputDir: "",
    useGpu: true,
    preferredEncoder: "",
    autoDetectGpu: true,
    selectedGpu: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<"ok" | "error" | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [nativeGpus, setNativeGpus] = useState<GpuCapability[]>([]);
  const [gpuLoading, setGpuLoading] = useState(true);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [persistentCacheStats, setPersistentCacheStats] = useState<PersistentCacheStats | null>(null);
  const [persistentCacheClearing, setPersistentCacheClearing] = useState(false);

  const isBusy = saving || resetting;

  const clearMessageTimer = useCallback(() => {
    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
      messageTimer.current = null;
    }
  }, []);

  useEffect(() => {
    loadSettings();
    detectGpuInfo();
    loadCacheStats();
    loadPersistentCacheStats();
    return () => clearMessageTimer();
  }, []);

  const loadSettings = async () => {
    try {
      const s = await getSettings();
      setSettings(s);
      queueMicrotask(() => onSettingsChanged(s));
    } catch {
      let defaultDir = "";
      let defaultOutput = "";
      try {
        defaultDir = await getDefaultDownloadDir();
        defaultOutput = await getDefaultOutputDir();
      } catch {
        defaultDir = "";
        defaultOutput = "";
      }
      const fallback: AppSettings = {
        downloadDir: defaultDir,
        outputDir: defaultOutput,
        useGpu: true,
        preferredEncoder: "",
        autoDetectGpu: true,
        selectedGpu: "",
      };
      setSettings(fallback);
      queueMicrotask(() => onSettingsChanged(fallback));
    } finally {
      setLoading(false);
    }
  };

  const detectGpuInfo = async () => {
    setGpuLoading(true);
    try {
      const [info, nativeCaps] = await Promise.all([
        detectGpu().catch(() => ({ ok: false, available: false, encoder: null, vendor: null, hwaccel: null, name: null, allEncoders: [], message: "GPU detection failed" })),
        detectGpusNative().catch(() => []),
      ]);
      setGpuInfo(info);
      setNativeGpus(nativeCaps);
    } catch {
      setGpuInfo({ ok: false, available: false, encoder: null, vendor: null, hwaccel: null, name: null, allEncoders: [], message: "GPU detection failed" });
    } finally {
      setGpuLoading(false);
    }
  };

  const loadCacheStats = async () => {
    try {
      setCacheStats(await getCacheStats());
    } catch {
      setCacheStats(null);
    }
  };

  const loadPersistentCacheStats = async () => {
    try {
      setPersistentCacheStats(await getPersistentCacheStats());
    } catch {
      setPersistentCacheStats(null);
    }
  };

  const handleClearCache = async () => {
    setCacheClearing(true);
    try {
      await clearCache();
      await loadCacheStats();
    } finally {
      setCacheClearing(false);
    }
  };

  const handleClearPersistentCache = async () => {
    setPersistentCacheClearing(true);
    try {
      await clearPersistentCache();
      await loadPersistentCacheStats();
    } finally {
      setPersistentCacheClearing(false);
    }
  };

  const handleSave = async () => {
    if (!isValidPath(settings.downloadDir) || !isValidPath(settings.outputDir)) {
      setSaveMessage("error");
      clearMessageTimer();
      messageTimer.current = setTimeout(() => setSaveMessage(null), 3000);
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    clearMessageTimer();
    try {
      const saved = await saveSettings(settings);
      setSettings(saved);
      onSettingsChanged(saved);
      setSaveMessage("ok");
      messageTimer.current = setTimeout(() => setSaveMessage(null), 2000);
    } catch {
      setSaveMessage("error");
      messageTimer.current = setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setSaveMessage(null);
    clearMessageTimer();
    try {
      const defaults = await resetSettings();
      setSettings(defaults);
      onSettingsChanged(defaults);
      setSaveMessage("ok");
      messageTimer.current = setTimeout(() => setSaveMessage(null), 2000);
    } catch {
      setSaveMessage("error");
      messageTimer.current = setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setResetting(false);
    }
  };

  const pickFolder = async (current: string, onSelect: (path: string) => void) => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: current || undefined,
        title: "Select folder",
      });
      if (selected) {
        onSelect(selected as string);
      }
    } catch (err) {
      console.error("Folder picker failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="panel p-6 text-center">
        <p className="text-sm text-app-text-muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Download Directory */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <Download size={14} className="text-app-accent" />
          <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
            Download Directory
          </span>
        </div>
        <p className="text-[11px] text-app-text-muted">
          Where URL downloads are saved by default.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.downloadDir}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, downloadDir: e.target.value }))
            }
            disabled={disabled || isBusy}
            className="input flex-1 text-xs"
            placeholder="Downloads folder"
          />
          <button
            onClick={() =>
              pickFolder(settings.downloadDir, (dir) =>
                setSettings((prev) => ({ ...prev, downloadDir: dir }))
              )
            }
            disabled={disabled || isBusy}
            className="btn px-3 py-2"
            title="Browse for folder"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </motion.div>

      {/* Output Directory */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="panel p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={14} className="text-app-accent" />
          <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
            Output Directory
          </span>
        </div>
        <p className="text-[11px] text-app-text-muted">
          Where converted and transcoded files are saved.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.outputDir}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, outputDir: e.target.value }))
            }
            disabled={disabled || isBusy}
            className="input flex-1 text-xs"
            placeholder="Output folder"
          />
          <button
            onClick={() =>
              pickFolder(settings.outputDir, (dir) =>
                setSettings((prev) => ({ ...prev, outputDir: dir }))
              )
            }
            disabled={disabled || isBusy}
            className="btn px-3 py-2"
            title="Browse for folder"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </motion.div>

      {/* GPU Acceleration */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="panel p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <Monitor size={14} className="text-app-accent" />
          <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
            Performance
          </span>
        </div>
        <p className="text-[11px] text-app-text-muted">
          Video conversion, reduction, target-size reduction, and upscaling use hardware encoding. GPU mode never silently switches to a CPU video encoder.
        </p>

        <div className="space-y-2">
          <label htmlFor="gpu-selection" className="text-xs text-app-text font-medium">GPU for video tasks</label>
          <select
            id="gpu-selection"
            aria-describedby="gpu-selection-help"
            className="input w-full text-xs"
            value={settings.autoDetectGpu ? "auto" : settings.useGpu && settings.selectedGpu !== "libx264" ? settings.selectedGpu : "cpu"}
            disabled={disabled || isBusy || gpuLoading}
            onChange={(event) => {
              const value = event.target.value;
              const next = {
                ...settings,
                autoDetectGpu: value === "auto",
                useGpu: value !== "cpu",
                selectedGpu: value === "auto" || value === "cpu" ? "" : value,
                preferredEncoder: "",
              };
              setSettings(next);
              onSettingsChanged(next);
            }}
          >
            <option value="auto">Automatic (Recommended GPU)</option>
            <option value="parallel" disabled={parallelGpuEncoders(gpuInfo?.allEncoders ?? []).length < 2}>Both GPUs (parallel tasks)</option>
            {(gpuInfo?.allEncoders ?? []).filter((encoder) => encoder.vendor !== "CPU" && encoder.id !== "libx264").map((encoder) => (
              <option key={encoder.id} value={encoder.id}>{encoder.label}</option>
            ))}
            {settings.selectedGpu && settings.selectedGpu !== "libx264" && settings.selectedGpu !== "parallel" && !(gpuInfo?.allEncoders ?? []).some((encoder) => encoder.id === settings.selectedGpu) && (
              <option value={settings.selectedGpu} disabled>{settings.selectedGpu} (unavailable)</option>
            )}
            <option value="cpu">CPU only (software encoding)</option>
          </select>
          <p id="gpu-selection-help" className="text-[11px] text-app-text-muted">
            Both GPUs runs separate videos on available GPUs, one job per GPU. It requires two detected GPU vendors. Audio, images, and AI enhancement do not use this scheduling mode. Save Settings to keep your choice.
          </p>
          {gpuLoading ? (
            <p className="text-[11px] text-app-text-muted">Detecting GPU...</p>
          ) : gpuInfo?.available ? (
            <p className="text-[11px] text-app-text-secondary">Recommended: {gpuInfo.name} ({gpuInfo.encoder})</p>
          ) : (
            <p className="text-[11px] text-app-text-muted">{gpuInfo?.message || "No hardware encoder detected"}</p>
          )}
        </div>

        {nativeGpus.length > 0 && (
          <div className="space-y-1 mt-2">
            <p className="text-[11px] text-app-text-secondary font-medium">Detected encoders:</p>
            {nativeGpus.map((gpu) => (
              <div key={gpu.encoder} className="flex items-center gap-2 text-[11px]">
                <span className={gpu.works ? "text-green-400" : "text-red-400"}>
                  {gpu.works ? "●" : "○"}
                </span>
                <span className="text-app-text">{gpu.label}</span>
                <span className="text-app-text-muted">({gpu.vendor}, {gpu.hwaccel})</span>
              </div>
            ))}
          </div>
        )}

        {!gpuInfo?.available && !gpuLoading && (
          <p className="text-[11px] text-app-text-muted italic">
            Hardware encoding is not available. Select CPU only above to use software video encoding.
          </p>
        )}
      </motion.div>

      {/* Cache */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="panel p-4 space-y-3"
      >
        <div className="flex items-center gap-2">
          <HardDrive size={14} className="text-app-accent" />
          <span className="text-sm font-medium text-app-text">Cache</span>
        </div>
        <p className="text-[11px] text-app-text-muted">
          GPU detection and file metadata are cached to avoid redundant probes.
        </p>
        {cacheStats && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-app-text-secondary">
              Memory: {cacheStats.gpuEntries} GPU entry · {cacheStats.gpuHits} hit · {cacheStats.gpuMisses} miss
            </span>
            <motion.button
              onClick={handleClearCache}
              disabled={disabled || cacheClearing}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="btn py-1.5 px-3 text-[11px]"
            >
              <RotateCcw size={12} />
              {cacheClearing ? "Clearing..." : "Clear"}
            </motion.button>
          </div>
        )}
        {persistentCacheStats && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-app-text-secondary">
              Disk: {persistentCacheStats.totalEntries} entries · {persistentCacheStats.encoderHits + persistentCacheStats.fileHits} hit · {persistentCacheStats.encoderMisses + persistentCacheStats.fileMisses} miss
            </span>
            <motion.button
              onClick={handleClearPersistentCache}
              disabled={disabled || persistentCacheClearing}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="btn py-1.5 px-3 text-[11px]"
            >
              <RotateCcw size={12} />
              {persistentCacheClearing ? "Clearing..." : "Clear"}
            </motion.button>
          </div>
        )}
      </motion.div>

      {/* Save / Reset buttons */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="flex gap-2"
      >
          <motion.button
            onClick={handleSave}
            disabled={disabled || isBusy}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="flex-1 btn btn-primary py-2.5"
          >
          {saving ? (
            "Saving..."
          ) : saveMessage === "ok" ? (
            <>
              <Check size={14} /> Saved
            </>
          ) : saveMessage === "error" ? (
            <>
              <AlertCircle size={14} /> Error
            </>
          ) : (
            "Save Settings"
          )}
        </motion.button>
        <motion.button
          onClick={handleReset}
          disabled={disabled || isBusy}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="btn py-2.5 px-4"
          title="Reset to defaults"
        >
          {resetting ? "Resetting..." : (
            <>
              <RotateCcw size={14} />
              Reset
            </>
          )}
        </motion.button>
      </motion.div>

      <motion.button
        type="button"
        onClick={onOpenAbout}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        className="w-full btn py-2.5 text-xs"
      >
        <Info size={14} aria-hidden="true" /> About & Updates
      </motion.button>

      <p className="text-[11px] text-app-text-muted text-center">
        Settings are saved to your system's config folder and persist across app restarts.
      </p>
    </div>
  );
}
