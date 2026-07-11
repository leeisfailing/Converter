import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { detectFile } from "../lib/tauri-commands";
import { FolderOpen, FileVideo, Image, ArrowRight, ToggleLeft, ToggleRight, Plus } from "lucide-react";

interface Props {
  onAdd: (inputPath: string, outputPath: string, format: string, devMode: boolean) => void;
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

export default function FileConverter({ onAdd, disabled }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
  const [allowedFormats, setAllowedFormats] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [devMode, setDevMode] = useState(false);

  const refreshFormats = useCallback(async (path: string, dev: boolean) => {
    try {
      const res = await detectFile(path, dev);
      if (res.ok) {
        setFileType(res.file_type);
        setAllowedFormats(res.allowed_formats);
        if (res.allowed_formats.length > 0 && !res.allowed_formats.includes(selectedFormat)) {
          setSelectedFormat(res.allowed_formats[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [selectedFormat]);

  useEffect(() => {
    if (filePath) {
      refreshFormats(filePath, devMode);
    }
  }, [filePath, devMode]);

  const handleBrowse = async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: "Media Files",
        extensions: [
          "mp4", "mkv", "avi", "mov", "webm", "wmv", "flv", "m4v", "mpg", "mpeg", "3gp", "ts",
          "jpg", "jpeg", "png", "webp", "bmp", "gif", "tiff", "tif", "heic", "heif", "avif",
        ],
      }],
    });
    if (selected) {
      setFilePath(selected as string);
      setSelectedFormat("");
    }
  };

  const getOutputPath = useCallback(() => {
    if (!filePath || !selectedFormat) return "";
    const lastDot = filePath.lastIndexOf(".");
    const base = lastDot > 0 ? filePath.substring(0, lastDot) : filePath;
    return `${base}_converted.${selectedFormat}`;
  }, [filePath, selectedFormat]);

  const handleAdd = () => {
    if (!filePath || !selectedFormat) return;
    onAdd(filePath, getOutputPath(), selectedFormat, devMode);
    setFilePath(null);
    setSelectedFormat("");
    setFileType(null);
    setAllowedFormats([]);
  };

  const videoFormats = ALL_FORMATS.filter((f) => allowedFormats.includes(f.value) && f.type === "video");
  const photoFormats = ALL_FORMATS.filter((f) => allowedFormats.includes(f.value) && f.type === "photo");

  return (
    <div className="space-y-4">
      {/* File Drop */}
      <motion.div
        onClick={!disabled ? handleBrowse : undefined}
        className={`drop-area ${filePath ? "has-file" : ""} ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
        whileHover={!disabled ? { scale: 1.005 } : undefined}
        whileTap={!disabled ? { scale: 0.995 } : undefined}
      >
        {filePath ? (
          <div className="flex items-center justify-center gap-3">
            {fileType === "video" ? <FileVideo size={18} className="text-glass-accent" /> : <Image size={18} className="text-glass-accent" />}
            <span className="text-sm font-medium text-white/70 truncate max-w-[400px]">{filePath.split(/[\\/]/).pop()}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <FolderOpen size={24} className="text-white/20" />
            <p className="text-sm text-white/40">Click to select a file</p>
          </div>
        )}
      </motion.div>

      {/* DEV MODE */}
      {filePath && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Dev Mode</span>
            <span className="text-[10px] text-white/20">(cross-type)</span>
          </div>
          <button onClick={() => setDevMode(!devMode)} disabled={disabled} className="cursor-pointer">
            {devMode ? <ToggleRight size={28} className="text-glass-accent" /> : <ToggleLeft size={28} className="text-white/25" />}
          </button>
        </motion.div>
      )}

      {/* Format Selection */}
      <AnimatePresence>
        {filePath && allowedFormats.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <div className="glass-panel p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-white/30">
                <span className="font-medium text-white/50">{fileType === "video" ? "Video" : fileType === "photo" ? "Photo" : "File"}</span>
                <ArrowRight size={12} />
                <span className="font-medium text-white/50">Output format</span>
              </div>

              {videoFormats.length > 0 && (
                <div>
                  <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Video</p>
                  <div className="flex flex-wrap gap-1.5">
                    {videoFormats.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setSelectedFormat(f.value)}
                        disabled={disabled}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                          selectedFormat === f.value
                            ? "bg-glass-accent/20 border border-glass-accent/30 text-glass-accent"
                            : "bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]"
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
                  <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Photo</p>
                  <div className="flex flex-wrap gap-1.5">
                    {photoFormats.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setSelectedFormat(f.value)}
                        disabled={disabled}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                          selectedFormat === f.value
                            ? "bg-glass-accent/20 border border-glass-accent/30 text-glass-accent"
                            : "bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]"
                        } ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Add to Queue Button */}
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
      </AnimatePresence>

      {!filePath && (
        <p className="text-[10px] text-white/15 text-center">
          Select a file to convert. You can add multiple conversions to the queue.
        </p>
      )}
    </div>
  );
}
