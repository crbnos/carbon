// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useIsomorphicLayoutEffect } from "@carbon/react";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useUIStore } from "~/stores/ui";
import { path } from "~/utils/path";

const preferencesKey = (identity: string) => `carbon:navigation:${identity}`;
const lastPageKey = (identity: string) => `carbon:lastPage:${identity}`;

function stablePagePath(pathname: string) {
  const manualPegging = pathname.match(
    /^\/x\/project\/([^/]+)\/pegging\/manual$/
  );
  if (manualPegging) return path.to.projectPegging(manualPegging[1]);

  const stockTransferScan = pathname.match(
    /^\/x\/stock-transfer\/([^/]+)\/scan\/[^/]+$/
  );
  if (stockTransferScan) return path.to.stockTransfer(stockTransferScan[1]);

  return pathname;
}

function readLastPage(identity: string): string | null {
  try {
    const saved = window.localStorage.getItem(lastPageKey(identity));
    if (!saved) return null;
    const url = new URL(saved, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      (url.pathname !== path.to.authenticatedRoot &&
        !url.pathname.startsWith(`${path.to.authenticatedRoot}/`))
    ) {
      return null;
    }
    const tab = url.searchParams.get("tab");
    const search = tab ? `?${new URLSearchParams({ tab })}` : "";
    return `${stablePagePath(url.pathname)}${search}`;
  } catch {
    return null;
  }
}

/** Browser-only navigation preferences, scoped to the current user and company. */
export function usePersistentNavigation(
  userId: string | null | undefined,
  companyId: string | null | undefined,
  enabled: boolean
) {
  const location = useLocation();
  const navigate = useNavigate();
  const restoredFor = useRef<string | null>(null);
  const identity = userId && companyId ? `${userId}:${companyId}` : null;

  // The server and first hydration render use the same defaults. Apply the
  // browser preference before the first paint, including on company changes.
  useIsomorphicLayoutEffect(() => {
    if (!enabled || !identity) return;
    try {
      const saved = window.localStorage.getItem(preferencesKey(identity));
      const preferences = saved ? JSON.parse(saved) : null;
      useUIStore.setState({
        isRailOpen:
          typeof preferences?.railOpen === "boolean"
            ? preferences.railOpen
            : false,
        isSidebarOpen:
          typeof preferences?.sidebarOpen === "boolean"
            ? preferences.sidebarOpen
            : true
      });
    } catch {
      // Storage can be unavailable; the in-memory defaults still work.
    }

    return useUIStore.subscribe((state, previous) => {
      if (
        state.isRailOpen === previous.isRailOpen &&
        state.isSidebarOpen === previous.isSidebarOpen
      ) {
        return;
      }
      try {
        window.localStorage.setItem(
          preferencesKey(identity),
          JSON.stringify({
            railOpen: state.isRailOpen,
            sidebarOpen: state.isSidebarOpen
          })
        );
      } catch {
        // Keep the current interaction even when persistence is unavailable.
      }
    });
  }, [enabled, identity]);

  useEffect(() => {
    if (!enabled || !identity) return;
    if (restoredFor.current !== identity) {
      restoredFor.current = identity;
      if (location.pathname === path.to.authenticatedRoot) {
        const saved = readLastPage(identity);
        if (saved && saved !== path.to.authenticatedRoot) {
          navigate(saved, { replace: true });
          return;
        }
      }
    }

    if (!location.pathname.startsWith(`${path.to.authenticatedRoot}/`)) {
      return;
    }
    const tab = new URLSearchParams(location.search).get("tab");
    const search = tab ? `?${new URLSearchParams({ tab })}` : "";
    try {
      window.localStorage.setItem(
        lastPageKey(identity),
        `${stablePagePath(location.pathname)}${search}`
      );
    } catch {
      // Browsing still works without local storage.
    }
  }, [enabled, identity, location.pathname, location.search, navigate]);
}
