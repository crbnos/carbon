"use client";

/**
 * ReadingProgress — the right-edge tick ruler that fills as the reader scrolls.
 * Mount once in the Guide layout (not inside MDX). Hidden below lg.
 *
 * Design intent: make the page's length *finite and visible*. A reader who can
 * see they're 40% through keeps going. See references/design-language.md.
 */
import { motion, useScroll, useTransform } from "framer-motion";

const TICKS = 32;

function Ticks({ className }: { className?: string }) {
  return (
    <div className={`flex h-full flex-col justify-between ${className ?? ""}`}>
      {Array.from({ length: TICKS }).map((_, i) => (
        <span key={i} className="h-px w-3 rounded-full bg-current" />
      ))}
    </div>
  );
}

export function ReadingProgress() {
  const { scrollYProgress } = useScroll();
  // Reveal the brand-colored copy of the ruler from the top down to scroll depth.
  const height = useTransform(scrollYProgress, (v) => `${Math.min(Math.max(v, 0), 1) * 100}%`);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed right-5 top-1/2 z-30 hidden h-56 -translate-y-1/2 lg:block"
    >
      <div className="relative h-full">
        {/* Base ticks (inactive) */}
        <Ticks className="text-border" />
        {/* Accent overlay clipped to scroll progress; inner copy is full-height so ticks align */}
        <motion.div className="absolute inset-x-0 top-0 overflow-hidden text-brand" style={{ height }}>
          <div className="h-56">
            <Ticks className="text-brand" />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
