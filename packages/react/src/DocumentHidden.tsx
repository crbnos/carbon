// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect } from "react";

export const DOCUMENT_HIDDEN_ATTRIBUTE = "data-doc-hidden";

/**
 * Radix menus, popovers and dialogs stay mounted after they close until their
 * exit animation ends. A hidden tab (a background tab, or a browser run by
 * automation) runs no animations, so that never happens: the closed layer
 * stays in the DOM and keeps the rest of the page aria-hidden. With no exit
 * animation, Radix Presence unmounts the layer at once. The same holds when
 * the user asks for reduced motion.
 */
export const closedLayerMotionCss = `[${DOCUMENT_HIDDEN_ATTRIBUTE}] [data-state="closed"]{animation:none!important}@media (prefers-reduced-motion: reduce){[data-state="closed"]{animation:none!important}}`;

/** Marks <html> while the tab is hidden. Returns the cleanup. */
export function trackDocumentHidden(doc: Document = document) {
  const sync = () => {
    doc.documentElement.toggleAttribute(
      DOCUMENT_HIDDEN_ATTRIBUTE,
      doc.visibilityState === "hidden"
    );
  };
  sync();
  doc.addEventListener("visibilitychange", sync);
  return () => {
    doc.removeEventListener("visibilitychange", sync);
    doc.documentElement.removeAttribute(DOCUMENT_HIDDEN_ATTRIBUTE);
  };
}

/**
 * Lets closed overlays unmount without waiting for an exit animation when the
 * tab is hidden or motion is reduced. Mount once at the app root.
 */
export function DocumentHiddenMotion() {
  useEffect(() => trackDocumentHidden(), []);
  // Not as a child: the server would escape its quotes to `&quot;`, which a
  // <style> keeps as written, so hydration would fail on every page load.
  return <style dangerouslySetInnerHTML={{ __html: closedLayerMotionCss }} />;
}
