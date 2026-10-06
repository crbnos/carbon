// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { TooltipProvider } from "@carbon/react";
import { Outlet } from "react-router";

/**
 * Bare shell for pages that render inside another product (the Onshape right
 * panel): no app chrome, no navigation, the host supplies both.
 */
export default function OnshapeLayout() {
  return (
    <TooltipProvider>
      {/*
       * A real scroll container, not `min-h-dvh`. The app shell pins
       * `html`/`body` to `h-full` with `overflow-x: hidden`, which makes the
       * ROOT element a fixed-height scroller. Radix's Select does not survive
       * that combination: opening one snapped the document to scrollTop 0 and
       * closed the popup before it could be used. Owning the scroll here keeps
       * the document itself unscrolled, which fixes it and is what lets the
       * panel pin a header and an action bar.
       */}
      <div className="isolate flex h-dvh flex-col overflow-hidden bg-card text-foreground antialiased">
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
