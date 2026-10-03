// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import { useSyncExternalStore } from "react";
import { path } from "~/utils/path";

// Customer preview lets an internal Carbon user render the hub as the customer
// sees it — carbon-only pages hidden, carbon-owned fields locked.
//
// It lives in a session cookie scoped to the hub, not sessionStorage: the
// server has to know it too. Rendered without it, a reload painted the staff
// view first and swapped to the preview on hydration — the internal pages and
// the bar flashed, and the page moved.
const COOKIE = "hubPreviewAsCustomer";
const EVENT = "carbon:hub:previewAsCustomer";

/** Whether the request carries the preview cookie (for the hub's loader). */
export function isCustomerPreview(cookieHeader: string | null): boolean {
  return (cookieHeader ?? "").split(/;\s*/).includes(`${COOKIE}=1`);
}

function read(): boolean {
  return isCustomerPreview(document.cookie);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useCustomerPreview(): boolean {
  const server =
    useRouteData<{ previewAsCustomer?: boolean }>(path.to.getStarted)
      ?.previewAsCustomer ?? false;
  return useSyncExternalStore(subscribe, read, () => server);
}

export function setCustomerPreview(on: boolean): void {
  if (typeof window === "undefined") return;
  // No expiry: gone when the browser closes, like the sessionStorage flag was.
  document.cookie = `${COOKIE}=${on ? "1" : ""}; path=${path.to.getStarted}; SameSite=Lax${on ? "" : "; max-age=0"}`;
  window.dispatchEvent(new Event(EVENT));
}
