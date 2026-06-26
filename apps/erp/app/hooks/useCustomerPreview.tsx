import { useSyncExternalStore } from "react";

// Customer preview lets an internal Carbon user render the hub as the customer
// sees it — carbon-only pages hidden, carbon-owned fields locked. Persisted in
// sessionStorage so it survives navigation + reloads within the tab/session
// (scoped to that session, not leaked across tabs or restarts).
const KEY = "carbon:hub:previewAsCustomer";
// sessionStorage fires no `storage` event in the same tab, so the setter
// broadcasts this custom event to sync every live hook instance.
const EVENT = "carbon:hub:previewAsCustomer";

function read(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(KEY) === "1";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useCustomerPreview(): boolean {
  // Server snapshot is always false — preview is a client-only, internal-only view.
  return useSyncExternalStore(subscribe, read, () => false);
}

export function setCustomerPreview(on: boolean): void {
  if (typeof window === "undefined") return;
  if (on) window.sessionStorage.setItem(KEY, "1");
  else window.sessionStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}
