import { useMemo, memo } from "react";
import { motion } from "framer-motion";

interface Props {
  weights: number[];
  labels?: string[];
}

export default memo(function WeightingGraph({ weights, labels }: Props) {
  const maxWeight = useMemo(() => {
    if (weights.length === 0) return 1;
    return Math.max(...weights, 0.01);
  }, [weights]);

  const svgWidth = 600;
  const svgHeight = 120;
  const padding = { top: 10, right: 10, bottom: 20, left: 10 };
  const graphWidth = svgWidth - padding.left - padding.right;
  const graphHeight = svgHeight - padding.top - padding.bottom;

  const points = useMemo(() => {
    if (weights.length === 0) return [];
    return weights.map((w, i) => {
      const x = padding.left + (i / Math.max(weights.length - 1, 1)) * graphWidth;
      const y = padding.top + graphHeight - (w / maxWeight) * graphHeight;
      return { x, y, weight: w, index: i };
    });
  }, [weights, maxWeight, graphWidth, graphHeight]);

  const pathD = useMemo(() => {
    if (points.length === 0) return "";
    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }, [points]);

  const areaD = useMemo(() => {
    if (points.length === 0) return "";
    if (points.length === 1) {
      const x = points[0].x;
      return `M ${x} ${padding.top + graphHeight} L ${x} ${points[0].y} L ${x} ${padding.top + graphHeight} Z`;
    }
    let d = `M ${points[0].x} ${padding.top + graphHeight}`;
    d += ` L ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    d += ` L ${points[points.length - 1].x} ${padding.top + graphHeight} Z`;
    return d;
  }, [points, graphHeight]);

  if (weights.length === 0) {
    return (
      <div className="text-center py-4 text-[10px] text-app-text-muted">
        No weights to display
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto"
        style={{ maxHeight: "120px" }}
      >
        <defs>
          <linearGradient id="weightGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <motion.path
          d={areaD}
          fill="url(#weightGrad)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        />

        {/* Line */}
        <motion.path
          d={pathD}
          fill="none"
          stroke="var(--accent)"
          strokeOpacity="0.7"
          strokeWidth="2"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, ease: "easeInOut", delay: 0.15 }}
        />

        {/* Dots */}
        {points.map((p, i) => (
          <motion.circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3"
            fill="var(--accent)"
            fillOpacity="0.9"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="1"
            className="weighting-dot"
            style={{ transformOrigin: `${p.x}px ${p.y}px` }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              duration: 0.3,
              delay: 0.3 + i * 0.05,
              ease: "backOut",
            }}
            whileHover={{ scale: 1.15 }}
          />
        ))}

        {/* Labels */}
        {points.length <= 10 &&
          points.map((p, i) => (
            <motion.text
              key={`label-${i}`}
              x={p.x}
              y={padding.top + graphHeight + 14}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.4 + i * 0.05 }}
            >
              {labels?.[i] ?? (i + 1)}
            </motion.text>
          ))}
      </svg>
    </motion.div>
  );
});
