import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, Music, Film, Plus, Monitor, Loader2, Globe, Clock } from "lucide-react";
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

  const requestIdRef = useRef(0);

  const isValidUrl = (str: string): boolean => {
    try {
      const u = new URL(str);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };

  const handleDetect = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isValidUrl(trimmed)) {
      setDetectError("Please enter a valid HTTP or HTTPS URL");
      setDetectState("error");
      return;
    }

    const thisRequest = ++requestIdRef.current;
    setDetectState("detecting");
    setDetectError("");
    setDetectedInfo(null);
    setSelectedFormat("");

    try {
      const result = await detectUrl(trimmed);
      if (thisRequest !== requestIdRef.current) return;

      if (result.ok) {
        if (!result.formats || result.formats.length === 0) {
          setDetectError("No downloadable formats found for this URL");
          setDetectState("error");
          return;
        }
        setDetectedInfo(result);
        setSelectedFormat(result.formats[0].value);
        setDetectState("done");
      } else {
        setDetectError("Could not detect URL info");
        setDetectState("error");
      }
    } catch (err) {
      if (thisRequest !== requestIdRef.current) return;
      setDetectError(err instanceof Error ? err.message : String(err));
      setDetectState("error");
    }
  }, [url]);

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
    <div className="space-y-4">
      {/* URL Input */}
      <div className="panel p-4">
        <div className="section-label flex items-center gap-1.5 mb-3">
          <Link size={12} />
          Paste URL
        </div>
        <div className="flex gap-2">
          <input
            type="url"
            className={`input flex-1 ${disabled ? "opacity-40 pointer-events-none" : ""}`}
            placeholder="Paste any URL — video, audio, file, etc."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (detectState === "idle" || detectState === "error") && handleDetect()}
            disabled={disabled || detectState === "detecting" || detectState === "done"}
          />
          {detectState === "idle" || detectState === "error" ? (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleDetect}
              disabled={disabled || !url.trim()}
              className="btn btn-primary px-5"
            >
              <Globe size={16} />
              Detect
            </motion.button>
          ) : detectState === "detecting" ? (
            <motion.button
              disabled
              className="btn btn-primary px-5 opacity-60"
            >
              <Loader2 size={16} className="animate-spin" />
              Detecting...
            </motion.button>
          ) : (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleReset}
              disabled={disabled}
              className="btn px-5"
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
            className="text-xs text-app-danger bg-app-danger-dim border border-app-danger/20 rounded-lg px-3 py-2"
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
            <div className="panel p-3 flex items-center gap-3">
              {detectedInfo.thumbnail && (
                <img
                  src={detectedInfo.thumbnail}
                  alt=""
                  className="w-16 h-10 object-cover rounded-lg"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-app-text truncate">{detectedInfo.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {detectedInfo.duration && (
                    <span className="text-[11px] text-app-text-muted flex items-center gap-1">
                      <Clock size={10} />
                      {detectedInfo.duration}
                    </span>
                  )}
                  <span className="text-[11px] text-app-text-muted">
                    {detectedInfo.format_type === "video" ? "Video" : "Audio"}
                  </span>
                  {detectedInfo.is_live && (
                    <span className="text-[11px] font-medium text-app-danger">LIVE</span>
                  )}
                </div>
              </div>
            </div>

            {/* Format picker */}
            <div className="panel p-4">
              <div className="section-label mb-3">Pick quality</div>
              <div className="grid grid-cols-3 gap-2">
                {detectedInfo.formats.map((fmt) => (
                  <button
                    key={fmt.value}
                    onClick={() => setSelectedFormat(fmt.value)}
                    disabled={disabled}
                    className={`format-chip ${selectedFormat === fmt.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                  >
                    {fmt.value.includes("mp3") ? (
                      <Music size={14} className={selectedFormat === fmt.value ? "text-app-accent" : "text-app-text-muted"} />
                    ) : fmt.value.includes("mp4") ? (
                      <Film size={14} className={selectedFormat === fmt.value ? "text-app-accent" : "text-app-text-muted"} />
                    ) : (
                      <Monitor size={14} className={selectedFormat === fmt.value ? "text-app-accent" : "text-app-text-muted"} />
                    )}
                    <span className={`text-[11px] font-medium ${selectedFormat === fmt.value ? "text-app-text" : "text-app-text-secondary"}`}>
                      {fmt.label}
                    </span>
                    <span className="text-[10px] text-app-text-muted">{fmt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Add button */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleAdd}
              disabled={disabled || !selectedFormat}
              className="w-full btn btn-primary py-2.5"
            >
              <Plus size={16} />
              Add to queue
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[11px] text-app-text-muted text-center">
        Paste any URL, click Detect to see options, then add to queue.
      </p>
    </div>
  );
}
