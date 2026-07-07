# Binding: Avalara Integration Foundation (#1061)

## Kind
`feature`

## Risk
`medium` — No DB schema changes beyond one seed row. Touches `packages/ee`, `packages/env`, ERP routes, and `apps/erp` settings wiring. No SST infra changes. Risk is correctness of the typed client (auth plumbing, retry policy, error taxonomy) and following the Xero/Plaid precedent exactly.

## Issue
crbnos/carbon#1061

## Spec
`.ai/specs/2026-07-04-avalara-integration-foundation.md` (from `period-closing-spec` branch / PR #1013 — read via `git show origin/period-closing-spec:.ai/specs/2026-07-04-avalara-integration-foundation.md`)

## Plan
`.ai/plans/2026-07-04-avalara-integration-foundation.md` (from `period-closing-spec` branch — read via `git show origin/period-closing-spec:.ai/plans/2026-07-04-avalara-integration-foundation.md`)

> **IMPORTANT:** The spec and plan files do not exist on `main` yet (they're in PR #1013 / `period-closing-spec`). Read them via `git show origin/period-closing-spec:.ai/specs/2026-07-04-avalara-integration-foundation.md` and `git show origin/period-closing-spec:.ai/plans/2026-07-04-avalara-integration-foundation.md`.

## Summary
Ship the shared Avalara substrate for both US sales-tax determination (#1044) and EU e-invoicing clearance (#1054). Following the Xero integration architecture exactly: registry entry (`defineIntegration`, id `avalara`), per-company config in `companyIntegration.metadata`, server lifecycle hooks, and a typed REST client covering AvaTax + e-invoicing surfaces. Credentials are env-level (`AVALARA_ACCOUNT_ID` + `AVALARA_LICENSE_KEY` for AvaTax; `AVALARA_CLIENT_ID` + `AVALARA_CLIENT_SECRET` for e-invoicing Avalara Identity OAuth2). Integration hidden unless env creds present. No new tables; one idempotent seed migration for the registry row.

## Package layout
```
packages/ee/src/avalara/
├── config.tsx          # defineIntegration registry entry (browser-safe — NO server imports)
├── hooks.server.ts     # onInstall / onUninstall / onHealthcheck
├── service.server.ts   # getAvalaraClient(companyId), getAvalaraConfig(companyId), isAvalaraFeatureEnabled(...)
├── lib/
│   ├── client.ts       # AvalaraClient — shared HTTP core: auth, base URLs, retry, timeout, error taxonomy
│   ├── avatax.ts       # AvaTax surface: ping, companies, createTransaction, commit, void, resolveAddress, listNexus
│   ├── einvoicing.ts   # E-invoicing surface: submitDocument, getDocumentStatus, listDocuments, listMandates
│   └── types.ts        # namespace Avalara — request/response models for both surfaces
└── index.ts            # barrel
```

## Critical constraints (non-negotiable)
1. **`config.tsx` must never import `service.server.ts`, `hooks.server.ts`, or client files** — it's bundled for the browser (see `packages/ee/AGENTS.md` "Never").
2. **No plaintext secrets in `companyIntegration.metadata`** — only non-secret config.
3. **No whole-repo typecheck** — OOMs. Run `pnpm --filter @carbon/ee typecheck` and `pnpm --filter @carbon/erp typecheck`.
4. **No `pnpm run generate:types`** — no DB schema changes.
5. **License key never logged** — error messages include taxonomy `kind` + Avalara message only.
6. **E-invoicing auth**: assume Avalara Identity OAuth2 client-credentials model — `AVALARA_CLIENT_ID`/`AVALARA_CLIENT_SECRET` env pair + token manager. If sandbox testing proves license-key auth suffices, remove the token manager.
7. **Retry policy**: retry ONLY on 429 (honor `Retry-After`), 502/503/504, and network errors. NEVER retry on 4xx. NEVER auto-retry a `commit: true` call after an ambiguous timeout without idempotent `code`.
8. **Sandbox default**: new installs default to `environment: sandbox`.

## Acceptance criteria
1. With `AVALARA_ACCOUNT_ID`/`AVALARA_LICENSE_KEY` unset → Avalara card absent from `/x/settings/integrations`; `getAvalaraClient()` returns a typed "not configured" error.
2. With env set → card appears under Tax & Compliance; install with a `companyCode` (chosen from live `listCompanies()` options) persists `companyIntegration.metadata` matching `AvalaraSettingsSchema` with no secret material in the row.
3. `onHealthcheck` returns healthy only when `ping().authenticated === true` AND company code resolves; wrong license key or bogus code → unhealthy badge.
4. Test Connection flashes environment + resolved company name on success; taxonomy-mapped reason (`auth` vs `not_found` vs `transient`) on failure.
5. Unit tests (mocked fetch) prove:
   - Basic-auth header + `X-Avalara-Client` sent on AvaTax calls
   - 429 honored via `Retry-After` then succeeds
   - 400 maps to `validation` with parsed `details[]`, NOT retried
   - 503 retries then maps to `transient`
   - Timeout aborts at configured budget
6. Sandbox smoke (mocked in CI, env-gated for live): `createTransaction({ type: "SalesOrder" })` returns computed `totalTax` + `details[]`; `resolveAddress` returns validated address; `voidTransaction` returns `Cancelled`.
7. Feature toggles: `isAvalaraFeatureEnabled(companyId, "taxDetermination")` reflects the switch; both toggles independent.
8. `pnpm --filter @carbon/ee typecheck` ✅, `pnpm --filter @carbon/erp typecheck` ✅, `pnpm --filter @carbon/ee test` ✅, `pnpm run lint` ✅.

## Reference: Xero precedent
- Registry entry: `packages/ee/src/xero/config.tsx`
- Hooks (no Avalara subscriptions needed — Avalara is outbound only): `packages/ee/src/xero/hooks.server.ts`
- Env vars pattern: `packages/env/src/index.ts` lines for `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET`
- `integrations` array: `packages/ee/src/index.ts`

## Reference: Plaid credential precedent
- Token storage (AES-GCM / Vault probe): `.ai/specs/2026-07-02-plaid-bank-feeds.md` §Token storage

## Seed migration
```sql
-- packages/database/supabase/migrations/YYYYMMDDHHMMSS_add-avalara-integration.sql
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('avalara', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;
```
Use the current timestamp for the filename. Do NOT run `generate:types`.

## API routes
- `apps/erp/app/routes/api+/integrations.avalara.test.ts` — action: uncached healthcheck, flash result
- `apps/erp/app/routes/api+/integrations.avalara.companies.ts` — loader: `listCompanies()` for dynamic `companyCode` options
- Wired in `apps/erp/app/modules/settings/settings.server.ts` dynamic-options section (beside Xero accounts)
