import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, Music, Film, Plus, ChevronDown, Loader2, Globe, Clock } from "lucide-react";
import { detectUrl } from "../lib/tauri-commands";
import type { UrlFormat } from "../lib/tauri-commands";

interface Props {
  onAdd: (url: string, formatType: string) => void;
  disabled: boolean;
}

type DetectState = "idle" | "detecting" | "done" | "error";

const containerVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const chipVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.92 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.25, ease: "easeOut" } },
};

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
  const [selectedFormatType, setSelectedFormatType] = useState<string>("");
  const [selectedQuality, setSelectedQuality] = useState<string>("");
  const [qualityDropdownOpen, setQualityDropdownOpen] = useState(false);

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
    setSelectedFormatType("");
    setSelectedQuality("");
    setQualityDropdownOpen(false);

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
        const firstFmt = result.formats[0];
        setSelectedFormatType(firstFmt.value);
        const defaultQuality = firstFmt.qualities?.[0]?.value || firstFmt.value;
        setSelectedQuality(defaultQuality);
        setSelectedFormat(defaultQuality);
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
    setSelectedFormatType("");
    setSelectedQuality("");
    setQualityDropdownOpen(false);
  };

  const handleReset = () => {
    setUrl("");
    setDetectState("idle");
    setDetectedInfo(null);
    setSelectedFormat("");
    setSelectedFormatType("");
    setSelectedQuality("");
    setDetectError("");
    setQualityDropdownOpen(false);
  };

  return (
    <motion.div
      className="space-y-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* URL Input */}
      <div className="panel p-4">
        <div className="section-label flex items-center gap-1.5 mb-3">
          <Link size={12} />
          Paste URL
        </div>
        <div className="flex gap-2">
          <motion.input
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
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
              whileHover={{ scale: 1.01 }}
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
              whileHover={{ scale: 1.01 }}
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
              <div className="section-label mb-3">Pick format</div>
              <motion.div
                className="grid grid-cols-2 gap-2"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                {detectedInfo.formats.map((fmt) => (
                  <motion.button
                    key={fmt.value}
                    variants={chipVariants}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setSelectedFormatType(fmt.value);
                      const defaultQ = fmt.qualities?.[0]?.value || fmt.value;
                      setSelectedQuality(defaultQ);
                      setSelectedFormat(defaultQ);
                    }}
                    disabled={disabled}
                    className={`format-chip ${selectedFormatType === fmt.value ? "selected" : ""} ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                  >
                    {fmt.value === "mp3" ? (
                      <Music size={14} className={selectedFormatType === fmt.value ? "text-app-accent" : "text-app-text-muted"} />
                    ) : (
                      <Film size={14} className={selectedFormatType === fmt.value ? "text-app-accent" : "text-app-text-muted"} />
                    )}
                    <span className={`text-[11px] font-medium ${selectedFormatType === fmt.value ? "text-app-text" : "text-app-text-secondary"}`}>
                      {fmt.label}
                    </span>
                    <span className="text-[10px] text-app-text-muted">{fmt.desc}</span>
                  </motion.button>
                ))}
              </motion.div>

              {/* Quality dropdown */}
              {selectedFormatType && (() => {
                const activeFmt = detectedInfo.formats.find(f => f.value === selectedFormatType);
                const qualities = activeFmt?.qualities;
                if (!qualities || qualities.length === 0) return null;
                const currentQ = qualities.find(q => q.value === selectedQuality) || qualities[0];
                return (
                  <div className="mt-3 relative">
                    <div className="section-label mb-1.5">Quality</div>
                    <button
                      type="button"
                      onClick={() => setQualityDropdownOpen(!qualityDropdownOpen)}
                      disabled={disabled}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-app-surface border border-app-border text-left text-sm text-app-text hover:border-app-accent/50 transition-colors"
                    >
                      <span>{currentQ.label}</span>
                      <ChevronDown size={14} className={`text-app-text-muted transition-transform ${qualityDropdownOpen ? "rotate-180" : ""}`} />
                    </button>
                    <AnimatePresence>
                      {qualityDropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="absolute z-20 mt-1 w-full rounded-lg bg-app-surface border border-app-border shadow-lg overflow-hidden"
                        >
                          {qualities.map((q) => (
                            <button
                              key={q.value}
                              type="button"
                              onClick={() => {
                                setSelectedQuality(q.value);
                                setSelectedFormat(q.value);
                                setQualityDropdownOpen(false);
                              }}
                              className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                                q.value === selectedQuality
                                  ? "bg-app-accent/10 text-app-accent"
                                  : "text-app-text hover:bg-app-accent/5"
                              }`}
                            >
                              {q.label}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })()}
            </div>

            {/* Add button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
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
    </motion.div>
  );
}
