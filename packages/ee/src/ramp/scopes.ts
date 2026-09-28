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
