import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, Download, Music, Film, Plus, Monitor, Loader2, Globe, Clock } from "lucide-react";
import { detectUrl } from "../lib/tauri-commands";
import type { UrlFormat } from "../lib/tauri-commands";

interface Props {
  onAdd: (url: string, formatType: string) => void;
  disabled: boolean;
}

type DetectState = "idle" | "detecting" | "done" | "error";

export default function URLDownloader({ onAdd, disabled }: Props) {
  const [url, setUrl] = useState("");
  const [detectState, setDetectState] = useState<DetectState>("idle");
  const [detectError, setDetectError] = useState("");
  const [detectedInfo, setDetectedInfo] = useState<{
    title: string;
    duration: string;
    thumbnail: string;
    webpage_url: string;
    is_live: boolean;
    formats: UrlFormat[];
    format_type: string;
  } | null>(null);
  const [selectedFormat, setSelectedFormat] = useState("");

  const handleDetect = async () => {
    if (!url.trim()) return;
    setDetectState("detecting");
    setDetectError("");
    setDetectedInfo(null);
    setSelectedFormat("");

    try {
      const result = await detectUrl(url.trim());
      if (result.ok) {
        setDetectedInfo(result);
        if (result.formats.length > 0) {
          setSelectedFormat(result.formats[0].value);
        }
        setDetectState("done");
      } else {
        setDetectError("Could not detect URL info");
        setDetectState("error");
      }
    } catch (err) {
      setDetectError(String(err));
      setDetectState("error");
    }
  };

  const handleAdd = () => {
    if (!detectedInfo || !selectedFormat) return;
    onAdd(detectedInfo.webpage_url || url.trim(), selectedFormat);
    setUrl("");
    setDetectState("idle");
    setDetectedInfo(null);
    setSelectedFormat("");
  };

  const handleReset = () => {
    setUrl("");
    setDetectState("idle");
    setDetectedInfo(null);
    setSelectedFormat("");
    setDetectError("");
  };

  return (
    <div className="glass-panel p-6 space-y-4">
      {/* URL Input */}
      <div>
        <div className="section-label flex items-center gap-1.5 mb-3">
          <Link size={12} />
          Paste URL
        </div>
        <div className="flex gap-2">
          <input
            type="url"
            className={`glass-input flex-1 ${disabled ? "opacity-40 pointer-events-none" : ""}`}
            placeholder="Paste any URL — video, audio, file, etc."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && detectState === "idle" && handleDetect()}
            disabled={disabled || detectState === "detecting"}
          />
          {detectState === "idle" || detectState === "error" ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleDetect}
              disabled={disabled || !url.trim()}
              className="glass-btn glass-btn-primary px-5"
            >
              <Globe size={16} />
              Detect
            </motion.button>
          ) : detectState === "detecting" ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              disabled
              className="glass-btn glass-btn-primary px-5 opacity-60"
            >
              <Loader2 size={16} className="animate-spin" />
              Detecting...
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleReset}
              disabled={disabled}
              className="glass-btn px-5"
            >
              Reset
            </motion.button>
          )}
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {detectState === "error" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-glass-danger bg-glass-danger-dim border border-glass-danger/20 rounded-lg px-3 py-2"
          >
            {detectError || "Failed to detect URL. Try a different link."}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detected Info + Format Picker */}
      <AnimatePresence>
        {detectState === "done" && detectedInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4"
          >
            {/* Title bar */}
            <div className="flex items-center gap-3 bg-glass-surface rounded-lg px-3 py-2.5">
              {detectedInfo.thumbnail && (
                <img
                  src={detectedInfo.thumbnail}
                  alt=""
                  className="w-16 h-10 object-cover rounded"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-glass-text font-medium truncate">{detectedInfo.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {detectedInfo.duration && (
                    <span className="text-[10px] text-glass-text-muted flex items-center gap-1">
                      <Clock size={9} />
                      {detectedInfo.duration}
                    </span>
                  )}
                  <span className="text-[10px] text-glass-text-muted">
                    {detectedInfo.format_type === "video" ? "Video" : "Audio"}
                  </span>
                  {detectedInfo.is_live && (
                    <span className="text-[10px] text-glass-danger">LIVE</span>
                  )}
                </div>
              </div>
            </div>

            {/* Format picker */}
            <div>
              <div className="section-label mb-2">Pick quality</div>
              <div className="grid grid-cols-3 gap-2">
                {detectedInfo.formats.map((fmt) => (
                  <button
                    key={fmt.value}
                    onClick={() => setSelectedFormat(fmt.value)}
                    disabled={disabled}
                    className={`glass-panel p-3 flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      selectedFormat === fmt.value
                        ? "border-glass-accent/40 bg-glass-accent-dim"
                        : "hover:bg-glass-surface-hover"
                    } ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                  >
                    {fmt.value.includes("mp3") ? (
                      <Music size={14} className={selectedFormat === fmt.value ? "text-glass-accent" : "text-glass-text-muted"} />
                    ) : fmt.value.includes("mp4") ? (
                      <Film size={14} className={selectedFormat === fmt.value ? "text-glass-accent" : "text-glass-text-muted"} />
                    ) : (
                      <Monitor size={14} className={selectedFormat === fmt.value ? "text-glass-accent" : "text-glass-text-muted"} />
                    )}
                    <span className={`text-[11px] font-medium ${selectedFormat === fmt.value ? "text-glass-text" : "text-glass-text-dim"}`}>
                      {fmt.label}
                    </span>
                    <span className="text-[9px] text-glass-text-muted">{fmt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Add button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAdd}
              disabled={disabled || !selectedFormat}
              className="w-full glass-btn glass-btn-primary py-2.5"
            >
              <Plus size={16} />
              Add to queue
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[10px] text-glass-text-muted text-center">
        Paste any URL, click Detect to see options, then add to queue.
      </p>
    </div>
  );
}
