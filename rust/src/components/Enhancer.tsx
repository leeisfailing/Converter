import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { detectFile } from "../lib/tauri-commands";
import {
  FolderOpen,
  FileVideo,
  Image,
  FileUp,
  Sparkles,
  Cpu,
} from "lucide-react";

interface Props {
  onAdd: (
    inputPath: string,
    outputPath: string,
    fileType: "video" | "photo",
    model: string,
    tileSize: number,
  ) => void;
  disabled: boolean;
}

const ENHANCE_MODELS = [
  {
    label: "4x Upscale",
    value: "realesrgan-x4plus",
    desc: "Best quality, 4\u00d7 enlargement",
  },
  {
    label: "2x Upscale",
    value: "realesrgan-x2plus",
    desc: "Faster, 2\u00d7 enlargement",
  },
  {
    label: "General 4x",
    value: "realesr-general-x4v3",
    desc: "Versatile, handles mixed content",
  },
];

const TILE_SIZES = [
  { label: "128", value: 128, desc: "Low VRAM" },
  { label: "256", value: 256, desc: "Balanced" },
  { label: "384", value: 384, desc: "More detail" },
  { label: "512", value: 512, desc: "Max quality" },
];

export default function Enhancer({ onAdd, disabled }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [detectedFileType, setDetectedFileType] = useState<"video" | "photo" | null>(null);
  const [model, setModel] = useState("realesrgan-x4plus");
  const [tileSize, setTileSize] = useState(256);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileError, setFileError] = useState("");
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
          console.log(`[enhancer] File dropped: "${paths[0].split(/[\\/]/).pop()}"`);
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
    let cancelled = false;
    const generation = ++detectGeneration.current;
    console.log(`[enhancer] Detecting file type...`);
    detectFile(filePath, false)
      .then((res) => {
        if (cancelled || generation !== detectGeneration.current) return;
        if (res.ok && (res.file_type === "video" || res.file_type === "photo")) {
          const ft = res.file_type;
          console.log(`[enhancer] Detected: type=${ft}`);
          setDetectedFileType(ft);
        } else {
          setFileError("Choose a supported video or image file.");
        }
      })
      .catch((err) => {
        if (cancelled || generation !== detectGeneration.current) return;
        console.error(`[enhancer] Detection failed:`, err);
        setFileError("Could not read this file. Choose another video or image.");
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
    const modelSuffix = model.replace("realesrgan-", "").replace("realesr-", "");
    return `${base}_AI_${modelSuffix}${ext}`;
  }, [filePath, model, detectedFileType]);

  const handleAdd = () => {
    if (!filePath || !detectedFileType) return;

    console.log(`[enhancer] Adding to queue: "${filePath.split(/[\\/]/).pop()}" => ${model}`);

    onAdd(
      filePath,
      getOutputPath(),
      detectedFileType,
      model,
      tileSize,
    );

    setFilePath(null);
    setDetectedFileType(null);
    setModel("realesrgan-x4plus");
    setTileSize(256);
  };

  const selectedModel = ENHANCE_MODELS.find((m) => m.value === model);

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
            ? { scale: 1.02, borderColor: "#a855f7" }
            : { scale: 1, borderColor: "rgba(0, 0, 0, 0)" }
        }
        whileHover={!disabled ? { scale: 1.02 } : undefined}
        whileTap={!disabled ? { scale: 0.98 } : undefined}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {filePath ? (
          <div className="flex items-center justify-center gap-3">
            {detectedFileType === "video" ? (
              <FileVideo size={18} className="text-purple-400" />
            ) : (
              <Image size={18} className="text-purple-400" />
            )}
            <span className="text-sm font-medium text-app-text truncate max-w-[400px]">
              {filePath.split(/[\\/]/).pop()}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {isDragOver ? (
              <FileUp size={24} className="text-purple-400" />
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
                <Sparkles size={12} className="text-purple-400" />
                <span className="font-medium text-app-text-secondary">AI Enhance</span>
                <span className="inline-flex items-center rounded-md bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-300 ring-1 ring-inset ring-purple-500/30">BETA</span>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-medium text-app-text-muted uppercase tracking-wider">
                  AI Model
                </label>
                <div className="flex flex-wrap gap-2">
                  {ENHANCE_MODELS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setModel(m.value)}
                      disabled={disabled}
                      className={`format-chip ${model === m.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                    >
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-semibold text-app-text">
                          {m.label}
                        </span>
                        <span className="text-[9px] text-app-text-muted">
                          {m.desc}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-medium text-app-text-muted uppercase tracking-wider flex items-center gap-1">
                  <Cpu size={10} />
                  Tile Size
                </label>
                <div className="flex flex-wrap gap-2">
                  {TILE_SIZES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setTileSize(t.value)}
                      disabled={disabled}
                      className={`format-chip ${tileSize === t.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                    >
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-semibold text-app-text">
                          {t.label}
                        </span>
                        <span className="text-[9px] text-app-text-muted">
                          {t.desc}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {detectedFileType === "video" && (
                <p className="text-[10px] text-app-text-muted">
                  Video enhancement processes each frame individually. This may take a while for longer videos.
                </p>
              )}
            </div>

            <motion.button
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAdd}
              disabled={disabled}
              className="w-full btn btn-primary py-3 mt-3"
              style={{ background: "linear-gradient(135deg, #9333ea, #6366f1)" }}
            >
              <Sparkles size={16} />
              Add to Queue &mdash; {selectedModel?.label || "Enhance"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {!filePath && (
        <p className="text-[11px] text-app-text-muted text-center">
          AI-powered super-resolution using Real-ESRGAN neural networks. Enhance photos and videos with deep learning.
        </p>
      )}
    </motion.div>
  );
}
