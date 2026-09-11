import { forwardRef, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  ArrowRightLeft,
  Film,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Clock,
  HardDrive,
  List,
} from "lucide-react";
import type { QueueItem, QueueItemStatus } from "../lib/queue-types";

interface Props {
  items: QueueItem[];
  onRemove: (id: string) => void;
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
  blur: { icon: Film, color: "text-amber-400", bg: "bg-amber-500/10" },
  compress: { icon: HardDrive, color: "text-emerald-400", bg: "bg-emerald-500/10" },
};

const QueueItemRow = forwardRef<HTMLDivElement, { item: QueueItem; onRemove: (id: string) => void }>(
  ({ item, onRemove }, ref) => {
    const sConfig = statusConfig[item.status];
    const tConfig = typeConfig[item.type] || typeConfig.convert;
    const SIcon = sConfig.icon;
    const TIcon = tConfig.icon;

    return (
      <motion.div
        ref={ref}
        layout
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 10, height: 0 }}
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
          <div className="flex items-center gap-2 mt-0.5">
            <SIcon
              size={11}
              className={`${sConfig.color} ${item.status === "active" ? "animate-spin" : ""}`}
            />
            <span className={`text-[10px] ${sConfig.color}`}>
              {item.status === "active" ? `${Math.round(item.progress)}%` : item.status}
            </span>
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

        {/* Remove button */}
        {(item.status === "completed" || item.status === "failed" || item.status === "cancelled") && (
          <button
            onClick={() => onRemove(item.id)}
            className="w-6 h-6 rounded flex items-center justify-center text-app-text-muted hover:text-app-danger hover:bg-app-danger-dim transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
          </button>
        )}
      </motion.div>
    );
  }
);
QueueItemRow.displayName = "QueueItemRow";

export default memo(function QueueManager({ items, onRemove, onClearCompleted }: Props) {
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
        <div className="flex items-center gap-2">
          <List size={14} className="text-app-accent" />
          <span className="text-xs font-semibold text-app-text uppercase tracking-wider">
            Queue
          </span>
          {activeItem && (
            <span className="text-[10px] text-app-accent bg-app-accent-dim px-1.5 py-0.5 rounded">
              Processing 1 of {items.length}
            </span>
          )}
          {!activeItem && pendingCount > 0 && (
            <span className="text-[10px] text-app-text-muted">
              {pendingCount} pending
            </span>
          )}
        </div>
        {completedCount > 0 && (
          <button
            onClick={onClearCompleted}
            className="text-[10px] text-app-text-muted hover:text-app-text transition-colors cursor-pointer"
          >
            Clear done
          </button>
        )}
      </div>

      {/* Queue items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <QueueItemRow key={item.id} item={item} onRemove={onRemove} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
});
