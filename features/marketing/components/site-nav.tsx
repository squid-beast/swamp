"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ThemeToggle } from "@/shared/components/theme-toggle";
import { cn } from "@/shared/lib/utils";
import { NAV_LINKS } from "../nav";

// The top bar.
//
// Three links. A nav with nine items is a nav nobody reads, and every extra item
// dilutes the two things this bar is actually for: telling you what SWAMP is, and
// getting you to sign up.
//
// `Log in` and `Sign up` stay separate. Collapsing them into one "Get started"
// button is a small cruelty to the person who already has an account and just
// wants to reach their data.

export function SiteNav() {
  const [open, setOpen] = React.useState(false);

  // Escape closes the mobile panel. Being stuck inside a fullscreen menu with no
  // obvious way out is a genuinely bad thirty seconds.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="swamp-brand group flex items-center gap-2.5 font-display text-[17px] font-extrabold tracking-tight"
        >
          <Mark />
          SWAMP
        </Link>

        <nav
          aria-label="Main"
          className="hidden items-center gap-7 text-[14px] text-muted-foreground md:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <ThemeToggle />

          <Button asChild variant="ghost" size="sm" className="hidden h-9 sm:inline-flex">
            <Link href="/auth/sign-in">Log in</Link>
          </Button>

          <Button asChild size="sm" className="h-9">
            <Link href="/auth/register">Sign up free</Link>
          </Button>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="ml-1 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile. A panel, not a drawer — there are four links, and a drawer would
          be machinery in service of nothing. */}
      <div className={cn("border-t bg-background md:hidden", open ? "block" : "hidden")}>
        <nav aria-label="Mobile" className="mx-auto flex max-w-6xl flex-col px-4 py-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="py-2.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/auth/sign-in"
            onClick={() => setOpen(false)}
            className="py-2.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground sm:hidden"
          >
            Log in
          </Link>
        </nav>
      </div>
    </header>
  );
}

// The brand mark — the SWAMP logo, drawn inline instead of as an image.
//
// Two reasons it's SVG here and not the PNG tile (the tile still powers the favicon
// and the emails, where a raster is required):
//   • It inherits `currentColor`, so it's black in light mode and white in dark with
//     no second file and no theme-detection JS. Mode-specific for free.
//   • It can move. On hover of the whole brand link, the links redraw and the nodes
//     give a small pop. Anyone with reduced-motion set sees it sit still.
//
// Same seven-node network as the tile: rounded squares are tables, circles are
// records, the lines between them are the links.
// Same geometry the favicon tile is drawn from — a shared hub that everything
// joins into. Squares are tables/cells, circles are records, lines are the links.
const MARK_NODES = [
  { x: 24, y: 24, shape: "hub" as const },
  { x: 9, y: 15, shape: "square" as const },
  { x: 9, y: 33, shape: "square" as const },
  { x: 23, y: 8, shape: "circle" as const },
  { x: 24, y: 40, shape: "circle" as const },
  { x: 39, y: 16, shape: "square" as const },
  { x: 40, y: 32, shape: "circle" as const },
];
const MARK_EDGES: [number, number][] = [
  [1, 0], [2, 0], [3, 0], [4, 0], [0, 5], [0, 6], [5, 6], [3, 5],
];

export function Mark({ className }: { className?: string }) {
  return (
    <span className={cn("swamp-navmark inline-flex size-[22px] shrink-0 text-foreground", className)} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" className="size-full" style={{ overflow: "visible" }}>
        <g stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          {MARK_EDGES.map(([a, b], i) => (
            <line
              key={i}
              x1={MARK_NODES[a].x}
              y1={MARK_NODES[a].y}
              x2={MARK_NODES[b].x}
              y2={MARK_NODES[b].y}
              pathLength={1}
              style={{ "--i": i } as React.CSSProperties}
            />
          ))}
        </g>
        <g fill="currentColor">
          {MARK_NODES.map((n, i) => {
            const style = { "--i": i } as React.CSSProperties;
            if (n.shape === "circle") {
              return <circle key={i} className="nm-n" cx={n.x} cy={n.y} r={3.4} style={style} />;
            }
            const s = n.shape === "hub" ? 8 : 6;
            return (
              <rect
                key={i}
                className="nm-n"
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

      <style>{`
        .swamp-navmark line { stroke-dasharray: 1; stroke-dashoffset: 0; }
        .swamp-navmark .nm-n { transform-box: fill-box; transform-origin: center; }
        .swamp-brand:hover .swamp-navmark line {
          animation: nm-draw 0.6s ease both;
          animation-delay: calc(var(--i) * 0.04s);
        }
        .swamp-brand:hover .swamp-navmark .nm-n {
          animation: nm-pop 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
          animation-delay: calc(var(--i) * 0.045s);
        }
        @keyframes nm-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        @keyframes nm-pop { 0% { transform: scale(0.55); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) {
          .swamp-brand:hover .swamp-navmark line,
          .swamp-brand:hover .swamp-navmark .nm-n { animation: none; }
        }
      `}</style>
    </span>
  );
}
