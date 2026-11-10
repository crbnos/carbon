// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The panel token lives in `sessionStorage`, partitioned by Onshape's top-level
 * site and gone with the tab. Every access is guarded: storage throws in a
 * sandboxed or storage-blocked frame and the panel must still render.
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
 * Long because Onshape builds an assembly's BOM on first request; finite so a
 * stalled read shows a message and Refresh.
 */
export const PANEL_FETCH_TIMEOUT_MS = 60_000;

export class PanelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Carbon didn't answer within ${timeoutMs / 1000} seconds. It may still be working; try Refresh in a moment.`
    );
    this.name = "PanelTimeoutError";
  }
}

/**
 * Bearer `fetch`. A 401 drops the token so the panel offers sign-in again.
 * `timeoutMs: null` waits indefinitely, for pushes that keep writing anyway.
 */
export async function panelFetch(
  token: string,
  input: string,
  init: RequestInit = {},
  timeoutMs: number | null = PANEL_FETCH_TIMEOUT_MS
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const controller = new AbortController();
  const caller = init.signal;
  const abortForCaller = () => controller.abort();
  if (caller?.aborted) controller.abort();
  caller?.addEventListener("abort", abortForCaller);
  const timer =
    timeoutMs === null ? null : setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers,
      signal: controller.signal
    });
  } catch (error) {
    // Only our own abort is a timeout; a caller's cancellation stays theirs.
    if (timeoutMs !== null && controller.signal.aborted && !caller?.aborted) {
      throw new PanelTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    caller?.removeEventListener("abort", abortForCaller);
  }

  if (response.status === 401) {
    clearPanelSessionToken();
    throw new PanelUnauthorizedError();
  }
  return normalizeErrorBody(response);
}

export const PANEL_FORBIDDEN_MESSAGE =
  "Your Carbon account doesn't have permission for this. Ask an admin in Carbon to grant it.";

/**
 * Callers read a failure as `{ error }` JSON; a 403 (plain-text "Forbidden")
 * or a gateway's HTML page is rewritten to that shape.
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
