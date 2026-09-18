import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { detectFile } from "../lib/tauri-commands";
import {
  FolderOpen,
  FileVideo,
  Image,
  Music,
  Plus,
  FileUp,
  SlidersHorizontal,
  Shrink,
  FileDown,
} from "lucide-react";

export type TranscoderMode = "compress" | "reduce";

interface Props {
  onAdd: (
    inputPath: string,
    outputPath: string,
    quality: number,
    fileType: "video" | "photo" | "audio",
    targetBytes: number | null,
    mode: TranscoderMode,
  ) => void;
  disabled: boolean;
}

function getQualityLabel(q: number): string {
  if (q <= 30) return "Low quality (smaller file)";
  if (q <= 60) return "Medium quality";
  if (q <= 85) return "High quality";
  return "Maximum quality";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

const MODE_OPTIONS: { id: TranscoderMode; label: string; icon: typeof Shrink; description: string }[] = [
  { id: "compress", label: "Compress", icon: SlidersHorizontal, description: "Quality-based encoding" },
  { id: "reduce", label: "Reduce", icon: Shrink, description: "Fit within a target size" },
];

export default function FileTranscoder({ onAdd, disabled }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [detectedFileType, setDetectedFileType] = useState<"video" | "photo" | "audio" | null>(null);
  const [mode, setMode] = useState<TranscoderMode>("compress");
  const [quality, setQuality] = useState(50);
  const [targetSize, setTargetSize] = useState("10");
  const [targetUnit, setTargetUnit] = useState<"KB" | "MB" | "GB">("MB");
  const targetBytes = Math.floor(Number(targetSize) * { KB: 1_000, MB: 1_000_000, GB: 1_000_000_000 }[targetUnit]);
  const validTarget = Number.isSafeInteger(targetBytes) && targetBytes > 0 && targetBytes <= 10_000_000_000;
  const [isDragOver, setIsDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const detectGeneration = useRef(0);

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter") {
        setIsDragOver(true);
      } else if (event.payload.type === "leave") {
        setIsDragOver(false);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        if (disabled) return;
        const paths = event.payload.paths;
        if (paths.length > 0) {
          console.log(`[transcoder] File dropped: "${paths[0].split(/[\\/]/).pop()}"`);
          setFilePath(paths[0]);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [disabled]);

  useEffect(() => {
    if (!filePath) return;
    setDetectedFileType(null);
    let cancelled = false;
    const generation = ++detectGeneration.current;
    console.log(`[transcoder] Detecting file type...`);
    detectFile(filePath, false)
      .then((res) => {
        if (cancelled || generation !== detectGeneration.current) return;
        if (res.ok) {
          const ft = res.file_type as "video" | "photo" | "audio";
          console.log(`[transcoder] Detected: type=${ft}`);
          setDetectedFileType(ft);
        }
      })
      .catch((err) => {
        if (cancelled || generation !== detectGeneration.current) return;
        console.error(`[transcoder] Detection failed:`, err);
      });
    return () => { cancelled = true; };
  }, [filePath]);

  const handleBrowse = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Media Files",
          extensions: [
            "mp4", "mkv", "avi", "mov", "webm", "wmv", "flv", "m4v",
            "jpg", "jpeg", "png", "webp", "bmp", "gif", "tiff", "tif",
            "heic", "heif", "avif",
            "mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus",
          ],
        },
      ],
    });
    if (selected) {
      setFilePath(selected as string);
    }
  };

  const getOutputPath = useCallback(() => {
    if (!filePath) return "";
    const lastDot = filePath.lastIndexOf(".");
    const ext = lastDot > 0 ? filePath.substring(lastDot) : "";
    const base = lastDot > 0 ? filePath.substring(0, lastDot) : filePath;
    const suffix = mode === "reduce" ? "_reduced" : "_compressed";
    return `${base}${suffix}${ext}`;
  }, [filePath, mode]);

  const handleAdd = () => {
    if (!filePath || !detectedFileType) return;
    if (mode === "reduce" && !validTarget) return;

    const targetBytesVal = mode === "reduce" ? targetBytes : null;
    console.log(`[transcoder] Adding to queue: "${filePath.split(/[\\/]/).pop()}" => mode=${mode}${mode === "compress" ? `, quality=${quality}%` : `, max ${targetSize} ${targetUnit}`}`);

    onAdd(
      filePath,
      getOutputPath(),
      quality,
      detectedFileType,
      targetBytesVal,
      mode,
    );

    setFilePath(null);
    setDetectedFileType(null);
    setQuality(50);
    setTargetSize("10");
  };

  const isVideoOrPhoto = detectedFileType === "video" || detectedFileType === "photo";
  const outputFileType = detectedFileType === "video" ? "MP4" : detectedFileType === "audio" ? "MP3" : "WebP";

  const buttonLabel = (() => {
    if (mode === "reduce") {
      return `under ${formatBytes(targetBytes)}`;
    }
    return `${quality}% quality`;
  })();

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <motion.div
        ref={dropRef}
        onClick={!disabled ? handleBrowse : undefined}
        className={`drop-area ${filePath ? "has-file" : ""} ${
          isDragOver ? "active" : ""
        } ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
        animate={
          isDragOver
            ? { scale: 1.02, borderColor: "#6366f1" }
            : { scale: 1, borderColor: "rgba(0, 0, 0, 0)" }
        }
        whileHover={!disabled ? { scale: 1.02 } : undefined}
        whileTap={!disabled ? { scale: 0.98 } : undefined}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {filePath ? (
          <div className="flex items-center justify-center gap-3">
            {detectedFileType === "video" ? (
              <FileVideo size={18} className="text-app-accent" />
            ) : detectedFileType === "audio" ? (
              <Music size={18} className="text-app-accent" />
            ) : (
              <Image size={18} className="text-app-accent" />
            )}
            <span className="text-sm font-medium text-app-text truncate max-w-[400px]">
              {filePath.split(/[\\/]/).pop()}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {isDragOver ? (
              <FileUp size={24} className="text-app-accent" />
            ) : (
              <FolderOpen size={24} className="text-app-text-muted" />
            )}
            <p className="text-sm text-app-text-muted">
              {isDragOver ? "Drop file here" : "Click or drag a file here"}
            </p>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {filePath && detectedFileType && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="panel p-4 space-y-4">
              <div className="flex items-center gap-2 text-xs text-app-text-muted">
                <span className="font-medium text-app-text-secondary">
                  {detectedFileType === "video" ? "Video" : detectedFileType === "audio" ? "Audio" : "Photo"}
                </span>
                <SlidersHorizontal size={12} />
                <span className="font-medium text-app-text-secondary">Transcode</span>
              </div>

              {/* Mode selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-app-text-muted uppercase tracking-wider">
                  Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {MODE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const selected = mode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setMode(opt.id)}
                        disabled={disabled}
                        className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all ${
                          selected
                            ? "border-app-accent bg-app-accent/10 text-app-text"
                            : "border-app-border bg-app-surface text-app-text-secondary hover:border-app-accent/50"
                        } ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
                      >
                        <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${
                          selected ? "bg-app-accent/20" : "bg-app-surface-hover"
                        }`}>
                          <Icon size={14} className={selected ? "text-app-accent" : "text-app-text-muted"} />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-medium">{opt.label}</p>
                          <p className="text-[10px] text-app-text-muted">{opt.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Compress mode: quality slider */}
              {mode === "compress" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-app-text-muted uppercase tracking-wider">
                      Quality
                    </label>
                    <span className="text-xs text-app-text font-medium">{quality}%</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    disabled={disabled}
                    className="w-full accent-app-accent h-1.5 bg-app-surface-hover rounded-full appearance-none cursor-pointer disabled:opacity-40"
                  />
                  <p className="text-[10px] text-app-text-muted">{getQualityLabel(quality)}</p>
                </motion.div>
              )}

              {/* Reduce mode: target size */}
              {mode === "reduce" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2"
                >
                  <label className="text-[11px] font-medium text-app-text-muted uppercase tracking-wider">
                    Target file size
                  </label>
                  <div className="flex gap-2">
                    <input id="transcoder-target" type="number" min="0" step="any" value={targetSize}
                      disabled={disabled} onChange={(e) => setTargetSize(e.target.value)}
                      aria-invalid={!validTarget} aria-describedby="transcoder-target-help"
                      aria-label="Target file size"
                      className="flex-1 min-w-0 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-text" />
                    <select aria-label="Size unit" value={targetUnit} disabled={disabled}
                      onChange={(e) => setTargetUnit(e.target.value as typeof targetUnit)}
                      className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-text">
                      <option>KB</option><option>MB</option><option>GB</option>
                    </select>
                  </div>
                  <p id="transcoder-target-help" className={`text-xs ${validTarget ? "text-app-text-muted" : "text-app-danger"}`}>
                    {validTarget
                      ? `Output: ${outputFileType}. The file will be re-encoded to fit within ${formatBytes(targetBytes)}. Quality is adjusted automatically.`
                      : "Enter a size greater than zero, up to 10 GB."}
                  </p>
                </motion.div>
              )}

            </div>

            <motion.button
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAdd}
              disabled={disabled || (mode === "reduce" && !validTarget)}
              className="w-full btn btn-primary py-3 mt-3"
            >
              <Plus size={16} />
              Add to Queue \u2014 {buttonLabel}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {!filePath && (
        <p className="text-[11px] text-app-text-muted text-center">
          Select or drag a file to transcode. You can add multiple files to the queue.
        </p>
      )}
    </motion.div>
  );
}
