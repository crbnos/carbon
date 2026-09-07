/**
 * The message an OAuth callback rendered inside a popup posts to the
 * integrations page that opened it (see `oauth-popup.server.ts` for the page
 * and `IntegrationCard` for the listener). Client-safe: no server imports.
 */

export const OAUTH_POPUP_MESSAGE = "app_oauth_result" as const;

/** What the callback decided; `error` is a code from `integration-errors`. */
export type OAuthPopupOutcome = {
  /** The integration id (`Onshape.id`, …) the result belongs to. */
  integration: string;
} & ({ ok: true } | { ok: false; error: string });

export type OAuthPopupResult = {
  type: typeof OAUTH_POPUP_MESSAGE;
} & OAuthPopupOutcome;

export function isOAuthPopupResult(data: unknown): data is OAuthPopupResult {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Record<string, unknown>;
  return (
    message.type === OAUTH_POPUP_MESSAGE &&
    typeof message.integration === "string" &&
    typeof message.ok === "boolean"
  );
}
