// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import { useSyncExternalStore } from "react";
import { path } from "~/utils/path";

// Preview on Implementation Hub 2.0: Carbon staff see a person's page as that
// person does, without the editing controls and staff-only detail. The same
// mechanism as Implementation Hub 1.0's preview (`useCustomerPreview`): a
// session cookie scoped to /x/implementation, so the server renders the
// preview too and nothing flashes on hydration.
const COOKIE = "implementationPreviewAsCustomer";
const EVENT = "carbon:implementation:previewAsCustomer";

/** Whether the request carries the preview cookie (for the 2.0 layout's loader). */
export function isImplementationPreview(cookieHeader: string | null): boolean {
  return (cookieHeader ?? "").split(/;\s*/).includes(`${COOKIE}=1`);
}

function read(): boolean {
  return isImplementationPreview(document.cookie);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useImplementationPreview(): boolean {
  const server =
    useRouteData<{ previewAsCustomer?: boolean }>(path.to.implementation)
      ?.previewAsCustomer ?? false;
  return useSyncExternalStore(subscribe, read, () => server);
}

export function setImplementationPreview(on: boolean): void {
  if (typeof window === "undefined") return;
  // No expiry: gone when the browser closes.
  document.cookie = `${COOKIE}=${on ? "1" : ""}; path=${path.to.implementation}; SameSite=Lax${on ? "" : "; max-age=0"}`;
  window.dispatchEvent(new Event(EVENT));
}
