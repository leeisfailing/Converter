import { memo } from "react";
import { motion } from "framer-motion";

interface Props {
  progress: number;
}

export default memo(function ProgressBar({ progress }: Props) {
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <div className="panel p-4">
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Conversion progress"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-app-text-muted">
            Processing...
          </span>
          <motion.span
            className="text-xs font-semibold text-app-accent"
            key={Math.round(clamped)}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.15 }}
          >
            {Math.round(clamped)}%
          </motion.span>
        </div>
        <div className="progress-track">
          <motion.div
            className="progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${clamped}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      </div>
    </div>
  );
});
