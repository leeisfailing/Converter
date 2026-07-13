import { useState, useEffect, useCallback, useRef } from "react";

export type LogLevel = "info" | "warn" | "error" | "system";

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  source?: string;
}

interface UseDebugConsoleOptions {
  maxLogs?: number;
  captureConsole?: boolean;
  captureErrors?: boolean;
  captureRejections?: boolean;
}

let logIdCounter = 0;
function genLogId(): string {
  return `log-${Date.now()}-${++logIdCounter}`;
}

export default function useDebugConsole(options: UseDebugConsoleOptions = {}) {
  const {
    maxLogs = 500,
    captureConsole = true,
    captureErrors = true,
    captureRejections = true,
  } = options;

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isCapturing, setIsCapturing] = useState(true);
  const originalFns = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    info: typeof console.info;
  } | null>(null);
  const patchedFns = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    info: typeof console.info;
  } | null>(null);

  const addLog = useCallback(
    (level: LogLevel, message: string, source?: string) => {
      const entry: LogEntry = {
        id: genLogId(),
        timestamp: Date.now(),
        level,
        message: message,
        source,
      };
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > maxLogs ? next.slice(-maxLogs) : next;
      });
    },
    [maxLogs]
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const formatArgs = useCallback((args: unknown[]): string => {
    return args
      .map((arg) => {
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}`;
        }
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(" ");
  }, []);

  useEffect(() => {
    if (!isCapturing) return;

    // Save originals
    originalFns.current = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
    };

    if (captureConsole) {
      const patchedLog = (...args: unknown[]) => {
        originalFns.current?.log(...args);
        addLog("info", formatArgs(args));
      };
      const patchedWarn = (...args: unknown[]) => {
        originalFns.current?.warn(...args);
        addLog("warn", formatArgs(args));
      };
      const patchedError = (...args: unknown[]) => {
        originalFns.current?.error(...args);
        addLog("error", formatArgs(args));
      };
      const patchedInfo = (...args: unknown[]) => {
        originalFns.current?.info(...args);
        addLog("info", formatArgs(args));
      };

      console.log = patchedLog;
      console.warn = patchedWarn;
      console.error = patchedError;
      console.info = patchedInfo;

      patchedFns.current = {
        log: patchedLog,
        warn: patchedWarn,
        error: patchedError,
        info: patchedInfo,
      };
    }

    // Capture unhandled errors
    const handleError = (event: ErrorEvent) => {
      addLog(
        "error",
        `${event.message}\n  at ${event.filename}:${event.lineno}:${event.colno}`,
        "window.onerror"
      );
    };

    // Capture unhandled promise rejections
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        reason instanceof Error
          ? `${reason.name}: ${reason.message}\n${reason.stack || ""}`
          : String(reason);
      addLog("error", msg, "unhandledrejection");
    };

    if (captureErrors) {
      window.addEventListener("error", handleError);
    }
    if (captureRejections) {
      window.addEventListener("unhandledrejection", handleRejection);
    }

    addLog("system", "Debug console initialized");

    return () => {
      if (originalFns.current && patchedFns.current) {
        if (console.log === patchedFns.current.log) {
          console.log = originalFns.current.log;
        }
        if (console.warn === patchedFns.current.warn) {
          console.warn = originalFns.current.warn;
        }
        if (console.error === patchedFns.current.error) {
          console.error = originalFns.current.error;
        }
        if (console.info === patchedFns.current.info) {
          console.info = originalFns.current.info;
        }
      }
      patchedFns.current = null;
      if (captureErrors) {
        window.removeEventListener("error", handleError);
      }
      if (captureRejections) {
        window.removeEventListener("unhandledrejection", handleRejection);
      }
    };
  }, [isCapturing, captureConsole, captureErrors, captureRejections, addLog]);

  return {
    logs,
    addLog,
    clearLogs,
    isCapturing,
    setIsCapturing,
  };
}
