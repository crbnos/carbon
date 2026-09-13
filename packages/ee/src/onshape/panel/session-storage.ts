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
  return normalizeErrorBody(response);
}

/** Copy a permission denial can carry, whatever the server's body said. */
export const PANEL_FORBIDDEN_MESSAGE =
  "Your Carbon account doesn't have permission for this. Ask an admin in Carbon to grant it.";

/**
 * Every caller reads a failed response as `{ error }` JSON, and two kinds of
 * failure are not JSON: a permission denial (`requirePermissions` throws a
 * plain-text "Forbidden") and anything a gateway or the framework answers with
 * an HTML page. `response.json()` then threw, the catch rendered the parser's
 * own message, and a user without a permission saw
 * `Unexpected token 'F', "Forbidden" is not valid JSON` in every section.
 *
 * Normalising here fixes all eleven call sites at once instead of teaching each
 * to parse defensively. A successful response is never touched.
 */
async function normalizeErrorBody(response: Response): Promise<Response> {
  if (response.ok) return response;
  const isJson = (response.headers.get("Content-Type") ?? "").includes(
    "application/json"
  );
  if (response.status !== 403 && isJson) return response;

  const error =
    response.status === 403
      ? PANEL_FORBIDDEN_MESSAGE
      : `Carbon returned an unexpected response (HTTP ${response.status}). Try again.`;
  return new Response(JSON.stringify({ error, status: response.status }), {
    status: response.status,
    headers: { "Content-Type": "application/json" }
  });
}
