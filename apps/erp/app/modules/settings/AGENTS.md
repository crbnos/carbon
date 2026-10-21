# Settings Module

Company configuration: the company/subsidiary records themselves, the ~50-flag `companySettings` row, document templates and reusable sections, numbering sequences, terms, custom fields, integrations, API keys, webhooks, theme, and the backup/restore UI. Almost every other module reads from here (`getCompanySettings`, `getNextSequence`, `getDocumentTemplate`) and almost nothing writes here.

## Key Domain Concepts

- **Company Settings** — exactly one `companySettings` row per company. Its PK **`id` IS the company id**; there is no `companyId` column (`20241127142822_sales-settings.sql`). Read once with `getCompanySettings`. Each settings page writes through its one `update<Page>Settings` operation (see Operations), which writes only the fields sent.
- **Company / Subsidiary** — `company` rows sharing a `companyGroupId` form a parent+subsidiaries tree. `getCompanies` / `getEmployeeCompanies` read the `companies` membership view (user↔company) and rewrite logo columns to public storage URLs via `PUBLIC_STORAGE_URL_PREFIX`; `getEmployeeCompanies` additionally filters `role = "employee"` and is the single source for the login callback, company picker, and `x+/_layout` guard. `seedCompany` (`settings.service.ts`, ported from the `seed-company` server function, `system` only) seeds a new company; `createCompany`, `createSubsidiary` and onboarding (`provisionCompanyData`) run it through `invokePosting` with the new company's id. That company has no group yet (the seed creates it, or joins the parent's), so `invokePosting` runs `seed-company` without one (`POSTING_DEFAULTS` in `shared.service.ts`); every other posting refuses a company with no group.
- **Document Template** — one `documentTemplate` row per `(companyId, documentType)` holding `blocks` / `theme` / `settings` JSON plus nullable `headerSectionId` / `footerSectionId`. **`documentSection`** rows are company-global reusable rich text (`placement` = `body|header|footer`); system sections live in code, and editing one **forks** it into a real row keyed by the same id (`upsertDocumentSection` → `isBuiltInSectionId`), which then overrides the built-in everywhere.
- **Sequence** — per-company numbering (`table`, `prefix`, `suffix`, `next`, `step`, `size`) behind readable ids like `PO000123`. `getNextSequence` calls the `get_next_sequence` RPC and **consumes** a number; `getCurrentSequence` only previews it (and re-derives date tokens through `interpolateSequenceDate` in the company timezone so the preview matches what SQL will issue). `itemSerialSequence` is the per-item serial-number equivalent.
- **Custom Field** — user-defined fields per table (`customField`, read through the `customFieldTables` view). Definitions are Redis-cached under `customFields:{companyId}:*`.
- **Integration** — per-company third-party config in `companyIntegration` (read through the `integrations` view), Redis-cached under `integrations:{companyId}` and `json:integrations:{companyId}`. An OAuth callback can't render its own failure, so it redirects with `integrationErrorSearch(integration, code)` and the integrations page resolves the code to Lingui copy via `getIntegrationError` (`integration-errors.ts`) — only a code crosses the URL, never the provider's message.
- **API Key / Webhook** — outbound automation. `upsertApiKey` stores only `keyHash` / `keyPreview` and returns the raw key **once**; `rateLimit`/`rateLimitWindow` are stripped as platform-controlled.

## Safety

### Always

- MUST filter `companySettings` with `.eq("id", companyId)` — there is no `companyId` column. `saveCompanySettings` (`settings.service.ts`) does it for every page operation.
- MUST invalidate the Redis caches after writing integrations or custom fields — `clearCompanyIntegrationCache` / `clearAllIntegrationCaches` / `clearCustomFieldsCache` (`settings.service.ts`). `deactivateIntegration`, `upsertCompanyIntegration`, `upsertCustomField`, and `deleteCustomField` already do.
- MUST write templates through `upsertDocumentTemplate` (called by `saveDocumentTemplate`) — it stamps `CURRENT_TEMPLATE_FORMAT_VERSION` and conflicts on `companyId,documentType` (one template per type per company).
- MUST read a stored template through `getDocumentTemplateConfig` (or `toDocumentTemplate` + `resolveTemplate`) — the JSON columns are untyped in the generated DB types, and `resolveTemplate` appends built-in blocks added since the row was saved.
- MUST use `getNextSequence` to consume a document number. `getCurrentSequence` does not increment and must never be used to issue one.

### Ask First

- Editing a `sequence` row (`next`, `size`, `prefix`) for a document type already in use — issued ids can collide.
- Anything in the backups code (`backups.service.ts`, the backup functions in `settings.service.ts`) — `startCompanyRestore` wipes and reloads every company-scoped table (see `.claude/rules/company-backup-restore.md`).
- Deleting a `documentSection` — `documentTemplate.headerSectionId` / `footerSectionId` are soft refs with **no FK**, so the deletion is silent and the section is skipped at render.

### Never

- Never write a whole `companySettings` row: a page's update writes only the fields sent (`sentFields`), so an unrelated form can't blank a neighbouring flag.
- Never persist or log a raw API key; only `keyHash` / `keyPreview` are stored, and the raw value is returned to the caller exactly once on create.
- Never import `settings.service.ts` or `backups.service.ts` from browser code (components, hooks, `ui/`). Both are server-only (Redis, `@carbon/ee`, the backup engine). A function a component needs goes in `settings.utils.ts` (`no-server-code-in-client`).

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

## Operations (`settings.server.ts`)

Each operation is one `defineServiceFn` const in `settings.server.ts`. A route calls it through `carbon(request)` as `api.settings.<name>(input)` and makes no other write; the API and MCP publish the ones tagged `@mcp` as `settings_<name>`.

A settings page has ONE update operation, `update<Page>Settings` (`updateAccountingSettings`, `updateInventorySettings`, …), for `accounting`, `inventory`, `invoicing`, `items`, `people`, `planning`, `production`, `purchasing`, `quality`, `resources`, `sales` and `security`. It takes the page's fields, all optional, writes the ones sent (`saveCompanySettings`, as the caller) and returns them; a call that sends none is refused. The route parses its card's form with one `z.discriminatedUnion("intent", …)` per page (`settingsToggle(intent, field)` in `settings.models.ts` is a switch's form) and the component toasts from the returned fields.

| Operation | Route | What it holds |
|---|---|---|
| `updateAccountingSettings` / `writeMissingJournals` | `x+/settings+/accounting.tsx` | The deferred tax accounts go to `accountDefault`; the repair runs `journal-legacy-documents` under the operation's own gate and needs `update: accounting` too, so it is not published (the API gate takes one module) |
| `updateInvoicingSettings`, `updatePurchasingSettings` | `invoicing.tsx`, `purchasing.tsx` | The centralized billing address (a null field clears it); Stripe must be connected for "Post and Send via Stripe" |
| `updateProductionSettings` | `production.tsx` | A location's staffing rule is written as the system, for the company's own location only |
| `updatePeopleSettings` | `people.tsx` | Console mode through `@carbon/ee/console.server` (the plan lock); returns a generated PIN once, never to a key caller. Not published |
| `updateSecuritySettings` | `security.tsx` | Requiring two-factor through `@carbon/ee/two-factor.server`; emails the company on off → on, never in a controlled environment |
| `updatePlanningSettings` | `planning.tsx` | Every employee named must be the company's; a location hidden by RLS is refused |
| `updateCompanyDetails` / `createCompany`, `updateSubsidiaryDetails` / `createSubsidiary` | `company.tsx`, `company.new.tsx`, `companies.$id.tsx`, `companies.new.tsx` | A base-currency change deletes the exchange-rate overrides in one transaction; the time-zone cache is dropped; a new company is seeded with its Headquarters and the caller's job; group companies are for internal users only and the parent must be in the caller's group. Only `updateCompanyDetails` is published |
| `savePrinterRoute` / `testPrinterRoute` / `removePrinterRoute`, `assignPrinter`, `reprintPrintJob` / `deletePrintJob` / `viewPrintJobContent` | `printing.tsx`, `printing.$id.delete.tsx`, `printing.jobs.tsx` | Deleting a route clears every assignment that named it; each write drops the printer cache. `savePrinterRoute`, `testPrinterRoute`, `reprintPrintJob` and `viewPrintJobContent` are not published: the first three make the server POST to a URL the caller gives |
| `saveDocumentTemplate`, `saveDocumentSection` / `removeDocumentSection` | `x+/templates+/$type.tsx`, `x+/templates+/shared.tsx` | The header layout is saved onto its section first |
| `createApiKey` / `updateApiKey` / `revokeApiKey` | `api-keys.new.tsx`, `api-keys.$id.tsx`, `api-keys.delete.$id.tsx` | Key generation and hashing, the auth-cache busts; the plan lock stays in `@carbon/ee/api-keys.server`. Not published |
| `deactivateCompanyIntegration` | `integrations.deactivate.$id.tsx` | The plan check, the uninstall hook, the health cache |
| `setIntegrationSyncEnabled`, `transitionSyncOperations`, `suggestAccountMappings` / `saveAccountMappings`, `updateDimensionSync`, `saveDimensionValueMappings`, `updatePostingSync`, `saveOeeDeviceMapping` | `integrations.$id.tsx` (the drawer's tabs, one intent each) | Sync stays off until every required account is mapped; dimension slots are checked against the provider's targets; posting sync is saved in the v3 shape and keeps the reconciliation's keys; a device maps only when the provider reports it. The mapping writes go through Kysely and are not published, nor is the AI suggestion. The settings form's own save (install, Onshape authorization) is still composed in the route |
| `enableCompanyAuditLog` / `disableCompanyAuditLog` / `getAuditArchiveDownloadUrl` | `audit-logs.tsx` | The plan lock in `@carbon/ee/audit.server`; a controlled environment cannot disable |
| `getBillingPortalUrl` / `transferCompanyOwnership` | `billing.tsx` | The Stripe portal call is unchanged. Not published |
| `setRecordTags`, `setRecordCustomFields` | `tags.tsx`, `custom-fields.tsx` | Any record's tags or custom field values, under the caller's RLS. Not published |

A plan refusal from `@carbon/ee` (`EntitlementError`) comes back as an `entitlement` error, so these routes no longer `requireFeature`. The per-toggle writers these replaced are deleted; `updateCompany`, `updateCompanyWithBaseCurrencyChange`, `updateSubsidiary`, `upsertDocumentTemplate`, `upsertDocumentSection` and `deleteDocumentSection` stay as building blocks in `settings.service.ts` and are never tools.

## Key Service Functions

- `getCompanySettings` / `getCompany` / `getCompanies` / `getEmployeeCompanies` — the reads the rest of the app depends on (~78 files read company settings)
- `getNextSequence` (RPC `get_next_sequence`) / `getCurrentSequence` / `getSequence(s)` / `updateSequence` — document numbering
- `getDocumentTemplate` / `getDocumentTemplateConfig` / `upsertDocumentTemplate` — template read/write
- `getDocumentSections` / `getDocumentSectionsByIds` / `upsertDocumentSection` / `deleteDocumentSection` / `resolveSections` — sections; `resolveSections` seeds built-ins first, then lets a stored row of the same id override
- `getTerms` — company terms fallback for the Terms block; `getAccountsPayableBillingAddress` / `getAccountsReceivableBillingAddress` (+ `update*`) — addresses printed on documents
- `getCustomField(s)` / `getCustomFieldsTables`, plus `upsertCustomField` / `deleteCustomField` / `updateCustomFieldsSortOrder` (`settings.service.ts`, cache-clearing)
- `getIntegration(s)` / `getCompanyIntegrations` / `upsertCompanyIntegration` / `deactivateIntegration` / `getIntegrationsWithHealth`
- Webhook + API-key READ helpers stay here (`getWebhook(s)` / `getWebhookTables`, `getApiKey(s)`); the commercial AUTHORING writers moved to `@carbon/ee` behind the entitlement lock — `upsertApiKey` / `deleteApiKey` (`@carbon/ee/api-keys.server`, `API_KEYS`) and `upsertWebhook` / `deleteWebhook` / `deactivateWebhooks` (`@carbon/ee/webhooks.server`, `WEBHOOKS`)
- `insertCompany` / `insertSubsidiary` / `updateSubsidiary` / `deleteSubsidiary` / `seedCompany` / `updateCompany` / `updateCompanyPlan` — the building blocks of `createCompany` / `updateCompanyDetails` / `createSubsidiary` / `updateSubsidiaryDetails`
- The lease policy (the ASC 842 thresholds `leaseMajorPartThresholdPercent` / `leaseSubstantiallyAllThresholdPercent`, `leaseDefaultDiscountRate` and `leaseIncrementalBorrowingRate`, percentage points) — written by `updateAccountingSettings` from `x+/settings+/accounting.tsx` (intent `leasePolicy`); applies to later lease activations only. Revenue recognition has no setting of its own. The same page's General Ledger card has no switch: it shows "Accounting since {date}" from `companySettings.accountingCutoverDate`, or "Accounting is not set up" and a "Set up accounting" button to the enable wizard (`x+/accounting+/activation`, see accounting AGENTS). The test is `hasAccountingCutover` (`~/modules/accounting/accounting.utils`). After the cutover the card shows a warning alert when documents posted on or after the cutover have no journal: the loader awaits `hasLegacyDocuments` (one statement of EXISTS tests, `@carbon/database/accounting-cutover-reads`), because it decides whether the alert exists, and streams the count (`getLegacyDocumentCounts`, read with `useResolved`). The alert's "Write missing journals" button posts intent `journal-legacy`, which runs `writeMissingJournals` (`repairLegacyJournals` (`accounting.service.ts`, ported from the `journal-legacy-documents` server function)); it needs `update: settings` and `update: accounting`. The `accountingEnabled` column is unused
- Strict backflush (Settings → Items, `x+/settings+/items.tsx`, intents `requireBackflushStorageUnit` / `preventNegativeBackflush`): `updateItemsSettings` writes `companySettings.requireBackflushStorageUnit` / `preventNegativeBackflush`. The card's gaps are `getStrictBackflushGapCounts`, and its two drawers read `getActiveMethodsMissingPullFrom` / `getOpenJobsMissingStorageUnit` — all three building blocks in `settings.service.ts` (raw SQL through Kysely). Row types `MethodMissingPullFrom` / `JobMissingStorageUnit` are in `types.ts`. The feature itself: `apps/erp/app/modules/production/AGENTS.md` → Strict backflush.
- `updateLogoLight|LightIcon|Dark|DarkIcon|Watermark` — store the storage path on `company`, not a URL (readers prefix it)
- `listCompanyBackupFolders` / `deleteCompanyBackup` / `getCompanyRestoreRuns` / `getCompanyExportRun` (`backups.service.ts`); `exportCompanyBackup` (`settings.service.ts`, sends `carbon/company-export`); `getCompanyBackups` — the Backups loader's list, which computes each backup's live compatibility verdict via `@carbon/jobs/backups` — and the restore triggers live in `settings.service.ts`
- Planning (Settings → Planning, `x+/settings+/planning.tsx`, cards in `ui/Planning/`): every card saves through `updatePlanningSettings` — the reschedule tolerance, horizon and forecast consumption window (`companySettings`), and the action owner ladder: the company default, a location's (`setLocationResponsibleEmployee`, `location.responsibleEmployee`; it returns the row, since a user without `resources_update` matches none under RLS and the operation refuses that) and an item group's at a location (`upsertItemPostingGroupResponsibility`; updates in place so `createdBy` survives, inserts a new cell, and a null employee deletes the row), read back by `getItemPostingGroupResponsibilities`. Every employee named must be an active employee of the company. The item rung is `itemPlanning.responsibleEmployee`, edited on the item. The scheduled MRP time is `companySettings.mrpRunTime` (null = every 3 hours), edited on the same page. Cards and intents: `ResponsibleEmployeeCard` (`setCompanyDefault` / `setLocation` / `setItemGroup`), `RescheduleToleranceCard` (`setTolerance`), `PlanningHorizonCard` (`setPlanningHorizon`), `ForecastConsumptionCard` (`setForecastConsumption`), `MrpScheduleCard` (`setMrpSchedule`); validators `mrpScheduleValidator`, `rescheduleToleranceValidator`, `planningHorizonValidator`, `forecastConsumptionValidator` (`settings.models.ts`; `settings.models.mrp-schedule.test.ts`). The `companySettings` columns: `defaultResponsibleEmployee`, `rescheduleToleranceDays` (default 7), `defaultPlanningHorizonDays` (null = no fence), `forecastConsumptionBackwardPeriods` / `forecastConsumptionForwardPeriods` (defaults 4 / 1), `mrpRunTime` (TIME; null = every 3 hours — `useMrpScheduleDescription` in `~/hooks` renders it). Nav: `useSettingsSubmodules.tsx` → `path.to.planningSettings` (`/x/settings/planning`).
- `settings.service.ts` re-exports `resolveLabelLogo` from `@carbon/documents/labels` unchanged, and adds `getCompanyLogoForLabel`, which reads the company's logo storage paths fresh and expands them against `SUPABASE_INTERNAL_URL`; label routes (`file+/**/$id.labels[.]pdf|zpl`) feed that into `resolveLabelLogo` instead of `getCompany`'s public URLs (MES keeps its own copy at `apps/mes/app/services/labelLogo.server.ts`)

## Settings → Invoicing

`x+/settings+/invoicing.tsx` (`path.to.invoicingSettings`) is the one page for recurring invoices and the invoice-email defaults. Every card saves through `updateInvoicingSettings`. Cards, in order: **Recurring Invoices** (`companySettings.invoiceAutomation`, intent `invoiceAutomation`; default `Post and Email`; "Post and Send via Stripe" is refused until Stripe Connect is connected), **Receivables Email** (`accountsReceivableEmail` — the Reply-To and a CC on automated invoice emails), **Notifications** ("Also notify": `invoiceNotificationGroup`, intent `invoiceNotifications` — the company-wide digest on top of each owner's own), **Emails** (default customer CC) and **Centralized Billing Address** — the last two moved here from `settings+/sales.tsx`, which keeps "Require a Customer Contact and Location". The check that setting drives, `checkPartyContactRequirement`, now lives in `@carbon/lib/party-contact.server`; `party-contact.ts` here re-exports the client-safe `@carbon/lib/party-contact`.

## Document Preview

Two functions in `settings.service.ts` let the template editor render a draft layout against a **real record** instead of sample data:

- `listPreviewEntities(client, companyId, documentType)` — populates the editor's record picker. `LIST_CONFIG` is the gate: a document type absent from the map returns `[]` and can only preview sample data. Each entry is `{ view, idColumn, hasRevision? }` — currently `salesInvoice`→`salesInvoices`, `salesOrder`→`salesOrders`, `purchaseOrder`→`purchaseOrders`, `quote`→`quotes`, `stockTransfer`→`stockTransfer`. It selects the six most recent rows by `createdAt`, scoped by `companyId`.
- `hasRevision` marks the types whose records are revised — currently `purchaseOrder` and `quote`. It gates selecting `revisionId` (only those views carry the column, so requesting it from `salesInvoices` / `stockTransfer` would error) and switches the label to `withRevisionSuffix` (`@carbon/documents/utils`), so two revisions sharing one readable id don't render as indistinguishable options. Sales orders are deliberately excluded: the column exists but nothing writes it.
- `buildPreviewProps(client, companyId, companyGroupId, documentType, id, locale)` — mirrors the live PDF route loaders per type, returning the exact prop bag that document's PDF expects, or `null` when the type is unsupported or the record is missing (the caller then falls back to sample data). It always fetches `getCompany` + `getCompanySettings` as a base, gates the AP/AR billing address on the corresponding `companySettings` flag, and for `quote` additionally resolves an `exchangeRate` via `getCurrencyByCode`. Because it pulls readers from accounting, inventory, invoicing, purchasing, sales, and settings, **adding a preview-able document type means adding both a `LIST_CONFIG` entry and a `switch` arm**.

Consumers: `x+/templates+/$type.tsx` (loader → picker) and `x+/templates+/$type.preview.tsx` (action → `DOCUMENT_PDFS` → `renderToStream`). Both gate on `view: "settings"`; template saves need `update: "settings"`.

## Key Exports

```typescript
import { getCompanySettings, getNextSequence, getDocumentTemplateConfig } from "~/modules/settings/settings.service";
import { companyValidator, sequenceValidator, documentTemplateValidator } from "~/modules/settings/settings.models";
import { buildPreviewProps } from "~/modules/settings/settings.service"; // server-only
```

## Related Modules

- **shared** — `getCustomFieldsSchemas` (`shared.service.ts`) reads the fields defined here; `getApprovalRules` backs the Approval Rules UI that lives in `settings/ui/Approvals`
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
