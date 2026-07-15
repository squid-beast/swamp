"use client";

import * as React from "react";

// ════════════════════════════════════════════════════════════════════════════
// Particle network — the animated backdrop for the hero and final CTA.
//
// Original code (not copied from any component gallery), written in the 21st.dev
// spirit: drifting dots that draw a line to their neighbours when close, so it
// reads as a living constellation. On-brand for SWAMP — data points joining — and
// deliberately MONOCHROME: it paints with the theme's `--foreground` colour, so it
// is dark-on-light in light mode and light-on-dark in dark mode, and it re-reads
// that colour when the theme is toggled. Freezes to a single static frame for
// anyone with reduced-motion set.
// ════════════════════════════════════════════════════════════════════════════

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function ParticleField() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const LINK = 130; // px within which two dots are joined

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let dots: P[] = [];

    // The theme colour, read from CSS as an HSL triplet like "0 0% 93%".
    let triplet = "0 0% 90%";
    const readColor = () => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--foreground")
        .trim();
      if (v) triplet = v;
    };
    const stroke = (a: number) => {
      const [hh, ss, ll] = triplet.split(/\s+/);
      return `hsla(${hh}, ${ss}, ${ll}, ${a})`;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.min(90, Math.floor((w * h) / 13000));
      dots = Array.from({ length: Math.max(24, target) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
      }));
    };

    const frame = () => {
      ctx.clearRect(0, 0, w, h);

      if (!reduce) {
        for (const p of dots) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
        }
      }

      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const a = dots[i];
          const b = dots[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK) {
            ctx.strokeStyle = stroke(0.16 * (1 - dist / LINK));
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      ctx.fillStyle = stroke(0.55);
      for (const p of dots) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduce) raf = requestAnimationFrame(frame);
    };

    readColor();
    resize();
    frame();

    const onResize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      resize();
      if (reduce) frame();
    };
    window.addEventListener("resize", onResize);

    // Re-read the colour when the theme class flips, and repaint if we're static.
    const obs = new MutationObserver(() => {
      readColor();
      if (reduce) frame();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      obs.disconnect();
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      {/* fade the field into the page so the edges and the text stay clean */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,hsl(var(--background))_84%)]" />
    </div>
  );
}
