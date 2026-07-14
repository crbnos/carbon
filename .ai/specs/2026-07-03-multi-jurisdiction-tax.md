# Multi-Jurisdiction Tax Compliance

> Status: draft (open questions resolved — ready for /plan)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-03
> Research notes: `.ai/research/multi-jurisdiction-tax.md`

## TLDR

Carbon's tax support today is a single flat `taxPercent` per line, defaulted from the customer record — and at posting time that tax is **credited into revenue** on the sales side and **capitalized into cost** on the purchase side; the `salesTaxPayableAccount` / `purchaseTaxPayableAccount` / `reverseChargeSalesTaxPayableAccount` fields that have existed in `accountDefault` since 2023 are dead config that no posting path reads. This spec introduces a unified multi-jurisdiction tax system built from the industry-consensus parts (research: SAP, NetSuite, Dynamics 365 BC, Odoo, Xero, Avalara), sized to Carbon's post-posting-group philosophy of **flat, direct configuration over classification matrices**: a **tax code** composed of **components** (one per jurisdiction/authority, each with its own rate and GL accounts — covering single-rate VAT and stacked US state+county+city alike); **direct assignment** of codes to customers, ship-to locations, and suppliers (the Xero model — two-hop resolution, no matrix), with address-based *suggestions* at assignment time and a single `taxable` boolean on items; an immutable **`taxLedger`** subledger written when documents post (the BC "VAT Entry" / SAP BSET pattern) that all tax reporting reads; **corrected GL posting** (revenue net of tax + per-component output-tax liability; recoverable input tax as an asset, with a non-recoverable flag preserving today's capitalize-into-cost behavior for US purchase tax); **reverse charge and US use-tax accrual** as compositions of the same paired-entry machinery; **memo tax** so credit/debit memos correctly unwind liability; company **tax registrations** that print on documents; **tax returns with settlement posting** (period-locked ledger rows, a settlement journal entry, and optional remittance through AP to the authority's supplier record); and an **Avalara AvaTax connector** (estimate on orders, committed transactions at posting, address validation, outage fallback) that swaps in behind the single `resolveLineTaxes` seam per company. Delivery is phased: Phase 1 determination + posting + ledger + reporting, Phase 2 returns/settlement + use tax, Phase 3 external engine + Xero tax mapping.

## Problem Statement

A manufacturer selling into several US states — or exporting from a VAT country — cannot use Carbon for tax compliance today:

- **One flat rate per customer.** `customer.taxPercent` (NUMERIC, 0..1) is copied onto quote/order/invoice lines ([sales.service.ts:1937](apps/erp/app/modules/sales/sales.service.ts), [20241105002325_quote-taxes-and-shipping.sql](packages/database/supabase/migrations/20241105002325_quote-taxes-and-shipping.sql)). There is no notion of *where* the goods ship (destination-based US sourcing), *what* is being sold (item taxability), or *which authority* the tax belongs to. A Texas customer with plants in Austin (8.25%) and a no-nexus state gets one rate for both.
- **Collected tax is booked as revenue.** `post-sales-invoice` computes the line total as `(qty × unitPrice + shipping + addOn) × (1 + taxPercent)` ([post-sales-invoice/index.ts:302-306](packages/database/supabase/functions/post-sales-invoice/index.ts)) and credits the **sales account** with that gross amount ([post-sales-invoice/index.ts:381-398](packages/database/supabase/functions/post-sales-invoice/index.ts)). Revenue is overstated by every dollar of tax collected, and no liability is recorded — there is nothing to remit against.
- **Recoverable input tax is buried in cost.** `post-purchase-invoice` folds `taxAmount` into line cost ([post-purchase-invoice/index.ts:449-458](packages/database/supabase/functions/post-purchase-invoice/index.ts)) and only ever posts to `payablesAccount`. For US purchase tax that is correct (tax is part of cost); for VAT jurisdictions it is wrong — input VAT is a receivable, and burying it in inventory misstates both.
- **The account plumbing exists but is dead.** `accountDefault.salesTaxPayableAccount`, `purchaseTaxPayableAccount`, and `reverseChargeSalesTaxPayableAccount` are referenced by **zero** posting paths (verified by grep across `packages/database/supabase/functions/`). The old per-type posting-group overrides are gone entirely — [20260229000000_drop-posting-groups.sql](packages/database/supabase/migrations/20260229000000_drop-posting-groups.sql) dropped the posting-group matrix in favor of flat `accountDefault` resolution (`functions/shared/get-posting-group.ts` → `getDefaultPostingGroup` now reads `accountDefault` directly).
- **Exemption metadata is inert.** The recent `customerTax` / `supplierTax` tables ([20260430000001_tax-status.sql](packages/database/supabase/migrations/20260430000001_tax-status.sql)) capture `taxExempt`, exemption reason, and certificate number/file — but nothing reads `taxExempt` during calculation (verified: it appears only in forms and a header badge). An exempt customer with a resale certificate is still charged their `taxPercent`.
- **Memos can't carry tax.** The `memo` table ([20260630093809_ar-ap-payments.sql:310](packages/database/supabase/migrations/20260630093809_ar-ap-payments.sql)) is a header-only document (single `amount`, `direction` Credit/Debit, reason account) — a credit memo against a taxed invoice cannot reduce the tax liability.
- **No reporting, no returns.** There is no record of taxable vs exempt bases by jurisdiction, so even the simplest filing question — "what do I owe Texas for Q2?" — is unanswerable, and there is no way to mark a period's tax as filed or post the settlement.

Every surveyed ERP (SAP, NetSuite, BC, Odoo, Xero — see research) solves this with the same architecture: tax codes with per-jurisdiction components → posting to dedicated tax accounts → an immutable tax subledger → registrations gating scope → returns built from the subledger. None of it exists in Carbon.

## Proposed Solution

### One model for VAT, GST, and US sales tax

Follow the unified pattern (Odoo/Xero/Avalara — research consensus #2 answer) rather than BC's parallel VAT-vs-sales-tax subsystems:

- **`taxCode`** — a named treatment ("TX – Austin", "UK Standard 20%", "EU Reverse Charge", "Export Zero-Rated") with a `calculationType` (`Normal` | `Reverse Charge`), a `reportingCategory` (`Standard` | `Reduced` | `Zero-Rated` | `Exempt` | `Reverse Charge` | `Export` | `Out of Scope` — the attribute return layouts build on), an optional `invoiceMessage` (BC's VAT clause: "Reverse charge — VAT to be accounted for by the recipient"), and optional **address-match fields** (`countryId`, `state`) used to *suggest* the right code when assigning parties (never to silently resolve at document time).
- **`taxCodeComponent`** — 1..n rows per code: component name ("TX State", "City of Austin"), `taxAuthorityId`, `rate`, `sequence`, `isCompound` (tax-on-tax, applied in sequence order), `isRecoverable` (purchase side: `true` = input tax posts to an asset account, `false` = capitalize into cost — unifies VAT and US purchase-tax behavior with one flag), optional per-component GL accounts (`salesTaxAccountId`, `purchaseTaxAccountId`, falling back to `accountDefault`), and `effectiveDate`/`expirationDate` for rate changes (BC Tax Detail pattern: to change a rate, expire the old component row and add a new one; determination picks rows effective at the document date).
- **`taxAuthority`** — who you remit to (Texas Comptroller, HMRC), with an optional `supplierId` link so remittance becomes an ordinary payable (NetSuite's agency-as-vendor pattern — this is what Phase 2 settlement-to-AP builds on).

UK VAT = one code, one component. Texas = one code, two to four components. Canada GST+PST = two components, PST optionally compound. The effective line rate is the compound-aware sum of effective components, and it lands in the existing `taxPercent` column — so every downstream consumer (invoice-total views from [20260604120000_invoice-totals-computed-in-views.sql](packages/database/supabase/migrations/20260604120000_invoice-totals-computed-in-views.sql), PDF math in `packages/documents/src/utils/sales-invoice.ts`, Xero sync) keeps working unchanged.

### Determination: direct assignment, no matrix

Carbon already tried the classification-matrix approach for GL accounts — customerType × itemPostingGroup posting groups — and **deliberately removed it** ([20260229000000_drop-posting-groups.sql](packages/database/supabase/migrations/20260229000000_drop-posting-groups.sql)) because the indirection was confusing; flat `accountDefault` resolution won. Tax determination follows the same philosophy, which is exactly Xero's model (per-contact default tax type + line override — research):

- **Customers** get a `taxCodeId` (their default treatment). **Ship-to locations** (`customerLocation.taxCodeId`) override it for destination-based accuracy — the customer with an Austin plant and a California plant has a code on each location. **Suppliers** get a `taxCodeId` that defaults purchase lines (the supplier's invoice remains authoritative for amounts).
- **Items** get a single **`taxable` boolean** (default `true`). Non-taxable items zero the line's tax and write an exempt-base ledger row. Rarer item-level distinctions (reduced-rate goods, state-specific service taxability) are a **line-level override** — pick a different code on the line; the long tail is the Avalara engine (Phase 3).
- **Suggestion, not magic**: when a customer/location/supplier is created or its address edited, Carbon suggests active codes whose `countryId`/`state` match the address ("This address is in Texas — apply *TX – Austin*?"). The user confirms; documents then resolve deterministically from what was assigned. No document-time address inference, so a posted invoice's tax is always explainable by two fields.

Resolution for a sales line (`resolveLineTaxes`):

1. **Exempt customer?** `customerTax.taxExempt` → zero tax, no code; exemption reason and certificate number snapshot into the tax ledger at posting (exempt sales are *recorded*, not skipped — research consensus #6).
2. **Non-taxable item?** `item.taxable = false` → zero tax; ledger row carries the base as exempt.
3. **Code**: ship-to `customerLocation.taxCodeId` → `customer.taxCodeId` → none.
4. Resolved code stamps `taxCodeId` + computed `taxPercent` on the line (override allowed, audit-logged per OQ 3).
5. **No code** → fall back to today's behavior (`customer.taxPercent`, manual edit allowed). Companies that configure nothing see zero behavior change in determination.

**Document-level shipping** is taxed at the document's resolved code when `companySettings.shippingIsTaxable` is on (OQ 5 resolution); off (default) keeps shipping untaxed, today's behavior.

**Nexus semantics**: assignment *is* the nexus switch — a customer/location with no code (in a state where you aren't registered) gets no tax, mirroring Avalara's "no declared nexus → zero tax" (research consensus #5). The registrations page cross-warns: codes whose match fields point at a country/state with no active `taxRegistration`, and registrations with no matching code.

### The tax subledger: `taxLedger`

The BC VAT Entry / SAP BSET pattern (research consensus #3). When `post-sales-invoice` / `post-purchase-invoice` / memo posting post, they write one immutable `taxLedger` row per line per component: source (Sales/Purchase), document + line, journal id, code + component snapshots (name, authority, rate — self-contained even if config is later edited), taxable base, tax amount, exempt base, exemption reason, party, posting date, currency + exchange rate (amounts stored in base currency, journal parity). Exempt, non-taxable-item, and zero-rated lines write rows with `exemptAmount` — returns need exempt bases. VOID re-posting (the existing pattern in `post-sales-invoice`) writes reversing rows. Drafts never hit the ledger; they compute live from current components, so unposted documents float with rate changes and posted documents are frozen. Rows carry a nullable `taxReturnId` — stamped when a return is finalized (Phase 2), making filed rows immutable-by-inclusion (BC's open/closed VAT entries).

### Corrected GL posting

The behavior fix (research consensus #4), inside the existing edge functions:

| Path | Today | After |
|------|-------|-------|
| Sales invoice | Dr AR gross / Cr Revenue **gross** | Dr AR gross / Cr Revenue **net** / Cr output tax per component (`component.salesTaxAccountId` → `accountDefault.salesTaxPayableAccount`) |
| Purchase invoice (non-recoverable or no code) | Dr cost gross / Cr AP gross | unchanged — tax capitalizes into cost (correct for US purchase tax) |
| Purchase invoice (recoverable components) | — | Dr cost **net** / Dr input tax per component (`component.purchaseTaxAccountId` → `accountDefault.purchaseTaxPayableAccount`) / Cr AP gross |
| Purchase invoice (Reverse Charge code, recoverable) | — | Dr input tax / Cr `accountDefault.reverseChargeSalesTaxPayableAccount` — paired entries netting zero, both sides in the ledger (research consensus #7); AP stays net (supplier charged no tax) |
| Purchase invoice (Reverse Charge code, non-recoverable) = **US use tax** | — | Dr cost **gross of accrued tax** (capitalize) / Cr use-tax liability (`reverseChargeSalesTaxPayableAccount` or component account); AP stays net — self-assessment when the supplier didn't charge tax (BC Use Tax / Provincial Tax pattern) |
| Credit memo (customer, taxed) | Dr reason gross / Cr AR gross | Dr reason **net** / Dr output tax (unwinding liability) / Cr AR gross — negative `taxLedger` rows |

**Use tax falls out of the existing flags** (elegant composition, no new machinery): `calculationType = 'Reverse Charge'` produces the self-assessed paired entry; `isRecoverable = false` routes the debit side into cost instead of an input-tax asset. A purchase line whose supplier charged no tax gets an "Accrue use tax" affordance (Phase 2) where the user picks the applicable Reverse Charge code — the accrual posts with no AP impact.

Legacy lines (manual `taxPercent`, no `taxCodeId`) get the same sales-side fix, posting to `accountDefault.salesTaxPayableAccount` — one consistent rule instead of a config-dependent bug (OQ 1 resolution). Rounding is **per line, half-up, at currency precision** — matching how tax is computed and displayed today and Avalara's default for new companies; document-level rounding is explicitly out of scope.

### Memo tax (OQ 2 resolution)

`memo` gains `taxCodeId` + `taxAmount`. Semantics preserve the AR/AP tie-out contract: `memo.amount` remains **the gross figure that hits AR/AP** (unchanged for existing rows, views, and the net-model tie-out); `taxAmount` is the tax portion *within* it (auto-computed as `amount × r/(1+r)` from the resolved code — defaulted from the party's assigned code — and editable before posting). Posting splits: AR/AP gross (unchanged), reason account net, tax account per component with direction-aware sign; `taxLedger` rows are negative for Credit memos against sales (liability unwound) and mirrored for the other three direction/party combinations. Memos with no tax code post exactly as today.

### Registrations and documents

- **`taxRegistration`**: country (+ optional state/region), registration number, effective/end dates. Frames the liability report and prints on sales documents (the registration matching the company's country — EU invoices legally require the seller's VAT number; `company.taxId` remains as the fallback display value).
- Sales invoice PDFs gain a tax summary block grouped by component/authority (jurisdiction breakdown), the resolved codes' `invoiceMessage` clauses, and the customer's VAT number (already captured in `customerTax.vatNumber`) when the code is Reverse Charge/Export — the B2B compliance trifecta.

### Reporting: liability, returns, settlement

- **Tax liability report** (Phase 1): group `taxLedger` over a date range by authority → component: **taxable base, exempt base, tax collected (sales), input tax (purchases), net due**. Answers the US filing question and the VAT question (output − recoverable input) from the same rows. CSV export via the existing table-export path.
- **Tax returns** (Phase 2): a `taxReturn` document (period start/end, optional authority scope, status `Draft → Finalized`, totals snapshot). Finalizing a return stamps `taxReturnId` on the included `taxLedger` rows (they can never be claimed by another return) and **posts the settlement journal entry**: Dr each output-tax account, Cr each input-tax account, net to `accountDefault.taxSettlementAccount` (BC "Calc. and Post VAT Settlement" pattern). When the return's authority has a linked `supplierId`, Carbon offers to **create a draft purchase invoice to that supplier for the net due** — remittance flows through normal AP and payments (the NetSuite pay-tax-liabilities pattern). Late-arriving documents dated inside a finalized period simply land in the next return (their rows are unstamped), matching Odoo's tax-lock semantics without blocking postings — the period-closing spec's `Locked`/`Closed` statuses provide the hard boundary when both features are active.
- **Return layouts** (Phase 2): `taxReturnLayout` + `taxReturnLayoutLine` map ledger aggregates to official return boxes (BC VAT Statement / Xero ReportTaxType pattern): each line has a box label/number, a source (`Sales` | `Purchase`), an aggregate (`Tax` | `Taxable Base` | `Exempt Base`), and filters (reporting categories and/or specific tax codes), plus row-totaling. A built-in generic layout (liability by authority + VAT summary by reporting category) works with zero configuration; a UK-MTD-shaped 9-box layout ships as a seeded example.

### External engine: Avalara AvaTax connector (Phase 3)

All determination flows through `resolveLineTaxes` (app service) and a shared edge-function helper (`functions/shared/resolve-taxes.ts`, following the existing `functions/shared/` helper precedent — `get-accounting-period.ts`, `get-next-sequence.ts`). Phase 3 implements the Avalara engine behind that seam, following the research-verified API contract:

- **Company integration** (`companyIntegration`, the Xero precedent in `packages/ee`): account id, license key, company code, environment; per-company toggle "use AvaTax for determination" — when enabled, the resolver delegates to Avalara.
- **Estimates**: quotes/orders call `CreateTransaction` with type `SalesOrder` (temporary, never persisted by Avalara); results fill `taxPercent` + a component preview.
- **Committed documents**: `post-sales-invoice` calls type `SalesInvoice` with `commit: true`, `code` = Carbon invoice id (idempotent — re-posting overwrites uncommitted docs; committed conflicts surface as errors); the response's per-jurisdiction `details[]` map 1:1 into `taxLedger` rows (the component-row shape was designed to be isomorphic to Avalara's response). VOID calls `VoidTransaction`.
- **Address validation**: `ResolveAddress` action on customer/location forms (US/CA), the Avalara ERP-guide placement.
- **Exemptions**: `entityUseCode` derived from the existing `taxExemptionReason` enum; certificate numbers pass through.
- **Outage fallback** (Avalara ERP guide): on API failure, fall back to the internal codes, flag the document (`taxLedger.needsEngineReconciliation`), and provide a reconcile action that re-runs committed transactions once the service recovers — never silently commit guessed tax.
- **Nexus mirror**: registrations page compares Carbon `taxRegistration` rows against declared Avalara nexuses and warns on drift.

### Xero tax mapping (Phase 3)

The Xero syncer currently emits `TaxType: "OUTPUT" | "NONE"` from `taxPercent` ([packages/ee/src/accounting/providers/xero/entities/invoice.ts](packages/ee/src/accounting/providers/xero/entities/invoice.ts)). Phase 3 maps `taxCode` → Xero `TaxType` through the existing `externalIntegrationMapping` table (entityType `taxCode`), with per-code assignment in the tax-codes UI when a Xero integration is active; unmapped codes keep today's OUTPUT/NONE behavior.

### Delivery phases

| Phase | Scope | Depends on |
|-------|-------|-----------|
| **1 — Determine, post, report** | Schema; tax codes/components/authorities/registrations CRUD + UI; direct assignment on customers/locations/suppliers with address suggestions; `item.taxable`; `resolveLineTaxes` on quotes/orders/invoices/memos; corrected posting (sales split, recoverable input tax, reverse charge); memo tax; shipping taxability setting; exemption wiring; `taxLedger`; PDF tax blocks; liability report; `customer.taxPercent` sunset UX | — |
| **2 — Returns & self-assessment** | `taxReturn` finalize + settlement JE + AP remittance; return layouts (+ seeded generic & UK layouts); use-tax accrual affordance on purchase lines | Phase 1 |
| **3 — Engines & sync** | Avalara connector (estimates, committed docs, address validation, fallback, nexus mirror); Xero tax-code mapping | Phase 1 (2 for returns interplay) |

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Unified vs dual tax systems | One model: `taxCode` + components covers VAT, GST, and stacked US jurisdictions | Research consensus — BC's VAT/sales-tax split is NAV legacy; Odoo/Xero/Avalara prove components subsume both; Carbon gets one determination path, one ledger, one report |
| Determination shape | **Direct assignment** (`customerLocation.taxCodeId` → `customer.taxCodeId`), item `taxable` boolean, line override — **no classification matrix** | Carbon dropped the posting-group matrix for exactly this confusion ([20260229000000_drop-posting-groups.sql](packages/database/supabase/migrations/20260229000000_drop-posting-groups.sql)); Xero's per-contact default + line override is the proven SMB model; two-hop resolution is explainable at a glance |
| Address handling | Match fields on `taxCode` drive *suggestions* at assignment time; documents never infer from addresses | Deterministic, auditable document tax; no silent behavior change when an address is edited; rooftop accuracy is the Avalara engine's job (Phase 3) |
| Item-side granularity | `item.taxable` boolean; finer distinctions via line override or Avalara | Reduced-rate/item-class-per-region matrices are the confusing 20%; manufacturing B2B is overwhelmingly standard-rated; boolean covers the common non-taxable-service case |
| Rate storage on lines | Keep `taxPercent`, auto-filled from the resolved code; add nullable `taxCodeId` | Views, PDF math, and Xero sync consume `taxPercent` today — zero churn there; null `taxCodeId` = legacy manual behavior |
| Historical immutability | `taxLedger` snapshot rows at posting; drafts compute live; finalized returns stamp rows | BC VAT Entry / SAP BSET pattern; config edits must never change posted documents; returns need bases, which GL doesn't hold |
| Tax accounts | Per-component accounts with `accountDefault` fallback | Accounts-on-the-code is the consensus (BC jurisdictions, SAP account keys, Xero rates, Odoo repartition); matches the flat `accountDefault` philosophy — no per-type overrides |
| Purchase-side recoverability | `isRecoverable` flag per component; non-recoverable capitalizes (today's behavior), recoverable posts to input-tax asset | Unifies US purchase tax and VAT with one flag (BC Expense/Capitalize, Xero IsNonRecoverable, SAP NVV); default `false` preserves current behavior until configured |
| Reverse charge & use tax | `calculationType = 'Reverse Charge'` → paired self-assessed entries; `isRecoverable` picks EU reverse charge (recoverable) vs US use tax (capitalize + accrue) | One mechanism, two regimes (SAP/BC pattern); activates the existing `reverseChargeSalesTaxPayableAccount`; use-tax code picked explicitly on the line (Phase 2) |
| Memo tax semantics | `memo.amount` stays gross (the AR/AP figure); `taxAmount` = tax within it, back-computed `amount × r/(1+r)`, editable | Preserves the AR/AP net-model tie-out contract and all existing memo rows/views; posting splits reason-account net vs tax with direction-aware signs |
| Exemptions | `customerTax.taxExempt` short-circuits determination; reason + certificate snapshot to ledger; non-taxable items write exempt bases | Wires existing inert metadata; exempt sales write ledger rows because returns report exempt bases (research consensus #6) |
| Rate changes | `effectiveDate`/`expirationDate` on components; resolver filters by document date | BC Tax Detail / SuiteTax validity pattern; jurisdictions change rates on fixed dates and backdated documents are routine |
| Rounding | Per line, half-up, currency precision; document-level out of scope | Matches existing per-line computation and Avalara's default; keeps invoice-total views untouched |
| Returns model | `taxReturn` stamps ledger rows on finalize + posts settlement JE; late documents roll to the next return | BC settlement + Odoo tax-lock semantics without blocking postings; hard period boundaries come from the period-closing spec when both ship |
| Settlement remittance | Net due → `accountDefault.taxSettlementAccount`; optional draft AP invoice to the authority's linked supplier | NetSuite agency-as-vendor pattern; remittance rides existing AP + payments rails |
| Return layouts | `taxReturnLayout(Line)` filtered by reporting category / tax code with box labels; generic + UK layouts seeded | BC VAT Statement / Xero ReportTaxType pattern; box mapping is config, the code stays jurisdiction-neutral |
| External engine | Avalara connector behind the `resolveLineTaxes` seam; SalesOrder estimates, committed SalesInvoice at posting keyed by invoice id; internal fallback with reconcile flag | NetSuite SuiteTax plug-in pattern + Avalara ERP integration guide; ledger rows isomorphic to Avalara `details[]` by design |
| Registrations vs nexus | `taxRegistration` records registrations; code assignment drives collection; UI cross-warns; Phase 3 mirrors against Avalara nexuses | Avalara/Stripe registration-gating semantics without blocking legitimate edge cases |
| Multi-tenancy (heuristic 1) | Every new table: `companyId`, composite PK `("id","companyId")`, `id()` default, audit columns, `customFields` on config tables | House convention; child FKs reference `("id","companyId")` composites |
| Service shape (heuristic 2) | All new functions in `accounting.service.ts` / `accounting.models.ts`, `(client, companyId, ...)` → `{data, error}`, never throw | One module service file per house rule; tax is accounting-owned like currencies and payment terms |
| RLS (heuristic 3) | Four standard policies per table; SELECT via `get_companies_with_employee_role()`, writes via `get_companies_with_employee_permission('accounting_*')` | Config is accounting-gated; `taxLedger` writes happen via service-role posting functions, INSERT policy still defined for completeness |
| Permission scoping (heuristic 4) | Tax config + returns routes: `view/update: "accounting"`; determination runs inside existing sales/purchasing document permissions; line overrides keep document permissions + audit log (OQ 3) | Matches currencies/payment-terms precedent; audit posture without shop-floor friction |
| Form pattern (heuristic 5) | `ValidatedForm` + zod validators (`taxCodeValidator`, `taxRegistrationValidator`, …) + route actions; Drawer overlays for detail views | House convention + drawer-detail feedback rule |
| Module layout (heuristic 6) | No new module; accounting module + `ui/Tax/` component folder; routes under `x+/accounting+/tax-*`; Avalara code in `packages/ee` | Tax config is accounting settings; integrations live in ee (Xero precedent) |
| Backward compatibility (heuristic 7) | All new columns nullable (or defaulted to current behavior); no backfill; views recreated via DROP + `SELECT *`; `customer.taxPercent` hidden once codes are assigned, with a migration banner (OQ 4); sales-side posting fix applies to all lines (OQ 1, approved) | Unconfigured companies behave identically except the approved posting correction |

## Data Model Changes

One idempotent migration for Phase 1 (`pnpm db:migrate:new multi-jurisdiction-tax`, randomized HHMMSS) + a Phase 2 migration for returns; `pnpm run generate:types` after each. Sketch (audit columns, indexes on `companyId` + every FK, and the four standard RLS policies apply to every table; abbreviated here):

```sql
-- Enums (capitalized display values; additive-only later)
CREATE TYPE "taxCalculationType" AS ENUM ('Normal', 'Reverse Charge');
CREATE TYPE "taxReportingCategory" AS ENUM
  ('Standard', 'Reduced', 'Zero-Rated', 'Exempt', 'Reverse Charge', 'Export', 'Out of Scope');
CREATE TYPE "taxLedgerSource" AS ENUM ('Sales', 'Purchase');
CREATE TYPE "taxReturnStatus" AS ENUM ('Draft', 'Finalized');            -- Phase 2

CREATE TABLE "taxAuthority" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierId" TEXT,                          -- optional: remit via AP to this supplier
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("supplierId", "companyId") REFERENCES "supplier"("id", "companyId")
);
-- + UNIQUE ("companyId", "name")

CREATE TABLE "taxCode" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,                       -- "TX – Austin", "UK Standard 20%"
    "description" TEXT,
    "calculationType" "taxCalculationType" NOT NULL DEFAULT 'Normal',
    "reportingCategory" "taxReportingCategory" NOT NULL DEFAULT 'Standard',
    "invoiceMessage" TEXT,                      -- VAT clause printed on documents
    "countryId" INTEGER REFERENCES "country"("id"),  -- address-match SUGGESTION keys
    "state" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    -- audit columns, customFields …
    PRIMARY KEY ("id", "companyId")
);
-- + UNIQUE ("companyId", "name")

CREATE TABLE "taxCodeComponent" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "taxCodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,                       -- "TX State", "City of Austin"
    "taxAuthorityId" TEXT,
    "rate" NUMERIC NOT NULL,                    -- 0..1
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "isCompound" BOOLEAN NOT NULL DEFAULT FALSE,     -- tax-on-tax, applied in sequence
    "isRecoverable" BOOLEAN NOT NULL DEFAULT FALSE,  -- purchase side: FALSE = capitalize (today's behavior)
    "salesTaxAccountId" TEXT,                   -- fallback: accountDefault.salesTaxPayableAccount
    "purchaseTaxAccountId" TEXT,                -- fallback: accountDefault.purchaseTaxPayableAccount
    "effectiveDate" DATE,                       -- NULL = always; rate change = expire + new row
    "expirationDate" DATE,
    -- audit columns …
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId") ON DELETE CASCADE,
    FOREIGN KEY ("taxAuthorityId", "companyId") REFERENCES "taxAuthority"("id", "companyId")
);

CREATE TABLE "taxRegistration" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "countryId" INTEGER NOT NULL REFERENCES "country"("id"),
    "state" TEXT,
    "registrationNumber" TEXT NOT NULL,
    "effectiveDate" DATE,
    "endDate" DATE,
    -- audit columns, customFields …
    PRIMARY KEY ("id", "companyId")
);

CREATE TABLE "taxLedger" (
    "id" TEXT NOT NULL DEFAULT id('txl'),
    "companyId" TEXT NOT NULL,
    "source" "taxLedgerSource" NOT NULL,
    "documentType" TEXT NOT NULL,               -- 'Sales Invoice' | 'Purchase Invoice' | 'Memo'
    "documentId" TEXT NOT NULL,
    "documentLineId" TEXT,
    "journalId" TEXT,                           -- GL traceability
    "postingDate" DATE NOT NULL,
    "taxCodeId" TEXT,                           -- NULL for legacy/exempt lines
    "taxCodeComponentId" TEXT,
    "componentName" TEXT,                       -- snapshots: self-contained if config edited
    "taxAuthorityId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "rate" NUMERIC NOT NULL DEFAULT 0,
    "taxableAmount" NUMERIC NOT NULL DEFAULT 0, -- base currency
    "taxAmount" NUMERIC NOT NULL DEFAULT 0,     -- base currency; negative on VOID/credit-memo reversal
    "exemptAmount" NUMERIC NOT NULL DEFAULT 0,  -- exempt customer, non-taxable item, zero-rated
    "taxExemptionReason" "taxExemptionReason",  -- existing enum, snapshotted (NULL for non-taxable items)
    "exemptionCertificateNumber" TEXT,
    "currencyCode" TEXT,
    "exchangeRate" NUMERIC,
    "taxReturnId" TEXT,                         -- Phase 2: stamped on return finalize
    "needsEngineReconciliation" BOOLEAN NOT NULL DEFAULT FALSE,  -- Phase 3: engine-outage flag
    "postedToInputAccount" BOOLEAN NOT NULL DEFAULT FALSE,       -- recoverable input-tax leg (liability report reads this)
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),   -- required by audit-injection; stays NULL
    PRIMARY KEY ("id", "companyId")
);
-- indexes: ("companyId","postingDate"), ("companyId","documentId"),
--          ("companyId","taxAuthorityId"), ("companyId","taxReturnId")

-- Phase 2
CREATE TABLE "taxReturn" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "taxReturnId" TEXT NOT NULL,                -- readable id via get_next_sequence
    "taxAuthorityId" TEXT,                      -- NULL = all authorities
    "taxReturnLayoutId" TEXT,                   -- NULL = built-in generic layout
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "taxReturnStatus" NOT NULL DEFAULT 'Draft',
    "totals" JSONB,                             -- snapshot at finalize (per box/component)
    "journalId" TEXT,                           -- settlement entry
    "remittanceInvoiceId" TEXT,                 -- optional draft AP invoice
    "finalizedAt" TIMESTAMP WITH TIME ZONE,
    "finalizedBy" TEXT REFERENCES "user"("id"),
    -- audit columns, customFields …
    PRIMARY KEY ("id", "companyId")
);

CREATE TABLE "taxReturnLayout" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,                       -- "UK VAT Return (9 boxes)"
    -- audit columns …
    PRIMARY KEY ("id", "companyId")
);

CREATE TABLE "taxReturnLayoutLine" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "taxReturnLayoutId" TEXT NOT NULL,
    "boxNumber" TEXT NOT NULL,                  -- "1", "6", …
    "label" TEXT NOT NULL,                      -- "VAT due on sales"
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "source" "taxLedgerSource",                 -- NULL for row-totaling lines
    "aggregate" TEXT,                           -- 'Tax' | 'Taxable Base' | 'Exempt Base'
    "reportingCategories" "taxReportingCategory"[],
    "taxCodeIds" TEXT[],                        -- optional narrower filter
    "rowTotaling" TEXT,                         -- "1+2-3" style, BC pattern
    -- audit columns …
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("taxReturnLayoutId", "companyId")
      REFERENCES "taxReturnLayout"("id", "companyId") ON DELETE CASCADE
);
```

Column additions (all nullable or defaulted to current behavior, no backfill):

```sql
-- Phase 1
ALTER TABLE "item"             ADD COLUMN "taxable" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "customer"         ADD COLUMN "taxCodeId" TEXT;       -- FK taxCode
ALTER TABLE "customerLocation" ADD COLUMN "taxCodeId" TEXT;       -- ship-to override
ALTER TABLE "supplier"         ADD COLUMN "taxCodeId" TEXT;
ALTER TABLE "companySettings"  ADD COLUMN "shippingIsTaxable" BOOLEAN NOT NULL DEFAULT FALSE;  -- OQ 5
ALTER TABLE "quoteLine"           ADD COLUMN "taxCodeId" TEXT;
ALTER TABLE "salesOrderLine"      ADD COLUMN "taxCodeId" TEXT;
ALTER TABLE "salesInvoiceLine"    ADD COLUMN "taxCodeId" TEXT;
ALTER TABLE "purchaseOrderLine"   ADD COLUMN "taxCodeId" TEXT;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN "taxCodeId" TEXT;
ALTER TABLE "memo"                ADD COLUMN "taxCodeId" TEXT;    -- OQ 2
ALTER TABLE "memo"                ADD COLUMN "taxAmount" NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE "accountDefault"      ADD COLUMN "taxSettlementAccount" TEXT;  -- Phase 2 posting target
```

Affected views (`customers`, `suppliers`, `quoteLines`/order/invoice line views, memo views) are dropped and recreated with `SELECT *` per the view-redefinition rule, each forked from its **newest** migration definition. Every DDL statement is idempotency-guarded (`IF NOT EXISTS` / `DO $$ … duplicate_object`) per the migration-idempotency rule.

## API / Service Changes

All in `apps/erp/app/modules/accounting/` (models + service; no new files):

- **CRUD**: `get/upsert/deleteTaxCode` (+ components batch upsert), `…TaxAuthority`, `…TaxRegistration`, `…TaxReturnLayout` — standard `(client, companyId, …) → {data, error}` shape, list variants with `GenericQueryFilters`.
- **`resolveLineTaxes(client, companyId, args)`** — the determination seam: `{ source: "sales" | "purchase", customerId?/supplierId?, customerLocationId?, itemId?, date }` → `{ taxCodeId, taxPercent, components[], exempt, exemptionReason }`. Pure lookup (exempt check → item taxable check → location code → party code), no writes; internally dispatches to the internal codes or (Phase 3) the Avalara engine per company setting. Called by the quote/order/invoice/memo line create-and-update paths in `sales.service.ts`, `purchasing.service.ts`, and `invoicing.service.ts` where `customer.taxPercent` is copied today (e.g. [sales.service.ts:1937](apps/erp/app/modules/sales/sales.service.ts)); also exposed as a route action for the "recalculate taxes" affordance when ship-to changes.
- **`suggestTaxCode(client, companyId, { countryId?, state? })`** — returns active codes whose match fields fit the address; used by customer/location/supplier forms to offer the assignment suggestion.
- **`getEffectiveTaxComponents(client, companyId, taxCodeId, date)`** — effective-dated component resolution + compound-aware rate math (shared by resolver, UI preview, posting, and tests).
- **`getTaxLiability(client, companyId, { startDate, endDate, taxAuthorityId? })`** — groups `taxLedger` by authority → component: taxable base, exempt base, tax collected, input tax, net.
- **Phase 2**: `createTaxReturn` / `getTaxReturnPreview` (runs the layout against unstamped ledger rows) / `finalizeTaxReturn` (Kysely transaction: stamp rows, snapshot totals, post settlement JE via the journal service, optionally create the draft AP remittance invoice) / `reopenTaxReturn` (only the newest finalized return; reverses the settlement JE and unstamps).
- **Edge functions**: `post-sales-invoice` and `post-purchase-invoice` gain the posting changes from the table above + `taxLedger` writes inside the existing Kysely transactions (VOID paths write reversing rows); memo posting gains the net/tax split. A shared `functions/shared/resolve-taxes.ts` mirrors component resolution for posting-time recomputation, following the `functions/shared/` helper precedent (`get-accounting-period.ts`, `get-next-sequence.ts`).
- **Zod validators** in `accounting.models.ts`: `taxCodeValidator` (with match fields), `taxCodeComponentValidator` (rate 0..1, refine expiration > effective), `taxAuthorityValidator`, `taxRegistrationValidator`, `taxReturnValidator`, `taxReturnLayoutLineValidator`.
- **Phase 3 (packages/ee)**: `AvalaraTaxEngine` implementing the resolver contract (`CreateTransaction` SalesOrder/SalesInvoice+commit, `VoidTransaction`, `ResolveAddress`), company-integration config UI, reconcile job for `needsEngineReconciliation` rows (Inngest, the existing jobs precedent); Xero syncer reads the `taxCode → TaxType` mapping from `externalIntegrationMapping`.

## UI Changes

- **Accounting nav — new "Tax" group** (`x+/accounting+/…`, list + Drawer detail per house pattern, `view/update: "accounting"`):
  - `tax-codes` — table + drawer form with an inline components editor (name, authority, rate, dates, compound/recoverable flags, accounts), address-match fields, and a computed effective-rate preview; per-code Xero TaxType select when a Xero integration is active (Phase 3).
  - `tax-authorities`, `tax-registrations` — simple list + drawer CRUD; registrations page cross-warns codes-without-registration and registrations-without-codes (Phase 3: + Avalara nexus drift).
  - `tax-liability` — the report: date range + authority filter, grouped by authority/component, CSV export.
  - `tax-returns` (Phase 2) — list + detail: period picker, layout select, live preview of boxes, Finalize action (posts settlement, offers AP remittance invoice), Reopen on the newest finalized return.
- **Customer**: `CustomerTaxForm` gains a Tax Code select with address-based suggestion; `customerLocation` drawer gains the override select; customers table gains a bulk "Assign tax code" action for the `taxPercent` migration path (OQ 4). **Supplier**: same. **Item**: "Taxable" switch in the item properties panel (default on).
- **Documents**: quote/order/invoice line drawers show the resolved tax code + amount with an override select (document permission; old→new logged to the audit system per OQ 3); a "recalculate taxes" action on header ship-to change; purchase invoice lines gain an "Accrue use tax" affordance (pick a Reverse Charge code) when the supplier charged no tax (Phase 2). Memo form gains the tax code + computed tax display (OQ 2).
- **Settings**: accounting settings gain the `shippingIsTaxable` toggle; once any tax code is assigned to a party, customer/supplier `taxPercent` fields hide behind a "migrate to tax codes" banner listing parties still on flat percents (OQ 4).
- **PDFs** (`packages/documents`): sales invoice gains a tax summary block by component/authority, code `invoiceMessage` clauses, seller registration number, and customer VAT number for Reverse Charge/Export codes.

## Acceptance Criteria

Phase 1:

- [ ] Create a "TX – Austin" code (State 6.25% + City 2.0% components, match fields TX/US): the customer form suggests it for a Texas address; after assignment, a sales order line for that customer defaults `taxPercent = 0.0825`; posting the invoice credits revenue **net**, credits the two component accounts 6.25/2.00 split, debits AR gross; two `taxLedger` rows carry the correct bases and authorities.
- [ ] A customer with a default code and a differently-coded ship-to location: lines resolve the location's code when that location is the ship-to, the customer's code otherwise.
- [ ] Marking the customer `taxExempt` with a certificate: the same line resolves to zero tax; posting writes a `taxLedger` row with `exemptAmount` = base, snapshotted reason + certificate number; the invoice PDF shows no tax. An `item.taxable = false` line behaves the same with no exemption reason.
- [ ] A purchase invoice line with a recoverable 20% VAT code: cost posts net, input tax debits the component's account, AP credits gross; with `isRecoverable = false` the posting matches today's capitalized behavior exactly.
- [ ] A purchase invoice with a Reverse Charge (recoverable) code: paired GL lines (input tax debit + reverse-charge credit) net to zero, AP is net of tax, and the ledger shows both directions.
- [ ] A Credit memo with a tax code against a taxed customer: AR credited gross (`amount` unchanged), reason account debited net, output tax debited; negative `taxLedger` rows; a no-code memo posts byte-identically to today.
- [ ] With `shippingIsTaxable` on, document-level shipping on a taxable order is taxed at the document's resolved code; off, shipping stays untaxed.
- [ ] A component with `expirationDate = 2026-06-30` and a successor row at 8.5% effective `2026-07-01`: invoices dated June 30 vs July 1 compute 8.25% vs 8.5% respectively.
- [ ] Voiding a posted sales invoice writes reversing `taxLedger` rows; the liability report for the period nets to zero for that document.
- [ ] The tax liability report for a quarter ties to the GL balance movement of the tax payable accounts for the same range (cross-check documented in the test).
- [ ] Legacy lines (manual `taxPercent`, no code) post revenue net with tax to `accountDefault.salesTaxPayableAccount` (OQ 1); a company with no tax config and `taxPercent = 0` everywhere behaves byte-identically to today; all existing invoice-total views and PDFs render unchanged (typecheck + `pnpm run test` green, invoice-total snapshots unchanged for `taxPercent`-only fixtures).

Phase 2:

- [ ] A US purchase invoice line where the supplier charged no tax: "Accrue use tax" with a picked Reverse Charge (non-recoverable) code posts Dr cost gross-of-accrual / Cr use-tax liability, AP net; ledger rows carry the authority.
- [ ] Finalizing a Q2 return stamps exactly the unstamped ledger rows in range, snapshots totals, posts the settlement JE (output accounts debited, input accounts credited, net to `taxSettlementAccount`), and — when the authority has a linked supplier — creates a draft AP invoice for the net due; rows stamped by the return are excluded from the next return's preview; a document posted into Q2 *after* finalize lands in Q3's preview.
- [ ] Reopening the newest finalized return reverses the settlement JE and unstamps its rows; older returns cannot be reopened while a newer one is finalized.
- [ ] The seeded UK layout renders the 9 boxes from reporting categories (Box 1 output tax, Box 4 input tax, Box 6/7 bases) against a mixed fixture of standard/zero-rated/reverse-charge documents.

Phase 3:

- [ ] With Avalara enabled and mocked API: a quote line calls `CreateTransaction(SalesOrder)`; posting the invoice calls `CreateTransaction(SalesInvoice, commit: true, code = invoice id)` and maps `details[]` to `taxLedger` rows per jurisdiction; voiding calls `VoidTransaction`; re-posting an uncommitted document with the same code overwrites idempotently.
- [ ] With the Avalara API failing, posting falls back to the internal codes, flags rows `needsEngineReconciliation`, and the reconcile action clears them once the mock recovers — committed totals never silently diverge.
- [ ] A `taxCode` mapped to a Xero `TaxType` syncs invoice lines with that TaxType; unmapped codes keep OUTPUT/NONE.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/erp` and scoped tests pass after `pnpm run generate:types` (every phase).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Sales-posting behavior change (revenue now net of tax) breaks users' report expectations | High | Approved via OQ 1; release note; applies only to newly posted documents — no retroactive restatement |
| Per-party assignment under-collects when a customer ships somewhere new without a coded location | Med | Address-match suggestion fires on location creation/edit; registrations cross-warnings; Avalara engine (Phase 3) for businesses with wide destination spread |
| Misconfigured rates produce wrong tax at scale | Med | Effective-rate preview; liability report makes errors visible quickly; line override remains possible |
| Memo `amount` reinterpretation bugs the AR/AP tie-out | Med | `amount` semantics deliberately unchanged (gross, hits AR/AP); tax is carved out *within* it; tie-out views untouched — verified against the net-model contract |
| Settlement JE interplay with period closing (posting into a locked period) | Med | Settlement posts as an *accounting* source under the period-closing matrix; finalize validates the period is postable first |
| Avalara outage / API drift | Med | Fallback-and-flag pattern per Avalara's own ERP guide; connector isolated in `packages/ee`; internal codes always functional |
| `taxLedger` growth on high-volume companies | Low | Append-only, indexed by `(companyId, postingDate)`; report queries are range-scans; same profile as `itemLedger` |
| View recreation churn (customers/suppliers/line/memo views) | Med | DROP + `SELECT *` recreation per house rule; fork each view body from its newest migration definition (lessons.md backdated-migration rule) |
| Rounding drift between line-level tax and authority expectations | Low | Line-level half-up documented; authorities tolerate penny-level differences (research); document-level rounding is a contained future setting |
| Partial migration on deploy retry | Med | All DDL idempotency-guarded per the migrations-must-be-idempotent rule |
| Scope breadth (3 phases) stalls delivery | Med | Phases are independently shippable; Phase 1 alone fixes the misstatement and delivers determination + reporting; /plan sequences per phase |

## Open Questions

> 🛑 HARD STOP: Do not proceed with implementation until these are answered.

- [x] **1. Apply the sales-posting fix to legacy lines too?** — **Answer: Yes** (user approved, 2026-07-03). One consistent rule: any line with tax (code-resolved or manual `taxPercent`) posts revenue net and credits tax payable; the alternative preserved a known revenue misstatement. Applies to newly posted documents only.
- [x] **2. Are credit/debit memos in v1 scope?** — **Answer: Yes, Phase 1.** `memo.taxCodeId` + `taxAmount` (tax carved out of the unchanged gross `amount`), direction-aware posting splits and signed ledger rows. Preserves the AR/AP tie-out contract.
- [x] **3. Line-level tax override permission.** — **Answer: document permission + audit log.** Anyone who can edit the line can override the resolved code/percent; old→new is recorded via the audit log system. Accounting-gated override deferred until a customer asks.
- [x] **4. Sunset path for `customer.taxPercent`.** — **Answer: hide once codes are assigned.** When a company has assigned ≥1 tax code, customer/supplier `taxPercent` fields hide behind a "migrate to tax codes" banner; a bulk "Assign tax code" action on the customers/suppliers tables completes the migration. Data is retained (it remains the no-code fallback).
- [x] **5. Document-level shipping taxability.** — **Answer: in scope, Phase 1.** `companySettings.shippingIsTaxable` taxes shipment-level shipping at the document's resolved code; off (default) keeps it untaxed, preserving current behavior.
- [x] **6. Historical reclassification.** — **Answer: out of scope, deliberately.** Tax previously posted into revenue stays unless manually reclassified; Carbon ships guidance (docs) for a one-time reclass journal entry. Automated restatement rewrites audited history and stays out even under the ambitious scope — the correct instrument is an accountant-authored JE.

## Changelog

- 2026-07-03: Created — research at `.ai/research/multi-jurisdiction-tax.md`; verified current-state findings (flat `taxPercent`, tax-into-revenue posting, dead tax-account config, inert exemption metadata) against the codebase.
- 2026-07-03: All six open questions resolved (user: "yes, let's be very ambitious"). Scope expanded from single-phase to three phases: memo tax + shipping taxability pulled into Phase 1; tax returns with settlement posting + AP remittance, return layouts (seeded generic + UK), and US use-tax accrual added as Phase 2; Avalara AvaTax connector (estimates, committed transactions, address validation, outage fallback, nexus mirror) and Xero tax-code mapping added as Phase 3. Tax-inclusive pricing, document-level rounding, foreign-currency registrations, and automated historical restatement remain explicitly out of scope.
- 2026-07-03: **Determination redesigned — matrix removed** (user feedback: the posting-group matrix was confusing and was deliberately dropped in [20260229000000_drop-posting-groups.sql](packages/database/supabase/migrations/20260229000000_drop-posting-groups.sql); the tax design must not resurrect it). Replaced `taxArea` × `taxCategory` × `taxRule` (three tables + matrix editor) with **direct assignment** (Xero model): `taxCodeId` on customer/location/supplier, `item.taxable` boolean, address-match *suggestions* at assignment time, line-level override. Shipping taxability simplified to a `shippingIsTaxable` boolean; Phase 2 use-tax code is picked explicitly on the line. Also corrected stale posting-group references in the problem statement.
