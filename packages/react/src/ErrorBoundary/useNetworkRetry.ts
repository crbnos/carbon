// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect } from "react";
import { isRouteErrorResponse } from "react-router";
import { useRevalidator } from "../hooks/useRevalidator";
import { isNetworkError } from "./routeErrorCopy";

/**
 * A boundary showing a network failure reloads the page's data when the
 * browser comes back online or the tab is shown again. A background tab hits
 * this on its own: a timer's request lands while the laptop sleeps or the
 * connection drops. A successful reload clears the error, so the page returns
 * without a full reload.
 */
export function useNetworkRetry(error: unknown) {
  const { revalidate } = useRevalidator();
  const offline = isNetworkError(error);

  useEffect(() => {
    if (!offline) return;
    const retry = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [offline, revalidate]);

  // A 503 that is not maintenance is a service restarting under a deploy:
  // ask again every few seconds, so the page comes back without a click.
  const unavailable = isUnavailable(error);
  useEffect(() => {
    if (!unavailable) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [unavailable, revalidate]);

  return { offline, unavailable, retry: revalidate };
}

export function isUnavailable(error: unknown) {
  return (
    isRouteErrorResponse(error) &&
    error.status === 503 &&
    error.data?.message !== "maintenance"
  );
}
