"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

// A scroll-reveal wrapper (framer-motion). Fades and rises the first time it
// enters the viewport, then stays put. Anyone with reduced-motion set gets the
// content immediately, with no animation. Used on the landing page only.
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: [0.22, 0.8, 0.24, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
