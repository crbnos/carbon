// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { COMPACT_QUERY, compactHintCookie } from "@carbon/utils";
import type { ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore
} from "react";

type CompactProviderProps = {
  /** Server hint (cookie or user agent), used until the media query is read. */
  initialCompact: boolean;
  children: ReactNode;
};

/**
 * Opts the app into the compact (phone) layout. The CSS half of the opt-in is
 * `data-compact-ui` on <html>; set both.
 */
const Context = createContext<{ initialCompact: boolean } | null>(null);

export const CompactProvider = ({
  initialCompact,
  children
}: CompactProviderProps) => {
  // Record the viewport (and every breakpoint crossing) in the hint cookie, so
  // the next request renders the right layout on the server.
  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY);
    const write = () => {
      document.cookie = compactHintCookie(mql.matches);
    };
    write();
    mql.addEventListener("change", write);
    return () => mql.removeEventListener("change", write);
  }, []);

  return (
    <Context.Provider value={{ initialCompact }}>{children}</Context.Provider>
  );
};

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(COMPACT_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

const getSnapshot = () => window.matchMedia(COMPACT_QUERY).matches;

/** Viewport below md, regardless of the compact opt-in. */
export function useIsMobile(): boolean {
  const context = useContext(Context);
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => context?.initialCompact ?? false
  );
}

/**
 * True when the app opted into the compact layout and the viewport is below
 * md. Use it only where the component tree must change; style-only changes
 * use the `compact:` variant. False without a provider.
 */
export function useCompact(): boolean {
  const isMobile = useIsMobile();
  return useContext(Context) !== null && isMobile;
}

/**
 * Phones: a 44x44 tap target around a smaller control. A child element rather
 * than the control's ::after, which already draws the focus ring. Place it
 * first inside a `relative` control; it renders `display: none` elsewhere.
 */
export const HitArea = () => (
  <span
    aria-hidden
    className="hidden compact:absolute compact:m-0 compact:block compact:-inset-[max(0px,calc((44px-100%)/2))]"
  />
);
