# Withholding Tax, EC Sales List, Intrastat, and UK MTD VAT Submission

> Status: in-progress
> Author: Claude (readiness program GAP-D1 remainder), for brad@carbonos.dev
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1055
> Parent finding: `.ai/specs/2026-07-03-public-company-readiness.md` §GAP-D1
> Builds on: `.ai/specs/2026-07-03-multi-jurisdiction-tax.md` (tax codes/components/authorities/registrations, `taxLedger`, `taxReturn` + layouts + settlement — this spec EXTENDS that machinery, never parallels it)
> Research: `.ai/research/public-company-compliance.md` (§7 tax engine, §regulatory VAT/trade reporting, MTD reference)

## TLDR

The tax spec delivers determination, the tax subledger, returns with settlement, and a seeded UK 9-box layout. Four statutory obligations remain for Carbon's EU/UK/US footprint, and all four are built as extensions of that machinery. (1) **AP withholding tax**: WHT codes ride `taxCode` (`calculationType = 'Withholding'`, income type, authority component) with treaty-rate overrides gated on tracked supplier residency certificates; purchase-invoice posting adds Dr AP / Cr WHT liability for the withheld portion (supplier payable becomes net), writes `taxLedger` rows with the new `'Withholding'` source, and WHT returns + supplier certificates extract per authority through the existing `taxReturn` settlement/remittance path. (2) **EC Sales List**: a `tradeDeclaration` document extracts intra-EU B2B supplies (customer VAT number, country, value, indicator code from the tax code) from `taxLedger` + invoice location data, per registration per period, exported as HMRC CSV and generic XML. (3) **Intrastat**: arrivals/dispatches declarations built from posted receipts/shipments using new item trade fields (CN8 commodity code, net mass, supplementary units, country of origin) and nature-of-transaction codes, gated by per-country threshold config with rolling-12-month warnings. (4) **UK MTD VAT**: an HMRC connector in `packages/ee` (OAuth, obligations/returns/liabilities endpoints, fraud-prevention headers) submits the UK layout's 9 boxes straight from the finalized `taxReturn` — an unbroken digital link with no rekeying — sandbox-tested before production. Delivery order follows live customer need: MTD first (UK entities file quarterly today), ECSL/Intrastat second (intra-EU trade is live), WHT third — unless a customer's cross-border payments carry live withholding obligations, in which case WHT jumps the queue; all four are fully spec'd here.

## Problem Statement

Customers operate across Europe and the US (geography resolved in the readiness spec). With the tax spec implemented, a UK or EU entity can compute its VAT return boxes — but cannot legally file or trade-report:

- **UK**: HMRC's Making Tax Digital mandates API submission of the 9-box return with *unbroken digital links* — retyping Carbon's numbers into a bridging spreadsheet breaks the legal chain. The tax spec produces the boxes; nothing submits them.
- **Intra-EU B2B supplies** must be declared on an EC Sales List (customer VAT number, member state, value, indicator code) per registration per period. `taxLedger` has the values and `customerTax.vatNumber`/EORI exist (`20260430000001_tax-status.sql`, `20260429001730_eori.sql`), but no extract exists.
- **Intrastat**: entities crossing per-country arrival/dispatch thresholds must declare physical goods movements with CN8 commodity codes, net mass, supplementary units, country of origin/destination, and nature of transaction. Carbon's `item`, `shipmentLine`, and `receiptLine` carry **none** of these fields (verified: no commodity/weight/origin columns in any migration), so the data cannot even be captured.
- **Withholding tax**: cross-border AP (royalties, technical services, interest) requires withholding at source at domestic or treaty rates, remitting to the authority, and issuing certificates to suppliers. Carbon's AP posts gross with no withholding concept; treaty rates are only valid while a supplier's residency certificate is — nothing tracks validity.

## Proposed Solution

### 1. AP withholding tax — new calculation type on the existing tax machinery

- **WHT codes are `taxCode` rows**: `taxCalculationType` gains `'Withholding'` (additive enum). A WHT code carries a new `incomeType` (`Services` | `Royalties` | `Interest` | `Dividends` | `Rent` | `Other`) and 1..n `taxCodeComponent` rows (authority + domestic rate + effective dates + liability account with `accountDefault."withholdingTaxPayableAccount"` fallback) — reusing rate-change, authority, and account-fallback machinery wholesale.
- **Assignment**: `supplierTax.withholdingTaxCodeId` (the supplier tax table is the natural home). At purchase-invoice creation, the supplier's WHT code defaults onto every line (`purchaseInvoiceLine.withholdingTaxCodeId`, nullable); users clear it on lines it doesn't apply to (e.g. goods) — the tax spec's direct-assignment philosophy, no matrix.
- **Treaty rates ride certificates**: `withholdingCertificate` rows per supplier (country, income type, treaty rate, validity window, certificate number + file). Effective rate at posting = the treaty rate of a certificate **valid on the posting date** matching the code's income type, else the component's domestic rate. Expired certificate ⇒ automatic fallback to domestic rate — the compliance-safe default.
- **Posting** (in `post-purchase-invoice`): AP still credits **gross**; for each withheld line the poster adds Dr AP / Cr WHT liability for `whtBase × effectiveRate` (WHT base = line net amount, exclusive of VAT). The supplier's open payable is therefore **net** — payment flows need no change. One `taxLedger` row per withheld line with new source `'Withholding'` (additive `taxLedgerSource` value), snapshotting rate, treaty flag, certificate number, authority. VOID re-posting writes reversing rows, matching the existing pattern.
- **Returns & certificates**: a WHT return is an ordinary `taxReturn` scoped to the WHT authority — finalize stamps the `'Withholding'` ledger rows, posts settlement (Dr WHT liability / Cr `taxSettlementAccount`), and offers the draft AP remittance invoice via the authority's linked supplier. New extract: per-supplier **WHT certificate PDF** (period, income type, gross, rate, withheld) from `packages/documents`, plus a CSV authority extract.

### 2. EC Sales List — extract over `taxLedger`

- **Row source**: sales-side `taxLedger` rows in period whose tax code has a non-null **`ecslIndicator`** (new nullable SMALLINT on `taxCode`: `0` = goods, `2` = triangulation, `3` = services) — set on the company's intra-EU Reverse Charge / Zero-Rated codes. Joined to `customerTax.vatNumber` and ship-to country (`salesInvoiceLocations`).
- **Document**: `tradeDeclaration` (type `'EC Sales List'`), scoped to a `taxRegistration` + period. Draft computes lines live (VAT number, country, summed value, indicator); Finalize snapshots lines to JSONB (immutable filing record — the `taxReturn.totals` pattern). No GL impact, hence a separate lightweight document rather than `taxReturn`.
- **Validation before finalize**: missing/malformed customer VAT numbers and non-EU ship-to rows carrying an ECSL-flagged code are surfaced as blocking exceptions.
- **Exports**: HMRC ECSL CSV (UK layout) and a generic XML/CSV per member state; format renderers live beside the declaration service.

### 3. Intrastat — declarations from receipts and shipments

- **Item trade fields** (new, nullable): `item.commodityCode` (CN8, 8 digits), `item.countryOfOriginId`, `item.netWeight` (kg per inventory unit, bare NUMERIC), `item.supplementaryUnitConversion` (supplementary units per inventory unit, for CN8 chapters that require them).
- **Movement data**: `shipment.natureOfTransactionCode` and `receipt.natureOfTransactionCode` (TEXT, default from config, standard code list seeded — `11` sale, `21` return, etc.).
- **Config**: `intrastatConfiguration` per company per country — arrivals/dispatches enabled flags, threshold amounts (seeded with current EU per-country thresholds as reference data), default nature of transaction. A rolling-12-month arrivals/dispatches value banner warns when an unconfigured country crosses its threshold.
- **Declarations**: `tradeDeclaration` types `'Intrastat Arrivals'` (posted receipts from EU suppliers) and `'Intrastat Dispatches'` (posted shipments to EU customers) where counterparty country ≠ company country and both are EU. Draft lines aggregate by CN8 × partner country × origin country × nature of transaction: value (from invoice/order line pricing), net mass (qty × `item.netWeight`), supplementary units. Missing commodity codes/weights are blocking exceptions listing the offending items (fix on the item, refresh). Finalize snapshots; CSV export per national format (generic layout v1).

### 4. UK MTD VAT submission — connector in `packages/ee`

- **Integration**: `companyIntegration` entry "HMRC MTD VAT" (the Xero/Avalara precedent): OAuth 2.0 authorization-code flow against HMRC, encrypted token storage + refresh, sandbox/production environment switch, VRN taken from the UK `taxRegistration`.
- **Endpoints**: retrieve VAT obligations (open/fulfilled period keys), submit return, view liabilities and payments. All calls send the mandatory **fraud-prevention headers** (`Gov-Client-Connection-Method: WEB_APP_VIA_SERVER`, device/user/timezone/vendor headers assembled server-side from the session).
- **Digital links**: the submission payload is built **only** from the finalized `taxReturn`'s UK-layout box totals — the submit UI displays the 9 boxes read-only with a declaration checkbox; no manual entry anywhere between `taxLedger` and HMRC. `taxReturn` gains `hmrcPeriodKey` (bound when the user matches the return to an open obligation), and `taxReturnStatus` gains `'Submitted'` (additive). The HMRC receipt (`formBundleNumber`, `chargeRefNumber`, processing date) is stored on the return; submitted returns cannot be reopened.
- **Sandbox-tested**: the full obligation→submit→receipt cycle runs against HMRC's sandbox (with its `Gov-Test-Scenario` headers) as an acceptance gate before production credentials are requested.

### Delivery phases (ordered by live customer need)

| Phase | Scope | Depends on |
|-------|-------|-----------|
| **1 — MTD** | HMRC connector, fraud headers, obligations/submit/liabilities, `taxReturn` submission columns, sandbox suite | Tax spec Phase 2 (returns + UK layout) |
| **2 — ECSL + Intrastat** | `taxCode.ecslIndicator`, item trade fields, nature-of-transaction, `intrastatConfiguration`, `tradeDeclaration` + exports | Tax spec Phase 1 (`taxLedger`) |
| **3 — WHT** | Withholding calculation type, certificates, posting change, WHT returns + supplier certificate PDFs | Tax spec Phases 1–2 |

**Sequencing rule (resolved)**: WHT moves to Phase 1 only if a customer has live cross-border payments with withholding obligations; today's confirmed live needs are UK MTD filing and intra-EU trade, so MTD leads. All three phases are independently shippable and fully spec'd here.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | WHT model | Extend `taxCode`/`taxCodeComponent` with `calculationType = 'Withholding'` + `incomeType`; **new `taxLedgerSource` value `'Withholding'`** (not a flag) | One codes/components/authority/ledger machine (parent-spec mandate: extend, never parallel); a distinct source keeps VAT returns and liability reports from ever mingling WHT rows by accident — a flag on `Purchase` rows would require every existing consumer to add a filter |
| 2 | Treaty rate gating | Certificate-with-validity required for treaty rate; expired ⇒ silent fallback to domestic rate + document warning | Treaty relief is only defensible with a valid residency certificate on file; failing *open* (under-withholding) creates issuer liability — fail safe |
| 3 | WHT posting shape | AP credits gross, then Dr AP / Cr WHT liability per withheld line; base = line net of VAT | Supplier statement shows gross invoice and net payable (standard certificate math); payments/settlement/tie-outs untouched because the AP *balance* is net |
| 4 | WHT returns | Reuse `taxReturn` scoped to the WHT authority (stamp + settle + AP remittance) | Settlement and remittance rails already exist; only certificates/extracts are new |
| 5 | ECSL/Intrastat document | New `tradeDeclaration` (Draft computes live, Finalize snapshots JSONB) — not `taxReturn` | These filings have no settlement JE and no GL impact; forcing them through `taxReturn` would bolt no-op posting onto a pure extract |
| 6 | ECSL row selection | `taxCode.ecslIndicator` set on intra-EU codes; extract = ledger rows carrying flagged codes | Deterministic and auditable from the posted ledger; avoids re-inferring place-of-supply at report time |
| 7 | Intrastat data placement | Master data on `item` (CN8/mass/origin/supplementary), movement code on shipment/receipt header, aggregation at declaration time | CN8 and mass are item facts; nature of transaction is a movement fact; keeping lines computed-then-snapshotted avoids double-keying every shipment line |
| 8 | Thresholds | Per-country `intrastatConfiguration` with seeded reference thresholds + rolling-12-month crossing warning; declarations only for enabled flows | Thresholds change annually per member state — config, not code; the warning prevents silent non-compliance |
| 9 | MTD digital link | Submission payload built exclusively from the finalized return's layout totals; read-only submit UI; `Submitted` returns locked | The unbroken-digital-link requirement is the point of MTD; any editable box is a compliance break |
| 10 | MTD placement | `packages/ee` connector behind `companyIntegration` (Xero/Avalara precedent); fraud headers assembled server-side | Established integration pattern; HMRC vendor credentials are licensed, i.e. ee-gated |
| 11 | Multi-tenancy (heuristic 1) | Every new table: `companyId`, composite PK `("id","companyId")`, `id('prefix')`, audit columns, `customFields` on config tables; composite child FKs | House convention |
| 12 | Service shape (heuristic 2) | All functions in `accounting.models.ts` / `accounting.service.ts`, `(client, companyId, …) → {data, error}`; HMRC client in `packages/ee` | Tax is accounting-owned (parent-spec precedent); one service file per module |
| 13 | RLS (heuristic 3) | Four standard policies; SELECT via `get_companies_with_employee_role()`, writes via `get_companies_with_employee_permission('accounting_*')`; ledger writes via service-role posting functions | Package AGENTS.md convention (no deprecated `has_role`) |
| 14 | Permissions (heuristic 4) | Declarations/returns/config: `view/update: "accounting"`; item trade fields ride `parts` permissions; certificate upload rides purchasing (the `supplierTax` storage precedent) | Matches tax-spec scoping; no new permission actions |
| 15 | Forms (heuristic 5) | `ValidatedForm` + zod (`withholdingCertificateValidator`, `tradeDeclarationValidator`, `intrastatConfigurationValidator`); Drawer detail views | House convention |
| 16 | Module layout (heuristic 6) | No new module: accounting module + `ui/Tax/`; routes `x+/accounting+/tax-*`; MTD in `packages/ee/src/hmrc/`; PDFs in `packages/documents` | Tax config is accounting settings; integrations live in ee |
| 17 | Backward compatibility (heuristic 7) | All columns nullable/defaulted; enum values additive; zero behavior change for companies with no WHT code, no ECSL indicator, no Intrastat config, no HMRC integration; views recreated DROP + `SELECT *`; idempotent DDL | Unconfigured companies post byte-identically to the tax-spec baseline |

## Data Model Changes

Three migrations (one per phase; `pnpm db:migrate:new <name>`, randomized HHMMSS, never `000000`), `pnpm run generate:types` after each. Standard audit columns, indexes on `companyId` + FKs, and the four RLS policies apply throughout; abbreviated:

```sql
-- Additive enum values (Phase 1 / 3)
ALTER TYPE "taxReturnStatus"    ADD VALUE IF NOT EXISTS 'Submitted';     -- Phase 1
ALTER TYPE "taxCalculationType" ADD VALUE IF NOT EXISTS 'Withholding';   -- Phase 3
ALTER TYPE "taxLedgerSource"    ADD VALUE IF NOT EXISTS 'Withholding';   -- Phase 3
CREATE TYPE "withholdingIncomeType" AS ENUM
  ('Services', 'Royalties', 'Interest', 'Dividends', 'Rent', 'Other');   -- Phase 3
CREATE TYPE "tradeDeclarationType" AS ENUM
  ('EC Sales List', 'Intrastat Arrivals', 'Intrastat Dispatches');       -- Phase 2
CREATE TYPE "tradeDeclarationStatus" AS ENUM ('Draft', 'Finalized');

-- Phase 1: MTD submission columns on the existing return
ALTER TABLE "taxReturn"
  ADD COLUMN IF NOT EXISTS "hmrcPeriodKey" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "submittedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "submissionReceipt" JSONB;  -- formBundleNumber, chargeRefNumber, processingDate

-- Phase 2: item trade fields, movement codes, config, declarations
ALTER TABLE "item"
  ADD COLUMN IF NOT EXISTS "commodityCode" TEXT,                 -- CN8
  ADD COLUMN IF NOT EXISTS "countryOfOriginId" INTEGER REFERENCES "country"("id"),
  ADD COLUMN IF NOT EXISTS "netWeight" NUMERIC,                  -- kg per inventory unit
  ADD COLUMN IF NOT EXISTS "supplementaryUnitConversion" NUMERIC;
ALTER TABLE "shipment" ADD COLUMN IF NOT EXISTS "natureOfTransactionCode" TEXT;
ALTER TABLE "receipt"  ADD COLUMN IF NOT EXISTS "natureOfTransactionCode" TEXT;
ALTER TABLE "taxCode"  ADD COLUMN IF NOT EXISTS "ecslIndicator" SMALLINT;  -- 0 | 2 | 3

CREATE TABLE IF NOT EXISTS "intrastatConfiguration" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "countryId" INTEGER NOT NULL REFERENCES "country"("id"),
    "arrivalsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "dispatchesEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "arrivalsThreshold" NUMERIC,          -- seeded reference values, editable
    "dispatchesThreshold" NUMERIC,
    "defaultNatureOfTransaction" TEXT NOT NULL DEFAULT '11',
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "intrastatConfiguration_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "intrastatConfiguration_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "intrastatConfiguration_unique" UNIQUE ("companyId", "countryId")
);
ALTER TABLE "intrastatConfiguration" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."intrastatConfiguration";
CREATE POLICY "SELECT" ON "public"."intrastatConfiguration" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
-- INSERT/UPDATE/DELETE via get_companies_with_employee_permission('accounting_*'),
-- same four-policy shape on every table below.

CREATE TABLE IF NOT EXISTS "tradeDeclaration" (
    "id" TEXT NOT NULL DEFAULT id('td'),
    "companyId" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,               -- readable id via get_next_sequence
    "type" "tradeDeclarationType" NOT NULL,
    "taxRegistrationId" TEXT,                    -- ECSL: required; Intrastat: the filing country's registration
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "tradeDeclarationStatus" NOT NULL DEFAULT 'Draft',
    "lines" JSONB,                               -- snapshot at finalize (immutable filing record)
    "totals" JSONB,
    "finalizedAt" TIMESTAMP WITH TIME ZONE,
    "finalizedBy" TEXT REFERENCES "user"("id"),
    -- audit columns, customFields …
    CONSTRAINT "tradeDeclaration_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "tradeDeclaration_taxRegistrationId_fkey" FOREIGN KEY ("taxRegistrationId", "companyId")
      REFERENCES "taxRegistration"("id", "companyId")
);

-- Phase 3: withholding
ALTER TABLE "taxCode"     ADD COLUMN IF NOT EXISTS "incomeType" "withholdingIncomeType";
ALTER TABLE "supplierTax" ADD COLUMN IF NOT EXISTS "withholdingTaxCodeId" TEXT;
ALTER TABLE "purchaseInvoiceLine" ADD COLUMN IF NOT EXISTS "withholdingTaxCodeId" TEXT;
ALTER TABLE "accountDefault"      ADD COLUMN IF NOT EXISTS "withholdingTaxPayableAccount" TEXT;
ALTER TABLE "taxLedger"
  ADD COLUMN IF NOT EXISTS "treatyRateApplied" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "withholdingCertificateId" TEXT;

CREATE TABLE IF NOT EXISTS "withholdingCertificate" (
    "id" TEXT NOT NULL DEFAULT id('whc'),
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "countryId" INTEGER NOT NULL REFERENCES "country"("id"),   -- supplier residency
    "incomeType" "withholdingIncomeType" NOT NULL,
    "treatyRate" NUMERIC NOT NULL,               -- 0..1; may be 0 (full relief)
    "certificateNumber" TEXT,
    "certificatePath" TEXT,                      -- private bucket, tax-certificates prefix
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    -- audit columns, customFields …
    CONSTRAINT "withholdingCertificate_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "withholdingCertificate_supplierId_fkey" FOREIGN KEY ("supplierId")
      REFERENCES "supplier"("id") ON DELETE CASCADE,
    CONSTRAINT "withholdingCertificate_validity" CHECK ("validTo" >= "validFrom")
);
```

Affected views (`suppliers`, purchase-invoice line views, item views) recreated via DROP + `SELECT *` from their newest definitions; all DDL idempotency-guarded. HMRC OAuth tokens live in `companyIntegration` metadata (encrypted, ee package) — no new auth tables.

## API / Service Changes

`apps/erp/app/modules/accounting/` (models + service, no new files) unless noted:

- **Phase 1 (`packages/ee/src/hmrc/`)**: `HmrcMtdClient` — OAuth authorize/callback/refresh; `getObligations(vrn, from, to)`; `submitVatReturn(vrn, periodKey, boxes, declarationConfirmed)`; `getLiabilities` / `getPayments`; fraud-prevention header assembly from request context. App-side: `matchReturnToObligation`, `submitTaxReturnToHmrc` (validates status `Finalized` + UK layout, builds boxes from stored totals only, persists receipt, sets `Submitted`); `reopenTaxReturn` gains a `Submitted` guard.
- **Phase 2**: `getEcslLines(client, companyId, {registrationId, periodStart, periodEnd})` (ledger join to `customerTax`/locations, exceptions list); `getIntrastatLines(client, companyId, {type, countryId, period})` (posted receipts/shipments aggregation, exceptions list); `upsert/finalizeTradeDeclaration` (finalize = validate exceptions empty, snapshot lines/totals); `exportTradeDeclaration` (HMRC ECSL CSV, generic XML, generic Intrastat CSV); `getIntrastatThresholdStatus` (rolling 12-month values vs config); `intrastatConfiguration` CRUD.
- **Phase 3**: `resolveWithholding(client, companyId, {supplierId, taxCodeId, date})` → `{rate, treatyRateApplied, certificateId}` (valid-certificate lookup, domestic fallback); `withholdingCertificate` CRUD with expiry-warning list; `post-purchase-invoice` edge function gains the withheld-line journal pair + `'Withholding'` ledger rows inside the existing transaction (shared logic in `functions/shared/resolve-taxes.ts`); `getWithholdingCertificateData` feeding the supplier certificate PDF (`packages/documents`); WHT authority extract CSV. Zod validators for all new forms.

## UI Changes

- **Phase 1**: HMRC integration card (connect/disconnect, environment) in settings integrations; tax-return detail gains an MTD panel — obligation matching, read-only 9 boxes, declaration checkbox, Submit, receipt display; `Submitted` badge in the returns table.
- **Phase 2**: `x+/accounting+/trade-declarations` list + detail (period/registration picker, live draft lines, blocking-exception panel with links to offending items/customers, Finalize, Export); Intrastat config page under tax settings with threshold-crossing banner; item Purchasing/Trade panel gains commodity code, origin, net weight, supplementary conversion; shipment/receipt drawers gain nature-of-transaction (defaulted, editable pre-post); ECSL indicator select on the tax-code form.
- **Phase 3**: supplier tax form gains WHT code select + certificates section (validity badges, expiring-soon warning); purchase-invoice line drawer shows resolved WHT (rate, treaty/domestic, certificate) with clear-per-line; WHT return detail gains supplier-certificate PDF generation; authority extract download.

## Acceptance Criteria

Phase 1 — MTD (sandbox, mocked in CI):
- [ ] Connecting HMRC stores tokens per company; obligations list shows sandbox period keys; a finalized UK-layout return matched to an open obligation submits successfully and stores `formBundleNumber`; the return shows `Submitted` and cannot be reopened.
- [ ] The submitted box values byte-match the finalized return's stored layout totals (no recomputation, no editable inputs anywhere in the submit path — asserted in test).
- [ ] Every HMRC call carries the mandatory fraud-prevention headers; a non-UK-layout or non-finalized return cannot reach the submit action.
- [ ] A generic (non-UK) company sees no MTD UI and posts returns exactly as the tax spec specifies.

Phase 2 — ECSL/Intrastat:
- [ ] Given posted intra-EU invoices on an `ecslIndicator = 0` zero-rated code, an ECSL declaration for the period lists one line per customer VAT number × indicator with summed values; a customer missing a VAT number blocks finalize with a named exception; the HMRC CSV export matches the snapshot.
- [ ] A finalized declaration's lines never change when later documents post into the period; the late rows appear in the next period's draft.
- [ ] With dispatches enabled for DE, posted shipments to EU customers aggregate by CN8 × destination × origin × nature code with net mass = Σ(qty × `item.netWeight`); an item missing a commodity code blocks finalize; arrivals mirror from receipts.
- [ ] The threshold banner fires when rolling-12-month arrivals exceed the configured threshold for a country with arrivals disabled.

Phase 3 — WHT:
- [ ] A supplier with a 15% Royalties WHT code and no certificate: posting a 1,000 purchase invoice (no VAT) credits AP 1,000, debits AP 150, credits WHT liability 150; the open payable is 850; one `'Withholding'` ledger row carries rate 0.15, `treatyRateApplied = false`.
- [ ] With a certificate (10%, valid on posting date): withheld = 100, `treatyRateApplied = true`, certificate id snapshotted; the same invoice posted one day after `validTo` withholds 150.
- [ ] WHT lines never appear in VAT liability reports or VAT return previews; a WHT-authority `taxReturn` stamps exactly the `'Withholding'` rows, posts Dr liability / Cr settlement, and offers the AP remittance invoice.
- [ ] The supplier certificate PDF totals tie to the stamped ledger rows; a supplier with no WHT code posts byte-identically to today (existing golden-master tests unchanged).
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/erp` + scoped tests green after `pnpm run generate:types` (every phase).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| HMRC production credentials require vendor approval (demo + fraud-header review) — calendar risk outside Carbon's control | High | Start the application at Phase-1 kickoff; sandbox acceptance is the code gate; production go-live decoupled |
| Fraud-prevention header non-compliance triggers HMRC rejection/penalties | Med | Server-side assembly with HMRC's header-validation sandbox endpoint in CI |
| WHT posting touches `post-purchase-invoice` concurrently with tax-spec and immutability work on the same function | Med | Phase 3 sequenced last; rebases on merged tax-spec posting; golden-master tests for no-WHT paths |
| Under/over-withholding from stale certificates | Med | Validity-date gating with domestic-rate fallback (decision 2); expiring-certificate warnings |
| Intrastat data quality (missing CN8/weights) stalls first filings | Med | Blocking exceptions name items; CSV item import covers commodity fields for bulk backfill |
| Per-country ECSL/Intrastat format drift (generic exports insufficient somewhere) | Low | Snapshot JSONB keeps data format-independent; renderers are additive per country on demand |
| Enum extensions (`taxLedgerSource`, `taxReturnStatus`) ripple through tax-spec consumers | Low | Additive values only; every existing consumer filters explicitly on `Sales`/`Purchase`/status — verified before merge |

## Open Questions

> 🛑 HARD STOP: Do not proceed with implementation until these are answered.

- [x] **Geography** — **Resolved (readiness spec, 2026-07-03): customers across Europe and the US.** ECSL, Intrastat, and MTD are live needs for EU/UK entities; US filing stays with Avalara behind the tax spec's connector.
- [x] **Extend or parallel the tax machinery?** — **Resolved: extend.** WHT rides `taxCode`/`taxCodeComponent`/`taxAuthority`/`taxLedger`/`taxReturn`; ECSL reads `taxLedger`; MTD submits the tax spec's UK return. No parallel tax structures anywhere in this spec.
- [x] **WHT ledger representation** — **Resolved in this spec: new `taxLedgerSource` value `'Withholding'`** (decision 1), not a flag on `Purchase` rows — existing VAT consumers stay correct without modification.
- [x] **Sequencing** — **Resolved: MTD → ECSL/Intrastat → WHT**, per live customer need (UK filing and intra-EU trade are live today); WHT jumps to first if a customer confirms live cross-border withholding obligations. All phases fully spec'd regardless of order.
- [x] **HMRC vendor registration**: who owns the HMRC developer-hub application and production-credentials process (company action, ~weeks of lead time, demo required)? Needed before Phase-1 production go-live; sandbox work is unblocked. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Company action, Brad owns the kickoff; start it at #1055's plan stage (weeks of lead time); build against HMRC sandbox credentials meanwhile.
- [x] **WHT gross-up contracts**: do any live supplier contracts require net-of-tax (gross-up) treatment, where Carbon must compute a grossed-up base so the supplier receives the full invoice amount? v1 assumes standard deduct-from-payment only. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Yes — support a gross-up flag per supplier WHT assignment in v1 schema + calculation. Back out at plan stage if no live contract needs it.

## Changelog

- 2026-07-04: Created — GAP-D1 remainder from the public-company readiness spec; verified against the tax spec's machinery, `20260429001730_eori.sql` / `20260430000001_tax-status.sql` (VAT/EORI capture exists), and shipment/receipt/item schemas (no commodity/weight/origin fields exist today). Tracking issue crbnos/carbon#1055.
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
