// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Ramp OAuth scopes — the single source of truth, shared by the API client
 * (`lib/client.ts`, the client-credentials + refresh-token requests) and the
 * client-bundled integration config (`config.tsx`, the "Connect to Ramp"
 * authorize URL).
 *
 * Browser-safe on purpose: NO node/server imports, so `config.tsx` can import
 * the canonical list without pulling `node:crypto` (which `lib/client.ts`
 * imports) into the client bundle. This module exists precisely because
 * `config.tsx` cannot import from `lib/client.ts`.
 */

/**
 * PROVIDER mode: Carbon holds Ramp's accounting-connection seat, so it needs the
 * write scope and every inbound family's read scope.
 *
 * Kept as an array so it reads cleanly; sent space-joined on the token request.
 */
export const RAMP_PROVIDER_SCOPES = [
  "accounting:read",
  "accounting:write",
  "transactions:read",
  "bills:read",
  "bills:write",
  "vendors:read",
  "vendors:write",
  "reimbursements:read",
  "purchase_orders:read",
  "purchase_orders:write",
  "transfers:read",
  // The repayments family calls GET /developer/v1/repayments on EVERY sync run.
  // Without this scope Ramp answers 403 DEVELOPER_7100 ("These scopes are not
  // allowed for this token: repayments:read"), the family logs "repayments
  // drain failed" and returns nothing — every run, silently, since one family's
  // failure does not fail the sync. Live-hit on the sandbox 2026-09-24.
  "repayments:read",
  "statements:read",
  "cashbacks:read",
  "receipts:read",
  "entities:read",
  "business:read"
] as const;

/**
 * PUSH-ONLY mode: another system holds Ramp's accounting-connection seat, so
 * Carbon must NOT request `accounting:write` — Ramp permits exactly one connected
 * accounting provider, and asking for it is what would take the seat.
 *
 * `accounting:read` IS kept: Carbon still needs to enumerate the ACTIVE provider's
 * coding surface, and to see which system holds the connection. Every inbound
 * family's scope is dropped except bills — push-only still pulls bill payments,
 * which is how a Carbon invoice learns it was paid.
 *
 * NOT requested: `item_receipts:write`. Pushing item receipts was designed and then
 * dropped (2026-09-25) — see `.ai/specs/implemented/2026-09-23-spend-management-push-only-mode.md`
 * §7. Carbon's Ramp app IS configured for that scope, so this is a deliberate
 * choice not to ask for it, not a limitation.
 *
 * Grounded in the per-endpoint `security` blocks of
 * `docs.ramp.com/openapi/developer-api.json`: `/bills/drafts`, `/purchase-orders`,
 * `/vendors` and `/item-receipts` require only their own resource scopes.
 *
 * A scope missing from EITHER set fails quietly, not loudly — Ramp answers
 * `403 DEVELOPER_7100`, the family logs a drain failure and returns nothing, every
 * run. That is how `repayments:read` was missing above until 2026-09-24.
 */
export const RAMP_PUSH_ONLY_SCOPES = [
  "accounting:read",
  "bills:read",
  "bills:write",
  "vendors:read",
  "vendors:write",
  "purchase_orders:read",
  "purchase_orders:write",
  "entities:read",
  "business:read"
] as const;

/**
 * Legacy alias. The stored client-credentials path predates modes and is always
 * provider-shaped; new code should name the mode.
 */
export const RAMP_SCOPES = RAMP_PROVIDER_SCOPES;

/**
 * Scopes requested in the OAuth authorization-code (Connect) flow — the mode's
 * resource scopes plus `offline_access` so Ramp returns a refresh token (the app
 * must also have the Refresh Token grant enabled).
 */
export const RAMP_OAUTH_SCOPES = [
  ...RAMP_PROVIDER_SCOPES,
  "offline_access"
] as const;

export const RAMP_PUSH_ONLY_OAUTH_SCOPES = [
  ...RAMP_PUSH_ONLY_SCOPES,
  "offline_access"
] as const;

/**
 * The Ramp Developer Console app's configured scope list must remain the SUPERSET
 * of both modes, or Ramp rejects the authorize request with `invalid_scope`
 * ("Requested scope not configured for app") — before the consent screen, so the
 * failure reads as broken rather than unauthorized.
 *
 * Carbon's app is configured more broadly than either mode requests (it carries
 * `item_receipts:write`, which no mode asks for today), so this is currently slack
 * rather than a constraint. It stops being slack if a mode ever requests something
 * the app was never registered for — which is a console change, i.e. a human in
 * Ramp's dashboard, not something any code here can do.
 */
export const RAMP_ALL_CONFIGURED_SCOPES = [
  ...new Set<string>([...RAMP_OAUTH_SCOPES, ...RAMP_PUSH_ONLY_OAUTH_SCOPES])
] as const;
