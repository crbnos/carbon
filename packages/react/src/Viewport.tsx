// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Viewport } from "@carbon/utils";
import { PHONE_QUERY, TABLET_QUERY, viewportHintCookie } from "@carbon/utils";
import type { ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore
} from "react";

type ViewportProviderProps = {
  /** Server hint (cookie or user agent), used until the media queries are read. */
  initialViewport: Viewport;
  children: ReactNode;
};

const Context = createContext<Viewport | null>(null);

const readViewport = (): Viewport => {
  if (window.matchMedia(PHONE_QUERY).matches) return "phone";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
};

const subscribe = (onChange: () => void) => {
  const queries = [PHONE_QUERY, TABLET_QUERY].map((q) => window.matchMedia(q));
  for (const mql of queries) mql.addEventListener("change", onChange);
  return () => {
    for (const mql of queries) mql.removeEventListener("change", onChange);
  };
};

const noSubscription = () => () => undefined;

/**
 * Reads the viewport once for the whole tree, so every consumer sees the same
 * size in a render: a menu root and its trigger read separately could disagree
 * mid-resize and render a phone root around a desktop trigger. Seeds the first
 * render with the server's hint and records each change in the hint cookie.
 */
export const ViewportProvider = ({
  initialViewport,
  children
}: ViewportProviderProps) => {
  const viewport = useSyncExternalStore(
    subscribe,
    readViewport,
    () => initialViewport
  );

  useEffect(() => {
    const write = () => {
      document.cookie = viewportHintCookie(readViewport());
    };
    write();
    return subscribe(write);
  }, []);

  return <Context.Provider value={viewport}>{children}</Context.Provider>;
};

/**
 * The viewport size as three booleans, exactly one of them true. Use it only
 * where the component tree must change; style-only changes use `max-md:`
 * (phone) or `md:max-lg:` (tablet). Without a provider the server render is
 * desktop.
 */
export function useViewport(): {
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
} {
  const provided = useContext(Context);
  // Without a provider (tests, embeds), read the media queries directly.
  const own = useSyncExternalStore(
    provided ? noSubscription : subscribe,
    provided ? () => provided : readViewport,
    () => provided ?? "desktop"
  );
  const viewport = provided ?? own;
  return useMemo(
    () => ({
      isPhone: viewport === "phone",
      isTablet: viewport === "tablet",
      isDesktop: viewport === "desktop"
    }),
    [viewport]
  );
}

/*
 * Phones never move focus on their own: focusing a text field pops the
 * keyboard over the page. These two hooks are the one place that rule lives.
 */

export function usePhoneAutoFocus(autoFocus: boolean | undefined) {
  return useViewport().isPhone ? false : autoFocus;
}

/**
 * A Radix `onOpenAutoFocus` that skips the first focus on phones and then
 * runs the caller's own handler.
 */
export function usePhoneOpenAutoFocus(handler?: (event: Event) => void) {
  const { isPhone } = useViewport();
  return (event: Event) => {
    if (isPhone) event.preventDefault();
    handler?.(event);
  };
}

/**
 * Phones: a 44x44 tap target around a smaller control. A child element rather
 * than the control's ::after, which already draws the focus ring. Place it
 * first inside a `relative` control; it renders `display: none` elsewhere.
 */
export const HitArea = () => (
  <span
    aria-hidden
    className="hidden max-md:absolute max-md:m-0 max-md:block max-md:-inset-[max(0px,calc((44px-100%)/2))]"
  />
);
