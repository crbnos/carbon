# Avalara Integration Foundation — Implementation Plan

## Overview

- **Design Spec:** `.ai/specs/2026-07-04-avalara-integration-foundation.md` (status: in-progress; one open question gates Task 5 internals only)
- **Tracking issue:** crbnos/carbon#1061
- **Tasks:** 11 tasks + gated verification
- **Branch:** `feature/avalara-integration-foundation`

**Ground rules for the executor:**

- No DB schema changes beyond one idempotent seed row — do NOT run `pnpm run generate:types` expecting changes, and never commit a regenerated `packages/database/src/types.ts` diff.
- Do NOT rebuild the database; apply the seed migration with `pnpm db:migrate` only, when the local stack is up.
- Typecheck per package (`pnpm --filter @carbon/ee typecheck`, `--filter @carbon/erp typecheck`) — whole-repo typecheck OOMs.
- `config.tsx` must stay browser-safe: no imports of `service.server.ts`, `hooks.server.ts`, or the client (see `packages/ee/AGENTS.md` "Never").
- Never log or flash the license key; error messages include taxonomy `kind` + Avalara message only.
- Commit only at the marked checkpoints, after verification passes (check-and-commit gate).

## Dependencies

```
Task 1 (env vars) ──┬─ Task 3 (client core) ─┬─ Task 4 (avatax surface) ─┬─ Task 6 (hooks + service seam)
                    │                        └─ Task 5 (einvoicing surface — OQ-gated)
                    └─ Task 2 (config.tsx registry) ────────────────────┘
Task 7 (seed migration) — independent; needed before browser verification
Task 8 (API routes + dynamic options) — after Task 6
Task 9 (unit tests + sandbox smoke) — after Tasks 4–5
Task 10 (docs/rules) — after Task 8
Task 11 (validation gate) — last
```

---

## Task 1: Env plumbing — `AVALARA_ACCOUNT_ID` / `AVALARA_LICENSE_KEY`

**Files:**
- Modify: `packages/env/src/index.ts`
- Modify: `.env.example` (repo root; also check `apps/erp/.env.example` if present)

**Steps:**

1. Next to the `XERO_CLIENT_ID` block (~line 313), add:

```typescript
export const AVALARA_ACCOUNT_ID = getEnv("AVALARA_ACCOUNT_ID", {
  isRequired: false
});
export const AVALARA_LICENSE_KEY = getEnv("AVALARA_LICENSE_KEY", {
  isRequired: false,
  isSecret: true
});
```

2. Add `AVALARA_ACCOUNT_ID` to the same server-env aggregation object that lists `XERO_CLIENT_ID` (~line 436) if that object gates availability; do NOT add the license key to anything client-visible.
3. Add both to the `ProcessEnv` interface declaration at the top of the file (where `XERO_CLIENT_ID: string` is declared, ~line 23).
4. Trace how `XERO_CLIENT_ID` reaches `@carbon/auth` (the Xero `config.tsx` imports it from there) — mirror the export for the two Avalara vars.
5. Document both in `.env.example` with a comment: `# Avalara (tax + e-invoicing) — integration hidden unless both set`.

**Verification:** `pnpm --filter @carbon/env typecheck && pnpm --filter @carbon/auth typecheck`

---

## Task 2: Registry entry — `packages/ee/src/avalara/config.tsx`

**Files:**
- Create: `packages/ee/src/avalara/config.tsx`
- Modify: `packages/ee/src/index.ts` (import + `integrations` array + re-export `Avalara`)

**Steps:**

1. Model on `packages/ee/src/xero/config.tsx`. `defineIntegration({ id: "avalara", name: "Avalara", category: "Tax & Compliance", active: !!AVALARA_ACCOUNT_ID && !!AVALARA_LICENSE_KEY, logo: Logo, images: [], ... })` — no `oauth` block (Basic auth is env-side). Import env vars from the same source Xero uses (`@carbon/auth`).
2. `AvalaraSettingsSchema` (zod, reuse the file-local `coerceBoolean` pattern from Xero's config):
   - `companyCode: z.string().min(1)`
   - `environment: z.enum(["sandbox", "production"]).default("sandbox")`
   - `taxDetermination: coerceBoolean.optional().default(false)`
   - `eInvoicing: coerceBoolean.optional().default(false)`
   - `avalaraCompanyId: z.coerce.number().optional()` (not a form field; written by install hook)
3. `settingGroups`: `Connection` ("Which Avalara company and environment this Carbon company uses") and `Features` ("Enable the Avalara capabilities this company consumes").
4. `settings`: `companyCode` (type `options`, `listOptions: []` — populated dynamically, Xero account-code precedent; `required: true`), `environment` (type `options` with sandbox/production descriptions, default `sandbox`), `taxDetermination` + `eInvoicing` (type `switch`, default `false`, descriptions pointing at #1044/#1054 features).
5. `actions`: `[{ id: "test-connection", label: "Test Connection", description: "Verify credentials and company code against Avalara", endpoint: "/api/integrations/avalara/test" }]`.
6. Inline `Logo` SVG component (simple monochrome "A" mark placeholder is fine; note for design pass).
7. Register in `packages/ee/src/index.ts`: import, add to `integrations` array (alphabetical — before `Email`), add `export { Avalara } from "./avalara/config";`.

**Verification:** `pnpm --filter @carbon/ee typecheck`

---

## Task 3: Client core — auth, base URLs, retry/timeout, error taxonomy

**Files:**
- Create: `packages/ee/src/avalara/lib/client.ts`
- Create: `packages/ee/src/avalara/lib/types.ts`

**Steps:**

1. `types.ts`: `namespace Avalara` request/response models — `PingResult`, `CompanyModel`, `TransactionModel` (with `details[]`: jurisdiction, rate, tax, taxableAmount — the shape the tax spec maps to `taxLedger`), `AddressResolutionModel`, `NexusModel`, `ErrorBody` (`error.code`, `error.details[]`), e-invoicing `DocumentSubmitResponse`, `DocumentStatusEvent`, `Mandate`. Keep fields to what the spec's consumers need; do not transcribe the whole AvaTax swagger.
2. `client.ts`:
   - `export class AvalaraError extends Error { kind: "auth" | "validation" | "not_found" | "conflict" | "rate_limit" | "transient"; status?: number; avalaraCode?: string; retryable: boolean; details?: unknown }` + `toAvalaraError(status, body)` mapper per the spec's taxonomy table (409 and committed-document conflicts → `conflict`).
   - Base-URL maps: `AVATAX_BASE = { sandbox: "https://sandbox-rest.avatax.com", production: "https://rest.avatax.com" }`; `EINVOICING_BASE = { sandbox: "https://api.sbx.avalara.com/einvoicing", production: "https://api.avalara.com/einvoicing" }`.
   - `AvalaraHttp` core: constructor takes `{ environment, accountId, licenseKey }`; `request<T>(surface: "avatax" | "einvoicing", method, path, { body?, timeoutMs?, retryable? })` → `{ data: T | null, error: AvalaraError | null }`. Basic auth header for avatax; `X-Avalara-Client: Carbon; 1.0; REST; v2; carbon` on avatax calls; `avalara-version` header on einvoicing calls; `AbortSignal.timeout(timeoutMs ?? 10_000)`.
   - Retry loop: max 2 retries with exponential backoff + jitter on `rate_limit` (honor `Retry-After` seconds) and `transient`, only when the call is marked `retryable` (default true for GET, false for POSTs unless the method opts in). Do NOT reuse `accounting/core/utils.ts`'s `HTTPClient` (no retry/timeout; throws `RatelimitError` for Inngest semantics we don't want here) — but keep the same `{ data, error }` return philosophy.

**Verification:** `pnpm --filter @carbon/ee typecheck`

---

## Task 4: AvaTax surface

**Files:**
- Create: `packages/ee/src/avalara/lib/avatax.ts`
- Create: `packages/ee/src/avalara/index.ts` (barrel: client, surfaces, types, schema type)
- Modify: `packages/ee/package.json` (exports: `"./avalara": "./src/avalara/index.ts"`)

**Steps:**

1. `AvataxApi` (constructed with an `AvalaraHttp` + `companyCode`):
   - `ping()` → `GET /api/v2/utilities/ping`; returns `{ authenticated: boolean, version }` — treat `authenticated: false` as `AvalaraError(kind: "auth")`.
   - `listCompanies()` → `GET /api/v2/companies?$top=200`; `getCompanyByCode(code)` → same with `$filter=companyCode eq '<escaped>'`, returns the single match or `not_found`.
   - `createTransaction(model)` → `POST /api/v2/transactions/create` (30s timeout; `retryable: false` when `model.commit === true` — document the caller idempotent-`code` contract from the tax spec in the JSDoc).
   - `commitTransaction(transactionCode)` → `POST /api/v2/companies/{companyCode}/transactions/{transactionCode}/commit` body `{ commit: true }`.
   - `voidTransaction(transactionCode, reason = "DocVoided")` → `POST .../void` body `{ code: reason }`.
   - `resolveAddress(address)` → `POST /api/v2/addresses/resolve`.
   - `listNexus(avalaraCompanyId)` → `GET /api/v2/companies/{avalaraCompanyId}/nexus`.
2. Verify each path/verb against the current AvaTax REST v2 docs (developer.avalara.com) before finalizing — record any corrections in the spec changelog.

**Verification:** `pnpm --filter @carbon/ee typecheck`

---

## Task 5: E-invoicing surface (OQ-gated auth)

**Files:**
- Create: `packages/ee/src/avalara/lib/einvoicing.ts`

**Steps:**

1. FIRST: resolve the spec's open question against current Avalara e-invoicing (ELR) API docs: auth mechanism (Avalara Identity OAuth2 client-credentials vs license key) and current `avalara-version` value. If OAuth2 is confirmed: pause, get Brad's approval to add `AVALARA_CLIENT_ID`/`AVALARA_CLIENT_SECRET` (extends Task 1), implement a token-caching `AuthStrategy` in `client.ts`; tick the spec checkbox with the resolution.
2. `EinvoicingApi`: `submitDocument(payload, meta)` → `POST /documents`; `getDocumentStatus(documentId)` → `GET /documents/{id}/status`; `listDocuments(query)`; `listMandates()` → `GET /mandates`. Verify exact paths in the same docs pass.
3. If the OQ answer is delayed, ship the method contract with a `not_configured` `AvalaraError` when e-invoicing creds are absent so the e-invoicing spec (`.ai/specs/2026-07-04-e-invoicing.md`) can compile against the interface — do NOT block Tasks 6–11.

**Verification:** `pnpm --filter @carbon/ee typecheck`

---

## Task 6: Hooks + consumer seam

**Files:**
- Create: `packages/ee/src/avalara/service.server.ts`
- Create: `packages/ee/src/avalara/hooks.server.ts`
- Modify: `packages/ee/src/hooks.server.ts` (register `avalara`)
- Modify: `packages/ee/package.json` (exports: `"./avalara/hooks.server": "./src/avalara/hooks.server.ts"`)

**Steps:**

1. `service.server.ts` (spec §Consumer contract — the ONLY entry point #1044/#1054 use):
   - `getAvalaraConfig(client, companyId)` — read `companyIntegration` row `id = 'avalara'`, parse metadata with `AvalaraSettingsSchema` (safeParse; parse failure → error), include `installed = active`.
   - `getAvalaraClient(client, companyId)` — env creds present + installed + parsed config → `{ data: { avatax: AvataxApi, einvoicing: EinvoicingApi, config } }`; else descriptive error ("Avalara is not configured"/"not installed for this company").
   - `isAvalaraFeatureEnabled(client, companyId, feature)` — false on any error path, never throws.
2. `hooks.server.ts` (model: `packages/ee/src/xero/hooks.server.ts`, using `getCarbonServiceRole()`):
   - `avalaraHealthcheck(companyId, metadata)`: parse metadata; build client from env + metadata directly (healthcheck receives metadata — don't re-read the row); `ping()` authenticated AND `getCompanyByCode(companyCode)` resolves → true; any error → false (log kind, never the key).
   - `avalaraOnInstall(companyId)`: best-effort resolve `companyCode` → write `avalaraCompanyId` into `companyIntegration.metadata` (merge, don't clobber). No event-system subscriptions (spec decision).
   - `avalaraOnUninstall(companyId)`: delete the Redis health key `integrations:{companyId}:avalara:health` if the redis client is importable here; otherwise no-op with comment (cache self-expires in 5 min).
3. Register in `packages/ee/src/hooks.server.ts` `serverHooks` map: `avalara: { onHealthcheck, onInstall, onUninstall }`.

**Verification:** `pnpm --filter @carbon/ee typecheck`

**COMMIT CHECKPOINT 1:** `feat(ee): avalara integration foundation — client, registry entry, lifecycle hooks`

---

## Task 7: Seed migration

**Files:**
- Create via `pnpm db:migrate:new avalara-integration` → `packages/database/supabase/migrations/<ts>_avalara-integration.sql`

**Steps:**

1. Contents (Jira precedent `20260215000000_add_jira_integration.sql`, plus idempotency guard):

```sql
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('avalara', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;
```

2. Confirm `integration.id` is the PK/unique target (read `20240119095150_integrations.sql`); adjust the conflict target if needed.
3. Apply only when the local stack is up: `pnpm db:migrate`. No type regeneration expected; `git status` must show no `packages/database/src/types.ts` diff.

**Verification:** `psql ... -c "SELECT id FROM \"integration\" WHERE id = 'avalara'"` returns one row; re-running the migration file is a no-op.

---

## Task 8: API routes + dynamic company options

**Files:**
- Create: `apps/erp/app/routes/api+/integrations.avalara.test.ts`
- Create: `apps/erp/app/routes/api+/integrations.avalara.companies.ts`
- Modify: `apps/erp/app/modules/settings/settings.server.ts` (dynamic options wiring)

**Steps:**

1. `integrations.avalara.test.ts` — action, `requirePermissions(request, { update: "settings" })`: `getAvalaraClient` → `ping()` + `getCompanyByCode()` uncached; flash success `Connected to Avalara — company "<name>" (<environment>)` or the taxonomy-mapped failure (`auth` → "Invalid Avalara credentials", `not_found` → "Company code not found", `transient` → "Avalara unreachable"); redirect back to `path.to.integration("avalara")` (check the exact path helper used by the Xero backfill route and mirror it).
2. `integrations.avalara.companies.ts` — loader, same permissions: `listCompanies()` → `[{ value: companyCode, label: name }]`.
3. In `settings.server.ts`, where the Xero integration branch populates dynamic `listOptions` (the `dynamicOptions` path feeding `integrations.$id.tsx`), add the `avalara` branch: when env creds present, populate `companyCode` options from `listCompanies()`; on error leave options empty (field degrades to free entry only if the renderer supports it — otherwise show empty list; do not crash the page).
4. Grep `path.to` for how existing `api+/integrations.*` endpoints are referenced from config `actions` (Xero's is the literal string `/api/integrations/xero/backfill`) — keep the literal-string convention.

**Verification:** `pnpm --filter @carbon/erp typecheck`

---

## Task 9: Tests — unit + sandbox smoke

**Files:**
- Create: `packages/ee/src/avalara/lib/client.test.ts`
- Create: `packages/ee/src/avalara/lib/avatax.test.ts`

**Steps:**

1. Check how existing `@carbon/ee` vitest suites stub `fetch` (grep `vi.stubGlobal("fetch"` / `msw` under `packages/ee`); follow that pattern.
2. `client.test.ts`: Basic auth + `X-Avalara-Client` headers present; 429 with `Retry-After: 1` retried then succeeds; 400 with AvaTax `error.details[]` → `kind: "validation"`, no retry, details preserved; 503×3 → `kind: "transient"` after max retries; abort at timeout budget → `transient`; POST with `retryable: false` never retried.
3. `avatax.test.ts` (mocked): `createTransaction(SalesOrder)` sends `type/companyCode/commit:false` and parses `totalTax` + `details[]`; `createTransaction(..., commit: true)` is marked non-retryable; `voidTransaction` hits the companies-scoped path; `getCompanyByCode` escapes quotes in the `$filter`.
4. Sandbox smoke (spec AC): a `describe.skipIf(!process.env.AVALARA_SANDBOX_SMOKE)` block running live sandbox `ping` + `createTransaction(SalesOrder)` + `resolveAddress` — never runs in CI without the flag; document the flag in the test header.

**Verification:** `pnpm --filter @carbon/ee test` — all pass (smoke skipped).

**COMMIT CHECKPOINT 2:** `feat(erp): avalara settings wiring — seed row, test-connection, dynamic company codes, tests`

---

## Task 10: Docs + rules

**Files:**
- Create: `.ai/rules/avalara-integration.md` (frontmatter `paths: ["packages/ee/src/avalara/**", "apps/erp/app/routes/api+/integrations.avalara.*"]`)
- Modify: `packages/ee/AGENTS.md` (exports list + key patterns)
- Modify: `AGENTS.md` (Task Router → Integrations: `Avalara (tax + e-invoicing substrate)` row)

**Steps:**

1. Rule file: package layout, consumer contract (`getAvalaraClient`/`isAvalaraFeatureEnabled` — consumers never read `companyIntegration` directly), error taxonomy table, env vars, sandbox/production switching, the commit-idempotency contract, pointers to the three specs (#1044 tax Phase 3, #1054 e-invoicing, this foundation).
2. `packages/ee/AGENTS.md`: add `./avalara` + `./avalara/hooks.server` to Exports; note "Avalara is NOT an accounting-sync provider — no syncers, no `externalIntegrationMapping`".

---

## Task 11: Validation + gated browser verification

**Steps:**

1. ```bash
   pnpm --filter @carbon/ee typecheck
   pnpm --filter @carbon/erp typecheck
   pnpm --filter @carbon/env typecheck
   pnpm --filter @carbon/ee test
   pnpm run lint
   # Expected: all pass
   ```
2. Browser verify (requires user go-ahead, stack up, sandbox env vars set; `/auth` + `/test` skills):
   - Env unset → no Avalara card in `/x/settings/integrations`; env set → card under Tax & Compliance.
   - Install flow: company-code dropdown lists sandbox companies; save persists metadata (inspect row — NO secrets); health badge goes green; Test Connection flashes company + environment.
   - Break the license key in env → healthcheck red + Test Connection shows the `auth` message.
   - Toggle `taxDetermination` on and confirm via a scratch loader/console that `isAvalaraFeatureEnabled` flips.
   - Screenshot the card + Test Connection result for the PR.
3. Update the spec: tick acceptance criteria as verified; changelog entry; resolve/annotate the e-invoicing-auth open question with the Task 5 outcome.

**COMMIT CHECKPOINT 3:** `docs(ai): avalara integration rule + agents updates` — PR references `Tracking spec: .ai/specs/2026-07-04-avalara-integration-foundation.md` + `Closes crbnos/carbon#1061`.

## Deferred (explicit non-goals, per spec)

- AvaTax determination connector (#1044 Phase 3: `AvalaraTaxEngine`, `resolveLineTaxes` dispatch, `taxLedger` mapping, outage fallback/reconcile job, nexus-drift UI).
- E-invoicing flows (#1054: document building, submission orchestration, status jobs, mandate UX).
- Per-company secret storage (Vault/AES-GCM) — nothing secret per company in v1; Plaid precedent reserved.
- Custom Avalara logo/design pass; category grouping polish if "Tax & Compliance" renders oddly in the integrations list.
