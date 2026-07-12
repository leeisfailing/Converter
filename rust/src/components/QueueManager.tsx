import { forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  ArrowRightLeft,
  Film,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  CircleDot,
  Clock,
  HardDrive,
} from "lucide-react";
import type { QueueItem } from "../lib/queue-types";

interface Props {
  items: QueueItem[];
  onRemove: (id: string) => void;
  onClearCompleted: () => void;
}

const statusConfig: Record<
  QueueItemStatus,
  { icon: typeof Download; color: string; bg: string }
> = {
  pending: { icon: Clock, color: "text-glass-text-muted", bg: "bg-glass-surface" },
  active: { icon: Loader2, color: "text-glass-accent", bg: "bg-glass-accent-dim" },
  completed: { icon: CheckCircle2, color: "text-glass-success", bg: "bg-glass-success-dim" },
  failed: { icon: XCircle, color: "text-glass-danger", bg: "bg-glass-danger-dim" },
  cancelled: { icon: XCircle, color: "text-glass-text-muted", bg: "bg-glass-surface" },
};

type QueueItemStatus = "pending" | "active" | "completed" | "failed" | "cancelled";

const QueueItemRow = forwardRef<HTMLDivElement, { item: QueueItem; onRemove: (id: string) => void }>(
  ({ item, onRemove }, ref) => {
    const config = statusConfig[item.status];
    const Icon = config.icon;

    return (
      <motion.div
        ref={ref}
        layout
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 10, height: 0 }}
        className={`glass-panel p-3 flex items-center gap-3 ${config.bg} ${
          item.status === "active" ? "border-glass-accent/30" : ""
        }`}
      >
        {/* Type icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          item.type === "download" ? "bg-blue-500/10" : item.type === "blur" ? "bg-amber-500/10" : item.type === "compress" ? "bg-emerald-500/10" : "bg-purple-500/10"
        }`}>
          {item.type === "download" ? (
            <Download size={14} className="text-blue-400" />
          ) : item.type === "blur" ? (
            <Film size={14} className="text-amber-400" />
          ) : item.type === "compress" ? (
            <HardDrive size={14} className="text-emerald-400" />
          ) : (
            <ArrowRightLeft size={14} className="text-purple-400" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-glass-text truncate">{item.label}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Icon
              size={11}
              className={`${config.color} ${item.status === "active" ? "animate-spin" : ""}`}
            />
            <span className={`text-[10px] ${config.color}`}>
              {item.status === "active" ? `${item.progress}%` : item.status}
            </span>
            {item.error && (
              <span className="text-[10px] text-glass-danger truncate max-w-[150px]">
                {item.error}
              </span>
            )}
          </div>
          {/* Progress bar for active item */}
          {item.status === "active" && (
            <div className="mt-1.5 h-1 rounded-full bg-glass-surface overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-glass-accent"
                initial={{ width: 0 }}
                animate={{ width: `${item.progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
        </div>

        {/* Remove button */}
        {(item.status === "completed" || item.status === "failed" || item.status === "cancelled") && (
          <button
            onClick={() => onRemove(item.id)}
            className="w-6 h-6 rounded flex items-center justify-center text-glass-text-muted hover:text-glass-danger hover:bg-glass-danger-dim transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
          </button>
        )}
      </motion.div>
    );
  }
);
QueueItemRow.displayName = "QueueItemRow";

export default function QueueManager({ items, onRemove, onClearCompleted }: Props) {
  const hasItems = items.length > 0;
  const completedCount = items.filter(
    (i) => i.status === "completed" || i.status === "failed" || i.status === "cancelled"
  ).length;
  const activeItem = items.find((i) => i.status === "active");
  const pendingCount = items.filter((i) => i.status === "pending").length;

  if (!hasItems) return null;

  return (
    <div className="space-y-2">
      {/* Queue header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-glass-text-muted uppercase tracking-wider">
            Queue
          </span>
          {activeItem && (
            <span className="text-[10px] text-glass-accent">
              Processing 1 of {items.length}
            </span>
          )}
          {!activeItem && pendingCount > 0 && (
            <span className="text-[10px] text-glass-text-muted">
              {pendingCount} pending
            </span>
          )}
        </div>
        {completedCount > 0 && (
          <button
            onClick={onClearCompleted}
            className="text-[10px] text-glass-text-muted hover:text-glass-text transition-colors cursor-pointer"
          >
            Clear done
          </button>
        )}
      </div>

      {/* Queue items */}
      <div className="space-y-1.5 max-h-[250px] overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <QueueItemRow key={item.id} item={item} onRemove={onRemove} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
