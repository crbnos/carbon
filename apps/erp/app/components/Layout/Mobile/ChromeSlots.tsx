// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, useViewport } from "@carbon/react";
import type { ReactNode } from "react";
import { Children, useEffect, useState } from "react";
import { createPortalSlot } from "./slots";

/**
 * Pages put controls into the compact app bar and bottom bar through these
 * slots, so the shell needs no props. Desktop renders nothing.
 */
const appBarActionsSlot = createPortalSlot();
const bottomBarSlot = createPortalSlot();

/** Where <AppBarActions> render: the right of the compact app bar. */
export const AppBarActionsTarget = appBarActionsSlot.Target;

/** True while any <BottomBar> is mounted; the dock hides then. */
export const useBottomBarActive = bottomBarSlot.useFilled;

const MAX_APP_BAR_ACTIONS = 2;

/** Up to two controls on the right of the compact app bar. */
export function AppBarActions({ children }: { children: ReactNode }) {
  if (
    process.env.NODE_ENV !== "production" &&
    Children.count(children) > MAX_APP_BAR_ACTIONS
  ) {
    // biome-ignore lint/suspicious/noConsole: dev-only authoring warning
    console.warn("[AppBarActions] the app bar holds at most 2 actions");
  }
  return <appBarActionsSlot.Fill>{children}</appBarActionsSlot.Fill>;
}

/** A compact bottom bar (action bar or bulk bar) that replaces the dock. */
export const BottomBar = bottomBarSlot.Fill;

/** A page's phone action bar: its buttons in one row, in place of the dock. */
export function PhoneActionBar({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <BottomBar>
      <div
        className={cn(
          "flex items-center gap-2 border-t border-border bg-card px-4 pt-2 pb-safe-4",
          className
        )}
      >
        {children}
      </div>
    </BottomBar>
  );
}

/**
 * Publish an element's height as a CSS variable on <html> while compact, so
 * the app's existing `calc(100dvh - var(--…))` frames fit between the bars.
 * Removed on desktop, where the stylesheet values apply unchanged.
 */
export function useCompactCssVar(
  name: "--header-height" | "--hero-height" | "--content-inset",
  element: HTMLElement | null
) {
  const { isPhone } = useViewport();
  useEffect(() => {
    if (!isPhone || !element) return;
    const root = document.documentElement;
    const write = () =>
      root.style.setProperty(
        name,
        `${element.getBoundingClientRect().height}px`
      );
    write();
    const observer = new ResizeObserver(write);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(name);
    };
  }, [isPhone, element, name]);
}

/**
 * The shell's bottom chrome: the target for <BottomBar> and the dock. Its
 * height becomes `--content-inset`, so full-height pages end above it.
 */
export function MobileBottomChrome({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useCompactCssVar("--content-inset", element);
  return (
    <div ref={setElement} className="md:hidden shrink-0">
      <bottomBarSlot.Target className="empty:hidden" />
      {children}
    </div>
  );
}
