import { motion } from "framer-motion";

interface Props {
  progress: number;
}

export default function ProgressBar({ progress }: Props) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-white/40">
          Processing...
        </span>
        <span className="text-xs font-semibold text-glass-accent">
          {Math.round(progress)}%
        </span>
      </div>
      <div className="glass-progress-track">
        <motion.div
          className="glass-progress-fill"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
