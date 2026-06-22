"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Reset window scroll to the top on every forward route change.
 *
 * Next's App Router scroll-to-top is suppressed by the global
 * `html { scroll-behavior: smooth }` (app/global.css) — the Guide relies on that
 * rule for its anchor glides, so we restore the cross-page reset here instead of
 * dropping it. Pointer-driven sidebar/nav clicks now land at the top of the new
 * page.
 *
 * - Hash links (`/docs/x#section`) are left alone so anchors land on their target.
 * - Back/forward keeps the browser's restored position (popstate guard), so
 *   returning to a page doesn't yank you back to the top.
 * - In-page TOC clicks only change the hash, not the pathname, so they never fire.
 */
export function ScrollToTop() {
  const pathname = usePathname();
  const poppedRef = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      poppedRef.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (poppedRef.current) {
      poppedRef.current = false;
      return;
    }
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return null;
}
