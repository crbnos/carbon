# Settings Module

Company configuration: the company/subsidiary records themselves, the ~50-flag `companySettings` row, document templates and reusable sections, numbering sequences, terms, custom fields, integrations, API keys, webhooks, theme, and the backup/restore UI. Almost every other module reads from here (`getCompanySettings`, `getNextSequence`, `getDocumentTemplate`) and almost nothing writes here.

## Key Domain Concepts

- **Company Settings** — exactly one `companySettings` row per company. Its PK **`id` IS the company id**; there is no `companyId` column (`20241127142822_sales-settings.sql`). Read once with `getCompanySettings`; every write is a narrow, single-purpose function (`updateShelfLifeSettings`, `updateKanbanOutputSetting`, `updateMetricSettings`, `updateShowCurrencyTrailingZerosSetting`, …~30 of them).
- **Company / Subsidiary** — `company` rows sharing a `companyGroupId` form a parent+subsidiaries tree. `getCompanies` / `getEmployeeCompanies` read the `companies` membership view (user↔company) and rewrite logo columns to public storage URLs via `PUBLIC_STORAGE_URL_PREFIX`; `getEmployeeCompanies` additionally filters `role = "employee"` and is the single source for the login callback, company picker, and `x+/_layout` guard. `seedCompany` runs the `seed-company` server function (`@carbon/server-functions/seed-company`).
- **Document Template** — one `documentTemplate` row per `(companyId, documentType)` holding `blocks` / `theme` / `settings` JSON plus nullable `headerSectionId` / `footerSectionId`. **`documentSection`** rows are company-global reusable rich text (`placement` = `body|header|footer`); system sections live in code, and editing one **forks** it into a real row keyed by the same id (`upsertDocumentSection` → `isBuiltInSectionId`), which then overrides the built-in everywhere.
- **Sequence** — per-company numbering (`table`, `prefix`, `suffix`, `next`, `step`, `size`) behind readable ids like `PO000123`. `getNextSequence` calls the `get_next_sequence` RPC and **consumes** a number; `getCurrentSequence` only previews it (and re-derives date tokens through `interpolateSequenceDate` in the company timezone so the preview matches what SQL will issue). `itemSerialSequence` is the per-item serial-number equivalent.
- **Custom Field** — user-defined fields per table (`customField`, read through the `customFieldTables` view). Definitions are Redis-cached under `customFields:{companyId}:*`.
- **Integration** — per-company third-party config in `companyIntegration` (read through the `integrations` view), Redis-cached under `integrations:{companyId}` and `json:integrations:{companyId}`. An OAuth callback can't render its own failure, so it redirects with `integrationErrorSearch(integration, code)` and the integrations page resolves the code to Lingui copy via `getIntegrationError` (`integration-errors.ts`) — only a code crosses the URL, never the provider's message.
- **API Key / Webhook** — outbound automation. `upsertApiKey` stores only `keyHash` / `keyPreview` and returns the raw key **once**; `rateLimit`/`rateLimitWindow` are stripped as platform-controlled.

## Safety

### Always

- MUST filter `companySettings` with `.eq("id", companyId)` — there is no `companyId` column. `updateDefaultCustomerCc` (settings.service.ts) currently filters `"companyId"` and is the one outlier; copy any other `update*Setting`, not that one.
- MUST invalidate the Redis caches after writing integrations or custom fields — `clearCompanyIntegrationCache` / `clearAllIntegrationCaches` / `clearCustomFieldsCache` (`settings.server.ts`). `deactivateIntegration`, `upsertCompanyIntegration`, `upsertCustomField`, and `deleteCustomField` already do.
- MUST write templates through `upsertDocumentTemplate` — it stamps `CURRENT_TEMPLATE_FORMAT_VERSION` and conflicts on `companyId,documentType` (one template per type per company).
- MUST read a stored template through `getDocumentTemplateConfig` (or `toDocumentTemplate` + `resolveTemplate`) — the JSON columns are untyped in the generated DB types, and `resolveTemplate` appends built-in blocks added since the row was saved.
- MUST use `getNextSequence` to consume a document number. `getCurrentSequence` does not increment and must never be used to issue one.

### Ask First

- Editing a `sequence` row (`next`, `size`, `prefix`) for a document type already in use — issued ids can collide.
- Anything under `backups.*` — `startCompanyRestore` wipes and reloads every company-scoped table (see `.claude/rules/company-backup-restore.md`).
- Deleting a `documentSection` — `documentTemplate.headerSectionId` / `footerSectionId` are soft refs with **no FK**, so the deletion is silent and the section is skipped at render.

### Never

- Never add a wide "update companySettings" helper — the per-setting functions exist so an unrelated form can't blank a neighboring flag.
- Never persist or log a raw API key; only `keyHash` / `keyPreview` are stored, and the raw value is returned to the caller exactly once on create.
- Never re-export the `*.server.ts` files from `index.ts`. The barrel is `backups.service`, `settings.models`, `settings.service`, `types`, `ui` only — `settings.server.ts` (Redis + `@carbon/ee`), `backups.server.ts`, `backups-archive.server.ts`, `documentPreview.server.ts`, and `labelLogo.server.ts` are deep-imported by path (e.g. `~/modules/settings/documentPreview.server`) to keep server-only deps out of client bundles.

## Validation Commands

```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec turbo run typecheck --filter=@carbon/documents   # when touching template types
pnpm run test
pnpm run lint
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `company` | Company/subsidiary master: address, tax ids, `companyGroupId`, all five logo columns |
| `companies` (view) | User↔company membership with `userId` / `role`; source for the company picker |
| `companySettings` | Per-company flags/JSON (PK `id` = company id) |
| `companyPlan` / `plan` | Stripe subscription state and plan catalog |
| `config` / `industry` | Global config row; onboarding industry catalog (`active`, `sortOrder`) |
| `documentTemplate` | Block layout + theme + settings per `(companyId, documentType)` |
| `documentSection` | Company-global reusable header/body/footer rich text |
| `terms` | Company `salesTerms` / `purchasingTerms` JSON (PK = company id) |
| `sequence` | Readable-id numbering per table |
| `itemSerialSequence` / `itemSerialSequences` (view) | Per-item serial-number numbering |
| `customField` / `customFieldTables` (view) | User-defined fields, grouped per table |
| `companyIntegration` / `integrations` (view) | Per-company third-party config + metadata |
| `apiKey` | Hashed API keys with per-module scopes |
| `webhook` / `webhookTable` | Outbound webhooks and the tables they may subscribe to |
| `companyAccountsPayableBillingAddress` / `companyAccountsReceivableBillingAddress` | Remit-to / bill-to addresses printed on documents |
| `itemPostingGroupResponsibility` | Planning ownership: the responsible employee for an item group AT a location (`locationId`, `itemPostingGroupId`; UNIQUE `(companyId, locationId, itemPostingGroupId)`, the upsert's conflict target; RLS employee read, `settings_update` writes — `20261006130100`) — one rung of the MRP action owner ladder (see Planning below) |
| `employeeType` / `employeeTypePermission` / `employee` | Written only by `updateConsoleSetting` (now in the commercial `@carbon/ee/console.server`, gated to Business via the `PERMISSIONS` feature), which provisions a "Console Operator" type |

## Key Service Functions

- `getCompanySettings` / `getCompany` / `getCompanies` / `getEmployeeCompanies` — the reads the rest of the app depends on (~78 files read company settings)
- `getNextSequence` (RPC `get_next_sequence`) / `getCurrentSequence` / `getSequence(s)` / `updateSequence` — document numbering
- `getDocumentTemplate` / `getDocumentTemplateConfig` / `upsertDocumentTemplate` — template read/write
- `getDocumentSections` / `getDocumentSectionsByIds` / `upsertDocumentSection` / `deleteDocumentSection` / `resolveSections` — sections; `resolveSections` seeds built-ins first, then lets a stored row of the same id override
- `getTerms` — company terms fallback for the Terms block; `getAccountsPayableBillingAddress` / `getAccountsReceivableBillingAddress` (+ `update*`) — addresses printed on documents
- `getCustomField(s)` / `getCustomFieldsTables`, plus `upsertCustomField` / `deleteCustomField` / `updateCustomFieldsSortOrder` (`settings.server.ts`, cache-clearing)
- `getIntegration(s)` / `getCompanyIntegrations` / `upsertCompanyIntegration` / `deactivateIntegration` / `getIntegrationsWithHealth`
- Webhook + API-key READ helpers stay here (`getWebhook(s)` / `getWebhookTables`, `getApiKey(s)`); the commercial AUTHORING writers moved to `@carbon/ee` behind the entitlement lock — `upsertApiKey` / `deleteApiKey` (`@carbon/ee/api-keys.server`, `API_KEYS`) and `upsertWebhook` / `deleteWebhook` / `deactivateWebhooks` (`@carbon/ee/webhooks.server`, `WEBHOOKS`)
- `insertCompany` / `insertSubsidiary` / `updateSubsidiary` / `deleteSubsidiary` / `seedCompany` / `updateCompany` / `updateCompanyPlan`
- `updateLeasePolicySettings` (the ASC 842 lessor thresholds `leaseMajorPartThresholdPercent` / `leaseSubstantiallyAllThresholdPercent` and `leaseDefaultDiscountRate`, percentage points) — written from `x+/settings+/accounting.tsx` (intent `leasePolicy`); applies to later rental activations only. Revenue recognition has no setting of its own. The same page's General Ledger card has no switch: it shows "Accounting since {date}" from `companySettings.accountingCutoverDate`, or a "Set up accounting" button to the enable wizard (`x+/accounting+/activation`, see accounting AGENTS). `updateAccountingEnabledSetting` is gone, and the `accountingEnabled` column is unused
- `updateLogoLight|LightIcon|Dark|DarkIcon|Watermark` — store the storage path on `company`, not a URL (readers prefix it)
- `listCompanyBackupFolders` / `deleteCompanyBackup` / `getCompanyRestoreRuns` / `getCompanyExportRun` (`backups.service.ts`); `exportCompanyBackup` (`backups.server.ts`, sends `carbon/company-export`); `getCompanyBackups` — the Backups loader's list, which computes each backup's live compatibility verdict via `@carbon/jobs/backups` — and the restore triggers live in `backups.server.ts`
- Planning (Settings → Planning, `x+/settings+/planning.tsx`, cards in `ui/Planning/`): `setRescheduleToleranceDays` / `setDefaultPlanningHorizonDays` / `setForecastConsumptionWindow` (`companySettings`), and the action owner ladder — `setDefaultResponsibleEmployee` (company), `setLocationResponsibleEmployee` (`location.responsibleEmployee`; returns the row, since a user without `resources_update` matches none under RLS and the route reports that), `upsertItemPostingGroupResponsibility` (item group at a location; updates in place so `createdBy` survives, inserts a new cell, and a null employee deletes the row), read back by `getItemPostingGroupResponsibilities`. The item rung is `itemPlanning.responsibleEmployee`, edited on the item. The scheduled MRP time is `updateMrpRunTimeSetting` (`companySettings.mrpRunTime`, null = every 3 hours), edited on the same page. Cards and intents: `ResponsibleEmployeeCard` (`setCompanyDefault` / `setLocation` / `setItemGroup`), `RescheduleToleranceCard` (`setTolerance`), `PlanningHorizonCard` (`setPlanningHorizon`), `ForecastConsumptionCard` (`setForecastConsumption`), `MrpScheduleCard` (`setMrpSchedule` → `updateMrpRunTimeSetting`); validators `mrpScheduleValidator`, `rescheduleToleranceValidator`, `planningHorizonValidator`, `forecastConsumptionValidator` (`settings.models.ts`; `settings.models.mrp-schedule.test.ts`). The `companySettings` columns: `defaultResponsibleEmployee`, `rescheduleToleranceDays` (default 7), `defaultPlanningHorizonDays` (null = no fence), `forecastConsumptionBackwardPeriods` / `forecastConsumptionForwardPeriods` (defaults 4 / 1), `mrpRunTime` (TIME; null = every 3 hours — `useMrpScheduleDescription` in `~/hooks` renders it). Nav: `useSettingsSubmodules.tsx` → `path.to.planningSettings` (`/x/settings/planning`).
- `labelLogo.server.ts` — re-exports `resolveLabelLogo` from `@carbon/documents/labels` unchanged, and adds `getCompanyLogoForLabel`, which reads the company's logo storage paths fresh and expands them against `SUPABASE_INTERNAL_URL`; label routes (`file+/**/$id.labels[.]pdf|zpl`) feed that into `resolveLabelLogo` instead of `getCompany`'s public URLs (MES keeps its own copy at `apps/mes/app/services/labelLogo.server.ts`)

## Settings → Invoicing

`x+/settings+/invoicing.tsx` (`path.to.invoicingSettings`) is the one page for recurring invoices and the invoice-email defaults. Cards, in order: **Recurring Invoices** (`companySettings.invoiceAutomation`, `updateInvoiceAutomationSetting`, intent `invoiceAutomation`; default `Post and Email`), **Receivables Email** (`accountsReceivableEmail`, `updateAccountsReceivableEmail` — the Reply-To and a CC on automated invoice emails), **Notifications** ("Also notify": `invoiceNotificationGroup`, `updateInvoiceNotificationSetting`, intent `invoiceNotifications` — the company-wide digest on top of each owner's own), **Emails** (default customer CC) and **Centralized Billing Address** — the last two moved here from `settings+/sales.tsx`, which keeps "Require a Customer Contact and Location". The check that setting drives, `checkPartyContactRequirement`, now lives in `@carbon/lib/party-contact.server`; `party-contact.ts` / `party-contact.server.ts` here re-export it.

## Document Preview

`documentPreview.server.ts` lets the template editor render a draft layout against a **real record** instead of sample data. Two exports, both deep-imported (never via the barrel):

- `listPreviewEntities(client, companyId, documentType)` — populates the editor's record picker. `LIST_CONFIG` is the gate: a document type absent from the map returns `[]` and can only preview sample data. Each entry is `{ view, idColumn, hasRevision? }` — currently `salesInvoice`→`salesInvoices`, `salesOrder`→`salesOrders`, `purchaseOrder`→`purchaseOrders`, `quote`→`quotes`, `stockTransfer`→`stockTransfer`. It selects the six most recent rows by `createdAt`, scoped by `companyId`.
- `hasRevision` marks the types whose records are revised — currently `purchaseOrder` and `quote`. It gates selecting `revisionId` (only those views carry the column, so requesting it from `salesInvoices` / `stockTransfer` would error) and switches the label to `withRevisionSuffix` (`@carbon/documents/utils`), so two revisions sharing one readable id don't render as indistinguishable options. Sales orders are deliberately excluded: the column exists but nothing writes it.
- `buildPreviewProps(client, companyId, companyGroupId, documentType, id, locale)` — mirrors the live PDF route loaders per type, returning the exact prop bag that document's PDF expects, or `null` when the type is unsupported or the record is missing (the caller then falls back to sample data). It always fetches `getCompany` + `getCompanySettings` as a base, gates the AP/AR billing address on the corresponding `companySettings` flag, and for `quote` additionally resolves an `exchangeRate` via `getCurrencyByCode`. Because it pulls readers from accounting, inventory, invoicing, purchasing, sales, and settings, **adding a preview-able document type means adding both a `LIST_CONFIG` entry and a `switch` arm**.

Consumers: `x+/templates+/$type.tsx` (loader → picker) and `x+/templates+/$type.preview.tsx` (action → `DOCUMENT_PDFS` → `renderToStream`). Both gate on `view: "settings"`; template saves need `update: "settings"`.

## Key Exports

```typescript
import { getCompanySettings, getNextSequence, getDocumentTemplateConfig } from "~/modules/settings";
import { companyValidator, sequenceValidator, documentTemplateValidator } from "~/modules/settings";
import { buildPreviewProps } from "~/modules/settings/documentPreview.server"; // server-only, by path
```

## Related Modules

- **shared** — `getCustomFieldsSchemas` (`shared.server.ts`) reads the fields defined here; `getApprovalRules` backs the Approval Rules UI that lives in `settings/ui/Approvals`
- **users** — ITAR certification data (`getItarCertificationReport`) rendered by `settings/ui/ItarCertifications`
- **accounting / invoicing / purchasing / sales / inventory** — consume `getNextSequence` and `getCompanySettings`, and supply every reader `buildPreviewProps` calls
- **items** — `itemSerialSequence` numbering; `plmReleaseControl` validator imported from `items.models`
- **`@carbon/printing`** — `printerRouteValidator` / `updateAssignmentValidator` are re-exported from `settings.models.ts`; **`@carbon/ee`** supplies the integration configs and server hooks `settings.server.ts` uses

## Rules References

- `.claude/rules/document-template-customizer.md` — block schema, `resolveTemplate`, section forking, render path
- `.claude/rules/company-backup-restore.md` — export/restore jobs, access gate, storage layout
- `.claude/rules/printing-system.md` — printer routing and the queued label path
- `.claude/rules/audit-log-system.md` — the audit-log settings surface under `settings/ui/AuditLog`
- `.claude/rules/conventions-services.md` — service function shape and naming
