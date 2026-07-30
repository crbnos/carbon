paths: ["packages/ee/src/avalara/**", "apps/erp/app/routes/api+/integrations.avalara.*"]

# Avalara Integration Foundation

The shared Avalara substrate for **both** US sales-tax determination (#1044) and
EU e-invoicing clearance (#1054). This is the socket, not the appliances — the
tax connector and the e-invoicing flows are separate workstreams that plug into
the seam defined here. Follows the Xero integration architecture exactly.

## Package layout (`packages/ee/src/avalara/`)

| File | Role |
|------|------|
| `config.tsx` | `defineIntegration` registry entry. **Browser-bundled — never imports server code** (service, hooks, or `lib/client.ts`). Exports `Avalara`, `AvalaraSettingsSchema`, `AvalaraSettings`. |
| `service.server.ts` | The consumer seam: `getAvalaraClient`, `getAvalaraConfig`, `isAvalaraFeatureEnabled`, `listAvalaraCompanies`, `isAvalaraConfigured`. |
| `hooks.server.ts` | `avalaraHealthcheck` / `avalaraOnInstall` / `avalaraOnUninstall`. Registered in `packages/ee/src/hooks.server.ts`. |
| `lib/client.ts` | `AvalaraHttp` HTTP core — auth, base URLs, retry, timeout; `AvalaraError` + `toAvalaraError` taxonomy. |
| `lib/avatax.ts` | `AvataxApi` — ping, listCompanies, getCompanyByCode, createTransaction, commit, void, resolveAddress, listNexus. |
| `lib/einvoicing.ts` | `EinvoicingApi` — submitDocument, getDocumentStatus, listDocuments, listMandates (OAuth2 bearer). |
| `lib/types.ts` | `namespace Avalara` request/response models. |
| `index.ts` | Barrel (`@carbon/ee/avalara`). Pulls in `service.server.ts`, so it is a **server-only** import. |

## Consumer contract (the seam #1044 / #1054 import)

Consumers import ONLY from `@carbon/ee/avalara` and **never read
`companyIntegration` directly**:

```ts
isAvalaraFeatureEnabled(client, companyId, "taxDetermination" | "eInvoicing") // → boolean, never throws
getAvalaraClient(client, companyId)   // → { data: { avatax, einvoicing, config }, error } — error if env unset / not installed
getAvalaraConfig(client, companyId)   // → { data: AvalaraSettings & { installed }, error }
```

The dispatcher checks `isAvalaraFeatureEnabled` first, then `getAvalaraClient`.

## Credentials (env-level; no per-company secret)

- `AVALARA_ACCOUNT_ID` (non-secret, **browser-exposed** via `getBrowserEnv`) +
  `AVALARA_LICENSE_KEY` (secret) — AvaTax HTTP Basic auth.
- `AVALARA_CLIENT_ID` (non-secret) + `AVALARA_CLIENT_SECRET` (secret) — Avalara
  Identity OAuth2 client-credentials for the e-invoicing surface only.
- The integration is **hidden unless `AVALARA_ACCOUNT_ID` is set** — `active`
  gates on the account id (browser-safe), because the license key is a secret
  and returns `""` in the browser. The key's validity is proven by the
  healthcheck, not by `active`.
- **No plaintext secrets in `companyIntegration.metadata`, ever.** v1 stores only
  non-secret config (see below). A future per-company secret must use the Plaid
  Vault-probe → AES-256-GCM precedent.

## Per-company settings (`companyIntegration.metadata`, `AvalaraSettingsSchema`)

`companyCode` (required, dynamic options from live `listCompanies()`),
`environment` (`sandbox` | `production`, defaults `sandbox`), `taxDetermination`
(switch), `eInvoicing` (switch), and `avalaraCompanyId` (derived — written by
`avalaraOnInstall`, not a form field).

## Error taxonomy (`AvalaraError.kind`)

| kind | From | Retryable |
|------|------|-----------|
| `auth` | 401/403, `ping().authenticated === false` | no |
| `validation` | other 4xx (400/422) + parsed `details[]` | no |
| `not_found` | 404 / unknown companyCode | no |
| `conflict` | 409 / already-committed | no |
| `rate_limit` | 429 (honors `Retry-After`) | yes |
| `transient` | 5xx, network, timeout | yes |
| `not_configured` | env creds absent / not installed | no |

## Retry & idempotency contract

- Retry **only** on `rate_limit` (429, honoring `Retry-After`) and `transient`
  (502/503/504, network, timeout); max 2 retries, exp backoff + jitter. **Never
  retry 4xx.**
- GET defaults `retryable: true`; mutating verbs default `false`.
- `createTransaction({ commit: true })` is marked **non-retryable** — a retry
  after an ambiguous timeout is the caller's responsibility, keyed by a stable
  idempotent `code` (e.g. the Carbon invoice id) so Avalara overwrites the
  uncommitted doc rather than duplicating it.
- The license key is **never logged or flashed** — errors carry only the
  taxonomy `kind` and Avalara's own message.

## Lifecycle & UI

- `avalaraHealthcheck` (cached 5 min by `getIntegrationHealth`): healthy only
  when `ping().authenticated === true` AND `getCompanyByCode(companyCode)`
  resolves. Metadata is passed in — the row is not re-read.
- `avalaraOnInstall`: best-effort resolves `companyCode` → `avalaraCompanyId`,
  merged into metadata. **No event-system subscriptions** (both consumers are
  outbound/call-time, unlike Xero's DB-driven push sync).
- `avalaraOnUninstall`: clears the Redis health key.
- Settings UI is entirely the generic integrations renderer. `companyCode`
  options are populated in the `integrations.$id.tsx` loader via
  `listAvalaraCompanies` (works **pre-install** so a code can be chosen).
  API routes: `api+/integrations.avalara.test.ts` (Test Connection),
  `api+/integrations.avalara.companies.ts` (dynamic options) — both
  `update: "settings"`.

## Specs

- `.ai/specs/2026-07-04-avalara-integration-foundation.md` — this foundation.
- `.ai/specs/2026-07-03-multi-jurisdiction-tax.md` Phase 3 (#1044) — tax consumer.
- `.ai/specs/2026-07-04-e-invoicing.md` (#1054) — e-invoicing consumer.
