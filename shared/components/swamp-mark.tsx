import * as React from "react";
import { cn } from "@/shared/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
// The SWAMP mark — one source of truth for the connected-node logo, used in the
// marketing nav AND the app sidebar so they match. It inherits `currentColor`
// (mode-adaptive), and with `animate` it draws its own links in on mount — so
// keying it on a state change (e.g. sidebar collapse) replays the draw.
// ════════════════════════════════════════════════════════════════════════════

const NODES = [
  { x: 24, y: 24, shape: "hub" as const },
  { x: 9, y: 15, shape: "square" as const },
  { x: 9, y: 33, shape: "square" as const },
  { x: 23, y: 8, shape: "circle" as const },
  { x: 24, y: 40, shape: "circle" as const },
  { x: 39, y: 16, shape: "square" as const },
  { x: 40, y: 32, shape: "circle" as const },
];
const EDGES: [number, number][] = [
  [1, 0], [2, 0], [3, 0], [4, 0], [0, 5], [0, 6], [5, 6], [3, 5],
];

export function SwampMark({
  className,
  animate = false,
}: {
  className?: string;
  animate?: boolean;
}) {
  return (
    <span
      className={cn("swamp-mark inline-flex text-foreground", animate && "swamp-mark--animate", className)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" fill="none" className="size-full" style={{ overflow: "visible" }}>
        <g stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          {EDGES.map(([a, b], i) => (
            <line
              key={i}
              className="sm-edge"
              x1={NODES[a].x}
              y1={NODES[a].y}
              x2={NODES[b].x}
              y2={NODES[b].y}
              pathLength={1}
              style={{ "--i": i } as React.CSSProperties}
            />
          ))}
        </g>
        <g fill="currentColor">
          {NODES.map((n, i) => {
            const style = { "--i": i } as React.CSSProperties;
            if (n.shape === "circle") {
              return <circle key={i} className="sm-node" cx={n.x} cy={n.y} r={3.4} style={style} />;
            }
            const s = n.shape === "hub" ? 8 : 6;
            return (
              <rect
                key={i}
                className="sm-node"
                x={n.x - s / 2}
                y={n.y - s / 2}
                width={s}
                height={s}
                rx={n.shape === "hub" ? 2.2 : 1.7}
                style={style}
              />
            );
          })}
        </g>
      </svg>
    </span>
  );
}
