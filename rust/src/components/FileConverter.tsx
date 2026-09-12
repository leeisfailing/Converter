import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { detectFile } from "../lib/tauri-commands";
import {
  FolderOpen,
  FileVideo,
  Image,
  Music,
  ArrowRight,
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
  { value: "mp3", label: "MP3", type: "audio" },
  { value: "wav", label: "WAV", type: "audio" },
  { value: "flac", label: "FLAC", type: "audio" },
  { value: "aac", label: "AAC", type: "audio" },
  { value: "ogg", label: "OGG", type: "audio" },
  { value: "wma", label: "WMA", type: "audio" },
  { value: "m4a", label: "M4A", type: "audio" },
  { value: "opus", label: "Opus", type: "audio" },
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
          console.log(`[converter] File dropped: "${paths[0].split(/[\\/]/).pop()}"`);
          setFilePath(paths[0]);
          setSelectedFormat("");
          setConvertMode("format");
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [disabled]);

  const selectedFormatRef = useRef(selectedFormat);
  selectedFormatRef.current = selectedFormat;
  const usedOutputPaths = useRef(new Set<string>());

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    const generation = ++detectGeneration.current;
    console.log(`[converter] Detecting file type...`);
    detectFile(filePath, devMode)
      .then((res) => {
        if (cancelled || generation !== detectGeneration.current) return;
        if (res.ok) {
          console.log(`[converter] Detected: type=${res.file_type}, formats=[${res.allowed_formats.join(", ")}]`);
          setFileType(res.file_type);
          setAllowedFormats(res.allowed_formats);
          if (
            res.allowed_formats.length > 0 &&
            !res.allowed_formats.includes(selectedFormatRef.current)
          ) {
            setSelectedFormat(res.allowed_formats[0]);
          }
        }
      })
      .catch((err) => {
        if (cancelled || generation !== detectGeneration.current) return;
        console.error(`[converter] Detection failed:`, err);
      });
    return () => { cancelled = true; };
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
            "mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus",
            "aiff", "alac",
          ],
        },
      ],
    });
    if (selected) {
      setFilePath(selected as string);
      setSelectedFormat("");
      setConvertMode("format");
    }
  };

  const getOutputPath = useCallback(() => {
    if (!filePath) return "";
    const lastDot = filePath.lastIndexOf(".");
    const base = lastDot > 0 ? filePath.substring(0, lastDot) : filePath;

    let outputPath: string;
    if (convertMode === "compress") {
      const ext = filePath.split(".").pop() || "mp4";
      outputPath = `${base}_compressed.${ext}`;
    } else {
      outputPath = `${base}_converted.${selectedFormat}`;
    }

    if (usedOutputPaths.current.has(outputPath)) {
      let counter = 2;
      while (usedOutputPaths.current.has(outputPath.replace(/(\.\w+)$/, `_${counter}$1`))) {
        counter++;
      }
      const ext = outputPath.match(/(\.\w+)$/)?.[1] || "";
      const stem = outputPath.slice(0, -ext.length);
      outputPath = `${stem}_${counter}${ext}`;
    }

    usedOutputPaths.current.add(outputPath);
    return outputPath;
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

    const format = convertMode === "format" ? selectedFormat : "compress";
    console.log(`[converter] Adding to queue: "${filePath.split(/[\\/]/).pop()}" => ${format.toUpperCase()}`);

    onAdd(
      filePath,
      getOutputPath(),
      format,
      devMode,
      sizeBytes,
      convertMode === "compress" ? compressUnit : undefined
    );

    setFilePath(null);
    setSelectedFormat("");
    setFileType(null);
    setAllowedFormats([]);
    setCompressSize("");
    setDevMode(false);
    usedOutputPaths.current.clear();
  };

  const videoFormats = useMemo(
    () => ALL_FORMATS.filter((f) => allowedFormats.includes(f.value) && f.type === "video"),
    [allowedFormats]
  );
  const photoFormats = useMemo(
    () => ALL_FORMATS.filter((f) => allowedFormats.includes(f.value) && f.type === "photo"),
    [allowedFormats]
  );
  const audioFormats = useMemo(
    () => ALL_FORMATS.filter((f) => allowedFormats.includes(f.value) && f.type === "audio"),
    [allowedFormats]
  );

  const chipContainerVariants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.03 },
    },
  };

  const chipVariants = {
    hidden: { opacity: 0, y: 6 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {/* File Drop */}
      <motion.div
        ref={dropRef}
        onClick={!disabled ? handleBrowse : undefined}
        className={`drop-area ${filePath ? "has-file" : ""} ${
          isDragOver ? "active" : ""
        } ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
        animate={
          isDragOver
            ? { scale: 1.02, borderColor: "var(--accent, #6366f1)" }
            : { scale: 1, borderColor: "transparent" }
        }
        whileHover={!disabled ? { scale: 1.02 } : undefined}
        whileTap={!disabled ? { scale: 0.98 } : undefined}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {filePath ? (
          <div className="flex items-center justify-center gap-3">
            {fileType === "video" ? (
              <FileVideo size={18} className="text-app-accent" />
            ) : fileType === "audio" ? (
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

      {/* Mode Selector */}
      {filePath && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="radio-group">
            <button
              onClick={() => setConvertMode("format")}
              disabled={disabled}
              className={`radio-pill ${convertMode === "format" ? "active" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
            >
              <ArrowRight size={14} />
              Convert Format
            </button>
            <button
              onClick={() => setConvertMode("compress")}
              disabled={disabled || fileType !== "video"}
              className={`radio-pill ${convertMode === "compress" ? "active" : ""} ${disabled || fileType !== "video" ? "opacity-40 pointer-events-none" : ""}`}
            >
              <HardDrive size={14} />
              Compress Size
            </button>
          </div>
        </motion.div>
      )}

      {/* DEV MODE */}
      {filePath && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="panel p-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-app-text-muted uppercase tracking-wider">
              Dev Mode
            </span>
            <span className="text-[10px] text-app-text-muted">(cross-type)</span>
          </div>
          <button
            onClick={() => setDevMode(!devMode)}
            disabled={disabled}
            className={`toggle ${devMode ? "active" : ""}`}
          />
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
            <div className="panel p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-app-text-muted">
                <span className="font-medium text-app-text-secondary">
                  {fileType === "video" ? "Video" : fileType === "audio" ? "Audio" : fileType === "photo" ? "Photo" : "File"}
                </span>
                <ArrowRight size={12} />
                <span className="font-medium text-app-text-secondary">Output format</span>
              </div>

              {videoFormats.length > 0 && (
                <div>
                  <p className="text-[10px] text-app-text-muted uppercase tracking-wider mb-2">
                    Video
                  </p>
                  <motion.div
                    className="flex flex-wrap gap-2"
                    variants={chipContainerVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    {videoFormats.map((f) => (
                      <motion.button
                        key={f.value}
                        variants={chipVariants}
                        onClick={() => setSelectedFormat(f.value)}
                        disabled={disabled}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.95 }}
                        className={`format-chip ${selectedFormat === f.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                      >
                        <span className={`text-xs font-medium ${selectedFormat === f.value ? "text-app-text" : "text-app-text-secondary"}`}>
                          {f.label}
                        </span>
                      </motion.button>
                    ))}
                  </motion.div>
                </div>
              )}

              {photoFormats.length > 0 && (
                <div>
                  <p className="text-[10px] text-app-text-muted uppercase tracking-wider mb-2">
                    Photo
                  </p>
                  <motion.div
                    className="flex flex-wrap gap-2"
                    variants={chipContainerVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    {photoFormats.map((f) => (
                      <motion.button
                        key={f.value}
                        variants={chipVariants}
                        onClick={() => setSelectedFormat(f.value)}
                        disabled={disabled}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.95 }}
                        className={`format-chip ${selectedFormat === f.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                      >
                        <span className={`text-xs font-medium ${selectedFormat === f.value ? "text-app-text" : "text-app-text-secondary"}`}>
                          {f.label}
                        </span>
                      </motion.button>
                    ))}
                  </motion.div>
                </div>
              )}

              {audioFormats.length > 0 && (
                <div>
                  <p className="text-[10px] text-app-text-muted uppercase tracking-wider mb-2">
                    Audio
                  </p>
                  <motion.div
                    className="flex flex-wrap gap-2"
                    variants={chipContainerVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    {audioFormats.map((f) => (
                      <motion.button
                        key={f.value}
                        variants={chipVariants}
                        onClick={() => setSelectedFormat(f.value)}
                        disabled={disabled}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.95 }}
                        className={`format-chip ${selectedFormat === f.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                      >
                        <span className={`text-xs font-medium ${selectedFormat === f.value ? "text-app-text" : "text-app-text-secondary"}`}>
                          {f.label}
                        </span>
                      </motion.button>
                    ))}
                  </motion.div>
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
                className="w-full btn btn-primary py-3 mt-3"
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
            <div className="panel p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-app-text-muted">
                <span className="font-medium text-app-text-secondary">Original</span>
                <ArrowRight size={12} />
                <span className="font-medium text-app-text-secondary">Target size</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-app-text-secondary min-w-[80px]">
                  Target size
                </span>
                <input
                  type="number"
                  value={compressSize}
                  onChange={(e) => setCompressSize(e.target.value)}
                  disabled={disabled}
                  className="input w-24 py-1.5 px-2 text-xs"
                  placeholder="100"
                  min="0"
                  step="any"
                />
                <select
                  value={compressUnit}
                  onChange={(e) => setCompressUnit(e.target.value)}
                  disabled={disabled}
                  className="select py-1.5 px-2 text-xs"
                >
                  {SIZE_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-[10px] text-app-text-muted">
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
                className="w-full btn btn-primary py-3 mt-3"
              >
                <Plus size={16} />
                Add to Queue — {compressSize}{compressUnit}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!filePath && (
        <p className="text-[11px] text-app-text-muted text-center">
          Select or drag a file to convert. You can add multiple conversions to the queue.
        </p>
      )}
    </motion.div>
  );
}
