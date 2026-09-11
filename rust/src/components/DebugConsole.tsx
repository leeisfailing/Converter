import { useEffect, useRef, useState, useCallback, memo, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal,
  Trash2,
  ChevronDown,
  AlertTriangle,
  AlertCircle,
  Info,
  Zap,
  Pause,
  Play,
  Copy,
  Check,
} from "lucide-react";
import type { LogEntry, LogLevel } from "../hooks/useDebugConsole";

interface Props {
  logs: LogEntry[];
  onClear: () => void;
  isCapturing: boolean;
  onToggleCapture: () => void;
}

const levelConfig: Record<
  LogLevel,
  { icon: typeof Info; color: string; bg: string; label: string }
> = {
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", label: "INFO" },
  warn: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", label: "WARN" },
  error: { icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10", label: "ERROR" },
  system: { icon: Zap, color: "text-app-accent", bg: "bg-app-accent-dim", label: "SYS" },
};

type FilterLevel = "all" | LogLevel;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function formatLogForCopy(log: LogEntry): string {
  const time = formatTime(log.timestamp);
  const level = log.level.toUpperCase();
  const source = log.source ? ` [${log.source}]` : "";
  return `[${time}] ${level}${source} ${log.message}`;
}

export default memo(function DebugConsole({
  logs,
  onClear,
  isCapturing,
  onToggleCapture,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<FilterLevel>("all");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const copiedIdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedAllTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredLogs = useMemo(
    () => filter === "all" ? logs : logs.filter((l) => l.level === filter),
    [logs, filter]
  );

  const errorCount = useMemo(
    () => logs.filter((l) => l.level === "error").length,
    [logs]
  );
  const warnCount = useMemo(
    () => logs.filter((l) => l.level === "warn").length,
    [logs]
  );

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  useEffect(() => {
    return () => {
      if (copiedIdTimeoutRef.current) clearTimeout(copiedIdTimeoutRef.current);
      if (copiedAllTimeoutRef.current) clearTimeout(copiedAllTimeoutRef.current);
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 30);
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    }
  }, []);

  const handleCopyLog = useCallback(async (log: LogEntry) => {
    const text = formatLogForCopy(log);
    const ok = await copyToClipboard(text);
    if (ok) {
      if (copiedIdTimeoutRef.current) clearTimeout(copiedIdTimeoutRef.current);
      setCopiedId(log.id);
      copiedIdTimeoutRef.current = setTimeout(() => setCopiedId(null), 1500);
    }
  }, [copyToClipboard]);

  const handleCopyAll = useCallback(async () => {
    const text = filteredLogs.map(formatLogForCopy).join("\n");
    const ok = await copyToClipboard(text);
    if (ok) {
      if (copiedAllTimeoutRef.current) clearTimeout(copiedAllTimeoutRef.current);
      setCopiedAll(true);
      copiedAllTimeoutRef.current = setTimeout(() => setCopiedAll(false), 1500);
    }
  }, [filteredLogs, copyToClipboard]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="panel overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border">
        <div className="flex items-center gap-2">
          <Terminal size={13} className="text-app-accent" />
          <span className="text-[11px] font-semibold text-app-text-muted uppercase tracking-wider">
            Console
          </span>
          <div className="flex items-center gap-1 ml-2">
            {errorCount > 0 && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-app-danger-dim text-app-danger">
                {errorCount} error{errorCount !== 1 ? "s" : ""}
              </span>
            )}
            {warnCount > 0 && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-app-warning-dim text-app-warning">
                {warnCount} warn{warnCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyAll}
            disabled={filteredLogs.length === 0}
            className="btn-icon !w-6 !h-6 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Copy all logs"
          >
            {copiedAll ? <Check size={12} className="text-app-success" /> : <Copy size={12} />}
          </button>
          <button
            onClick={onToggleCapture}
            className={`btn-icon !w-6 !h-6 ${isCapturing ? "active" : ""}`}
            title={isCapturing ? "Pause capture" : "Resume capture"}
          >
            {isCapturing ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            onClick={onClear}
            className="btn-icon !w-6 !h-6 hover:!text-app-danger hover:!bg-app-danger-dim"
            title="Clear logs"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="btn-icon !w-6 !h-6"
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
            />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            {/* Filters */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-app-border">
              {(["all", "error", "warn", "info", "system"] as FilterLevel[]).map(
                (f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                      filter === f
                        ? f === "error"
                          ? "bg-app-danger-dim text-app-danger"
                          : f === "warn"
                          ? "bg-app-warning-dim text-app-warning"
                          : f === "system"
                          ? "bg-app-accent-dim text-app-accent"
                          : "bg-app-surface-elevated text-app-text"
                        : "text-app-text-muted hover:text-app-text-secondary hover:bg-app-surface-hover"
                    }`}
                  >
                    {f === "all" ? "All" : levelConfig[f].label}
                  </button>
                )
              )}
              <div className="flex-1" />
              <span className="text-[9px] text-app-text-muted font-mono">
                {filteredLogs.length} log{filteredLogs.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Log entries */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="h-[180px] overflow-y-auto px-3 py-1 font-mono text-[11px] leading-relaxed"
            >
              {filteredLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-app-text-muted text-[10px]">
                  No logs yet
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const config = levelConfig[log.level];
                  const Icon = config.icon;
                  return (
                    <div
                      key={log.id}
                      className="group flex items-start gap-2 py-0.5 rounded px-1 -mx-1 hover:bg-app-surface-hover"
                    >
                      <span className="text-app-text-muted select-none shrink-0">
                        {formatTime(log.timestamp)}
                      </span>
                      <Icon size={10} className={`${config.color} shrink-0 mt-0.5`} />
                      <div className="min-w-0 flex-1">
                        {log.source && (
                          <span className="text-app-text-muted mr-1">
                            [{log.source}]
                          </span>
                        )}
                        <span
                          className={`break-words whitespace-pre-wrap ${
                            log.level === "error"
                              ? "text-red-400"
                              : log.level === "warn"
                              ? "text-amber-400"
                              : log.level === "system"
                              ? "text-app-accent"
                              : "text-app-text-secondary"
                          }`}
                        >
                          {log.message}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopyLog(log)}
                        className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-app-text-muted hover:text-app-accent opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        title="Copy log"
                      >
                        {copiedId === log.id ? (
                          <Check size={10} className="text-app-success" />
                        ) : (
                          <Copy size={10} />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
