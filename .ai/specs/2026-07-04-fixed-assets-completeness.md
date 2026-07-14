# Fixed Assets Completeness — Disposal Proceeds, Impairment, CIP, Components

> Status: in-progress
> Author: Claude (readiness remediation, GAP-4 remainder)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1041
> Readiness finding: `.ai/specs/2026-07-03-public-company-readiness.md` §GAP-4 (Phase 2 slice)
> Related: `.ai/specs/2026-07-04-multi-book.md` (book-specific depreciation), close-automation spec (scheduled depreciation — GAP-4.1, **not** this spec), `.ai/specs/2026-07-02-period-closing.md` (posting matrix)

## TLDR

The fixed-asset subledger acquires, depreciates, and scraps — but cannot book a
gain on sale (docs admit "no proceeds-based gain calculation"), impair
(`writeDownAccountId` is a dead FK), accumulate construction costs (no CIP), or
componentize (IAS 16 prerequisite for IFRS books). This spec adds to
`modules/accounting`: (1) disposal with proceeds — full or partial — posting
gain/loss = proceeds − NBV to the class's `disposalAccountId`, linked to a sales
invoice or direct cash proceeds; (2) an impairment document (asset or class scope)
posting Dr `writeDownAccountId` / Cr accumulated depreciation with an
`accumulatedImpairment` tracking column, re-basing future depreciation; (3) CIP
classes accumulating costs from Fixed Asset PO lines and job costs, capitalized
into a depreciating class via a transfer document; (4) parent/child component
assets with independent lives/methods, plus mid-life class transfers. All postings
obey the period-close matrix and posted-journal immutability.

## Problem Statement

Verified against `20260524143827_fixed-assets.sql`, `accounting.server.ts`
(`postDisposal` L37), `post-sales-invoice/index.ts` L578–800, and the docs
(`docs/content/docs/reference/fixed-assets.mdx`):

1. **Disposal ignores proceeds.** `postDisposal()` posts Dr accum dep / Dr
   `writeOffAccountId` (NBV) / Cr asset at cost; the sales-invoice path books
   proceeds as plain *revenue* and NBV to *write-off* — gross, never netted.
   `fixedAssetDisposal.saleProceeds`/`gainLoss` exist but no gain is computed;
   `disposalAccountId` (NOT NULL on every class) has **zero writers**. Cost 10,000,
   accum dep 4,000, sold 7,500 shows 7,500 revenue + 6,000 expense instead of a
   1,500 gain. No partial disposal.
2. **No impairment.** `writeDownAccountId` is required on every class and never
   referenced by any posting path; ASC 360/IAS 36 write-downs become manual JEs
   the subledger never learns about — NBV overstated, over-depreciation after.
3. **No CIP.** Fixed Asset PO lines post straight to the class asset account and
   depreciation can start before in-service; job costs (self-constructed
   machinery — Carbon's customer base) can't reach an asset at all. No CIP aging.
4. **No components.** No parent/child concept; IAS 16.43 componentization is a
   prerequisite for IFRS books via the multi-book spec. No mid-life class
   transfer either (wrong-class fixes mean dispose + re-create, losing history).

## Proposed Solution

### 1. Disposal with proceeds (full and partial)

Extends the dispose flow (`$fixedAssetId.dispose` → `postDisposal()`).

- **Proceeds source** — either a `salesInvoiceLine` of type `'Fixed Asset'` (link
  exists via `salesInvoiceLine.assetId`), or direct proceeds with a user-selected
  debit account (cash/clearing) for sales outside the invoicing flow.
- **Journal** (`sourceType: 'Asset Disposal'`): Dr accumulated depreciation (incl.
  impairment), Dr proceeds account (AR via invoice posting, or the cash account),
  Cr asset at cost, balancing line to the class's **`disposalAccountId`** — gain
  (credit) or loss (debit) = proceeds − NBV. The `post-sales-invoice` Fixed Asset
  branch is rewritten to this pattern (proceeds stop hitting revenue; NBV stops
  hitting write-off). `writeOffAccountId` stays the zero-proceeds (scrapping) target.
- **Partial disposal**: entered as quantity (e.g. 2 of 5 units) or value fraction,
  both resolving to `disposalFraction` (0 < f ≤ 1). Disposed cost and accumulated
  balances = balance × f (pro-rata); asset stays `Active` with reduced balances;
  `fixedAssetDisposal` records fraction + slices. `f = 1` is today's full disposal.

### 2. Impairment — new `fixedAssetImpairment` document, Draft → Posted

- **Scope**: single asset, or a class (one line per Active asset, each with its
  own recoverable amount, prefilled with NBV). **Loss** = max(0, NBV −
  recoverable), NBV = acquisitionCost − accumulatedDepreciation −
  accumulatedImpairment.
- **Posting** (new `journalEntrySourceType` `'Asset Impairment'`): Dr class
  `writeDownAccountId` / Cr class `accumulatedDepreciationAccountId`. **Contra
  treatment, not a new account column**: the credit lands in the existing
  accumulated-depreciation account while `fixedAsset.accumulatedImpairment` tracks
  the slice for the register, disposal clearing, and future IAS 36 reversals — a
  seventh NOT NULL account FK would force a breaking backfill of every class.
- **Re-basing**: future depreciation = (recoverable − residual) over remaining
  life; `buildDepreciationLines()` subtracts `accumulatedImpairment` in its NBV
  term. IAS 36 reversals: **out of scope** until multi-book adjustment books exist
  — same staging as LCNRV reversals in GAP-3.

### 3. CIP — construction in progress

- **CIP class flag**: `fixedAssetClass.isConstructionInProgress BOOLEAN` — assets
  in a CIP class never enter depreciation runs; status uses new enum value
  `'Under Construction'`. Seed one CIP class per company group (all six account
  FKs point at the CIP account — NOT NULL satisfied, depreciation ones never post).
- **Cost accumulation** — append-only `fixedAssetCipCost` rows, two sources:
  (1) **PO lines**: a Fixed Asset PO line pointing at a CIP asset posts Dr CIP
  asset account (existing acquisition path, unchanged) and appends a row (source
  `'Purchase Invoice'`, document line FK); (2) **job costs**: a job (or cost
  slice) attached to a CIP asset posts Dr CIP asset account / Cr WIP
  (`postingGroupInventory.workInProgressAccount`) and appends a row (source
  `'Job'`) — WIP-credit timing is an open question below.
- **Capitalization** = `fixedAssetTransfer` of type `'Capitalization'`: target
  class + in-service date; posts Dr target asset account / Cr CIP asset account
  at accumulated cost; sets `acquisitionCost`, `acquisitionDate`,
  `depreciationStartDate` (= in-service date), status → `Active`.
- **CIP aging report**: accumulated cost bucketed by age of first cost
  (0–90/91–180/181–365/365+ days) — the auditor's stale-CIP question.

### 4. Component assets and class transfers

- **Components**: `fixedAsset.parentFixedAssetId` self-FK (one level; a component
  cannot itself have children — trigger-enforced). Components are ordinary assets
  with their own class, method, life, and cost — depreciation/disposal/impairment
  work per component unchanged; the parent may carry residual cost (IAS 16.46
  "remainder"); register UI rolls children up under the parent. Componentization
  is the structural prerequisite for the multi-book spec
  (`.ai/specs/2026-07-04-multi-book.md`), whose per-book depreciation parameters
  attach to components.
- **Class transfer** (type `'Reclassification'`, same `fixedAssetTransfer` table):
  Dr new / Cr old asset account at cost, Dr old / Cr new accumulated-depreciation
  account (skip lines where accounts match); new `journalEntrySourceType`
  `'Asset Transfer'`. Method/life do **not** change on transfer (estimate change,
  edited on the asset directly).

### 5. Period close and immutability

Every posting above goes through the existing journal insert path and inherits
the period-close posting matrix (`20260702044133`) and posted-journal immutability
— no special cases. Posting actions resolve `accountingPeriodId` from the document
date and fail with the standard closed-period error; posted documents are
immutable, corrections are reversing documents. Scheduled depreciation and the
close-readiness depreciation check are the **close-automation spec's** scope —
referenced only so `Under Construction` assets are excluded from that check.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Gain/loss account | Net single line to class `disposalAccountId` (gain credit / loss debit) | Column is NOT NULL + seeded + unwritten — it was built for exactly this; NetSuite/BC both post net gain-loss, not gross revenue+expense |
| 2 | Sales-invoice disposal path | Rewrite `post-sales-invoice` Fixed Asset branch to gain/loss pattern; proceeds stop posting to revenue | Revenue overstatement is a GAAP error (ASC 610-20: derecognition gain, not revenue); coordinated-PR posting change per the readiness spec's decision 15 |
| 3 | Partial disposal representation | Single `disposalFraction` + frozen disposed-cost/accum snapshot columns on `fixedAssetDisposal` | Quantity and value entry both collapse to a fraction; snapshots make the disposal row self-auditing after the asset's balances shrink |
| 4 | Impairment credit side | Contra within existing accumulated-depreciation account + new `accumulatedImpairment` tracking column | A new NOT NULL account FK breaks every existing class (backfill + form churn); subledger column preserves the impairment split for register/disposal/IAS 36 reversals; BC's "Write-Down" posting type uses the same collapsed-contra pattern |
| 5 | Impairment reversals | Out of scope until multi-book adjustment books | US GAAP forbids reversal; IAS 36 requires it — inherently book-specific, same staging as GAP-3 LCNRV |
| 6 | CIP modeling | Class-level flag + `'Under Construction'` status + cost ledger, not a separate CIP module | Reuses acquisition paths already keyed to `fixedAssetClass` accounts; SAP AuC / BC "CIP class" precedent |
| 7 | Capitalization & reclass | One `fixedAssetTransfer` table, `type IN ('Capitalization','Reclassification')` | Same shape (from/to class, journal, date); two tables would duplicate posting + RLS + UI |
| 8 | Component depth | One level (parent → components), trigger-enforced | IAS 16 needs parts, not trees; deep hierarchies wreck register rollups and disposal math for no auditor benefit |
| 9 | Multi-tenancy (H1) | New tables: `companyId`, composite PK `("id","companyId")`, `id('prefix')`, audit columns | Repo convention (`packages/database/AGENTS.md`); existing fixed-asset tables predate it (xid, single PK) — new tables follow current convention; FKs still target `fixedAsset("id")` |
| 10 | Service shape (H2) | New functions in `accounting.service.ts` / posting transactions in `accounting.server.ts`, `(client, args)` → `{data,error}`, never throw | One service file per module; disposal/depreciation posting already lives there |
| 11 | RLS + permissions (H3/H4) | Four policies per new table via `get_companies_with_employee_permission('accounting_*')`; routes use `requirePermissions` with `accounting_*`; posting = `create`, like dispose today | Matches every existing fixed-asset table; no new permission actions — readiness spec decision 14 |
| 12 | Forms + module layout (H5/H6) | `ValidatedForm` + zod validators in `accounting.models.ts`, route actions under `x+/fixed-asset+` / `x+/impairment+`; everything in `modules/accounting` | Existing `FixedAssetDisposalForm`/route precedent; fixed assets already live there |
| 13 | Backward compatibility (H7) | Additive schema only; behavior changes are the two posting rewrites (dispose, post-sales-invoice), shipped as coordinated PRs | No FROZEN surface touched; existing disposals/journals untouched (new columns nullable/defaulted) |

## Data Model Changes

```sql
-- Enums (separate pre-migration file, per ADD VALUE transaction rule)
ALTER TYPE "fixedAssetStatus" ADD VALUE IF NOT EXISTS 'Under Construction';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Impairment';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Asset Transfer';

-- fixedAsset: components + impairment tracking
ALTER TABLE "fixedAsset"
  ADD COLUMN "parentFixedAssetId" TEXT REFERENCES "fixedAsset"("id") ON DELETE SET NULL,
  ADD COLUMN "accumulatedImpairment" NUMERIC NOT NULL DEFAULT 0;
-- + index on parentFixedAssetId; trigger rejects a parent that itself has a parent

-- fixedAssetClass: CIP flag
ALTER TABLE "fixedAssetClass"
  ADD COLUMN "isConstructionInProgress" BOOLEAN NOT NULL DEFAULT FALSE;

-- fixedAssetDisposal: proceeds linkage + partial disposal (additive)
ALTER TABLE "fixedAssetDisposal"
  ADD COLUMN "salesInvoiceLineId" TEXT REFERENCES "salesInvoiceLine"("id") ON DELETE SET NULL,
  ADD COLUMN "proceedsAccountId" TEXT REFERENCES "account"("id"),
  ADD COLUMN "disposalFraction" NUMERIC NOT NULL DEFAULT 1,
  -- posting-time snapshots: cost × fraction, accumulated dep/impairment × fraction
  ADD COLUMN "disposedCost" NUMERIC,
  ADD COLUMN "disposedAccumulatedDepreciation" NUMERIC,
  ADD COLUMN "disposedAccumulatedImpairment" NUMERIC;

-- Impairment document (header + lines). All new tables: audit columns (createdBy/
-- createdAt/updatedBy/updatedAt REFERENCES "user"("id")), "customFields" JSONB on
-- headers, companyId FK → company ON DELETE CASCADE.
CREATE TABLE "fixedAssetImpairment" (
    "id" TEXT NOT NULL DEFAULT id('faim'),
    "companyId" TEXT NOT NULL,
    "impairmentId" TEXT NOT NULL,               -- readable, sequence-backed
    "scope" TEXT NOT NULL CHECK ("scope" IN ('Asset', 'Class')),
    "fixedAssetClassId" TEXT REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
    "testDate" DATE NOT NULL,
    -- Draft→Posted lifecycle: "status" CHECK IN ('Draft','Posted'), "postedAt", "postedBy"
    CONSTRAINT "fixedAssetImpairment_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "fixedAssetImpairment_impairmentId_companyId_key" UNIQUE ("impairmentId", "companyId")
);
CREATE TABLE "fixedAssetImpairmentLine" (
    "id" TEXT NOT NULL DEFAULT id('fail'),
    "companyId" TEXT NOT NULL,
    "impairmentId" TEXT NOT NULL,               -- FK → fixedAssetImpairment(id)
    "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
    "netBookValue" NUMERIC NOT NULL,            -- snapshot at posting
    "recoverableAmount" NUMERIC NOT NULL,
    "impairmentLoss" NUMERIC NOT NULL,          -- max(0, NBV − recoverable)
    "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
    CONSTRAINT "fixedAssetImpairmentLine_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "fixedAssetImpairmentLine_asset_key" UNIQUE ("impairmentId", "fixedAssetId")
);

-- CIP cost ledger (append-only)
CREATE TABLE "fixedAssetCipCost" (
    "id" TEXT NOT NULL DEFAULT id('facc'),
    "companyId" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
    "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('Purchase Invoice', 'Receipt', 'Job', 'Manual')),
    "sourceDocumentId" TEXT,
    "sourceDocumentLineId" TEXT,
    "jobId" TEXT REFERENCES "job"("id") ON DELETE SET NULL,
    "amount" NUMERIC NOT NULL,
    "costDate" DATE NOT NULL,
    "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
    CONSTRAINT "fixedAssetCipCost_pkey" PRIMARY KEY ("id", "companyId")
);  -- + index on fixedAssetId

-- Capitalization + reclassification (Draft→Posted lifecycle like fixedAssetImpairment)
CREATE TABLE "fixedAssetTransfer" (
    "id" TEXT NOT NULL DEFAULT id('fatr'),
    "companyId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,                 -- readable, sequence-backed
    "type" TEXT NOT NULL CHECK ("type" IN ('Capitalization', 'Reclassification')),
    "fixedAssetId" TEXT NOT NULL REFERENCES "fixedAsset"("id") ON DELETE RESTRICT,
    "fromClassId" TEXT NOT NULL REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
    "toClassId" TEXT NOT NULL REFERENCES "fixedAssetClass"("id") ON DELETE RESTRICT,
    "transferDate" DATE NOT NULL,
    "inServiceDate" DATE,                       -- Capitalization only
    "transferredCost" NUMERIC NOT NULL,
    "transferredAccumulatedDepreciation" NUMERIC NOT NULL DEFAULT 0,
    "journalId" TEXT REFERENCES "journal"("id") ON DELETE SET NULL,
    -- Draft→Posted lifecycle columns as fixedAssetImpairment
    CONSTRAINT "fixedAssetTransfer_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "fixedAssetTransfer_transferId_companyId_key" UNIQUE ("transferId", "companyId")
);

-- RLS: all four tables get the standard four policies (accounting_view/create/
-- update/delete via get_companies_with_employee_permission(...)::text[]).
-- Seeds: "sequence" rows for fixedAssetImpairment + fixedAssetTransfer; one
-- 'Construction in Progress' class per company group.
```

## API / Service Changes

- `accounting.models.ts`: extend `fixedAssetDisposalValidator` (proceeds source,
  `salesInvoiceLineId` | `proceedsAccountId` + amount, quantity/fraction); new
  impairment + transfer validators; status arrays gain `'Under Construction'`.
- `accounting.service.ts`: CRUD for impairments, transfers, CIP costs;
  `getCipAging`; `getFixedAssetComponents` — all `(client, args)` → `{data,error}`.
- `accounting.server.ts` (Kysely transactions): `postDisposal()` gains proceeds +
  fraction handling; new `postImpairment()`, `postTransfer()`, `attachJobCostToCip()`.
- `accounting.utils.ts`: `buildDepreciationLines()` subtracts `accumulatedImpairment`
  in its basis term; excludes `'Under Construction'`.
- Edge functions: `post-sales-invoice` Fixed Asset branch → gain/loss pattern;
  `post-receipt`/`post-purchase-invoice` append `fixedAssetCipCost` rows when the
  target asset's class is CIP (GL lines unchanged — CIP class's own asset account).
- Routes: `x+/fixed-asset+/$fixedAssetId.{dispose,transfer,components}`;
  `x+/impairment+/{new,$impairmentId,$impairmentId.post}`; `x+/accounting+/cip-aging`.

## UI Changes

- `FixedAssetDisposalForm`: proceeds section (invoice picker filtered to this
  asset's Fixed Asset lines, or direct account + amount) and partial-disposal
  quantity/fraction input with live gain/loss preview.
- New `FixedAssetImpairmentForm` (scope toggle, per-line recoverable amounts,
  computed loss) + table; new `FixedAssetTransferForm` (type, target class,
  in-service date), reused as the "Capitalize" action on CIP assets.
- `FixedAssetForm`: parent-asset combobox; register groups components under
  parents; NBV column = cost − accum dep − accum impairment. CIP aging report
  page (buckets by first-cost age, drill to cost ledger).

## Acceptance Criteria

- [ ] Cost 10,000, accum dep 4,000, sold via sales invoice for 7,500: journal
      Dr AR 7,500, Dr Accum Dep 4,000, Cr Asset 10,000, Cr `disposalAccountId`
      1,500 (gain); `gainLoss` = 1,500; no revenue line; asset `Disposed`.
- [ ] Same asset scrapped (proceeds 0): unchanged legacy journal — Dr Accum Dep
      4,000, Dr `writeOffAccountId` 6,000, Cr Asset 10,000.
- [ ] Partial disposal, fraction 0.4, direct proceeds 3,000 to cash: Dr Cash
      3,000, Dr Accum Dep 1,600, Cr Asset 4,000, Cr gain 600; asset stays `Active`
      at cost 6,000 / accum dep 2,400; disposal row stores 0.4 + snapshots 4,000/1,600.
- [ ] Impairment: NBV 6,000 (10,000 − 4,000), recoverable 4,500 → Dr
      `writeDownAccountId` 1,500 / Cr accum dep 1,500; `accumulatedImpairment` =
      1,500; next run (straight line, 36 months left, 0 residual) charges 125.00
      (= 4,500/36), not 166.67.
- [ ] Class-scope impairment creates one line per Active asset, prefilled with
      each NBV; lines with recoverable ≥ NBV post nothing.
- [ ] CIP asset receives a 6,000 Fixed Asset PO line (purchase-invoice posting) +
      a 2,500 job-cost attachment: two `fixedAssetCipCost` rows; 8,500 Dr in the
      CIP asset account (2,500 credited from WIP); `Under Construction`; shown in
      CIP aging; excluded from depreciation runs.
- [ ] Capitalizing it into Machinery & Equipment, in-service 2026-08-01: Dr
      Machinery asset account 8,500 / Cr CIP asset account 8,500; `acquisitionCost`
      8,500, `depreciationStartDate` 2026-08-01, `Active`; August run depreciates it.
- [ ] Component with `parentFixedAssetId`, own class and 60-month life,
      depreciates independently; parenting under an asset that itself has a
      parent is rejected. Reclassification posts cost + accumulated-depreciation
      reclass lines, skipping lines where source and target accounts match.
- [ ] Posting any of these into a Closed period fails with the standard
      closed-period error; posted documents reject edits (immutability trigger
      pattern) and the UI offers reversal instead.
- [ ] All new tables have four RLS policies + `companyId` scoping; `pnpm exec
      turbo run typecheck --filter=erp` passes after `pnpm run generate:types`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Rewriting `post-sales-invoice` Fixed Asset branch regresses AR/tax lines | High | Coordinated PR with edge-function integration tests covering invoice-with-asset-line fixtures before/after |
| Partial-disposal rounding drift (fraction × cost vs stored balances) | Med | Snapshot columns are authoritative for the journal; final partial (remaining fraction) disposes exact remaining balances |
| Impairment inside accum-dep account complicates account-level reconciliation | Med | Register report splits dep vs impairment from subledger columns; note in docs; revisit split account when multi-book lands |
| CIP WIP credit double-counts if job later ships/completes normally | High | Jobs attached to a CIP asset are blocked from normal completion costing (see open question 6) |
| Enum ADD VALUE in same transaction as usage | Low | Separate enums migration file, as the existing `20260524143826` precedent |

## Open Questions

> HARD STOP: unchecked items must be resolved before implementation.

- [x] Where does disposal gain/loss post? — **Resolved:** net to the class's
      existing `disposalAccountId` (proceeds − NBV); `writeOffAccountId` stays the
      scrapping target. (Resolution 1.)
- [x] Partial disposals in scope? — **Resolved:** yes; quantity or value fraction,
      pro-rata cost/accumulated split. (Resolution 1.)
- [x] Impairment credit: new account column or contra? — **Resolved:** contra in
      the existing accumulated-depreciation account + `accumulatedImpairment`
      column; no new NOT NULL account FK. (Resolution 2 + Decision 4.)
- [x] CIP cost sources? — **Resolved:** Fixed Asset PO lines + job costs both
      accumulate onto a CIP asset; capitalization transfers to a depreciating
      class, depreciation starting at in-service date. (Resolution 3.)
- [x] Components for IFRS? — **Resolved:** one-level parent/child, independent
      lives/methods; book-specific parameters are the multi-book spec's layer. (Resolution 4.)
- [x] Depreciation scheduling / close checks here? — **Resolved:** no — the
      close-automation spec owns them; this spec only excludes
      `Under Construction` from runs. (Resolution 5.)
- [x] **Job → CIP WIP credit timing:** credit WIP at attachment (cost leaves the
      job immediately) vs at capitalization (WIP holds until in-service).
      Recommended: at attachment — matches SAP AuC settlement, keeps WIP clean at
      close — but it changes production job costing, and CIP-attached jobs must
      be blocked from normal completion costing. Cross-module → needs sign-off. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** At attachment (SAP AuC pattern) — cost leaves WIP when attached to the CIP asset; CIP-attached jobs are blocked from normal completion costing. The cross-module production change is accepted.
- [x] **Fate of the standalone "Sell" flow:** `$fixedAssetId.sell` creates a
      sales order at book value; the invoice posts revenue. Keep Sell as the
      invoice-generating front end with its posting rewritten to net to
      `disposalAccountId` (recommended), or fold it into the dispose form?
      Changes posted invoices' GL → needs confirmation. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Keep `$fixedAssetId.sell` as the invoice-generating front end with its posting rewritten to net proceeds to `disposalAccountId`.

## Changelog

- 2026-07-04: Created from readiness finding GAP-4 remainder (tracking crbnos/carbon#1041); scope resolutions 1–5 baked in; two new blocking questions surfaced (WIP credit timing, Sell-flow fate).
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
