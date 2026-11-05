// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { hasOpenDialog } from "./utils/dialog";
import { isEditableTarget } from "./utils/keyboard";

export type RouteChange = {
  previousPath: string;
  nextPath: string;
  /** A dialog (a route rendered as a modal or drawer) is open after the change. */
  dialogOpen: boolean;
  /** A dialog route was open after the previous change. */
  dialogWasOpen: boolean;
};

/**
 * What a client-side navigation tells assistive technology. A new page is
 * announced by its title and takes focus at its heading. A route that opens a
 * modal or drawer leaves both to the dialog, and closing one back to the page
 * behind it leaves focus where the dialog returns it.
 */
export function routeChangeAction({
  previousPath,
  nextPath,
  dialogOpen,
  dialogWasOpen
}: RouteChange): { announce: boolean; moveFocus: boolean } {
  if (previousPath === nextPath) return { announce: false, moveFocus: false };
  if (dialogOpen) return { announce: false, moveFocus: false };
  const backToPageBehindDialog =
    dialogWasOpen && previousPath.startsWith(`${nextPath.replace(/\/$/, "")}/`);
  return { announce: true, moveFocus: !backToPageBehindDialog };
}

function focusPageStart() {
  const target =
    document.querySelector<HTMLElement>("main h1") ??
    document.querySelector<HTMLElement>("h1") ??
    document.querySelector<HTMLElement>("main");
  if (!target) return;
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    // Focus lands here for screen readers and keyboard users; it is not a
    // control, so it draws no focus ring.
    target.style.outline = "none";
  }
  target.focus({ preventScroll: true });
}

/**
 * Announces client-side page changes and moves focus to the new page, which a
 * full page load does on its own and a React Router navigation does not.
 * Mount once at the app root, inside the router. Only a pathname change counts:
 * search-param changes (filters, sorting, tabs kept in the query) do not.
 */
export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const previousPath = useRef<string | null>(null);
  const dialogWasOpen = useRef(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    // The first load is announced by the browser itself.
    if (previous === null) return;

    // Wait a frame so the new page's <title>, heading and any dialog it
    // opens are in the DOM.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const dialogOpen = hasOpenDialog();
        const action = routeChangeAction({
          previousPath: previous,
          nextPath: pathname,
          dialogOpen,
          dialogWasOpen: dialogWasOpen.current
        });
        dialogWasOpen.current = dialogOpen;
        if (action.announce) {
          // Cleared first so the same title twice in a row is still read.
          setMessage("");
          timer = setTimeout(() => setMessage(document.title), 50);
        }
        if (action.moveFocus && !isEditableTarget(document.activeElement)) {
          focusPageStart();
        }
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [pathname]);

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
