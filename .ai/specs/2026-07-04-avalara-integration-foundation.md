# Avalara Integration Foundation

> Status: in-progress
> Author: Claude Code (directed by Brad, brad@carbonos.dev)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1061

## TLDR

Avalara is Carbon's first-class partner for **both** US sales-tax determination (crbnos/carbon#1044, `.ai/specs/2026-07-03-multi-jurisdiction-tax.md` Phase 3) and EU e-invoicing clearance (crbnos/carbon#1054, `.ai/specs/2026-07-04-e-invoicing.md`, written by a parallel agent). This spec ships the **shared substrate** both consumers plug into so neither builds its own: a `packages/ee/src/avalara/` integration following the Xero architecture exactly — registry entry (`defineIntegration`, id `avalara`), per-company config in `companyIntegration.metadata` (company code, sandbox|production, feature toggles for tax determination and e-invoicing), server lifecycle hooks (`onInstall`/`onUninstall`/`onHealthcheck` pinging `/utilities/ping` and verifying the company-code mapping), and a typed REST client covering the AvaTax surface (`CreateTransaction`, `CommitTransaction`, `VoidTransaction`, `ResolveAddress`, `ListNexus`) plus the e-invoicing document surface (submit/status/mandates) behind one retry/timeout/error taxonomy. Credentials are env-level (`AVALARA_ACCOUNT_ID` + `AVALARA_LICENSE_KEY`; integration hidden unless both are set) — **no plaintext secrets ever land in `companyIntegration.metadata`**, per the Plaid Vault-probe/AES-GCM precedent. The AvaTax determination connector itself and the e-invoicing flows are explicit non-scope: this is the socket, not the appliances.

## Problem Statement

Two approved workstreams both need Avalara:

1. **Multi-jurisdiction tax Phase 3** (#1044): an `AvalaraTaxEngine` behind the `resolveLineTaxes` seam — `CreateTransaction(SalesOrder)` estimates on quotes/orders, `CreateTransaction(SalesInvoice, commit: true)` at posting with `details[]` mapped 1:1 to `taxLedger` rows, `VoidTransaction` on void, `ResolveAddress` on customer/location forms, nexus mirroring.
2. **E-invoicing** (#1054): document submission to clearance/network mandates across the EU via Avalara's e-invoicing API (customers all over Europe + US — resolved: Avalara is the partner for both).

Without a shared foundation, each workstream would independently invent: an integration registry entry, credential plumbing, a REST client with retries and error mapping, environment switching (sandbox vs production), a company-code mapping, and a healthcheck. That means duplicated code in `packages/ee`, two half-compatible config schemas fighting over the same `companyIntegration('avalara')` row, and no single install/uninstall lifecycle. Carbon already has the exact pattern to avoid this — the Xero integration (`packages/ee/src/xero/` config + hooks, `packages/ee/src/accounting/providers/xero/` client) — it just needs an Avalara instance of it.

## Proposed Solution

### Package layout (Xero precedent, adapted)

```
packages/ee/src/avalara/
├── config.tsx          # defineIntegration registry entry (client + server bundled — no server imports)
├── hooks.server.ts     # onInstall / onUninstall / onHealthcheck (registered in packages/ee/src/hooks.server.ts)
├── service.server.ts   # getAvalaraClient(companyId), getAvalaraConfig(companyId), isAvalaraFeatureEnabled(...)
├── lib/
│   ├── client.ts       # AvalaraClient — shared HTTP core: auth, base URLs, retry, timeout, error taxonomy
│   ├── avatax.ts       # AvaTax surface: ping, companies, createTransaction, commit, void, resolveAddress, listNexus
│   ├── einvoicing.ts   # E-invoicing surface: submitDocument, getDocumentStatus, listDocuments, listMandates
│   └── types.ts        # namespace Avalara — request/response models for both surfaces
└── index.ts            # barrel (exported as @carbon/ee/avalara + @carbon/ee/avalara/hooks.server)
```

### Registry entry (`config.tsx`)

`defineIntegration({ id: "avalara", name: "Avalara", category: "Tax & Compliance", active: !!AVALARA_ACCOUNT_ID && !!AVALARA_LICENSE_KEY, ... })`. No `oauth` block — AvaTax authenticates with account-level Basic credentials, so `active` is computed from env presence exactly like the Plaid spec's "hidden unless env set" rule (Xero achieves the same via its OAuth `clientId` check). Added to the `integrations` array in `packages/ee/src/index.ts`; a one-row idempotent migration seeds the `integration` registry table (`INSERT ... ('avalara', ...) ON CONFLICT DO NOTHING`, per the Jira/Linear precedent — the `integrations` view CROSS JOINs `integration` × `company`).

Per-company settings (zod `AvalaraSettingsSchema`, stored in `companyIntegration.metadata`):

| Setting | Type | Default | Notes |
|---|---|---|---|
| `companyCode` | options (dynamic) | — required | Avalara company code this Carbon company maps to; options populated live from `GET /api/v2/companies` (Xero dynamic account-list precedent) |
| `avalaraCompanyId` | derived, not a form field | — | Numeric Avalara company id resolved from `companyCode` at save/install (needed by `ListNexus`) |
| `environment` | options: `sandbox` \| `production` | `sandbox` | Selects base URLs for both API surfaces |
| `taxDetermination` | switch | `false` | Feature toggle consumed by the tax connector (#1044); the `resolveLineTaxes` dispatcher checks this |
| `eInvoicing` | switch | `false` | Feature toggle consumed by the e-invoicing flows (#1054) |

### Credential handling (Plaid precedent applied)

- **Env-level (server-only)**: `AVALARA_ACCOUNT_ID` (non-secret) + `AVALARA_LICENSE_KEY` (secret) added to `packages/env/src/index.ts` via `getEnv(..., { isRequired: false, isSecret: true })`, following `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET`, and surfaced through the same `@carbon/auth` re-export path the Xero config uses. One Avalara account serves the whole install; tenancy separation is the per-company `companyCode`.
- **Per-company**: only non-secret config in `companyIntegration.metadata` (table above). **No plaintext secrets in metadata, ever.** v1 needs no per-company secret at all; if one ever appears (e.g. per-company Avalara sub-account keys), it MUST use the Plaid-resolved storage: Vault probe → `{ kind: "vault", secretId }`, else AES-256-GCM env-key fallback → `{ kind: "aes", ciphertext, iv, tag }`, behind a `tokens.server.ts`-style accessor (`.ai/specs/2026-07-02-plaid-bank-feeds.md` §Token storage — fallback pre-approved there).
- The `AvalaraClient` is constructed **only** in server code (`service.server.ts`, hooks, API routes); `config.tsx` never imports it (configs are bundled for the browser — `packages/ee/AGENTS.md` "Never").

### Typed client (`lib/`)

One HTTP core (its own small class modeled on `accounting/core/utils.ts` `HTTPClient`, extended — that class has no retry/timeout and lives inside the accounting sync package) shared by both surfaces:

- **Base URLs**: AvaTax `https://rest.avatax.com` / `https://sandbox-rest.avatax.com` (paths `/api/v2/...`); e-invoicing `https://api.avalara.com/einvoicing` / `https://api.sbx.avalara.com/einvoicing` (header `avalara-version`). Chosen by `environment`.
- **Auth**: AvaTax — HTTP Basic `base64(accountId:licenseKey)`. E-invoicing — pluggable `AuthStrategy` (see open question: Avalara Identity OAuth2 client-credentials vs license key). Required `X-Avalara-Client: Carbon; {version}; REST; v2; {host}` header on AvaTax calls.
- **Timeout**: `AbortSignal.timeout(ms)` — 10s default, 30s for `createTransaction` (Avalara's own guidance for large carts).
- **Retry**: max 2 retries, exponential backoff + jitter, **only** on 429 (honoring `Retry-After`), 502/503/504, and network errors; never on 4xx validation errors; never retry a `commit: true` call after an ambiguous timeout without an idempotent `code` (the tax spec keys committed docs by Carbon invoice id, making retry safe — document this contract on the method).
- **Error taxonomy** (`AvalaraError extends Error` with `kind`, `status`, `avalaraCode`, `retryable`, `details`):

| kind | From | Retryable |
|---|---|---|
| `auth` | 401/403 | no |
| `validation` | 400 + AvaTax error body (`error.details[]` parsed) | no |
| `not_found` | 404 (unknown companyCode/transaction) | no |
| `conflict` | 409 / "document already committed" class errors | no — surface to caller (tax-spec idempotency contract) |
| `rate_limit` | 429 | yes (Retry-After) |
| `transient` | 5xx, network, timeout | yes |

Methods (all return `{ data, error }`, never throw past the taxonomy — service-shape heuristic applied to a client):

- **AvaTax** (`avatax.ts`): `ping()` → `GET /api/v2/utilities/ping` (asserts `authenticated: true`); `listCompanies(filter?)` / `getCompanyByCode(code)`; `createTransaction(model)` (`type: SalesOrder | SalesInvoice | ReturnInvoice...`, `commit`, `code`); `commitTransaction(companyCode, transactionCode)`; `voidTransaction(companyCode, transactionCode, reason)`; `resolveAddress(address)`; `listNexus(avalaraCompanyId)`.
- **E-invoicing** (`einvoicing.ts`): `submitDocument(payload, meta)`; `getDocumentStatus(documentId)`; `listDocuments(query)`; `listMandates()` (country/mandate discovery, needed by the e-invoicing spec's routing).

### Lifecycle hooks (`hooks.server.ts`, registered in `packages/ee/src/hooks.server.ts`)

- `onInstall(companyId)`: no event-system subscriptions (unlike Xero — both consumers call Avalara synchronously/from their own jobs; nothing is push-synced from DB triggers). Best-effort: resolve `companyCode` → `avalaraCompanyId` via `getCompanyByCode` and persist it into metadata.
- `onUninstall(companyId)`: clear the Redis health-cache key; no subscriptions to remove. Consumers own their teardown (non-scope).
- `onHealthcheck(companyId, metadata)`: parse metadata with `AvalaraSettingsSchema`; `ping()` must return `authenticated: true`; `getCompanyByCode(companyCode)` must resolve to an active Avalara company. Healthy only if both pass (this is what the existing `getIntegrationHealth` in `settings.server.ts` calls and caches for 5 min).

### Consumer contract (`service.server.ts`) — the seam #1044 and #1054 import

```ts
getAvalaraConfig(client, companyId)   // → { data: AvalaraSettings & { installed: boolean }, error }
getAvalaraClient(client, companyId)   // → { data: AvalaraClient, error } — error if not installed/env unset
isAvalaraFeatureEnabled(client, companyId, feature: "taxDetermination" | "eInvoicing") // → boolean
```

The tax spec's `resolveLineTaxes` dispatcher and the e-invoicing submission path call `isAvalaraFeatureEnabled` first, then `getAvalaraClient`. Neither reads `companyIntegration` directly.

### Settings UI + connect flow

The generic integration page (`x+/settings+/integrations.$id.tsx`) renders everything from `config.tsx` settings — no bespoke page. Additions on top:

- **Dynamic company-code options**: `settings.server.ts` populates `companyCode` `listOptions` from `listCompanies()` when env creds are present (mirrors the Xero `defaultSalesAccountCode` dynamic-options wiring backed by `api+/integrations.xero.accounts.ts`).
- **Test connection**: an `actions` entry (`{ id: "test-connection", label: "Test Connection", endpoint: "/api/integrations/avalara/test" }`, the Xero `sync-data` action precedent). The route runs the same checks as `onHealthcheck` uncached and flashes success ("Connected to Avalara — company `ACME` (sandbox)") or the taxonomy-mapped failure reason.
- Card is invisible in the integrations list when env creds are absent (`active: false` — same behavior as Xero without `XERO_CLIENT_ID`).

### Design Decisions

Heuristics note (honest N/A): this is `packages/ee` client/registry code — **no new tables**, so heuristics 1 (multi-tenancy PKs) and 3 (RLS) are N/A beyond the one seed row into the existing `integration` registry table, which is global by design (per-company state lives in `companyIntegration`, which already has RLS).

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-tenancy (heuristic 1) | N/A — no new tables; per-company state in `companyIntegration.metadata` keyed by `companyId` | Xero/Plaid precedent: integration state is metadata, not schema |
| Service shape (heuristic 2) | `service.server.ts` functions take `client` first, return `{ data, error }`, never throw; client methods mirror the shape | House rule applied to the seam consumers import |
| RLS (heuristic 3) | N/A — no new tables; seed row in global `integration` table (no `companyId` column, existing pattern) | Registry rows are product catalog, not tenant data |
| Permission scoping (heuristic 4) | New API routes (`test`, `companies`) require `update: "settings"` — same scope as the integrations settings page | Only settings admins configure integrations |
| Form pattern (heuristic 5) | No custom form — generic integrations renderer + zod `AvalaraSettingsSchema` via `defineIntegration` | Zero bespoke UI; Xero precedent |
| Module layout (heuristic 6) | All code in `packages/ee/src/avalara/`; no ERP module touched; exports `@carbon/ee/avalara`(+`/hooks.server`) | Integrations live in ee (tax-spec heuristic-6 row already says so) |
| Backward compatibility (heuristic 7) | Purely additive: new env vars optional, new seed row, new package exports; nothing existing changes behavior | Env unset ⇒ integration invisible ⇒ zero behavior delta |
| One integration, two consumers | Single `avalara` registry entry with two feature switches, not `avalara-tax` + `avalara-einvoicing` | One credential set, one company mapping, one health status; toggles gate consumers independently |
| Credential level | Env-level account id + license key; per-company only `companyCode` | Avalara bills per account; Carbon Cloud runs one account with per-company codes; self-hosted sets its own env. Avoids secret-in-metadata entirely (Plaid rule) |
| Secret storage (future) | If per-company secrets ever needed: Vault probe → AES-256-GCM fallback, Plaid interface | Pre-approved precedent; do not invent a third scheme |
| Client home | `packages/ee/src/avalara/lib/`, NOT `accounting/providers/` | Avalara is not a `BaseProvider` accounting-sync engine (no entity syncers, no `externalIntegrationMapping` flows); forcing it into `SyncFactory` shape would be false symmetry |
| Retry policy | Retries only on 429/5xx/network; commit-call retry safety documented as caller's idempotent-`code` contract | Tax spec already keys committed docs by invoice id (idempotent overwrite of uncommitted docs) |
| Sandbox default | New installs default `environment: sandbox` | Safe-by-default; production is an explicit switch |
| onInstall subscriptions | None | Both consumers are call-time/outbound; Xero's event-system subscriptions exist for DB-driven push sync, which Avalara doesn't do |

## Data Model Changes

No new tables, no columns. One idempotent seed migration (registry pattern, cf. `20260215000000_add_jira_integration.sql`):

```sql
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('avalara', '{"type": "object", "properties": {}}'::json)
ON CONFLICT ("id") DO NOTHING;
```

`companyIntegration.metadata` shape for `avalara` (documented, not enforced by schema):

```jsonc
{
  "companyCode": "ACME",
  "avalaraCompanyId": 123456,        // resolved at install/save
  "environment": "sandbox",           // "sandbox" | "production"
  "taxDetermination": false,
  "eInvoicing": false
}
```

## API / Service Changes

- `packages/env/src/index.ts`: `AVALARA_ACCOUNT_ID`, `AVALARA_LICENSE_KEY` (optional; key is secret), exported through the existing `@carbon/auth` path.
- `packages/ee`: new files per layout above; `avalara` added to `integrations` array + `serverHooks` registry; `package.json` exports `./avalara`, `./avalara/hooks.server`.
- `apps/erp/app/routes/api+/integrations.avalara.test.ts` — action, `update: "settings"`: uncached health probe, flash result.
- `apps/erp/app/routes/api+/integrations.avalara.companies.ts` — loader, `update: "settings"`: `listCompanies()` for dynamic options.
- `apps/erp/app/modules/settings/settings.server.ts`: dynamic-options wiring for `avalara.companyCode` (beside the Xero accounts wiring).

## UI Changes

None bespoke. The existing integrations list/detail pages render the Avalara card (logo, settings groups Connection / Features, Test Connection action) entirely from the registry entry. Card hidden when env creds absent; health badge driven by `onHealthcheck`.

## Explicit Non-Scope

- **AvaTax determination connector** (#1044 / tax spec Phase 3): `AvalaraTaxEngine`, `resolveLineTaxes` dispatch, `taxLedger` mapping, outage fallback, reconcile job, nexus-drift UI.
- **E-invoicing flows** (#1054 / `.ai/specs/2026-07-04-e-invoicing.md`): document building (UBL/CII), submission orchestration, status polling jobs, mandate UX.
- Per-company secret storage implementation (nothing secret per company in v1; precedent reserved above).
- Any accounting-sync (`BaseEntitySyncer`) integration — Avalara syncs no entities.

## Acceptance Criteria

- [ ] With `AVALARA_ACCOUNT_ID`/`AVALARA_LICENSE_KEY` unset, the Avalara card does not appear in `/x/settings/integrations` and `getAvalaraClient` returns a "not configured" error.
- [ ] With env set, the card appears under Tax & Compliance; installing with a `companyCode` chosen from live Avalara options persists metadata matching `AvalaraSettingsSchema` (and `avalaraCompanyId` after install) with **no secret material in the row**.
- [ ] `onHealthcheck` returns healthy only when `ping().authenticated === true` AND the company code resolves; a wrong license key or bogus code shows the unhealthy badge.
- [ ] Test Connection flashes the environment + resolved company name on success and the taxonomy-mapped reason (`auth` vs `not_found` vs `transient`) on failure.
- [ ] Unit tests (mocked fetch) prove: Basic-auth header + `X-Avalara-Client` sent; 429 honored via `Retry-After` then succeeds; 400 maps to `validation` with parsed `details[]` and does NOT retry; 503 retries then maps to `transient`; timeout aborts at the configured budget.
- [ ] Sandbox smoke (mocked in CI; live run env-gated): `createTransaction({ type: "SalesOrder", ... })` against sandbox returns computed `totalTax` + `details[]`; `resolveAddress` returns a validated address; `voidTransaction` on a committed test doc returns status `Cancelled`.
- [ ] Feature toggles round-trip: `isAvalaraFeatureEnabled(companyId, "taxDetermination")` reflects the switch; both toggles independent.
- [ ] `pnpm --filter @carbon/ee typecheck`, `--filter @carbon/erp typecheck`, `pnpm --filter @carbon/ee test`, `pnpm run lint` all pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| E-invoicing API auth differs from AvaTax (Avalara Identity OAuth2) | Med | Pluggable `AuthStrategy` in the client core; open question below gates only `einvoicing.ts` internals, not its method contract |
| Consumers bypass the seam and read `companyIntegration` directly | Low | Contract functions exported + documented in both consumer specs; rule file added for `packages/ee/src/avalara/**` |
| Commit-call retry double-commits | Med | No auto-retry on ambiguous commit timeouts; idempotency delegated to caller-supplied `code` (tax-spec contract) documented on the method |
| Avalara rate limits under batch posting | Low | 429 taxonomy + Retry-After honored; consumers own batch pacing |
| Sandbox/production config mistake taxes real documents | Med | `sandbox` default; environment shown in Test Connection result and card description |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] Is Avalara the partner for both tax determination and e-invoicing, or tax-only? — **Answer: both (resolved by Brad): first-class partner for US sales tax (#1044) AND EU e-invoicing clearance (#1054); this foundation is the shared substrate.**
- [x] Where do credentials live? — **Answer: env-level account id + license key (integration hidden unless set), per-company non-secret config in `companyIntegration.metadata`; any future per-company secret uses the Plaid Vault-probe/AES-GCM precedent (pre-approved in the Plaid spec).**
- [x] One integration or two? — **Answer: one `avalara` registry entry with independent `taxDetermination`/`eInvoicing` feature toggles.**
- [x] **E-invoicing API credentials**: Avalara's e-invoicing (ELR) API appears to require Bearer tokens from Avalara Identity (OAuth2 client-credentials — i.e. separate `AVALARA_CLIENT_ID`/`AVALARA_CLIENT_SECRET`) rather than the AvaTax license key. Verify against current Avalara docs during Task 2; if confirmed, approve adding the two env vars. Blocks only the `einvoicing.ts` auth internals — AvaTax surface, config, hooks, and UI are unaffected. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Assume the separate Avalara Identity OAuth2 client-credentials model — add `AVALARA_CLIENT_ID`/`AVALARA_CLIENT_SECRET` env pair and a token manager in the client core alongside the AvaTax license-key auth. Verify in sandbox during plan/execute; if docs confirm license-key auth suffices, back the token manager out.

## Changelog

- 2026-07-04: Created — foundation substrate for #1044 (tax Phase 3) and #1054 (e-invoicing), tracking crbnos/carbon#1061. Xero architecture followed exactly; Plaid credential precedent applied; consumer contract (`getAvalaraClient`/`isAvalaraFeatureEnabled`) defined for both downstream specs.
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
