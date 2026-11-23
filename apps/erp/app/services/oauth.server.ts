// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// OAuth 2.0 authorization-server rules shared by `/register` and `/authorize`.

import type { Permission } from "@carbon/auth";

// The only scope the MCP resource advertises (`/.well-known/oauth-protected-resource`).
// A token carries no permissions of its own: every MCP call is gated on the
// authorizing user's live permissions in the token's company.
const SUPPORTED_SCOPES = new Set(["mcp:tools"]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
  "ftp:",
  "ws:",
  "wss:"
]);

/**
 * A redirect URI a client may register (RFC 8252 / OAuth 2.1): https anywhere,
 * http only to a loopback address (a native client's local listener), or a
 * private-use scheme (`cursor://…`). Never a fragment, and never a scheme a
 * browser executes or reads locally.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash || raw.includes("#")) return false;
  if (url.username || url.password) return false;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  // A private-use scheme is reverse-DNS by convention (`com.example.app:`);
  // require at least a dot or a host so `foo:bar` is not accepted.
  return url.host !== "" || url.protocol.includes(".");
}

/**
 * Whether `redirectUri` may receive a code for a client: registered by it, and
 * still allowed today. The second test covers clients registered before
 * `isAllowedRedirectUri` existed, whose stored URIs were never checked.
 */
export function isRegisteredRedirectUri(
  registered: readonly string[],
  redirectUri: string | null
): redirectUri is string {
  return (
    redirectUri !== null &&
    registered.includes(redirectUri) &&
    isAllowedRedirectUri(redirectUri)
  );
}

/** The requested scopes this server supports; unknown ones are dropped, as
 *  RFC 7591 lets a server do. */
export function supportedScope(scope: string | null | undefined) {
  const granted = (scope ?? "")
    .split(/\s+/)
    .filter((s) => SUPPORTED_SCOPES.has(s));
  return granted.length > 0 ? [...new Set(granted)].join(" ") : null;
}

/**
 * Whether a user may authorize a connector for `companyId`: an employee there
 * holding `settings_update` in THAT company. The token acts in the company it
 * names, so the check cannot be the session's active company.
 */
export function canAuthorizeForCompany(
  membership: { companyId: string; role: string },
  permissions: Record<string, Permission>
): boolean {
  return (
    membership.role === "employee" &&
    (permissions.settings?.update.includes(membership.companyId) ?? false)
  );
}

export const ACCESS_TOKEN_TTL_MS = 3600 * 1000;
// A refresh token not used for this long is dead. Every refresh pushes
// `expiresAt` an hour out, so `expiresAt` + this is the idle deadline — no
// separate column. A connector in use refreshes hourly and never meets it.
const REFRESH_TOKEN_IDLE_MS = 30 * 24 * 3600 * 1000;

/** Whether a refresh token whose access token expires at `expiresAt` has sat
 *  unused past the idle limit at `nowMs`. */
export function isRefreshTokenIdle(expiresAt: string, nowMs: number): boolean {
  return new Date(expiresAt).getTime() + REFRESH_TOKEN_IDLE_MS < nowMs;
}
