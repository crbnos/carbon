"use client";

/* Click-to-enlarge for guide figures and screenshots. The thumbnail and the
 * fullscreen overlay share a `view-transition-name`, so opening morphs the image up
 * into a centered lightbox and closing morphs it back — the native View Transitions
 * API does the shared-element morph (no animation library). Esc or a backdrop click
 * closes it; body scroll is locked while open. Browsers without View Transitions, and
 * reduced-motion users, get an instant open/close. */

import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { createPortal, flushSync } from "react-dom";

type ViewTransitionLike = { finished?: Promise<unknown>; ready?: Promise<unknown> };
type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => ViewTransitionLike;
};

/** Swallow the benign "transition aborted" rejection (fires on .ready and/or
 *  .finished when a transition is interrupted) so it isn't an unhandled rejection. */
function ignoreAbort(t: ViewTransitionLike | undefined) {
  t?.finished?.catch(() => {});
  t?.ready?.catch(() => {});
}

export function Zoomable({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // True only while a zoom open/close transition is in flight — see `set`.
  const [morphing, setMorphing] = useState(false);
  // useId() contains characters illegal in a CSS ident (":"); strip them.
  const name = `zoom-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => setMounted(true), []);

  // Animate the open/close through a view transition when available; the shared
  // view-transition-name on the thumbnail and the overlay image makes it a morph.
  const set = useCallback((next: boolean) => {
    const doc = document as DocWithVT;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && typeof doc.startViewTransition === "function") {
      // Attach the morph name only for the life of this transition. Left on permanently,
      // the thumbnail is promoted into *every* view transition on the page — including the
      // chapter-nav crossfade — where a named group paints in the top layer, above the
      // fixed header. flushSync commits the name before the API captures the old snapshot.
      flushSync(() => setMorphing(true));
      const t = doc.startViewTransition(() => flushSync(() => setOpen(next)));
      ignoreAbort(t);
      t?.finished?.finally?.(() => setMorphing(false));
    } else {
      setOpen(next);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") set(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, set]);

  return (
    <>
      <button
        type="button"
        onClick={() => set(true)}
        // The morph name is present only mid-transition (and only on the visible one of the
        // pair), so the thumbnail never joins unrelated transitions like the chapter swap.
        style={{ viewTransitionName: morphing && !open ? name : "none", opacity: open ? 0 : 1 }}
        className="group relative block w-full cursor-zoom-in appearance-none border-0 bg-transparent p-0 text-left"
      >
        {/* Accessible name; prefixing keeps any visible caption in the name (Label in Name). */}
        <span className="sr-only">Enlarge: </span>
        {children}
        <span className="pointer-events-none absolute right-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-lg border border-ed-hairline bg-ed-paper/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
              stroke="rgba(38,35,35,0.55)"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-5 md:p-14"
            onClick={() => set(false)}
          >
            {/* Backdrop fades in/out via the root view transition (or instantly without VT). */}
            <div aria-hidden className="absolute inset-0 bg-ed-ink/55 backdrop-blur-[3px]" />
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ viewTransitionName: name }}
              className="relative z-10 max-h-[88vh] w-full max-w-[min(1100px,92vw)] cursor-zoom-out overflow-auto"
            >
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
