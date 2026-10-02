// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * ScrollReveal — fade + gentle rise as a section enters the viewport, once.
 * Wrap sections to pace a long page.
 *
 * CSS-only via a scroll-driven `animation-timeline: view()` (see `.scroll-reveal`
 * in global.css). No JS and no motion library: the content is in the SSR HTML and
 * visible by default, so it never blocks LCP. Browsers without scroll-timeline
 * (Safari/Firefox) and reduced-motion users just see the final state.
 *
 * Usage in MDX:
 *   <ScrollReveal>
 *   ## Why routings matter
 *   ...
 *   </ScrollReveal>
 */
import type { ReactNode } from "react";

export function ScrollReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`scroll-reveal${className ? ` ${className}` : ""}`}>{children}</div>;
}
