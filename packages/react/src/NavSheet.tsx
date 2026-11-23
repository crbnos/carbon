// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/// <reference path="./css.d.ts" />
// Packages that import @carbon/react typecheck this file in their own program,
// where this package's css.d.ts is not included; the `?inline` imports need it.

"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { BottomSheet as SpringSheet } from "react-spring-bottom-sheet";
import libraryCss from "react-spring-bottom-sheet/dist/style.css?inline";

import { ClientOnly } from "./ClientOnly";
import navSheetCss from "./nav-sheet.css?inline";
import { cn } from "./utils/cn";

/**
 * The sheet's styles, rendered by React next to the sheet. A plain CSS import
 * becomes a <style> the bundler adds to <head> outside React; when hydration
 * fails React re-renders the whole document and drops it, leaving an open
 * sheet with no styles: drawn off-screen while its focus trap blocks every
 * tap on the page. The library's rules come first so Carbon's win.
 */
const sheetCss = `${libraryCss}\n${navSheetCss}`;

/**
 * The phone's navigation sheet, on react-spring-bottom-sheet: it follows the
 * finger, springs between heights and is dismissed by a drag down, a tap on
 * the backdrop or Escape. It fits its content up to 90% of the screen; a
 * longer list scrolls inside it.
 */
function NavSheet({
  open,
  onOpenChange,
  header,
  sibling,
  scrollLocking = true,
  trapFocus = true,
  className,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sticky above the scrolling content, under the drag handle. */
  header?: ReactNode;
  /**
   * Drawn beside the sheet, over its backdrop, inside its focus trap: a
   * full-screen layer such as a finder.
   */
  sibling?: ReactNode;
  /**
   * Locks touch scrolling to the sheet's content. Turn it off while a
   * `sibling` has its own scrolling list, or that list cannot scroll on iOS.
   */
  scrollLocking?: boolean;
  /**
   * Keeps focus and taps inside the sheet. The trap swallows taps on
   * anything portaled outside it (a combobox's options, a select's list),
   * so turn it off while the sheet shows a form with one; it comes back on
   * the next opening.
   */
  trapFocus?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // Opening focuses this rather than the first button, as phone sheets do,
  // so no focus ring lights up a row the user has not touched.
  const focusAnchor = useRef<HTMLSpanElement>(null);
  // Closing a sibling layer unmounts what had focus; bring it back into the
  // sheet, where Escape and the focus trap expect it.
  const hasSibling = Boolean(sibling);
  useEffect(() => {
    if (open && !hasSibling) focusAnchor.current?.focus();
  }, [open, hasSibling]);
  return (
    <ClientOnly fallback={null}>
      {() => (
        <>
          <style>{sheetCss}</style>
          <SpringSheet
            open={open}
            onDismiss={() => onOpenChange(false)}
            header={
              <>
                <span ref={focusAnchor} tabIndex={-1} className="sr-only" />
                {header}
              </>
            }
            sibling={sibling}
            scrollLocking={scrollLocking}
            initialFocusRef={trapFocus ? focusAnchor : false}
            snapPoints={({ minHeight, maxHeight }) =>
              Math.min(minHeight, maxHeight * 0.9)
            }
            className={cn("nav-sheet", className)}
          >
            {children}
          </SpringSheet>
        </>
      )}
    </ClientOnly>
  );
}

export { NavSheet };
