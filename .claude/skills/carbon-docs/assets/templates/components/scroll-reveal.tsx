"use client";

/**
 * ScrollReveal — fade + gentle rise as a section enters the viewport, once.
 * Wrap Guide sections to pace a long page. Honors prefers-reduced-motion:
 * when the user opts out, it renders the final state with no animation.
 *
 * Usage in MDX:
 *   <ScrollReveal>
 *   ## Why routings matter
 *   ...
 *   </ScrollReveal>
 */
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export function ScrollReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
