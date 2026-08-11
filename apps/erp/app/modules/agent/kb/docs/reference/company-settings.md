# Company settings

> The company record, its feature toggles, base currency, logos, and tags — the company-wide configuration every module reads from.

Everything in Carbon is scoped to a **company**. Your login can belong to several companies, and each one carries its own address, base currency, logos, feature toggles, and numbering. Two records hold this configuration: the `company` row (identity, address, currency, logos) and a paired `companySettings` row (one-to-one, keyed on the same id) that holds the company-wide feature flags and defaults. This page is the map of what lives where.

Settings live under **Settings** in the app, grouped into **Company**, **Modules**, and **System** (`apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx`). Every route is employee-only; a few are gated further — **Billing** needs company ownership and a Cloud environment, and **Companies** and **Backups** are internal-only.

## The company record

The `company` table is the tenant's identity. Its fields come from the `companyValidator` (`apps/erp/app/modules/settings/settings.models.ts:81`) and are edited under **Settings → Company**.

  - **name**: Company name.
  - **addressLine1 / addressLine2 / city / stateProvince / postalCode / countryCode**: The registered address. `addressLine1`, `city`, `postalCode`, and `countryCode` are required.
  - **baseCurrencyCode**: The currency every posted amount is expressed in. See [base currency](#base-currency) below.
  - **phone / fax / email / website**: Contact details.
  - **taxId / vatNumber / eori**: Tax registration identifiers printed on documents.
  - **logoLight / logoDark / logoLightIcon / logoDarkIcon / logoWatermark**: Storage paths to the company's logos. See [logos](#logos).
  - **parentCompanyId**: Set when this company is a subsidiary of another. See [multiple companies](#multiple-companies).
  - **isEliminationEntity**: Marks a consolidation-only company used to eliminate intercompany pairs.
  - **companyGroupId**: Groups related companies for the company switcher.
  - **selectedModules**: Which modules this company turned on during onboarding.
  - **industryId / customIndustryDescription**: The industry chosen at onboarding — collected on the industry step, not the general company form.
  - **auditLogEnabled**: Whether change history is recorded. See `docs/reference/notifications`.
  - **suggestionNotificationGroup**: Who is notified when the AI suggestion engine surfaces something.

The service reads it with `getCompany(client, companyId)`, which rewrites each stored logo path to a public URL before returning (`settings.service.ts:230`).

## Multiple companies

company membership is per-user, so one login can hold several companies and switch between them. `getCompanies(client, userId)` returns every company a user can enter (`settings.service.ts:139`); the ERP is an employee app, so supplier- and customer-only memberships are filtered out by `getEmployeeCompanies` (`settings.service.ts:183`). Switching happens through the company picker, and each company you enter carries its own settings, currency, and numbering — nothing crosses the boundary.

Companies can also nest. A company with a `parentCompanyId` is a **subsidiary** (`subsidiaryValidator`, `settings.models.ts:279`); an `isEliminationEntity` company exists only to net intercompany transactions out of consolidated reports.

The **Companies** management screen and **Backups** are gated to internal operators (`internalOnlyRoutes` in `useSettingsSubmodules.tsx`). Most tenants create and switch companies through onboarding and the company picker, not this screen.

For consolidated reporting and the elimination flow, see `docs/reference/intercompany`.

## Feature toggles and defaults

`companySettings` is a single row per company (one-to-one with `company`, keyed on the same id). It holds the company-wide switches and defaults that individual modules read at runtime. Read it with `getCompanySettings(client, companyId)` (`settings.service.ts:283`). Each group of fields is edited on its own **Settings → Modules** page and saved through a small dedicated validator.

The flags below are the real column names from the `companySettings` row (`packages/database/src/types.ts:6653`).

  - **accountingEnabled**: Master switch for the ledger. When off, operations complete without posting journal entries. This is the gate the accounting flow checks before it posts anything.
  - **timeCardEnabled**: Turns on shop-floor time cards. Edited via `timeCardSettingsValidator`.
  - **consoleEnabled**: Enables the support/impersonation console. Edited via `consoleSettingsValidator`.
  - **useMetric**: Whether material units default to metric. Edited via `materialUnitsValidator`.
  - **materialGeneratedIds**: Whether new materials get an auto-generated readable id. Edited via `materialIdsValidator`.
  - **plmReleaseControl**: The release-control policy for item revisions.
  - **kanbanOutput**: What a Kanban card prints: `label`, `qrcode`, or `url`.
  - **productLabelSize / shelfLabelSize**: Default label sizes for product and shelf labels.
  - **updateLeadTimesOnReceipt**: Whether receiving recalculates supplier lead times.
  - **purchasePriceUpdateTiming**: When purchase prices refresh: `Purchase Invoice Post` or `Purchase Order Finalize`.
  - **maintenanceGenerateInAdvance / maintenanceAdvanceDays**: Whether preventive-maintenance work is generated ahead of time, and by how many days (1–90).
  - **samplingStandard**: The default inspection sampling standard.
  - **enforceInspectionFourEyes**: Requires a second person to sign off inspections.
  - **qualityIssueTarget**: The quality issue target used in reporting.
  - **assetTaxDepreciationEnabled / assetTaxRate**: Whether a separate tax-depreciation schedule is tracked for fixed assets, and its rate.
  - **showCustomerReadableId / showSupplierReadableId**: Whether customer/supplier readable ids are surfaced in the UI.
  - **inventoryShelfLife**: A single blob holding every shelf-life knob (near-expiry warning days, default shelf life, calculated-input scope, expired-entity policy). See `docs/reference/shelf-life`.
  - **digitalQuoteEnabled / digitalQuoteIncludesPurchaseOrders**: Whether customers get a digital quote, and whether it includes purchase orders.
  - **quoteLineCategoryMarkups**: Per-category default markups (material, part, tool, labor, machine, overhead, outside…) applied to quote lines.

Several fields on the same row are **notification groups** — arrays of who to notify for a given event (`digitalQuoteNotificationGroup`, `rfqReadyNotificationGroup`, `supplierQuoteNotificationGroup`, `inventoryJobCompletedNotificationGroup`, `salesJobCompletedNotificationGroup`, the maintenance/quality/operations/other `*DispatchNotificationGroup`s, and `gaugeCalibrationExpiredNotificationGroup`). Two AP/AR email addresses (`accountsPayableEmail`, `accountsReceivableEmail`) and default CC lists (`defaultSupplierCc`, `defaultCustomerCc`) live here too. For how these fan out to people, see `docs/reference/notifications`.

`accountingEnabled` gates the *entire* ledger. If it is off, jobs, shipments, and invoices still complete, but nothing posts to the general ledger — there are no partial or per-transaction exceptions. Turning it on mid-stream doesn't backfill past activity.

## Base currency

Every company has one `baseCurrencyCode`, set on the `company` row and required by `companyValidator` (`settings.models.ts:77`). It is the currency that all *posted* amounts are stored and reported in. Transactions in other currencies are converted to base at their exchange rate before they post, so the ledger stays single-currency.

Base currency is chosen at onboarding and is not something you flip casually — it's the denomination of your whole history. A subsidiary can carry a different base currency from its parent; consolidation is where those meet.

## Theme

Carbon ships eight themes, each supplying a full set of HSL CSS variables (`packages/utils/src/themes.ts`): **Modern** (`zinc`), **Brutal** (`neutral`), **Cherry** (`red`), **Apricot** (`orange`), **Lemon** (`yellow`), **Mint** (`green`), **Blueberry** (`blue`), and **Lavender** (`violet`). The set is validated by `themeValidator` (`settings.models.ts:306`).

Theme selection is stored in a cookie for the current user and browser, not on the company record — the action just sets a cookie via `setTheme` (`apps/erp/app/routes/x+/account+/theme.tsx`). Two people in the same company can each run a different theme. Document templates have their own, separate theme setting.

## Logos

The `company` row holds up to five logo slots: `logoLight`, `logoDark`, `logoLightIcon`, `logoDarkIcon`, and `logoWatermark`, edited under **Settings → Logos**. They are stored as storage paths; `getCompany` and `getCompanies` rewrite them to public URLs on read (`settings.service.ts:230`, `settings.service.ts:139`). The light/dark pairs cover light and dark UI backgrounds; the icon variants are the compact mark; the watermark prints behind documents.

## Tags

Tags are free-form labels scoped to a company and a table, stored in the `tag` table. They're loaded per table with `getTagsList(client, companyId, table)` and created with `insertTag` (`apps/erp/app/modules/shared/shared.service.ts:929`, `:987`). Because every tag carries both `companyId` and a `table`, the same label can mean different things on items versus jobs, and tag vocabularies never leak across companies.

## Related system configuration

A few more company-wide lookups live under **Settings → System** and have their own reference pages:

  - Numbering sequences The per-company generators behind every readable document number.
  - API keys Scoped secrets that let external systems call the Carbon API.
  - Approvals Approval rules that gate documents above a threshold.
  - Notifications How the notification groups above reach people.

Which company-wide features are available at all also depends on your plan and edition — see `docs/platform/licensing`.

## Troubleshooting

Mostly "why can't I see or change setting X" — the answers are preconditions, not error strings.

### I can't find the Companies or Backups settings page
Both are internal-operator-only, gated by `internalOnlyRoutes` in `useSettingsSubmodules.tsx`. Regular tenants don't get these screens — create and switch companies through onboarding and the company picker instead.

### I can't see the Billing settings page
Billing needs **company ownership** *and* a Cloud environment — it's gated on both (`useSettingsSubmodules.tsx`). Self-hosted/community editions and non-owner users won't see it.

### Nothing posts to the general ledger even though jobs and invoices complete
`accountingEnabled` is a company-wide master switch, not per-document. When it's off, jobs, shipments, and invoices still complete but nothing posts — there are no partial exceptions. Turn it on under **Settings → Modules**; note it does **not** backfill past activity.

### My theme changed but a colleague still sees the old one
Theme is per-user, not per-company. The action just sets a cookie via `setTheme` (`apps/erp/app/routes/x+/account+/theme.tsx`), so each person in the same company runs their own theme. Document templates carry a separate theme setting.

### I can't change the base currency
Base currency (`baseCurrencyCode`) is the denomination of your whole posted history and is chosen at onboarding — it's not meant to be flipped casually. A subsidiary can carry a different base currency from its parent; that difference is reconciled at consolidation, not by switching a company's base.

### A settings page (Modules) exists but the toggle does nothing I expect
`companySettings` flags are read by individual modules at runtime; the feature they gate may also depend on your plan and edition (see licensing). If a flag appears set but the feature is absent, check the edition gate before assuming the toggle is broken.
