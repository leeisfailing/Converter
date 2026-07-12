import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { detectFile, getMediaDuration } from "../lib/tauri-commands";
import {
  FolderOpen,
  FileVideo,
  Image,
  ArrowRight,
  ToggleLeft,
  ToggleRight,
  Plus,
  HardDrive,
  FileUp,
} from "lucide-react";

type ConvertMode = "format" | "compress";

interface Props {
  onAdd: (
    inputPath: string,
    outputPath: string,
    format: string,
    devMode: boolean,
    compressSize?: number,
    compressUnit?: string
  ) => void;
  disabled: boolean;
}

const ALL_FORMATS = [
  { value: "mp4", label: "MP4", type: "video" },
  { value: "mkv", label: "MKV", type: "video" },
  { value: "avi", label: "AVI", type: "video" },
  { value: "mov", label: "MOV", type: "video" },
  { value: "webm", label: "WebM", type: "video" },
  { value: "gif", label: "GIF", type: "video" },
  { value: "jpg", label: "JPG", type: "photo" },
  { value: "jpeg", label: "JPEG", type: "photo" },
  { value: "png", label: "PNG", type: "photo" },
  { value: "webp", label: "WebP", type: "photo" },
  { value: "bmp", label: "BMP", type: "photo" },
  { value: "tiff", label: "TIFF", type: "photo" },
  { value: "avif", label: "AVIF", type: "photo" },
];

const SIZE_UNITS = [
  { value: "MB", label: "MB" },
  { value: "KB", label: "KB" },
  { value: "GB", label: "GB" },
];

export default function FileConverter({ onAdd, disabled }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
  const [allowedFormats, setAllowedFormats] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [devMode, setDevMode] = useState(false);
  const [convertMode, setConvertMode] = useState<ConvertMode>("format");
  const [compressSize, setCompressSize] = useState("");
  const [compressUnit, setCompressUnit] = useState("MB");
  const [isDragOver, setIsDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

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
          setFilePath(paths[0]);
          setSelectedFormat("");
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const refreshFormats = useCallback(
    async (path: string, dev: boolean) => {
      try {
        const res = await detectFile(path, dev);
        if (res.ok) {
          setFileType(res.file_type);
          setAllowedFormats(res.allowed_formats);
          if (
            res.allowed_formats.length > 0 &&
            !res.allowed_formats.includes(selectedFormat)
          ) {
            setSelectedFormat(res.allowed_formats[0]);
          }
        }
      } catch (err) {
        console.error(err);
      }
    },
    [selectedFormat]
  );

  useEffect(() => {
    if (filePath) {
      refreshFormats(filePath, devMode);
    }
  }, [filePath, devMode]);

  const handleBrowse = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Media Files",
          extensions: [
            "mp4", "mkv", "avi", "mov", "webm", "wmv", "flv", "m4v",
            "mpg", "mpeg", "3gp", "ts",
            "jpg", "jpeg", "png", "webp", "bmp", "gif", "tiff", "tif",
            "heic", "heif", "avif",
          ],
        },
      ],
    });
    if (selected) {
      setFilePath(selected as string);
      setSelectedFormat("");
    }
  };

  const getOutputPath = useCallback(() => {
    if (!filePath) return "";
    const lastDot = filePath.lastIndexOf(".");
    const base = lastDot > 0 ? filePath.substring(0, lastDot) : filePath;

    if (convertMode === "compress") {
      const ext = filePath.split(".").pop() || "mp4";
      return `${base}_compressed.${ext}`;
    }
    return `${base}_converted.${selectedFormat}`;
  }, [filePath, selectedFormat, convertMode]);

  const handleAdd = () => {
    if (!filePath) return;

    if (convertMode === "format" && !selectedFormat) return;
    if (convertMode === "compress" && (!compressSize || parseFloat(compressSize) <= 0))
      return;

    const sizeBytes =
      convertMode === "compress"
        ? parseFloat(compressSize) *
          (compressUnit === "GB"
            ? 1073741824
            : compressUnit === "MB"
            ? 1048576
            : 1024)
        : undefined;

    onAdd(
      filePath,
      getOutputPath(),
      convertMode === "format" ? selectedFormat : "compress",
      devMode,
      sizeBytes,
      convertMode === "compress" ? compressUnit : undefined
    );

    setFilePath(null);
    setSelectedFormat("");
    setFileType(null);
    setAllowedFormats([]);
    setCompressSize("");
  };

  const videoFormats = ALL_FORMATS.filter(
    (f) => allowedFormats.includes(f.value) && f.type === "video"
  );
  const photoFormats = ALL_FORMATS.filter(
    (f) => allowedFormats.includes(f.value) && f.type === "photo"
  );

  return (
    <div className="space-y-4">
      {/* File Drop */}
      <motion.div
        ref={dropRef}
        onClick={!disabled ? handleBrowse : undefined}
        className={`drop-area ${filePath ? "has-file" : ""} ${
          isDragOver ? "border-glass-accent bg-glass-accent-dim" : ""
        } ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
        whileHover={!disabled ? { scale: 1.005 } : undefined}
        whileTap={!disabled ? { scale: 0.995 } : undefined}
      >
        {filePath ? (
          <div className="flex items-center justify-center gap-3">
            {fileType === "video" ? (
              <FileVideo size={18} className="text-glass-accent" />
            ) : (
              <Image size={18} className="text-glass-accent" />
            )}
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
            <p className="text-sm text-glass-text-muted">
              {isDragOver ? "Drop file here" : "Click or drag a file here"}
            </p>
          </div>
        )}
      </motion.div>

      {/* Mode Selector */}
      {filePath && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-1.5 flex gap-1"
        >
          <button
            onClick={() => setConvertMode("format")}
            disabled={disabled || fileType !== "video"}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              convertMode === "format"
                ? "bg-glass-accent text-white shadow-glow"
                : "text-glass-text-dim hover:text-glass-text hover:bg-glass-surface-hover"
            } ${disabled || fileType !== "video" ? "opacity-40 pointer-events-none" : ""}`}
          >
            <ArrowRight size={14} />
            Convert Format
          </button>
          <button
            onClick={() => setConvertMode("compress")}
            disabled={disabled || fileType !== "video"}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              convertMode === "compress"
                ? "bg-glass-accent text-white shadow-glow"
                : "text-glass-text-dim hover:text-glass-text hover:bg-glass-surface-hover"
            } ${disabled || fileType !== "video" ? "opacity-40 pointer-events-none" : ""}`}
          >
            <HardDrive size={14} />
            Compress Size
          </button>
        </motion.div>
      )}

      {/* DEV MODE */}
      {filePath && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-panel p-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-glass-text-muted uppercase tracking-wider">
              Dev Mode
            </span>
            <span className="text-[10px] text-glass-text-muted">(cross-type)</span>
          </div>
          <button
            onClick={() => setDevMode(!devMode)}
            disabled={disabled}
            className="cursor-pointer"
          >
            {devMode ? (
              <ToggleRight size={28} className="text-glass-accent" />
            ) : (
              <ToggleLeft size={28} className="text-glass-text-muted" />
            )}
          </button>
        </motion.div>
      )}

      {/* Format Selection */}
      <AnimatePresence>
        {filePath && convertMode === "format" && allowedFormats.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="glass-panel p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-glass-text-muted">
                <span className="font-medium text-glass-text-dim">
                  {fileType === "video" ? "Video" : fileType === "photo" ? "Photo" : "File"}
                </span>
                <ArrowRight size={12} />
                <span className="font-medium text-glass-text-dim">Output format</span>
              </div>

              {videoFormats.length > 0 && (
                <div>
                  <p className="text-[10px] text-glass-text-muted uppercase tracking-wider mb-1.5">
                    Video
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {videoFormats.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setSelectedFormat(f.value)}
                        disabled={disabled}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                          selectedFormat === f.value
                            ? "bg-glass-accent-dim border border-glass-accent/30 text-glass-accent"
                            : "bg-glass-surface border border-glass-border text-glass-text-dim hover:text-glass-text hover:bg-glass-surface-hover"
                        } ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {photoFormats.length > 0 && (
                <div>
                  <p className="text-[10px] text-glass-text-muted uppercase tracking-wider mb-1.5">
                    Photo
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {photoFormats.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setSelectedFormat(f.value)}
                        disabled={disabled}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                          selectedFormat === f.value
                            ? "bg-glass-accent-dim border border-glass-accent/30 text-glass-accent"
                            : "bg-glass-surface border border-glass-border text-glass-text-dim hover:text-glass-text hover:bg-glass-surface-hover"
                        } ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {selectedFormat && (
              <motion.button
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleAdd}
                disabled={disabled}
                className="w-full glass-btn glass-btn-primary py-3 mt-3"
              >
                <Plus size={16} />
                Add to Queue — {selectedFormat.toUpperCase()}
              </motion.button>
            )}
          </motion.div>
        )}

        {/* Compress Size Selection */}
        {filePath && convertMode === "compress" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="glass-panel p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-glass-text-muted">
                <span className="font-medium text-glass-text-dim">Original</span>
                <ArrowRight size={12} />
                <span className="font-medium text-glass-text-dim">Target size</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-glass-text-dim min-w-[80px]">
                  Target size
                </span>
                <input
                  type="number"
                  value={compressSize}
                  onChange={(e) => setCompressSize(e.target.value)}
                  disabled={disabled}
                  className="glass-input w-24 py-1.5 px-2 text-xs"
                  placeholder="100"
                  min="0"
                  step="any"
                />
                <select
                  value={compressUnit}
                  onChange={(e) => setCompressUnit(e.target.value)}
                  disabled={disabled}
                  className="glass-select py-1.5 px-2 text-xs"
                >
                  {SIZE_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-[10px] text-glass-text-muted">
                ffmpeg will calculate the optimal bitrate to achieve your target file size.
              </p>
            </div>

            {compressSize && parseFloat(compressSize) > 0 && (
              <motion.button
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleAdd}
                disabled={disabled}
                className="w-full glass-btn glass-btn-primary py-3 mt-3"
              >
                <Plus size={16} />
                Add to Queue — {compressSize}{compressUnit}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!filePath && (
        <p className="text-[10px] text-glass-text-muted text-center">
          Select or drag a file to convert. You can add multiple conversions to the queue.
        </p>
      )}
    </div>
  );
}
