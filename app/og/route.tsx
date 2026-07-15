import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

// The Open Graph card, generated per page.
//
//   /og?title=Security&kicker=SWAMP
//
// Rendered at request time and cached at the edge, so every page gets a DIFFERENT
// card without anybody opening a design tool. A site where every link shares the
// same generic image is a site where nobody can tell your links apart in a Slack
// channel — which is most of them, because making 12 images by hand is a job
// nobody wants.
//
// No custom font is loaded: fetching a woff2 on every render is the usual reason
// these things are slow, and the system stack renders fine at 1200×630.

export const runtime = "edge";

const BG = "#0b0f0e";
const FG = "#f2f5f4";
const MUTED = "#7d8b87";
const ACCENT = "#4ade80";

export function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Cap the length. A 300-character title doesn't render, it just overflows the
  // canvas and produces a card with the words falling off the bottom.
  const title = (searchParams.get("title") ?? "The shared database your team can actually use").slice(0, 90);
  const kicker = (searchParams.get("kicker") ?? "SWAMP").slice(0, 40);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: "72px",
          // A soft wash so the card isn't a flat rectangle.
          backgroundImage: `radial-gradient(circle at 85% 15%, rgba(74,222,128,0.14), transparent 55%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: ACCENT,
              display: "flex",
            }}
          />
          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              color: FG,
              letterSpacing: "-0.02em",
            }}
          >
            SWAMP
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 20,
              color: ACCENT,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            {kicker}
          </div>

          <div
            style={{
              fontSize: title.length > 55 ? 60 : 74,
              fontWeight: 800,
              color: FG,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              display: "flex",
              maxWidth: 980,
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 24, color: MUTED, display: "flex" }}>
            A collaborative database
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
            }}
          >
            {[0.9, 0.6, 0.35, 0.2].map((opacity, i) => (
              <div
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: ACCENT,
                  opacity,
                  display: "flex",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
