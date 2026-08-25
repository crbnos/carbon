# Integration Secret Encryption via Supabase Vault

Status: IMPLEMENTED 2026-08-18 (1C.1/1C.2/1C.3 — verified in the NIST audit; plan at
`.ai/plans/implemented/2026-08-16-integration-secret-encryption.md`). Residual deploy-
ordering + stale-comment notes live in `.ai/plans/2026-08-15-nist-800-171-app-remediation.md`.

Moves third-party integration credentials out of the plaintext
`companyIntegration.metadata` JSON column into encrypted storage, closing NIST
800-171 **3.13.16 (SC-28, confidentiality of CUI at rest)**. Item **1C** of
`.ai/plans/2026-08-15-nist-800-171-app-remediation.md`.

## Problem

`companyIntegration.metadata` (`20240119095150_integrations.sql`) is a single
`JSON` column holding, per company + integration, a **mix** of:
- **secrets** — OAuth access/refresh tokens, `apiKey`, `client_secret`, webhook
  secrets (Xero, QuickBooks Online, Rillet, Jira, Linear, Slack, OnShape,
  exchange-rates).
- **non-secret config** — `tenantId`, `tenantName`, sync direction, entity/account
  mappings, `providerMetadata`.

Exposure: RLS grants `SELECT` to any employee with `settings_view`
(`20240119095150_integrations.sql`, still the deprecated `has_role`/
`has_company_permission` pattern), so integration secrets are readable in cleartext
by any settings-viewer and sit unencrypted at the application layer (protected only
by Postgres-at-rest). A leaked DB dump or an over-broad settings role exposes live
third-party credentials.

Constraints discovered:
- A `verify_integration()` trigger validates the whole `metadata` blob against a
  per-integration `jsonschema` when `active=true` — moving fields out requires the
  schemas to change too.
- OAuth providers **refresh tokens** and write them back to metadata — the encryption
  path is write-hot, not read-only.
- The accounting module already has a credentials abstraction
  (`parseStoredCredentials`, `packages/ee/src/accounting/core/models.ts`); other
  integrations (linear/jira/slack/onshape) read `metadata` raw.

## Resolved decisions

- [x] **D1 — Encryption mechanism.** **Supabase Vault (`vault.secrets`).**
  `companyIntegration` keeps only a vault secret reference; ciphertext lives in the
  `vault` schema; decryption via `vault.decrypted_secrets`, readable only by
  `service_role`/postgres. Rationale: `supabase_vault`/`pgsodium` already preloaded;
  `vault-enc-key` already an infra concern (rotation doesn't touch app code); keeps
  the decrypt boundary at `service_role`, which every EE provider already uses.
  Tradeoff accepted: the settings UI must be reworked to never receive the secret.

## Resolved decisions (continued)

- [x] **D2 — Granularity.** **Secret-field split.** Only genuinely-secret fields
  (tokens, `apiKey`, `client_secret`, webhook secrets) move to vault; non-secret
  config (`tenantId`, `tenantName`, `syncDirection`, entity/account mappings,
  `providerMetadata`) stays in the plaintext `metadata` column. The secret-key set
  is declared in a **centralized, reviewable `SECRET_KEYS` map keyed by integration
  id** (not scattered per call site). Rationale: UI/sync read non-secret config
  constantly (avoids a vault decrypt per list render, keeps the RLS user client
  serving config), preserves `verify_integration` validation of the config
  remainder, mirrors the accounting module's existing `providerMetadata` vs
  credentials boundary. Risk accepted: a field mis-classified as non-secret leaks —
  mitigated by the single reviewable map.
- [x] **D3 — jsonschema reconciliation.** **Rewrite each integration's `jsonschema`**
  (one new idempotent migration `UPDATE`-ing the ~10 `integration.jsonschema` rows —
  NOT editing historical migrations) to describe only the non-secret config
  remainder; drop secret properties from `properties`/`required`. Secret *presence*
  is enforced in the app: zod on the credential form + a service-role check that the
  vault reference exists before flipping `active=true`. `verify_integration` stays,
  guarding config integrity.
- [x] **D4 — Read access model + reveal.** Secrets are read only through one
  server helper `getIntegrationSecret(companyId, integrationId, key)` (service-role);
  never decrypted in a loader that serializes to the browser; not cached in app
  memory. The settings UI shows non-secret config + a **masked** secret
  (`sk_live_••••4821`) by default. An explicit **Reveal** action calls a
  permission-gated service-role endpoint that returns plaintext on demand and
  **writes an audit event ("viewed integration secret": actor, integration, when)**.
  Users can see and edit their key; access is deliberate and accountable (AU-3).
  - **D4a — Anti-overwrite save semantics (critical).** The masked display value
    MUST NEVER be written back as the secret. Rules:
    (1) the secret input is dirty-tracked; on save the secret is written to vault
    **only if the field was actually changed by the user** — an untouched field
    (whether still masked or revealed-but-unedited) omits the secret from the update
    payload, leaving the vault secret unchanged;
    (2) the server-side update helper additionally **rejects/ignores a submitted
    secret equal to the mask sentinel** as a belt-and-suspenders guard;
    (3) prefer an explicit `secretChanged` flag over string comparison — never infer
    "unchanged" from the value alone.
    This is the one place the whole design can silently corrupt a live credential.
  - **D4b — Reveal/edit gate.** `settings_update` (same as editing), always
    audited; under `CONTROLLED_ENVIRONMENT` a reveal additionally re-challenges MFA.
    Rationale: whoever can rotate the credential can already obtain it, so a stricter
    view-gate adds friction without protection — accountability comes from the audit
    event.
- [x] **D5 — Write path & vault lifecycle.** **One vault secret per
  `(companyId, integrationId)`** holding a JSON object of all that integration's
  secret fields. **Deterministic name** `integration:{companyId}:{integrationId}` →
  writes are an idempotent **upsert** (token refresh updates in place, never creates
  a new secret; no orphan accumulation). Reference stored in a **new
  `companyIntegration.secretRef` column** (a real column, NOT in the `metadata` JSON
  the jsonschema validates / the RLS user client serves). Helpers (service-role):
  `getIntegrationSecret`, `putIntegrationSecret` (upsert), `deleteIntegrationSecret`.
  **Cleanup:** a DB trigger on `companyIntegration` DELETE drops the paired
  `vault.secrets` row (vault rows don't cascade on their own) — no orphan-sweep job.
- [x] **D6 — Scope.** **All providers, single backfill.** Implementation may land
  accounting-first behind the shared helpers, but the spec's exit criterion is
  **zero plaintext secrets across every integration** (Xero, QBO, Rillet, Jira,
  Linear, Slack, OnShape, exchange-rates, Resend, …). Any integration still reading a
  raw secret from `metadata` is a release blocker — 3.13.16 does not half-close.
- [x] **D7 — Backfill mechanism.** **Hybrid.** DDL via migrations (add `secretRef`
  column, rewrite the ~10 `integration.jsonschema` rows, add the delete trigger); the
  **data movement is an idempotent app-level backfill** reading the single TS
  `SECRET_KEYS` map via a service-role client (run as a deploy step like `seed.ts`).
  Keeps the secret-key classification in ONE place (SQL/TS drift can't leak or corrupt
  a field). **Transitional read-fallback:** `getIntegrationSecret` returns the vault
  value when `secretRef` is set, else falls back to legacy plaintext `metadata` — so
  providers work before/during/after backfill (mirrors `normalizeStoredCredentials`).
  The plaintext **scrub is the final step** of the same release, once reads are
  confirmed on vault; the transitional fallback is then removed.
- [x] **D8 — Vault-unavailable failure mode.** **Fail closed.** `getIntegrationSecret`
  raises a typed `IntegrationSecretUnavailableError` (never returns empty that a
  provider might read as "no auth"). Sync jobs surface it, retry via Inngest, and emit
  an alert metric (Phase-4 monitoring). Reveal shows an error, no crash. After scrub
  there is deliberately no plaintext fallback — a vault failure fails loudly rather
  than degrading silently. (Contrast the MFA fail-OPEN being closed in plan item 2.4 —
  here there is no "proceed" branch to protect.)
