"use client";

import { useEffect, useRef, type ReactNode } from "react";

/* Reveals each `[data-reveal]` row as it scrolls in, once.
 *
 * Deliberately not the site's `.scroll-reveal` (`animation-timeline: view()`): that is
 * Chrome-only, so Safari and Firefox would see nothing at all on a public page.
 *
 * Content ships visible in the SSR HTML and is only hidden here, after mount, for rows
 * that are BELOW the fold — so nothing on screen can flash, LCP is untouched, and
 * readers with JS off or reduced motion on simply get the finished state. */
export function ChangelogReveal({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          delete (entry.target as HTMLElement).dataset.pending;
          observer.unobserve(entry.target);
        }
      },
      // Fire a little before the row's top edge lands, so it is settled by the time
      // it is comfortably readable.
      { rootMargin: "0px 0px -10% 0px" }
    );

    for (const el of host.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (el.getBoundingClientRect().top >= window.innerHeight) {
        el.dataset.pending = "";
        observer.observe(el);
      }
    }

    return () => observer.disconnect();
  }, []);

  return <div ref={root}>{children}</div>;
}

/* Fills the timeline spine to scroll depth on an entry page — the spine is already a
 * track, so it doubles as "how far through am I".
 *
 * The site's `.reading-progress-fill` would have been the obvious reuse, but it is driven
 * by `animation-timeline: scroll()` and is inert in every browser today (verified: its
 * timeline currentTime is null and the fill never leaves 0). This animates `scaleY`
 * rather than that class's `height`, so it stays on the compositor. */
export function ChangelogSpineProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.transform = `scaleY(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    // Coalesce to one write per frame; scroll fires far faster than we can paint.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // Collapsed until JS runs, so no-JS and reduced-motion readers get a plain spine.
  // The initial state is an inline `transform`, not Tailwind's `scale-y-0`: that utility
  // compiles to the standalone `scale` property in v4, which composes on top of
  // `transform` and would multiply every update back to zero.
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ transform: "scaleY(0)" }}
      className="absolute inset-0 origin-top bg-ed-brand-ink/45"
    />
  );
}
