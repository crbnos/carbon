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
 * OAuth scopes requested for the client-credentials token (spec §Auth). Kept as
 * an array so it reads cleanly; sent space-joined on the token request.
 */
export const RAMP_SCOPES = [
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
 * Scopes requested in the OAuth authorization-code (Connect) flow. Same resource
 * scopes as client-credentials, plus `offline_access` so Ramp returns a refresh
 * token (the app must also have the Refresh Token grant enabled).
 */
export const RAMP_OAUTH_SCOPES = [...RAMP_SCOPES, "offline_access"] as const;
