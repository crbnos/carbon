// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { TooltipProvider } from "@carbon/react";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";

/** Onshape's `theme` parameter sets the mode; light when it is missing. */
export const handle: Handle = {
  hostMode: (searchParams) =>
    searchParams.get("theme")?.toLowerCase() === "dark" ? "dark" : "light"
};

/** Bare shell for pages Onshape frames: no app chrome or navigation. */
export default function OnshapeLayout() {
  return (
    <TooltipProvider>
      {/*
       * Owns the scroll; never `min-h-dvh`. The app shell makes the root element
       * a fixed-height scroller, and opening a Radix Select there snaps it to
       * the top and closes the popup.
       */}
      <div className="isolate flex h-dvh flex-col overflow-hidden bg-card text-foreground antialiased">
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
