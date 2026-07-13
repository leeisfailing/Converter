import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  detectVideoInfo,
  startBlur,
  getWeightPreview,
  getEncodePresets,
  detectGpu,
  listBlurConfigs,
  loadBlurConfig,
  saveBlurConfig,
  deleteBlurConfig,
  type ConfigInfo,
} from "../lib/tauri-commands";
import WeightingGraph from "./WeightingGraph";
import {
  FolderOpen,
  Film,
  Settings2,
  ChevronDown,
  ChevronRight,
  Plus,
  ToggleLeft,
  ToggleRight,
  Save,
  Trash2,
  X,
  Download,
  FileUp,
  ClipboardPaste,
} from "lucide-react";

interface Props {
  onAdd: (
    input: string,
    output: string,
    settings: BlurSettings
  ) => void;
  disabled: boolean;
}

export interface BlurSettings {
  blur: boolean;
  blur_amount: number;
  blur_output_fps: number;
  blur_weighting: string;
  blur_gamma: number;
  interpolate: boolean;
  interpolated_fps: string;
  interpolation_method: string;
  pre_interpolate: boolean;
  pre_interpolated_fps: string;
  deduplicate: boolean;
  deduplicate_method: string;
  timescale: boolean;
  input_timescale: number;
  output_timescale: number;
  output_timescale_audio_pitch: boolean;
  filters: boolean;
  brightness: number;
  saturation: number;
  contrast: number;
  encode_preset: string;
  quality: number;
  gpu_decoding: boolean;
  gpu_interpolation: boolean;
  gpu_encoding: boolean;
  detailed_filenames: boolean;
  copy_dates: boolean;
  override_advanced: boolean;
  advanced: {
    video_container: string;
    deduplicate_range: number;
    deduplicate_threshold: string;
    ffmpeg_override: string;
    debug: boolean;
    blur_weighting_gaussian_std_dev: number;
    blur_weighting_gaussian_mean: number;
    blur_weighting_gaussian_bound: string;
    svp_interpolation_preset: string;
    svp_interpolation_algorithm: string;
    interpolation_blocksize: string;
    interpolation_mask_area: number;
    rife_model: string;
    manual_svp: boolean;
    super_string: string;
    vectors_string: string;
    smooth_string: string;
  };
}

const DEFAULT_SETTINGS: BlurSettings = {
  blur: true,
  blur_amount: 1.0,
  blur_output_fps: 60,
  blur_weighting: "equal",
  blur_gamma: 1.0,
  interpolate: true,
  interpolated_fps: "1200",
  interpolation_method: "svp",
  pre_interpolate: false,
  pre_interpolated_fps: "360",
  deduplicate: true,
  deduplicate_method: "svp",
  timescale: false,
  input_timescale: 1.0,
  output_timescale: 1.0,
  output_timescale_audio_pitch: false,
  filters: false,
  brightness: 1.0,
  saturation: 1.0,
  contrast: 1.0,
  encode_preset: "h264",
  quality: 16,
  gpu_decoding: true,
  gpu_interpolation: true,
  gpu_encoding: false,
  detailed_filenames: false,
  copy_dates: false,
  override_advanced: false,
  advanced: {
    video_container: "mp4",
    deduplicate_range: 2,
    deduplicate_threshold: "0.001",
    ffmpeg_override: "",
    debug: false,
    blur_weighting_gaussian_std_dev: 1.0,
    blur_weighting_gaussian_mean: 2.0,
    blur_weighting_gaussian_bound: "[0,2]",
    svp_interpolation_preset: "weak",
    svp_interpolation_algorithm: "13",
    interpolation_blocksize: "8",
    interpolation_mask_area: 0,
    rife_model: "rife-v4.26_ensembleFalse",
    manual_svp: false,
    super_string: "",
    vectors_string: "",
    smooth_string: "",
  },
};

const WEIGHTING_OPTIONS = [
  { value: "equal", label: "Equal" },
  { value: "ascending", label: "Ascending" },
  { value: "descending", label: "Descending" },
  { value: "pyramid", label: "Pyramid" },
  { value: "gaussian", label: "Gaussian" },
  { value: "gaussian_reverse", label: "Gaussian Reverse" },
  { value: "gaussian_sym", label: "Gaussian Sym" },
  { value: "vegas", label: "Vegas" },
];

const INTERPOLATION_METHODS = [
  { value: "svp", label: "SVP" },
  { value: "rife", label: "RIFE" },
];

const DEDUP_METHODS = [
  { value: "svp", label: "SVP" },
  { value: "rife", label: "RIFE" },
];

const SVP_PRESETS = ["weak", "film", "smooth", "animation", "default", "test"];
const SVP_ALGORITHMS = ["1", "2", "11", "13", "21", "23"];
const BLOCK_SIZES = ["4", "8", "16", "32"];

function Toggle({
  enabled,
  onToggle,
  disabled,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className="cursor-pointer"
    >
      {enabled ? (
        <ToggleRight size={28} className="text-glass-accent" />
      ) : (
        <ToggleLeft size={28} className="text-glass-text-muted" />
      )}
    </button>
  );
}

function Section({
  title,
  children,
  defaultOpen,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div className="glass-panel overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 cursor-pointer hover:bg-glass-surface transition-colors"
      >
        <span className="text-xs font-semibold text-glass-text-dim uppercase tracking-wider">
          {title}
        </span>
        {open ? (
          <ChevronDown size={14} className="text-glass-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-glass-text-muted" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-glass-text-dim min-w-[80px]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="flex-1 h-1 appearance-none bg-white/10 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-glass-accent [&::-webkit-slider-thumb]:cursor-pointer"
      />
      <span className="text-[10px] text-glass-text-muted min-w-[40px] text-right">
        {value.toFixed(step < 1 ? 1 : 0)}{suffix ?? ""}
      </span>
    </div>
  );
}

export default function BlurSettings({ onAdd, disabled }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [settings, setSettings] = useState<BlurSettings>({
    ...DEFAULT_SETTINGS,
  });
  const [weightPreview, setWeightPreview] = useState<number[]>([]);
  const [gpuType, setGpuType] = useState("cpu");
  const [availablePresets, setAvailablePresets] = useState<
    { name: string; codec: string }[]
  >([]);

  // Config state
  const [configs, setConfigs] = useState<ConfigInfo[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string>("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [configName, setConfigName] = useState("");
  const [configDescription, setConfigDescription] = useState("");
  const [configError, setConfigError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [showPostPasteSave, setShowPostPasteSave] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Drag-and-drop
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter") {
        setIsDragOver(true);
      } else if (event.payload.type === "leave") {
        setIsDragOver(false);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths;
        if (paths.length > 0) {
          const path = paths[0];
          const ext = path.split(".").pop()?.toLowerCase();
          const videoExts = [
            "mp4", "mkv", "avi", "mov", "webm", "wmv", "flv", "m4v",
            "mpg", "mpeg", "3gp", "ts", "mts", "vob",
          ];
          if (videoExts.includes(ext || "")) {
            setFilePath(path);
          }
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Detect GPU on mount
  useEffect(() => {
    let cancelled = false;
    detectGpu()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setGpuType(res.gpu_type);
          const p = res.gpu_type === "cpu" ? "cpu" : res.gpu_type;
          getEncodePresets(p)
            .then((presets) => {
              if (!cancelled && presets.ok) {
                setAvailablePresets(presets.presets);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load configs on mount
  const refreshConfigs = useCallback(async () => {
    try {
      const res = await listBlurConfigs();
      if (res.ok) {
        setConfigs(res.configs);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listBlurConfigs()
      .then((res) => {
        if (!cancelled && res.ok) {
          setConfigs(res.configs);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Auto-load last used config on mount
  useEffect(() => {
    let cancelled = false;
    const lastConfig = localStorage.getItem("blur_last_config");
    if (lastConfig) {
      loadBlurConfig(lastConfig)
        .then((res) => {
          if (!cancelled && res.ok && res.settings) {
            const loaded = res.settings as unknown as BlurSettings;
            setSettings((prev) => ({
              ...prev,
              ...loaded,
              advanced: { ...prev.advanced, ...(loaded.advanced || {}) },
            }));
            setSelectedConfig(lastConfig);
          }
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, []);

  // Update presets when gpu type changes
  useEffect(() => {
    let cancelled = false;
    const p = settings.gpu_encoding ? gpuType : "cpu";
    getEncodePresets(p)
      .then((presets) => {
        if (!cancelled && presets.ok) {
          setAvailablePresets(presets.presets);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [settings.gpu_encoding, gpuType]);

  // Update weight preview
  const updateWeightPreview = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await getWeightPreview({
        blur_weighting: settings.blur_weighting,
        blur_amount: settings.blur_amount,
        video_fps: 24,
        output_fps: settings.blur_output_fps,
        gaussian_std_dev: settings.advanced.blur_weighting_gaussian_std_dev,
        gaussian_mean: settings.advanced.blur_weighting_gaussian_mean,
        gaussian_bound: settings.advanced.blur_weighting_gaussian_bound,
      });
      if (!signal?.aborted && res.ok) {
        setWeightPreview(res.weights);
      }
    } catch {
      if (!signal?.aborted) {
        setWeightPreview([]);
      }
    }
  }, [
    settings.blur_weighting,
    settings.blur_amount,
    settings.blur_output_fps,
    settings.advanced.blur_weighting_gaussian_std_dev,
    settings.advanced.blur_weighting_gaussian_mean,
    settings.advanced.blur_weighting_gaussian_bound,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    updateWeightPreview(controller.signal);
    return () => controller.abort();
  }, [updateWeightPreview]);

  // Handle loading a config
  const handleLoadConfig = async (name: string) => {
    if (!name) return;
    try {
      const res = await loadBlurConfig(name);
      if (res.ok && res.settings) {
        const loaded = res.settings as unknown as BlurSettings;
        setSettings((prev) => ({
          ...prev,
          ...loaded,
          advanced: { ...prev.advanced, ...(loaded.advanced || {}) },
        }));
        setSelectedConfig(name);
        localStorage.setItem("blur_last_config", name);
      } else {
        setConfigError(`Failed to load config: ${name}`);
      }
    } catch (e) {
      setConfigError(`Failed to load config: ${String(e)}`);
    }
  };

  // Handle saving a config
  const handleSaveConfig = async () => {
    if (isSaving) return;
    if (!configName.trim()) {
      setConfigError("Name is required");
      return;
    }
    const savedName = configName.trim();
    const savedDescription = configDescription.trim();
    setIsSaving(true);
    try {
      await saveBlurConfig(savedName, savedDescription, settings as any);
      setShowSaveModal(false);
      setConfigName("");
      setConfigDescription("");
      setConfigError("");
      setSelectedConfig(savedName);
      await refreshConfigs();
    } catch (e) {
      setConfigError(String(e));
    } finally {
      setIsSaving(false);
    }
  };

  // Handle deleting a config
  const handleDeleteConfig = async (name: string) => {
    try {
      await deleteBlurConfig(name);
      setSelectedConfig("");
      await refreshConfigs();
    } catch (e) {
      setConfigError(`Failed to delete config: ${String(e)}`);
    }
  };

  // Parse pasted config text into BlurSettings
  const parsePasteConfig = (text: string): Partial<BlurSettings> => {
    const lines = text.split("\n");
    const result: Partial<BlurSettings> = {};
    const adv: Partial<BlurSettings["advanced"]> = {};

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("-")) continue;

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const val = line.substring(colonIdx + 1).trim();

      // Blur section
      if (key === "blur") result.blur = val === "true";
      else if (key === "blur amount") { const n = parseFloat(val); result.blur_amount = isNaN(n) ? 1.0 : n; }
      else if (key === "blur output fps") { const n = parseInt(val, 10); result.blur_output_fps = isNaN(n) ? 60 : n; }
      else if (key === "blur weighting") result.blur_weighting = val;
      else if (key === "blur gamma") { const n = parseFloat(val); result.blur_gamma = isNaN(n) ? 1.0 : n; }

      // Interpolation section
      else if (key === "interpolate") result.interpolate = val === "true";
      else if (key === "interpolated fps") result.interpolated_fps = val;
      else if (key === "interpolation method") result.interpolation_method = val;

      // Rendering section
      else if (key === "quality") { const n = parseInt(val, 10); result.quality = isNaN(n) ? 16 : n; }
      else if (key === "detailed filenames") result.detailed_filenames = val === "true";
      else if (key === "copy dates") result.copy_dates = val === "true";

      // Timescale section
      else if (key === "input timescale") { const n = parseFloat(val); result.input_timescale = isNaN(n) ? 1.0 : n; }
      else if (key === "output timescale") { const n = parseFloat(val); result.output_timescale = isNaN(n) ? 1.0 : n; }
      else if (key === "adjust timescaled audio pitch") result.output_timescale_audio_pitch = val === "true";
      else if (key === "timescale") result.timescale = val === "true";

      // Filters section
      else if (key === "brightness") { const n = parseFloat(val); result.brightness = isNaN(n) ? 1.0 : n; }
      else if (key === "saturation") { const n = parseFloat(val); result.saturation = isNaN(n) ? 1.0 : n; }
      else if (key === "contrast") { const n = parseFloat(val); result.contrast = isNaN(n) ? 1.0 : n; }
      else if (key === "filters") result.filters = val === "true";

      // Advanced rendering section
      else if (key === "gpu" || key === "gpu encoding") result.gpu_encoding = val === "true";
      else if (key === "gpu decoding") result.gpu_decoding = val === "true";
      else if (key === "gpu interpolation") result.gpu_interpolation = val === "true";
      else if (key === "deduplicate") result.deduplicate = val === "true";
      else if (key === "custom ffmpeg filters" || key === "ffmpeg override") adv.ffmpeg_override = val;
      else if (key === "video container") adv.video_container = val;

      // Advanced blur section
      else if (key === "blur weighting gaussian std dev") { const n = parseFloat(val); adv.blur_weighting_gaussian_std_dev = isNaN(n) ? 1.0 : n; }
      else if (key === "blur weighting gaussian mean") { const n = parseFloat(val); adv.blur_weighting_gaussian_mean = isNaN(n) ? 2.0 : n; }
      else if (key === "blur weighting bound") adv.blur_weighting_gaussian_bound = val;

      // Advanced interpolation section
      else if (key === "interpolation program (svp/rife/rife-ncnn)" || key === "interpolation program") result.interpolation_method = val.toLowerCase().includes("rife") ? "rife" : "svp";
      else if (key === "interpolation tuning" || key === "svp interpolation tuning" || key === "interpolation preset") adv.svp_interpolation_preset = val;
      else if (key === "interpolation algorithm" || key === "svp interpolation algorithm") adv.svp_interpolation_algorithm = val;
      else if (key === "interpolation speed") adv.svp_interpolation_preset = val;
      else if (key === "interpolation blocksize" || key === "interpolation block size") adv.interpolation_blocksize = val;

      // Deduplication
      else if (key === "deduplication method" || key === "dedup method") result.deduplicate_method = val;
      else if (key === "deduplication threshold" || key === "dedup threshold") adv.deduplicate_threshold = val;
    }

    // Enable features if settings were provided, but only if not explicitly set
    if (result.filters === undefined && (result.brightness !== undefined || result.saturation !== undefined || result.contrast !== undefined)) {
      result.filters = true;
    }
    if (result.timescale === undefined && (result.input_timescale !== undefined || result.output_timescale !== undefined)) {
      result.timescale = true;
    }

    result.advanced = adv as BlurSettings["advanced"];
    return result;
  };

  // Handle applying pasted config
  const handleApplyPaste = () => {
    try {
      const parsed = parsePasteConfig(pasteText);
      setSettings((prev) => ({
        ...prev,
        ...parsed,
        advanced: { ...prev.advanced, ...(parsed.advanced || {}) },
      }));
      setShowPasteModal(false);
      setPasteText("");
      setPasteError("");
      setShowPostPasteSave(true);
    } catch (e) {
      setPasteError("Failed to parse config: " + String(e));
    }
  };

  // Handle saving after paste
  const handlePostPasteSave = async () => {
    if (isSaving) return;
    if (!configName.trim()) {
      setConfigError("Name is required");
      return;
    }
    const savedName = configName.trim();
    const savedDescription = configDescription.trim();
    setIsSaving(true);
    try {
      await saveBlurConfig(savedName, savedDescription, settings as any);
      setShowPostPasteSave(false);
      setConfigName("");
      setConfigDescription("");
      setConfigError("");
      setSelectedConfig(savedName);
      await refreshConfigs();
    } catch (e) {
      setConfigError(String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const handleBrowse = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Video Files",
          extensions: [
            "mp4",
            "mkv",
            "avi",
            "mov",
            "webm",
            "wmv",
            "flv",
            "m4v",
            "mpg",
            "mpeg",
            "3gp",
            "ts",
            "mts",
            "vob",
          ],
        },
      ],
    });
    if (selected) {
      setFilePath(selected as string);
    }
  }, []);

  const getOutputPath = useCallback(() => {
    if (!filePath) return "";
    const lastDot = filePath.lastIndexOf(".");
    const base = lastDot > 0 ? filePath.substring(0, lastDot) : filePath;
    const container = settings.advanced.video_container || "mp4";
    return `${base}_blur.${container}`;
  }, [filePath, settings.advanced.video_container]);

  const handleAdd = useCallback(() => {
    if (!filePath) return;
    onAdd(filePath, getOutputPath(), settings);
    setFilePath(null);
    setSettings({ ...DEFAULT_SETTINGS });
    setSelectedConfig("");
  }, [filePath, getOutputPath, settings, onAdd]);

  const update = useCallback((partial: Partial<BlurSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const updateAdvanced = useCallback(
    (partial: Partial<BlurSettings["advanced"]>) => {
      setSettings((prev) => ({
        ...prev,
        advanced: { ...prev.advanced, ...partial },
      }));
    },
    []
  );

  const currentCodec = useMemo(
    () =>
      availablePresets.find((p) => p.name === settings.encode_preset)?.codec ||
      "libx264",
    [availablePresets, settings.encode_preset]
  );

  return (
    <div className="space-y-3">
      {/* Config Manager */}
      <div className="glass-panel p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-glass-text-dim uppercase tracking-wider">
            Preset Config
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setPasteError("");
                setShowPasteModal(true);
              }}
              disabled={disabled}
              className="p-1.5 rounded hover:bg-white/10 transition-colors"
              title="Paste config"
            >
              <ClipboardPaste size={14} className="text-glass-text-dim" />
            </button>
            <button
              onClick={() => {
                setConfigError("");
                setShowSaveModal(true);
              }}
              disabled={disabled}
              className="p-1.5 rounded hover:bg-white/10 transition-colors"
              title="Save current settings"
            >
              <Save size={14} className="text-glass-text-dim" />
            </button>
            {selectedConfig && !configs.find((c) => c.name === selectedConfig && c.is_preset) && (
              <button
                onClick={() => handleDeleteConfig(selectedConfig)}
                disabled={disabled}
                className="p-1.5 rounded hover:bg-glass-danger/20 transition-colors"
                title="Delete config"
              >
                <Trash2 size={14} className="text-glass-danger/60" />
              </button>
            )}
          </div>
        </div>
        <select
          value={selectedConfig}
          onChange={(e) => handleLoadConfig(e.target.value)}
          disabled={disabled}
          className="glass-select w-full py-1.5 px-2 text-xs"
        >
          <option value="">Custom (unsaved)</option>
          {configs.length > 0 && (
            <optgroup label="Built-in Presets">
              {configs
                .filter((c) => c.is_preset)
                .map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          )}
          {configs.some((c) => !c.is_preset) && (
            <optgroup label="Saved Configs">
              {configs
                .filter((c) => !c.is_preset)
                .map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
        {selectedConfig && (
          <p className="text-[10px] text-glass-text-muted mt-1.5">
            {configs.find((c) => c.name === selectedConfig)?.description}
          </p>
        )}
      </div>

      {/* File selector */}
      <motion.div
        onClick={!disabled ? handleBrowse : undefined}
        className={`drop-area ${filePath ? "has-file" : ""} ${
          isDragOver ? "border-glass-accent bg-glass-accent-dim" : ""
        } ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
        whileHover={!disabled ? { scale: 1.005 } : undefined}
        whileTap={!disabled ? { scale: 0.995 } : undefined}
      >
        {filePath ? (
          <div className="flex items-center justify-center gap-3">
            <Film size={18} className="text-glass-accent" />
            <span className="text-sm font-medium text-glass-text truncate max-w-[400px]">
              {filePath.split(/[\\/]/).pop()}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {isDragOver ? (
              <FileUp size={24} className="text-glass-accent" />
            ) : (
              <FolderOpen size={24} className="text-glass-text-muted" />
            )}
            <p className="text-sm text-glass-text-dim">
              {isDragOver
                ? "Drop video file here"
                : "Click or drag a video file here"}
            </p>
          </div>
        )}
      </motion.div>

      {filePath && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {/* Motion Blur */}
          <Section title="Motion Blur" defaultOpen>
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">Enable blur</span>
              <Toggle
                enabled={settings.blur}
                onToggle={() => update({ blur: !settings.blur })}
                disabled={disabled}
              />
            </div>
            {settings.blur && (
              <>
                <SliderField
                  label="Amount"
                  value={settings.blur_amount}
                  min={0}
                  max={2}
                  step={0.1}
                  onChange={(v) => update({ blur_amount: v })}
                  disabled={disabled}
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                    Output FPS
                  </span>
                  <input
                    type="number"
                    value={settings.blur_output_fps}
                    onChange={(e) =>
                      update({
                        blur_output_fps: parseInt(e.target.value) || 60,
                      })
                    }
                    disabled={disabled}
                    className="glass-input w-20 py-1 px-2 text-xs"
                    min={1}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                    Weighting
                  </span>
                  <select
                    value={settings.blur_weighting}
                    onChange={(e) =>
                      update({ blur_weighting: e.target.value })
                    }
                    disabled={disabled}
                    className="glass-select py-1 px-2 text-xs"
                  >
                    {WEIGHTING_OPTIONS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </div>
                {settings.blur_weighting === "gaussian" ||
                settings.blur_weighting === "gaussian_reverse" ||
                settings.blur_weighting === "gaussian_sym" ? (
                  <>
                    <SliderField
                      label="Std Dev"
                      value={settings.advanced.blur_weighting_gaussian_std_dev}
                      min={0.1}
                      max={5}
                      step={0.1}
                      onChange={(v) =>
                        updateAdvanced({ blur_weighting_gaussian_std_dev: v })
                      }
                      disabled={disabled}
                    />
                    <SliderField
                      label="Mean"
                      value={settings.advanced.blur_weighting_gaussian_mean}
                      min={0}
                      max={10}
                      step={0.1}
                      onChange={(v) =>
                        updateAdvanced({ blur_weighting_gaussian_mean: v })
                      }
                      disabled={disabled}
                    />
                  </>
                ) : null}
                <SliderField
                  label="Gamma"
                  value={settings.blur_gamma}
                  min={0.5}
                  max={3}
                  step={0.1}
                  onChange={(v) => update({ blur_gamma: v })}
                  disabled={disabled}
                />
                {/* Weighting Graph */}
                <div className="glass-panel p-3">
                  <WeightingGraph weights={weightPreview} />
                </div>
              </>
            )}
          </Section>

          {/* Frame Interpolation */}
          <Section title="Frame Interpolation">
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">Enable interpolation</span>
              <Toggle
                enabled={settings.interpolate}
                onToggle={() =>
                  update({ interpolate: !settings.interpolate })
                }
                disabled={disabled}
              />
            </div>
            {settings.interpolate && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                    Target FPS
                  </span>
                  <input
                    type="text"
                    value={settings.interpolated_fps}
                    onChange={(e) =>
                      update({ interpolated_fps: e.target.value })
                    }
                    disabled={disabled}
                    className="glass-input w-24 py-1 px-2 text-xs"
                    placeholder="1200 or 5x"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                    Method
                  </span>
                  <select
                    value={settings.interpolation_method}
                    onChange={(e) =>
                      update({ interpolation_method: e.target.value })
                    }
                    disabled={disabled}
                    className="glass-select py-1 px-2 text-xs"
                  >
                    {INTERPOLATION_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                {settings.interpolation_method === "svp" && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                        SVP Preset
                      </span>
                      <select
                        value={settings.advanced.svp_interpolation_preset}
                        onChange={(e) =>
                          updateAdvanced({
                            svp_interpolation_preset: e.target.value,
                          })
                        }
                        disabled={disabled}
                        className="glass-select py-1 px-2 text-xs"
                      >
                        {SVP_PRESETS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                        Algorithm
                      </span>
                      <select
                        value={settings.advanced.svp_interpolation_algorithm}
                        onChange={(e) =>
                          updateAdvanced({
                            svp_interpolation_algorithm: e.target.value,
                          })
                        }
                        disabled={disabled}
                        className="glass-select py-1 px-2 text-xs"
                      >
                        {SVP_ALGORITHMS.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                        Block Size
                      </span>
                      <select
                        value={settings.advanced.interpolation_blocksize}
                        onChange={(e) =>
                          updateAdvanced({
                            interpolation_blocksize: e.target.value,
                          })
                        }
                        disabled={disabled}
                        className="glass-select py-1 px-2 text-xs"
                      >
                        {BLOCK_SIZES.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-glass-text-dim">
                    Pre-interpolate (two-pass)
                  </span>
                  <Toggle
                    enabled={settings.pre_interpolate}
                    onToggle={() =>
                      update({
                        pre_interpolate: !settings.pre_interpolate,
                      })
                    }
                    disabled={disabled}
                  />
                </div>
              </>
            )}
          </Section>

          {/* Deduplication */}
          <Section title="Deduplication">
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">Enable deduplication</span>
              <Toggle
                enabled={settings.deduplicate}
                onToggle={() =>
                  update({ deduplicate: !settings.deduplicate })
                }
                disabled={disabled}
              />
            </div>
            {settings.deduplicate && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                    Method
                  </span>
                  <select
                    value={settings.deduplicate_method}
                    onChange={(e) =>
                      update({ deduplicate_method: e.target.value })
                    }
                    disabled={disabled}
                    className="glass-select py-1 px-2 text-xs"
                  >
                    {DEDUP_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                    Threshold
                  </span>
                  <input
                    type="text"
                    value={settings.advanced.deduplicate_threshold}
                    onChange={(e) =>
                      updateAdvanced({
                        deduplicate_threshold: e.target.value,
                      })
                    }
                    disabled={disabled}
                    className="glass-input w-24 py-1 px-2 text-xs"
                  />
                </div>
              </>
            )}
          </Section>

          {/* Timescale */}
          <Section title="Timescale">
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">Enable timescale</span>
              <Toggle
                enabled={settings.timescale}
                onToggle={() =>
                  update({ timescale: !settings.timescale })
                }
                disabled={disabled}
              />
            </div>
            {settings.timescale && (
              <>
                <SliderField
                  label="Input Speed"
                  value={settings.input_timescale}
                  min={0.1}
                  max={4}
                  step={0.1}
                  onChange={(v) => update({ input_timescale: v })}
                  disabled={disabled}
                  suffix="x"
                />
                <SliderField
                  label="Output Speed"
                  value={settings.output_timescale}
                  min={0.1}
                  max={4}
                  step={0.1}
                  onChange={(v) => update({ output_timescale: v })}
                  disabled={disabled}
                  suffix="x"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-glass-text-dim">
                    Adjust audio pitch
                  </span>
                  <Toggle
                    enabled={settings.output_timescale_audio_pitch}
                    onToggle={() =>
                      update({
                        output_timescale_audio_pitch:
                          !settings.output_timescale_audio_pitch,
                      })
                    }
                    disabled={disabled}
                  />
                </div>
              </>
            )}
          </Section>

          {/* Video Filters */}
          <Section title="Video Filters">
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">Enable filters</span>
              <Toggle
                enabled={settings.filters}
                onToggle={() =>
                  update({ filters: !settings.filters })
                }
                disabled={disabled}
              />
            </div>
            {settings.filters && (
              <>
                <SliderField
                  label="Brightness"
                  value={settings.brightness}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(v) => update({ brightness: v })}
                  disabled={disabled}
                />
                <SliderField
                  label="Saturation"
                  value={settings.saturation}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(v) => update({ saturation: v })}
                  disabled={disabled}
                />
                <SliderField
                  label="Contrast"
                  value={settings.contrast}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(v) => update({ contrast: v })}
                  disabled={disabled}
                />
              </>
            )}
          </Section>

          {/* Encoding */}
          <Section title="Encoding" defaultOpen>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                Preset
              </span>
              <select
                value={settings.encode_preset}
                onChange={(e) =>
                  update({ encode_preset: e.target.value })
                }
                disabled={disabled}
                className="glass-select py-1 px-2 text-xs"
              >
                {availablePresets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name.toUpperCase()} ({p.codec})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                Quality
              </span>
              <input
                type="number"
                value={settings.quality}
                onChange={(e) =>
                  update({ quality: parseInt(e.target.value) || 16 })
                }
                disabled={disabled}
                className="glass-input w-20 py-1 px-2 text-xs"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                Container
              </span>
              <select
                value={settings.advanced.video_container}
                onChange={(e) =>
                  updateAdvanced({ video_container: e.target.value })
                }
                disabled={disabled}
                className="glass-select py-1 px-2 text-xs"
              >
                {["mp4", "mkv", "avi", "mov", "webm"].map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">GPU encoding</span>
              <Toggle
                enabled={settings.gpu_encoding}
                onToggle={() =>
                  update({ gpu_encoding: !settings.gpu_encoding })
                }
                disabled={disabled}
              />
            </div>
          </Section>

          {/* Advanced */}
          <Section title="Advanced">
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">GPU decoding</span>
              <Toggle
                enabled={settings.gpu_decoding}
                onToggle={() =>
                  update({ gpu_decoding: !settings.gpu_decoding })
                }
                disabled={disabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">
                GPU interpolation
              </span>
              <Toggle
                enabled={settings.gpu_interpolation}
                onToggle={() =>
                  update({
                    gpu_interpolation: !settings.gpu_interpolation,
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">
                Detailed filenames
              </span>
              <Toggle
                enabled={settings.detailed_filenames}
                onToggle={() =>
                  update({
                    detailed_filenames: !settings.detailed_filenames,
                  })
                }
                disabled={disabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-glass-text-dim">Debug mode</span>
              <Toggle
                enabled={settings.advanced.debug}
                onToggle={() =>
                  updateAdvanced({ debug: !settings.advanced.debug })
                }
                disabled={disabled}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                Custom FFmpeg
              </span>
              <input
                type="text"
                value={settings.advanced.ffmpeg_override}
                onChange={(e) =>
                  updateAdvanced({ ffmpeg_override: e.target.value })
                }
                disabled={disabled}
                className="glass-input py-1 px-2 text-xs"
                placeholder="e.g. -c:v libx264 -crf 18"
              />
            </div>
          </Section>

          {/* Add to Queue */}
          {filePath && (
            <motion.button
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAdd}
              disabled={disabled}
              className="w-full glass-btn glass-btn-primary py-3"
            >
              <Plus size={16} />
              Add Blur to Queue
            </motion.button>
          )}
        </motion.div>
      )}

      {!filePath && (
        <p className="text-[10px] text-glass-text-muted text-center">
          Select or drag a video file to apply motion blur and frame interpolation.
        </p>
      )}

      {/* Save Config Modal */}
      <AnimatePresence>
        {showSaveModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => {
              setShowSaveModal(false);
              setConfigError("");
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel p-4 w-[320px] space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-glass-text">
                  Save Config
                </span>
                <button
                  onClick={() => {
                    setShowSaveModal(false);
                    setConfigError("");
                  }}
                  className="p-1 rounded hover:bg-white/10"
                >
                  <X size={14} className="text-glass-text-dim" />
                </button>
              </div>

              <input
                type="text"
                value={configName}
                onChange={(e) => {
                  setConfigName(e.target.value);
                  setConfigError("");
                }}
                placeholder="Config name"
                className="glass-input w-full py-2 px-3 text-sm"
                autoFocus
              />

              <input
                type="text"
                value={configDescription}
                onChange={(e) => setConfigDescription(e.target.value)}
                placeholder="Description (optional)"
                className="glass-input w-full py-2 px-3 text-sm"
              />

              {configError && (
                <p className="text-[10px] text-glass-danger/80">{configError}</p>
              )}

              <button
                onClick={handleSaveConfig}
                disabled={isSaving || !configName.trim()}
                className="w-full glass-btn glass-btn-primary py-2 disabled:opacity-30"
              >
                <Save size={14} />
                {isSaving ? "Saving..." : "Save"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Paste Config Modal */}
      <AnimatePresence>
        {showPasteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => {
              setShowPasteModal(false);
              setPasteError("");
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel p-4 w-[420px] space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-glass-text">
                  Paste Config
                </span>
                <button
                  onClick={() => {
                    setShowPasteModal(false);
                    setPasteError("");
                  }}
                  className="p-1 rounded hover:bg-white/10"
                >
                  <X size={14} className="text-glass-text-dim" />
                </button>
              </div>

              <p className="text-[10px] text-glass-text-muted">
                Paste your blur config below. Each setting on its own line with format: key: value
              </p>

              <textarea
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  setPasteError("");
                }}
                placeholder={"blur: true\nblur amount: 1.0\nblur output fps: 60\nblur weighting: equal\n\ninterpolate: true\ninterpolated fps: 960\n\nquality: 16\ndetailed filenames: true"}
                className="glass-input w-full h-[300px] py-2 px-3 text-xs font-mono resize-none"
                autoFocus
              />

              {pasteError && (
                <p className="text-[10px] text-glass-danger/80">{pasteError}</p>
              )}

              <button
                onClick={handleApplyPaste}
                disabled={!pasteText.trim()}
                className="w-full glass-btn glass-btn-primary py-2 disabled:opacity-30"
              >
                <ClipboardPaste size={14} />
                Apply Config
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Post-Paste Save Modal */}
      <AnimatePresence>
        {showPostPasteSave && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => {
              setShowPostPasteSave(false);
              setConfigError("");
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel p-4 w-[320px] space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-glass-text">
                  Config Applied
                </span>
                <button
                  onClick={() => {
                    setShowPostPasteSave(false);
                    setConfigError("");
                  }}
                  className="p-1 rounded hover:bg-white/10"
                >
                  <X size={14} className="text-glass-text-dim" />
                </button>
              </div>

              <p className="text-xs text-glass-text-dim">
                Config has been applied. Optionally save it for quick access later.
              </p>

              <input
                type="text"
                value={configName}
                onChange={(e) => {
                  setConfigName(e.target.value);
                  setConfigError("");
                }}
                placeholder="Config name (optional)"
                className="glass-input w-full py-2 px-3 text-sm"
                autoFocus
              />

              <input
                type="text"
                value={configDescription}
                onChange={(e) => setConfigDescription(e.target.value)}
                placeholder="Description (optional)"
                className="glass-input w-full py-2 px-3 text-sm"
              />

              {configError && (
                <p className="text-[10px] text-glass-danger/80">{configError}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowPostPasteSave(false);
                    setConfigError("");
                  }}
                  className="flex-1 glass-btn py-2"
                >
                  Skip
                </button>
                <button
                  onClick={handlePostPasteSave}
                  disabled={isSaving || !configName.trim()}
                  className="flex-1 glass-btn glass-btn-primary py-2 disabled:opacity-30"
                >
                  <Save size={14} />
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
