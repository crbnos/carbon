// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback } from "react";
import { useNavigate } from "react-router";

/**
 * Closes a route that renders as a modal or drawer over its parent.
 *
 * Going back keeps the list's filters and scroll position, so that is used
 * whenever this tab has somewhere to go back to. Opened from a link, a new tab
 * or a refresh there is nothing to pop — `navigate(-1)` leaves the app or does
 * nothing — so it goes to the parent route instead.
 */
export function useCloseRoute() {
  const navigate = useNavigate();
  return useCallback(() => {
    // React Router numbers this tab's history entries from 0.
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate("..");
  }, [navigate]);
}
