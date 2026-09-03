# Spec: Ramp OAuth (Connect flow) + production hardening

- **Date:** 2026-08-28
- **Status:** Part A (OAuth) IMPLEMENTED on `feat/feat-ramp` (RampClient exchange+refresh, callback
  route, config `oauth` block, env, unit tests) — pending live verification against a registered
  Ramp OAuth app. Part B (hardening) still open. Open questions carry recommended answers for veto.
- **Builds on:** `.ai/specs/2026-08-20-ramp-transaction-sync.md` (the shipped integration) and
  the live-verification work on `feat/feat-ramp` (PR #1503). The integration is implemented and
  live-verified against the Ramp sandbox; this spec covers what stands between that and a
  production/marketplace-quality release.
- **Owner:** TBD

## Problem / motivation

The Ramp integration ships with **client-credentials auth only**. `RampCredentialsSchema`
(`packages/ee/src/ramp/lib/models.ts`) is a discriminated union of `client_credentials`
(`clientId` + `clientSecret`) and `oauth2` (`accessToken`/`refreshToken`/`expiresAt`), but only
the first arm is wired: the install form (`config.tsx`) collects `clientId`/`clientSecret`, and
`RampClient.getAccessToken` **throws `"OAuth refresh not implemented — use client_credentials"`**
for the oauth2 arm. So every customer must, by hand, create a Ramp API client in their Ramp
developer dashboard, get the required scopes granted, and paste the id+secret into Carbon — the
exact scope-granting friction hit during verification, now multiplied per customer.

This was the deliberate plan of record ("OAuth is the destination; develop on client-credentials
first, keep the schema OAuth-ready from day one"). This spec closes that gap plus three smaller
production-hardening items surfaced during verification.

Ramp supports the standard **OAuth 2.0 authorization-code** flow (verified in
`docs.ramp.com/openapi/developer-api.json`):
- `authorizationUrl`: `https://api.ramp.com/v1/authorize` (sandbox: the `demo-api.ramp.com`
  equivalent — **confirm**, see OQ-1)
- `tokenUrl`: `https://api.ramp.com/developer/v1/token` (already the client's token endpoint)
- 76 scopes; the same read/write scopes the integration already requests.

Carbon already has the pattern: `api+/integrations.{quickbooks,xero,onshape,slack}.oauth.ts`
callback routes that call `provider.authenticate(code, redirectUri)`, store `type: "oauth2"`
credentials via `upsertCompanyIntegration`, and refresh with `grant_type=refresh_token` (QBO's
`provider.test.ts` pins the refresh). The Ramp work is an **additive mirror** of that precedent,
not a refactor.

## Goals

1. A customer can connect Ramp with **one click** ("Connect to Ramp" → Ramp consent → done), no
   manual credential creation or scope granting.
2. `oauth2` credentials are stored, used, and **auto-refreshed** (`refresh_token` grant) in
   `RampClient`, transparently to every family and outbound push.
3. **client-credentials stays supported** — the union keeps both arms; existing installs keep
   working; self-hosted / power users can still bring their own id+secret.
4. Three smaller production-hardening fixes (below) land alongside.

## Non-goals

- Changing any inbound/outbound sync behavior (families, journal shapes, mappings) — auth only.
- Ramp partner/marketplace listing paperwork (an external process; this spec makes Carbon
  *technically* ready for it).
- Migrating existing client-credentials installs to OAuth (they keep working; no forced cutover).

## Design

### Part A — OAuth authorization-code flow (primary)

Mirror the QBO precedent exactly.

**1. Carbon's single OAuth app (env).** Register ONE Ramp OAuth application (Carbon's, not the
customer's) and add `RAMP_CLIENT_ID` / `RAMP_CLIENT_SECRET` to `@carbon/env` + deploy config,
alongside the existing `QUICKBOOKS_CLIENT_ID` etc. The redirect URI registered with Ramp is
`${ERP_ORIGIN}/api/integrations/ramp/oauth`.

**2. "Connect to Ramp" in the config.** `config.tsx` gains a Connect action that redirects the
browser to the Ramp authorize URL with `response_type=code`, `client_id`, `redirect_uri`,
`scope=<RAMP_SCOPES joined>`, and a signed/opaque `state` (CSRF + companyId round-trip). The
account-mapping + sync-toggle fields stay in the form and are saved on the callback (or a
follow-up settings save), so the coding config is unchanged.

**3. Callback route** `apps/erp/app/routes/api+/integrations.ramp.oauth.ts` (`runtime: "nodejs"`),
built like `integrations.quickbooks.oauth.ts`:
- `requirePermissions({ update: "settings" })`, parse `oAuthCallbackSchema` (`code` + `state`),
  **verify `state`** (QBO leaves this a TODO — do it properly here: HMAC or a short-lived
  server-stored nonce keyed to companyId).
- Exchange the code at `POST /developer/v1/token` (`grant_type=authorization_code`, `code`,
  `redirect_uri`, Basic `RAMP_CLIENT_ID:RAMP_CLIENT_SECRET`) → `{ access_token, refresh_token,
  expires_in }`.
- Persist `credentials: { type: "oauth2", accessToken, refreshToken, expiresAt, environment }`
  via `persistIntegrationSecrets` (the vault — refresh token is a secret) + the non-secret
  metadata, then run the existing `convergeRamp` (connection, CoA push, cost centers, webhook)
  and fire the initial `ramp-sync`. Reuse `rampOnInstall`.

**4. Token refresh in `RampClient.getAccessToken` (the oauth2 arm).** Replace the throw with a
`refresh_token` grant when the stored `expiresAt` is within the refresh margin: `POST /token`
(`grant_type=refresh_token`, `refresh_token`, Basic app auth) → new access (+ rotated refresh)
token. **The refreshed tokens must be written back to the vault** (Ramp rotates refresh tokens),
so `getAccessToken` needs a persistence callback — pass a `persist(creds)` hook into the
`RampClient` constructor (or return the refreshed creds for the service layer to store). Mirror
how the QBO provider persists rotated tokens. Concurrency: a `concurrency: { key: companyId }`
already serializes `ramp-sync`, but the webhook route + outbound sweep can refresh in parallel —
guard with the same optimistic write the accounting providers use, or a short KV lock.

**5. Environment.** Production authorize/token → `api.ramp.com`; sandbox → the `demo-api.ramp.com`
equivalent, selected by the same `environment` field already on both credential arms.

### Part B — Production hardening (smaller, independent)

**B1. Domain-verification token → config-driven.**
`apps/erp/app/routes/[.well-known]+/ramp-verification[.]txt.tsx` serves a **hardcoded** token
literal tied to one Ramp app. Move it to env (`RAMP_DOMAIN_VERIFICATION_TOKEN`) so prod and
sandbox apps can differ and it's not a code change to rotate. If OAuth makes app-level domain
verification unnecessary (Ramp verifies the registered redirect URI instead), this route can be
**deleted** — confirm during Part A (OQ-2).

**B2. Multi-entity `entity_id` default.**
`resolveRampEntityId` (`ramp-sync.ts`) falls back to the business's **first** entity when
`metadata.entityId` is unset. Correct for single-entity businesses; arbitrary for multi-entity
ones (POs land on a random entity). Change: when the business has >1 entity AND `entityId` is
unset, **do not guess** — skip the PO with a clear, surfaced reason ("configure the Ramp entity")
rather than pushing to the wrong entity, and make the install/settings instructions call out the
Entity field for multi-entity customers. Single-entity businesses keep the zero-config behavior.

**B3. Purchase-order number collision.**
Ramp enforces global uniqueness on `purchase_order_number`; a Carbon PO number colliding with a
pre-existing Ramp PO fails the create (seen live). Two parts:
- **Idempotency parity with vendors:** before creating, match an existing Ramp PO by
  `external_id` (`GET /purchase-orders?external_id=<po.id>`) — if found, link + PATCH instead of
  create. Closes the "created-but-mapping-not-written" gap the way
  `resolveOrCreateRampSpendVendor` already does for vendors.
- **True collision (different PO, same number):** on a `DEVELOPER_7063 "already exists"`, fail the
  op with a clear message (surfaced via the existing `NotificationEvent.IntegrationSync`) rather
  than a bare throw. Optionally namespace the pushed number (e.g. a company-short-code prefix) —
  **decide** (OQ-3); prefer surfacing over silently mangling the customer's PO number.

## Open questions (recommended answers — flag to veto)

- **OQ-1 (sandbox authorize URL):** the OpenAPI lists only the production `api.ramp.com/v1/authorize`.
  **Recommend:** derive the sandbox authorize host from the same `environment` switch the client
  already uses (`demo-api.ramp.com`), and confirm the exact sandbox authorize path against a live
  sandbox consent during Part A implementation (Task 1). Low risk — token URL is already correct.
- **OQ-2 (keep the verification route?):** **Recommend** keeping B1 as env-driven for now; delete
  the route only once Part A confirms OAuth redirect-URI verification replaces it.
- **OQ-3 (PO number namespacing):** **Recommend** surface-and-fail on true collisions (no silent
  renaming); revisit namespacing only if real customers hit frequent collisions.
- **OQ-4 (client-credentials in the UI):** with OAuth as the primary path, **recommend** keeping
  the id/secret fields as an "Advanced / self-hosted" option (not removed) — the union already
  supports it and self-hosted installs may lack Carbon's registered OAuth app.

## Implementation plan (tasks)

1. **Ramp OAuth app + env** — register Carbon's Ramp OAuth app; add `RAMP_CLIENT_ID`/`SECRET` to
   `@carbon/env` + deploy; confirm the sandbox authorize URL (OQ-1). *Verify:* a hand-built
   authorize URL returns to the callback with a code.
2. **Callback route** `integrations.ramp.oauth.ts` — code exchange + state verification + store
   oauth2 creds + `convergeRamp` + initial sync. *Verify:* one-click connect end-to-end in
   sandbox → connection linked, CoA pushed.
3. **`RampClient` oauth2 refresh** — `refresh_token` grant + write-back hook + concurrency guard;
   remove the throw. *Verify:* unit test mirroring QBO `provider.test.ts` (expired access →
   refresh grant → rotated tokens persisted); live: let a token expire (or force it) and confirm
   a family still runs.
4. **Config "Connect" UI** — Connect button/redirect; keep account-mapping + toggles; id/secret as
   Advanced (OQ-4). *Verify:* browser flow via `/test`.
5. **B1** verification-token env — `RAMP_DOMAIN_VERIFICATION_TOKEN`; keep/delete decision (OQ-2).
6. **B2** multi-entity guard in `resolveRampEntityId` + setup-instructions copy. *Verify:* a
   2-entity sandbox business with no configured entity → PO skipped with a clear reason.
7. **B3** PO `external_id` pre-match + collision surfacing. *Verify:* re-push an already-pushed PO
   (idempotent, no dup); a number collision surfaces a Failed op with a readable message.

Parts A and B are independent; B1–B3 can ship first as quick wins.

## Testing

- **Unit (ee):** oauth2 refresh grant + token rotation persistence (new); state-verification
  helper. Keep the existing 582-test suite green.
- **Live sandbox:** the full Connect flow (Task 2), a forced refresh (Task 3), multi-entity skip
  (Task 6), PO re-push + collision (Task 7).
- **Regression:** an existing **client-credentials** install still installs, syncs, and pushes
  unchanged (the union must not regress arm 1).

## Risks

- **Rotated refresh tokens lost on a crash between refresh and write-back** → next call 401s and
  the customer must reconnect. Mitigate with the write-back-before-use ordering and the
  concurrency guard; this is the one genuinely new failure mode OAuth introduces.
- **Ramp partner/OAuth app review** is an external dependency for a *public* listing (not for a
  single/first customer using Carbon's app).
- **Sandbox authorize URL** unconfirmed (OQ-1) — a Task-1 spike, not a design risk.
</content>
</invoke>
