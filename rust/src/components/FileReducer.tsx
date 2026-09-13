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
} from "lucide-react";

interface Props {
  onAdd: (
    inputPath: string,
    outputPath: string,
    quality: number,
    maxWidth: number | null,
    fileType: "video" | "photo" | "audio",
    targetBytes: number | null,
  ) => void;
  disabled: boolean;
}

const MAX_WIDTH_PRESETS = [
  { label: "Original", value: null },
  { label: "1920", value: 1920 },
  { label: "1280", value: 1280 },
  { label: "854", value: 854 },
  { label: "640", value: 640 },
];

function getQualityLabel(q: number): string {
  if (q <= 30) return "Low quality (smaller file)";
  if (q <= 60) return "Medium quality";
  if (q <= 85) return "High quality";
  return "Maximum quality";
}

export default function FileReducer({ onAdd, disabled }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [detectedFileType, setDetectedFileType] = useState<"video" | "photo" | "audio" | null>(null);
  const [quality, setQuality] = useState(50);
  const [reductionMode, setReductionMode] = useState<"quality" | "size">("quality");
  const [targetSize, setTargetSize] = useState("10");
  const [targetUnit, setTargetUnit] = useState<"KB" | "MB" | "GB">("MB");
  const targetBytes = Math.floor(Number(targetSize) * { KB: 1_000, MB: 1_000_000, GB: 1_000_000_000 }[targetUnit]);
  const validTarget = Number.isSafeInteger(targetBytes) && targetBytes > 0 && targetBytes <= 10_000_000_000;
  const [maxWidth, setMaxWidth] = useState<number | null>(null);
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
          console.log(`[reducer] File dropped: "${paths[0].split(/[\\/]/).pop()}"`);
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
    console.log(`[reducer] Detecting file type...`);
    detectFile(filePath, false)
      .then((res) => {
        if (cancelled || generation !== detectGeneration.current) return;
        if (res.ok) {
          const ft = res.file_type as "video" | "photo" | "audio";
          console.log(`[reducer] Detected: type=${ft}`);
          setDetectedFileType(ft);
          setMaxWidth(null);
        }
      })
      .catch((err) => {
        if (cancelled || generation !== detectGeneration.current) return;
        console.error(`[reducer] Detection failed:`, err);
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
    const outputExt = reductionMode === "size"
      ? detectedFileType === "video" ? ".mp4" : detectedFileType === "audio" ? ".mp3" : ".webp" : ext;
    return `${base}_reduced${outputExt}`;
  }, [filePath, reductionMode, detectedFileType]);

  const handleAdd = () => {
    if (!filePath || !detectedFileType) return;
    if (reductionMode === "size" && !validTarget) return;

    console.log(`[reducer] Adding to queue: "${filePath.split(/[\\/]/).pop()}" => quality=${quality}%`);

    onAdd(
      filePath,
      getOutputPath(),
      quality,
      maxWidth,
      detectedFileType,
      reductionMode === "size" ? targetBytes : null,
    );

    setFilePath(null);
    setDetectedFileType(null);
    setQuality(50);
    setMaxWidth(null);
  };

  const isVideoOrPhoto = detectedFileType === "video" || detectedFileType === "photo";

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
                <span className="font-medium text-app-text-secondary">Size reduction</span>
              </div>

              <div className="flex gap-2" role="group" aria-label="Reduction mode">
                {(["quality", "size"] as const).map((mode) => (
                  <button type="button" key={mode} disabled={disabled} aria-pressed={reductionMode === mode}
                    className={`format-chip ${reductionMode === mode ? "selected" : ""}`}
                    onClick={() => setReductionMode(mode)}>{mode === "quality" ? "Quality" : "Target size"}</button>
                ))}
              </div>
              {reductionMode === "size" ? (
                <div className="space-y-2">
                  <label htmlFor="reduce-target" className="text-sm text-app-text">Maximum file size</label>
                  <div className="flex gap-2">
                    <input id="reduce-target" type="number" min="0" step="any" value={targetSize}
                      disabled={disabled} onChange={(e) => setTargetSize(e.target.value)}
                      aria-invalid={!validTarget} aria-describedby="reduce-target-help"
                      className="flex-1 min-w-0 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-text" />
                    <select aria-label="Size unit" value={targetUnit} disabled={disabled}
                      onChange={(e) => setTargetUnit(e.target.value as typeof targetUnit)}
                      className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-text">
                      <option>KB</option><option>MB</option><option>GB</option>
                    </select>
                  </div>
                  <p id="reduce-target-help" className={`text-xs ${validTarget ? "text-app-text-muted" : "text-app-danger"}`}>
                    {validTarget ? `Output: ${detectedFileType === "video" ? "MP4" : detectedFileType === "audio" ? "MP3" : "WebP"}. Prioritizes quality within your limit; processing may take longer. Resolution stays at your selected width. Very small targets may not be possible. 1 MB = 1,000 KB.` : "Enter a size greater than zero, up to 10 GB."}
                  </p>
                </div>
              ) : <div className="space-y-2">
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
              </div>}

              {isVideoOrPhoto && (
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-app-text-muted uppercase tracking-wider">
                    Max Width
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {MAX_WIDTH_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => setMaxWidth(preset.value)}
                        disabled={disabled}
                        className={`format-chip ${maxWidth === preset.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                      >
                        <span className={`text-xs font-medium ${maxWidth === preset.value ? "text-app-text" : "text-app-text-secondary"}`}>
                          {preset.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <motion.button
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAdd}
              disabled={disabled || (reductionMode === "size" && !validTarget)}
              className="w-full btn btn-primary py-3 mt-3"
            >
              <Plus size={16} />
              Add to Queue — {reductionMode === "size" ? `${targetSize} ${targetUnit} maximum` : `${quality}% quality`}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {!filePath && (
        <p className="text-[11px] text-app-text-muted text-center">
          Select or drag a file to reduce its size. You can add multiple files to the queue.
        </p>
      )}
    </motion.div>
  );
}
