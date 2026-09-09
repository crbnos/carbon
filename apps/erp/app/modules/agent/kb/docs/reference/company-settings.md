# Company settings

> The company record, its feature toggles, base currency, logos, and tags — the company-wide configuration every module reads from.

Everything in Carbon is scoped to a **company**, and two records hold its configuration: the `company` row (identity, address, currency, logos) and a paired `companySettings` row holding the company-wide feature flags and defaults. Settings live under **Settings** in the app, grouped into **Company**, **Modules**, and **System**. Every route is employee-only; **Billing** additionally needs company ownership on a Cloud environment, and **Companies** and **Backups** are internal-only.

## The company record

Edited under **Settings → Company**:

  - **name**: Company name.
  - **addressLine1 / addressLine2 / city / stateProvince / postalCode / countryCode**: The registered address. `addressLine1`, `city`, `postalCode`, and `countryCode` are required.
  - **baseCurrencyCode**: The currency every posted amount is expressed in. See [base currency](#base-currency).
  - **phone / fax / email / website**: Contact details.
  - **taxId / vatNumber / eori**: Tax registration identifiers printed on documents.
  - **logoLight / logoDark / logoLightIcon / logoDarkIcon / logoWatermark**: The five logo slots, edited under **Settings → Logos**: light/dark pairs for UI backgrounds, compact icon variants, and a watermark printed behind documents.
  - **parentCompanyId**: Set when this company is a subsidiary of another.
  - **isEliminationEntity**: Marks a consolidation-only company that nets intercompany pairs out of consolidated reports.
  - **companyGroupId**: Groups related companies for the company switcher.
  - **selectedModules**: Which modules this company turned on during onboarding.
  - **industryId / customIndustryDescription**: The industry chosen at onboarding.
  - **auditLogEnabled**: Whether change history is recorded. See `docs/reference/audit-log`.

Company membership is per-user: one login can hold several companies and switch through the company picker, and each company carries its own settings, currency, and numbering. Nothing crosses the boundary. A company with a `parentCompanyId` is a subsidiary; consolidation and elimination are covered in `docs/reference/intercompany`.

## Feature toggles and defaults

`companySettings` is a single row per company, edited across the **Settings → Modules** pages. These are the real column names:

  - **accountingEnabled**: Master switch for the ledger. When off, operations complete without posting journal entries.
  - **timeCardEnabled**: Turns on shop-floor time cards.
  - **consoleEnabled**: Enables the support/impersonation console.
  - **requireMfa**: Everyone needs an authenticator app to open this company. Edited from **Settings → System → Security**; locked on in controlled (ITAR) deployments. See `docs/reference/two-factor`.
  - **useMetric**: Whether material units default to metric.
  - **materialGeneratedIds**: Whether new materials get an auto-generated readable id.
  - **plmReleaseControl**: The release-control policy for item revisions.
  - **kanbanOutput**: What a Kanban card prints: `label`, `qrcode`, or `url`.
  - **productLabelSize / shelfLabelSize**: Default label sizes.
  - **updateLeadTimesOnReceipt**: Whether receiving recalculates supplier lead times.
  - **purchasePriceUpdateTiming**: When purchase prices refresh: `Purchase Invoice Post` or `Purchase Order Finalize`.
  - **maintenanceGenerateInAdvance / maintenanceAdvanceDays**: Whether preventive maintenance is generated ahead of time, and by how many days (1–90).
  - **samplingStandard**: The default inspection sampling standard.
  - **enforceInspectionFourEyes**: Requires a second person to sign off inspections.
  - **qualityIssueTarget**: The quality issue target used in reporting.
  - **assetTaxDepreciationEnabled / assetTaxRate**: Whether a separate tax-depreciation schedule is tracked for fixed assets, and its rate.
  - **showCustomerReadableId / showSupplierReadableId**: Whether customer/supplier readable ids are surfaced in the UI.
  - **inventoryShelfLife**: Every shelf-life knob in one blob. See `docs/reference/shelf-life`.
  - **digitalQuoteEnabled / digitalQuoteIncludesPurchaseOrders**: Whether customers get a digital quote, and whether it includes purchase orders.
  - **quoteLineCategoryMarkups**: Per-category default markups applied to quote lines.

The same row also carries the **notification groups** (who to notify for digital quotes, RFQ-ready, supplier quotes, job completions, dispatches, gauge-calibration expiry), the AP/AR email addresses, and default CC lists — see `docs/reference/notifications` for how they fan out.

`accountingEnabled` gates the *entire* ledger: off means jobs, shipments, and invoices complete but nothing posts, with no per-transaction exceptions. Turning it on mid-stream doesn't backfill past activity.

## Base currency

Every company has one `baseCurrencyCode`: the currency all *posted* amounts are stored and reported in, with foreign-currency transactions converted at their exchange rate before posting. It's chosen at onboarding and is the denomination of your whole history, so it isn't something you flip casually. A subsidiary can carry a different base currency from its parent; consolidation is where they meet.

## Theme and tags

Carbon ships eight color themes (Modern, Brutal, Cherry, Apricot, Lemon, Mint, Blueberry, Lavender). Theme is **per-person**, stored in a browser cookie rather than on the company record, so two people in one company can run different themes; document templates have their own separate theme setting. **Tags** are free-form labels scoped to a company *and* a table, so the same label can mean different things on items versus jobs, and vocabularies never leak across companies.

## Related system configuration

  - Numbering sequences The per-company generators behind every readable document number.
  - API keys Scoped secrets that let external systems call the Carbon API.
  - Approvals Approval rules that gate documents above a threshold.
  - Licensing Which features exist at all depends on plan and edition.

## Internals and troubleshooting

Settings nav groups come from `useSettingsSubmodules.tsx` (internal gates in `internalOnlyRoutes`). Company fields are validated by `companyValidator` (`settings.models.ts:81`; `baseCurrencyCode` required at `:77`); subsidiaries by `subsidiaryValidator` (`:279`); themes by `themeValidator` (`:306`, definitions in `packages/utils/src/themes.ts`). Reads: `getCompany` (`settings.service.ts:230`, rewrites logo paths to public URLs), `getCompanies` (`:139`), `getEmployeeCompanies` (`:183`, filters supplier/customer-only memberships), `getCompanySettings` (`:283`). `companySettings` columns are in `packages/database/src/types.ts:6653`; each Modules page saves through its own small validator (`timeCardSettingsValidator`, `consoleSettingsValidator`, `materialUnitsValidator`, `materialIdsValidator`, …). Tags live in the `tag` table via `getTagsList` / `insertTag` (`shared.service.ts:929`, `:987`). Theme is set by a cookie action (`routes/x+/account+/theme.tsx`).

### I can't find the Companies or Backups settings page
Internal-operator-only (`internalOnlyRoutes`). Tenants create and switch companies through onboarding and the company picker.

### I can't see the Billing settings page
Billing needs company ownership *and* a Cloud environment; self-hosted editions and non-owners don't get it.

### Nothing posts to the ledger though jobs and invoices complete
`accountingEnabled` is off. Turn it on under Settings → Modules; it does not backfill past activity.

### My theme changed but a colleague still sees the old one
Theme is per-user (a cookie), not per-company. Document templates carry a separate theme setting.

### I can't change the base currency
By design: it's the denomination of the whole posted history, chosen at onboarding. Subsidiary/parent currency differences reconcile at consolidation, not by switching a base.

### A Modules toggle does nothing I expect
Flags are read by modules at runtime, and the feature may also be gated by plan/edition. Check licensing before assuming the toggle is broken.
