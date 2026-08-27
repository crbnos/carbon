/**
 * Where the panel keeps its session token in the browser.
 *
 * `sessionStorage` inside the Onshape iframe is partitioned by Onshape's
 * top-level site, so the token is visible only to this panel on this Onshape
 * origin, and it dies with the tab. Every access is guarded: storage can throw
 * in a sandboxed or storage-blocked frame, and the panel must still render.
 */

const STORAGE_KEY = "carbon:onshape-panel-session";

export function getPanelSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setPanelSessionToken(token: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage blocked: the token lives only in React state for this load.
  }
}

export function clearPanelSessionToken() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}

export class PanelUnauthorizedError extends Error {
  constructor() {
    super("Panel session is missing or expired");
    this.name = "PanelUnauthorizedError";
  }
}

/**
 * `fetch` with the panel token as a bearer header. A 401 means the session is
 * gone (expired, revoked, or the stack restarted with an empty Redis): the
 * token is dropped so the panel offers sign-in again.
 */
export async function panelFetch(
  token: string,
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearPanelSessionToken();
    throw new PanelUnauthorizedError();
  }
  return response;
}
