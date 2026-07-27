"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Button } from "@/shared/ui/button";
import { ProductFrame } from "./product-frame";
import { ParticleField } from "./particle-field";
import { Mark } from "./site-nav";

// ════════════════════════════════════════════════════════════════════════════
// The hero — a full-bleed poster, not a document.
//
// It runs edge to edge (no inherited page gutter, no shared max-width); only the
// inner text column is constrained. The brand wordmark is the loudest element,
// the headline second. The real anchor is the product itself: ProductFrame is
// pulled up large and cropped into the first viewport, and a scroll-linked sticky
// moment scales it up while the text recedes. ParticleField is only texture.
//
// The whole motion track is scroll-driven (useScroll) and collapses to a static
// frame for anyone with reduced-motion set.
// ════════════════════════════════════════════════════════════════════════════

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  // 0 at the top of the hero, 1 once we've scrolled one section past it. Drives
  // both the parallax scale on the product frame and the sticky text hand-off.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const frameScale = useTransform(scrollYProgress, [0, 1], [0.94, 1.12]);
  const frameY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 0.5], [0, -48]);

  return (
    // Full-bleed. The extra height below the sticky stage is the scroll distance
    // the sticky moment plays out over.
    <section ref={ref} className="relative isolate border-b pb-[42vh] md:pb-[48vh]">
      {/* Decorative texture + a single brand-tinted glow. Not the anchor. */}
      <ParticleField />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--brand)/0.14),transparent_70%)]"
      />

      {/* Sticky stage — fills the first viewport (minus the 64px sticky nav). */}
      <div className="sticky top-16 flex min-h-[calc(100svh-4rem)] flex-col overflow-hidden">
        <motion.div
          style={reduce ? undefined : { opacity: textOpacity, y: textY }}
          className="mx-auto w-full max-w-3xl px-6 pt-10 text-center md:pt-14"
        >
          {/* Brand — the loudest thing on the screen. */}
          <div className="flex items-center justify-center gap-3">
            <Mark className="size-9 md:size-11" />
            <span className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">
              SWAMP
            </span>
          </div>

          <Link
            href="/auth/register"
            className="group mt-6 inline-flex items-center gap-2 rounded-full border bg-background/60 py-1 pl-1.5 pr-3 text-[12.5px] transition-colors hover:bg-background"
          >
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">
              Beta
            </span>
            <span className="text-muted-foreground">Free, and open source</span>
            <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          {/* The one H1, headline second in weight to the brand. */}
          <h1 className="mt-5 font-display text-3xl font-extrabold leading-[1.06] tracking-tight md:text-5xl">
            The shared database your team can{" "}
            <span className="text-brand">actually use</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-muted-foreground md:text-[17px]">
            Import a spreadsheet and get a real database — linked tables, roles,
            comments and share links, live in the browser.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-12 w-full gap-2 bg-brand px-7 text-[15px] text-brand-foreground hover:bg-brand/90 focus-visible:ring-brand sm:w-auto"
            >
              <Link href="/auth/register">
                Start free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 w-full px-7 text-[15px] sm:w-auto"
            >
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>
        </motion.div>

        {/* The anchor. Large, cropped by the stage's bottom edge, and scaled on
            scroll. It's the honest hero image for a data product. */}
        <motion.div
          style={reduce ? undefined : { scale: frameScale, y: frameY }}
          className="mx-auto mt-10 w-full max-w-6xl flex-1 px-4 md:mt-12 md:px-6"
        >
          <ProductFrame className="origin-top shadow-2xl shadow-black/10 dark:shadow-black/50" />
        </motion.div>
      </div>
    </section>
  );
}
