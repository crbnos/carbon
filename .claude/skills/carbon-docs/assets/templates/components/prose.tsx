/**
 * Small editorial primitives for the Guide surface.
 *
 * Eyebrow — the small pill above a chapter H1 ("Chapter III"). Register it in
 * mdx-components.tsx and use <Eyebrow> (capitalized — lowercase tags are treated
 * as plain HTML in MDX and won't resolve to a component).
 *
 * Usage in MDX:
 *   <Eyebrow>Chapter III</Eyebrow>
 *   # Run production
 */
import type { ReactNode } from "react";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="not-prose mb-3 inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
