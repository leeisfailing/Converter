import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { detectFile, checkUpscale } from "../lib/tauri-commands";
import {
  FolderOpen,
  FileVideo,
  Image,
  Plus,
  FileUp,
  ArrowUp,
  AlertTriangle,
} from "lucide-react";

interface Props {
  onAdd: (
    inputPath: string,
    outputPath: string,
    target: string,
    fileType: "video" | "photo",
  ) => void;
  disabled: boolean;
}

const UPSCALE_PRESETS = [
  { label: "2K", value: "2k", desc: "2560 \u00d7 1440" },
  { label: "4K", value: "4k", desc: "3840 \u00d7 2160" },
  { label: "8K", value: "8k", desc: "7680 \u00d7 4320" },
  { label: "16K", value: "16k", desc: "15360 \u00d7 8640" },
];

export default function Upscaler({ onAdd, disabled }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [detectedFileType, setDetectedFileType] = useState<"video" | "photo" | null>(null);
  const [target, setTarget] = useState("4k");
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileError, setFileError] = useState("");
  const [capabilityWarning, setCapabilityWarning] = useState<string | null>(null);
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
          console.log(`[upscaler] File dropped: "${paths[0].split(/[\\/]/).pop()}"`);
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
    setFileError("");
    setCapabilityWarning(null);
    let cancelled = false;
    const generation = ++detectGeneration.current;
    console.log(`[upscaler] Detecting file type...`);
    detectFile(filePath, false)
      .then((res) => {
        if (cancelled || generation !== detectGeneration.current) return;
        if (res.ok && (res.file_type === "video" || res.file_type === "photo")) {
          const ft = res.file_type;
          console.log(`[upscaler] Detected: type=${ft}`);
          setDetectedFileType(ft);
        } else {
          setFileError("Choose a supported video or image file.");
        }
      })
      .catch((err) => {
        if (cancelled || generation !== detectGeneration.current) return;
        console.error(`[upscaler] Detection failed:`, err);
        setFileError("Could not read this file. Choose another video or image.");
      });
    return () => { cancelled = true; };
  }, [filePath]);

  // Check capability when target changes
  useEffect(() => {
    if (!target) {
      setCapabilityWarning(null);
      return;
    }
    let cancelled = false;
    checkUpscale(target)
      .then((cap) => {
        if (cancelled) return;
        if (!cap.canUpscale) {
          setCapabilityWarning(cap.message);
        } else if (cap.message.startsWith("Warning")) {
          setCapabilityWarning(cap.message);
        } else {
          setCapabilityWarning(null);
        }
      })
      .catch(() => {
        if (!cancelled) setCapabilityWarning(null);
      });
    return () => { cancelled = true; };
  }, [target]);

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
    const hasExtension = lastDot > Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    const inputExt = hasExtension ? filePath.substring(lastDot).toLowerCase() : "";
    const ext = detectedFileType === "video" ? ".mp4" :
      [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif", ".avif"].includes(inputExt) ? inputExt : ".png";
    const base = hasExtension ? filePath.substring(0, lastDot) : filePath;
    return `${base}_${target.toUpperCase()}${ext}`;
  }, [filePath, target, detectedFileType]);

  const handleAdd = async () => {
    if (!filePath || !detectedFileType) return;

    // Final capability check before adding
    try {
      const cap = await checkUpscale(target);
      if (!cap.canUpscale) {
        setFileError(cap.message);
        return;
      }
    } catch {
      // If check fails, allow the add (backend will handle the error)
    }

    console.log(`[upscaler] Adding to queue: "${filePath.split(/[\\/]/).pop()}" => ${target.toUpperCase()}`);

    onAdd(
      filePath,
      getOutputPath(),
      target,
      detectedFileType,
    );

    setFilePath(null);
    setDetectedFileType(null);
    setTarget("4k");
  };

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {fileError && <p role="alert" className="text-xs text-red-400">{fileError}</p>}
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
              {isDragOver ? "Drop file here" : "Click or drag a video/image here"}
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
                  {detectedFileType === "video" ? "Video" : "Image"}
                </span>
                <ArrowUp size={12} />
                <span className="font-medium text-app-text-secondary">Upscale</span>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-medium text-app-text-muted uppercase tracking-wider">
                  Target Resolution
                </label>
                <div className="flex flex-wrap gap-2">
                  {UPSCALE_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => setTarget(preset.value)}
                      disabled={disabled}
                      className={`format-chip ${target === preset.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                    >
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-semibold text-app-text">
                          {preset.label}
                        </span>
                        <span className="text-[9px] text-app-text-muted">
                          {preset.desc}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {capabilityWarning && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-start gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20"
                  >
                    <AlertTriangle size={14} className="text-yellow-400 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-yellow-200">{capabilityWarning}</p>
                  </motion.div>
                )}
              </div>
            </div>

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
              Add to Queue &mdash; Upscale to {UPSCALE_PRESETS.find((p) => p.value === target)?.label}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {!filePath && (
        <p className="text-[11px] text-app-text-muted text-center">
          Upscale videos or images to 2K, 4K, 8K, or 16K resolution. GPU-accelerated when available.
        </p>
      )}
    </motion.div>
  );
}
