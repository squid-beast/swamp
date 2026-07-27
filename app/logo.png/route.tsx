import { ImageResponse } from "next/og";

// The SWAMP mark as a hosted PNG, for email.
//
//   /logo.png
//
// Email clients can't render inline SVG or local paths, so the mark has to be a
// real, public https:// raster. Rather than commit a binary (there's no public/
// dir, and the mark would then live in two places), this mirrors app/og/route.tsx:
// same edge runtime, the same green-on-black identity, rendered at request time
// and cached forever since it never changes.
//
// The node geometry is the one from shared/components/swamp-mark.tsx. It's
// duplicated here — Satori renders an <img> data-URI SVG, not a React component,
// and the OG route already duplicates its own mark the same way.

export const runtime = "edge";

const BG = "#0b0f0e";
const ACCENT = "#4ade80";

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

// The mark, as a standalone SVG string. Satori (next/og) renders SVG reliably
// when it arrives as an <img> data URI, which is how the connected-node graph
// gets drawn without shipping a React component into the edge runtime.
function markSvg(): string {
  const lines = EDGES.map(
    ([a, b]) =>
      `<line x1="${NODES[a].x}" y1="${NODES[a].y}" x2="${NODES[b].x}" y2="${NODES[b].y}" stroke="${ACCENT}" stroke-width="2.4" stroke-linecap="round"/>`
  ).join("");
  const dots = NODES.map((n) => {
    if (n.shape === "circle") {
      return `<circle cx="${n.x}" cy="${n.y}" r="3.4" fill="${ACCENT}"/>`;
    }
    const s = n.shape === "hub" ? 8 : 6;
    const rx = n.shape === "hub" ? 2.2 : 1.7;
    return `<rect x="${n.x - s / 2}" y="${n.y - s / 2}" width="${s}" height="${s}" rx="${rx}" fill="${ACCENT}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">${lines}${dots}</svg>`;
}

export function GET() {
  const mark = `data:image/svg+xml;utf8,${encodeURIComponent(markSvg())}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
          // The same radial green wash the OG card and email header band use.
          backgroundImage: `radial-gradient(circle at 70% 20%, rgba(74,222,128,0.18), transparent 60%)`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mark} width={168} height={168} alt="SWAMP" />
      </div>
    ),
    {
      width: 256,
      height: 256,
      headers: {
        // It never changes. Cache it at every hop, for a year, immutably.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }
  );
}
