import { useMemo, memo } from "react";

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
      <div className="text-center py-4 text-[10px] text-glass-text-muted">
        No weights to display
      </div>
    );
  }

  return (
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
      <path d={areaD} fill="url(#weightGrad)" />

      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.7"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Dots */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="3"
          fill="var(--accent)"
          fillOpacity="0.9"
          stroke="var(--accent)"
          strokeOpacity="0.4"
          strokeWidth="1"
        />
      ))}

      {/* Labels */}
      {points.length <= 10 &&
        points.map((p, i) => (
          <text
            key={`label-${i}`}
            x={p.x}
            y={padding.top + graphHeight + 14}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="8"
          >
            {labels?.[i] ?? (i + 1)}
          </text>
        ))}
    </svg>
  );
});
