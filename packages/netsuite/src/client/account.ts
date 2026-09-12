/**
 * NetSuite account identifiers appear in two shapes and they are NOT
 * interchangeable:
 *
 * - the **realm** (`1234567_SB1`) — uppercase, underscore-separated. It is what
 *   goes in the OAuth 1.0a `realm` parameter and what the customer sees under
 *   Setup → Company → Company Information → Account ID.
 * - the **host label** (`1234567-sb1`) — lowercase, hyphen-separated. It is what
 *   goes in the `*.suitetalk.api.netsuite.com` hostname.
 *
 * Sending the realm form in the hostname resolves to nothing (DNS failure), and
 * sending the host form as the realm fails signature validation with a generic
 * `INVALID_LOGIN_ATTEMPT`, which is the single most common setup dead-end. Both
 * derivations live here so no call site has to remember which one it needs.
 */

/** `1234567_SB1` → `1234567-sb1` (the DNS label). */
export function accountHostLabel(accountId: string): string {
  return accountId.trim().toLowerCase().replace(/_/g, "-");
}

/** `1234567-sb1` → `1234567_SB1` (the OAuth realm). */
export function accountRealm(accountId: string): string {
  return accountId.trim().toUpperCase().replace(/-/g, "_");
}

/** Base URL for the SuiteTalk REST services of an account. */
export function restBaseUrl(accountId: string): string {
  return `https://${accountHostLabel(accountId)}.suitetalk.api.netsuite.com/services/rest`;
}

/** OAuth 2.0 token endpoint for an account. */
export function tokenUrl(accountId: string): string {
  return `${restBaseUrl(accountId)}/auth/oauth2/v1/token`;
}

/** OAuth 2.0 authorization endpoint for an account. */
export function authorizeUrl(accountId: string): string {
  return `https://${accountHostLabel(accountId)}.app.netsuite.com/app/login/oauth2/authorize.nl`;
}

/** True for the sandbox/release-preview account forms (`_SB1`, `_RP`). */
export function isSandboxAccount(accountId: string): boolean {
  return /_(sb\d*|rp)$/i.test(accountId.trim());
}
