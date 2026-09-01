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
       * A real scroll container, not `min-h-dvh`. The host gives this page a
       * short, narrow viewport, so the content is almost always taller than it
       * — and the app shell pins `html`/`body` to `h-full` with
       * `overflow-x: hidden`, which makes the ROOT element a fixed-height
       * scroller. Radix's Select does not survive that combination: opening one
       * snapped the document to scrollTop 0 and closed the popup before it
       * could be used (verified live in the Onshape panel). Owning the scroll
       * here keeps the document itself unscrolled, which fixes it and is what
       * lets the panel pin a header and an action bar.
       */}
      <div className="isolate flex h-dvh flex-col overflow-hidden bg-background text-foreground antialiased">
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
