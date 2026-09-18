import { forwardRef, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  ArrowRightLeft,
  Minimize2,
  ArrowUp,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Clock,
  List,
  X,
} from "lucide-react";
import type { QueueItem, QueueItemStatus } from "../lib/queue-types";

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let idx = 0;
  let speed = bytesPerSec;
  while (speed >= 1024 && idx < units.length - 1) {
    speed /= 1024;
    idx++;
  }
  return `${speed.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

interface Props {
  items: QueueItem[];
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
  onClearCompleted: () => void;
}

const statusConfig: Record<
  QueueItemStatus,
  { icon: typeof Download; color: string; bg: string }
> = {
  pending: { icon: Clock, color: "text-app-text-muted", bg: "bg-app-surface" },
  active: { icon: Loader2, color: "text-app-accent", bg: "bg-app-accent-dim" },
  completed: { icon: CheckCircle2, color: "text-app-success", bg: "bg-app-success-dim" },
  failed: { icon: XCircle, color: "text-app-danger", bg: "bg-app-danger-dim" },
  cancelled: { icon: XCircle, color: "text-app-text-muted", bg: "bg-app-surface" },
};

const typeConfig: Record<string, { icon: typeof Download; color: string; bg: string }> = {
  download: { icon: Download, color: "text-app-accent", bg: "bg-app-accent-dim" },
  convert: { icon: ArrowRightLeft, color: "text-purple-400", bg: "bg-purple-500/10" },
  transcoder: { icon: Minimize2, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  upscale: { icon: ArrowUp, color: "text-blue-400", bg: "bg-blue-500/10" },
};

const staggerItem = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
};

const QueueItemRow = memo(forwardRef<HTMLDivElement, { item: QueueItem; onRemove: (id: string) => void; onCancel: (id: string) => void }>(
  ({ item, onRemove, onCancel }, ref) => {
    const sConfig = statusConfig[item.status];
    const tConfig = typeConfig[item.type] || typeConfig.convert;
    const SIcon = sConfig.icon;
    const TIcon = tConfig.icon;

    return (
      <motion.div
        ref={ref}
        layout
        initial="hidden"
        animate="visible"
        variants={staggerItem}
        transition={{ duration: 0.25, ease: "easeOut" }}
        whileHover={{ scale: 1.01, x: 2 }}
        whileTap={{ scale: 0.99 }}
        className={`panel p-3 flex items-center gap-3 ${sConfig.bg} ${
          item.status === "active" ? "border-app-accent/30" : ""
        }`}
      >
        {/* Type icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tConfig.bg}`}>
          <TIcon size={14} className={tConfig.color} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-app-text truncate">{item.label}</p>
          {item.assignedGpu && <p className="text-[11px] text-app-text-secondary">GPU: {item.assignedGpu}</p>}
          <div className="flex items-center gap-2 mt-0.5">
            <SIcon
              size={11}
              className={`${sConfig.color} ${item.status === "active" ? "animate-spin" : ""}`}
            />
            <span className={`text-[10px] ${sConfig.color}`}>
              {item.status === "active"
                ? item.downloadPhase === "resolving" ? "Finding video…"
                  : item.downloadPhase === "retrying" ? "Retrying…"
                  : `${Math.round(item.progress)}%`
                : item.status}
            </span>
            {item.status === "active" && item.type === "download" && (item.downloadSpeed ?? 0) > 0 && (
              <span className="text-[10px] text-app-accent font-medium">
                {formatSpeed(item.downloadSpeed ?? 0)}
              </span>
            )}
            {item.status === "active" && item.type === "download" && (item.downloadEta ?? 0) > 0 && (
              <span className="text-[10px] text-app-text-muted">
                {formatEta(item.downloadEta ?? 0)} left
              </span>
            )}
            {item.status === "active" && item.type === "download" && item.downloadIsLive && (
              <span className="text-[10px] text-red-400 font-medium">LIVE</span>
            )}
            {item.error && (
              <span className="text-[10px] text-app-danger truncate max-w-[120px]">
                {item.error}
              </span>
            )}
          </div>
          {/* Progress bar for active item */}
          {item.status === "active" && (
            <div className="mt-2 progress-track">
              <motion.div
                className="progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${item.progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
        </div>

        {/* Action button */}
        {item.status === "active" ? (
          <motion.button
            onClick={() => onCancel(item.id)}
            aria-label={`Cancel ${item.label}`}
            className="w-6 h-6 rounded flex items-center justify-center text-app-text-muted hover:text-app-danger hover:bg-app-danger-dim transition-colors cursor-pointer"
            whileHover={{ scale: 1.2 }}
            whileTap={{ scale: 0.8 }}
          >
            <X size={12} />
          </motion.button>
        ) : (
          <motion.button
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.label} from queue`}
            className="w-6 h-6 rounded flex items-center justify-center text-app-text-muted hover:text-app-danger hover:bg-app-danger-dim transition-colors cursor-pointer"
            whileHover={{ scale: 1.2 }}
            whileTap={{ scale: 0.8 }}
          >
            <Trash2 size={12} />
          </motion.button>
        )}
      </motion.div>
    );
  }
));
QueueItemRow.displayName = "QueueItemRow";

export default memo(function QueueManager({ items, onRemove, onCancel, onClearCompleted }: Props) {
  const hasItems = items.length > 0;

  const completedCount = useMemo(
    () => items.filter((i) => i.status === "completed" || i.status === "failed" || i.status === "cancelled").length,
    [items]
  );
  const activeItem = useMemo(() => items.find((i) => i.status === "active"), [items]);
  const pendingCount = useMemo(() => items.filter((i) => i.status === "pending").length, [items]);

  if (!hasItems) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Queue header */}
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between px-4 py-3 border-b border-app-border"
      >
        <div className="flex items-center gap-2">
          <List size={14} className="text-app-accent" />
          <span className="text-xs font-semibold text-app-text uppercase tracking-wider">
            Queue
          </span>
          {activeItem && (
            <motion.span
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="text-[10px] text-app-accent bg-app-accent-dim px-1.5 py-0.5 rounded"
            >
              Processing 1 of {items.length}
            </motion.span>
          )}
          {!activeItem && pendingCount > 0 && (
            <span className="text-[10px] text-app-text-muted">
              {pendingCount} pending
            </span>
          )}
        </div>
        {completedCount > 0 && (
          <motion.button
            onClick={onClearCompleted}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="text-[10px] text-app-text-muted hover:text-app-text transition-colors cursor-pointer"
          >
            Clear done
          </motion.button>
        )}
      </motion.div>

      {/* Queue items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <QueueItemRow key={item.id} item={item} onRemove={onRemove} onCancel={onCancel} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
});
