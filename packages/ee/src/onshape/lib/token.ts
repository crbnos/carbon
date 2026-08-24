// When an Onshape access token should be treated as expired.
//
// Free of imports on purpose: `client.ts` pulls in `@carbon/env`, which throws
// without the full server environment, so anything that needs a unit test cannot
// live there.

/**
 * Refresh this many seconds BEFORE Onshape's stated expiry.
 *
 * Expiry is checked at the START of a call. A token with four seconds left
 * passes that check and is dead by the time the request lands. Refreshing
 * slightly early costs one extra round trip and removes a whole class of
 * intermittent 401.
 */
const TOKEN_EXPIRY_MARGIN_SECONDS = 120;

/** Used only when Onshape sends no `expires_in`. */
const TOKEN_EXPIRY_FALLBACK_SECONDS = 3600;

/**
 * Both token write sites — the OAuth callback and the refresh — used to store
 * `now + 3600s` and discard the `expires_in` the response carries. When
 * Onshape's real lifetime is shorter than an hour, that stored value is a lie in
 * the dangerous direction: the token dies, Carbon still believes it is valid, so
 * it never refreshes, and every call fails with
 * `401 invalid_token / "Invalid access token"` until the fictional hour is up.
 *
 * Observed live 2026-08-24: a token issued at 15:45 was rejected by 15:55, while
 * the stored expiry claimed 16:45.
 */
export function onshapeTokenExpiresAt(expiresInSeconds?: number): string {
  const lifetime =
    typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds)
      ? expiresInSeconds
      : TOKEN_EXPIRY_FALLBACK_SECONDS;
  // Never produce a moment already behind us, however short the lifetime —
  // that reads as "always expired" and refreshes on every single call.
  const usable = Math.max(lifetime - TOKEN_EXPIRY_MARGIN_SECONDS, 30);
  return new Date(Date.now() + usable * 1000).toISOString();
}
