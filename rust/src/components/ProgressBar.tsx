import { memo } from "react";
import { motion } from "framer-motion";

interface Props {
  progress: number;
}

export default memo(function ProgressBar({ progress }: Props) {
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <div className="glass-panel p-4">
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Conversion progress"
      >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-white/40">
          Processing...
        </span>
        <span className="text-xs font-semibold text-glass-accent">
          {Math.round(clamped)}%
        </span>
      </div>
      <div className="glass-progress-track">
        <motion.div
          className="glass-progress-fill"
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
      </div>
    </div>
  );
});
