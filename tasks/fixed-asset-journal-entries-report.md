# Fixed Asset Journal Entries — Purchase & Sale (Research Report)

**Date:** 2026-07-16
**Scope:** Read-only research. Industry accounting standards + Carbon codebase (`/home/openclaw/carbon`) for fixed-asset purchase/sale GL posting, plus root-cause of the "failed to create sales order line" error attributed to PR #1155.
**Status:** No code changes made.

---

## 0. TL;DR

1. **Purchase GL** in Carbon is essentially GAAP-correct: goods receipt debits the asset account and credits GR/IR; the AP invoice clears GR/IR and books Payables, with price variance handled. Fixed assets are correctly **capitalized** (not run through inventory/COGS).
2. **Sale/disposal GL** is mostly right in its *net* effect but has one material GAAP weakness: **there is no dedicated Gain/Loss-on-Disposal account in the flow.** Both the net-book-value write-off and the offsetting sale proceeds are posted to the class's `writeOffAccountId`, so the gain/loss is only *implicit* in that account's net balance. The `disposalAccountId` and `writeDownAccountId` columns exist (NOT NULL on `fixedAssetClass`) but are **never used** in any posting path.
3. **Interim mis-statement:** between shipment and sales-invoice, the disposal row is written with `gainLoss = -NBV` and `saleProceeds = 0` (a full loss); it is only corrected to `proceeds − NBV` when the invoice posts. An asset shipped-but-never-invoiced shows a permanent full loss.
4. **Depreciation is fully manual** (no scheduled job). An asset can be sold without depreciation being caught up to the disposal date, which overstates NBV and mis-states the gain/loss vs GAAP.
5. **Root cause of "failed to create sales order line":** PR #1155 (*"fix(sales): don't require method type when selling a Fixed Asset"*, merged upstream as `5a1e6a2cc`) is the **fix**, not the cause. It is **absent from the local `main` checkout** — local `main` still has the buggy validator. On the buggy validator, a Fixed Asset (or Comment) sales-order line submits a hidden `methodType=""`, which fails the `z.enum(...)` check *before* the exempting `.refine()` runs, blocking line creation at the validation layer. The literal DB-level flash string is a red herring for the `methodType` issue (see §4).

---

## 1. Industry-Standard Journal Entries (GAAP / IFRS)

Fixed assets are **capitalized** and depreciated — they never flow through inventory or Cost of Goods Sold. The sign convention below is plain double-entry (debits = credits).

### 1a. Purchasing a Fixed Asset

**At goods receipt (asset physically received, not yet invoiced):**
```
Dr  Fixed Asset (or Asset Clearing / CIP)      acquisition cost
    Cr  GR/IR Clearing (Goods Received Not Invoiced)   acquisition cost
```
- The asset is recognized at **cost** (purchase price + directly-attributable costs to bring it into use: freight-in, install, non-refundable duties — IAS 16 / ASC 360).
- GR/IR is an accrued-liability clearing account bridging physical receipt and the vendor invoice.

**At AP invoice:**
```
Dr  GR/IR Clearing                              receipt cost   (reverses the accrual)
Dr/Cr  Purchase Price Variance                  invoice − receipt difference (if any)
    Cr  Accounts Payable                        invoice cost
```
- Reconciliation: the invoice **drains the same GR/IR account** the receipt credited; any residual is a price variance. Net result: asset on the books at cost, payable owed to the vendor, GR/IR back to zero.

**Subsequently, each period (depreciation):**
```
Dr  Depreciation Expense
    Cr  Accumulated Depreciation (contra-asset)
```
- Recognized systematically over useful life (straight-line, declining-balance, units-of-production). Tax books may differ (MACRS in the US), creating deferred-tax temporary differences.

### 1b. Selling / Disposing a Fixed Asset

The three GAAP requirements on disposal (IAS 16 ¶67–72 / ASC 360-10-40):
1. **Remove** the asset's gross cost **and** its accumulated depreciation from the books.
2. **Recognize proceeds.**
3. **Recognize gain or loss = Proceeds − Net Book Value**, where NBV = Cost − Accumulated Depreciation.

**Critical GAAP point:** proceeds from selling a fixed asset are **not sales revenue** (unless the entity is a dealer in such assets). The income statement reflects **only the gain or loss**, on a *non-operating* line ("Gain/(Loss) on Disposal of Assets" / "Other income & expense") — **not** the Sales/Revenue account, and gross proceeds do **not** inflate revenue.

**Combined disposal entry (single-step sale):**
```
Dr  Cash / Accounts Receivable                  sale proceeds
Dr  Accumulated Depreciation                    all accumulated depreciation on the asset
    Cr  Fixed Asset                             gross/original cost
    Cr  Gain on Disposal            (if proceeds > NBV)
--- or ---
Dr  Loss on Disposal                (if proceeds < NBV)
```

**ERP two-step (shipment then invoice) — how a well-designed ERP splits it:**
```
At shipment (asset physically leaves):
Dr  Accumulated Depreciation                    accumulated depreciation
Dr  Disposal Clearing (holds NBV)               net book value
    Cr  Fixed Asset                             gross cost

At invoice (proceeds recognized):
Dr  Accounts Receivable                         proceeds
    Cr  Disposal Clearing                       proceeds

Then the Disposal Clearing residual (NBV − proceeds) is reclassed to:
Dr/Cr  Gain/(Loss) on Disposal                  the residual
```
- Best practice also books a **catch-up depreciation to the disposal date** first, so NBV (and therefore the gain/loss) is correct at the moment of sale.
- Scrapping (no proceeds) is the same with proceeds = 0, so the entire NBV becomes a loss.

---

## 2. What Carbon Currently Does

**Mechanism.** GL entries are double-entry rows in `journal` (header) + `journalLine` (lines). Sign convention: `amount > 0` = debit, `amount < 0` = credit, produced by `debit()`/`credit()` helpers in `packages/database/supabase/functions/lib/utils.ts:57-83`. Posting happens in Deno **edge functions** inside one Kysely transaction, with `journalLineDimension` tags (Item / Location / CostCenter / **FixedAssetClass** / etc.).

**Account determination.** Thin interface-account model (`accountDefault`, one row per company) via `shared/get-posting-group.ts`. **Fixed-asset accounts come from `fixedAssetClass`**, which has six NOT NULL account FKs: `assetAccountId`, `accumulatedDepreciationAccountId`, `depreciationExpenseAccountId`, `writeOffAccountId`, `writeDownAccountId`, `disposalAccountId`.

**Data model.** `fixedAsset` has `acquisitionCost`, `accumulatedDepreciation`, `accumulatedTaxDepreciation`, depreciation config, disposal fields (`disposalMethod`, `saleProceeds`), `status` (Draft/Active/Fully Depreciated/Disposed). **There is no NBV column** — NBV is always computed in code as `acquisitionCost − accumulatedDepreciation`. Assets link to documents via `assetId` FK on `purchaseOrderLine` / `salesOrderLine` / `purchaseInvoiceLine` / `salesInvoiceLine` (migration `20260524143827_fixed-assets.sql`).

### 2a. Purchase (acquisition) — matches GAAP

- **`post-receipt/index.ts`** (Fixed Asset PO line): increments `fixedAsset.acquisitionCost`, sets `depreciationStartDate`, flips status to `Active`; posts **Dr `assetAccountId` / Cr GR/IR** at PO cost.
- **`post-purchase-invoice/index.ts` (~1441-1645)**: posts **Dr `assetAccountId`** ("Fixed Asset Acquisition"), clears GR/IR, books **Cr Payables**, and handles price variance (`purchaseVarianceAccount`). Reconciles against the receipt through the same GR/IR account.
- **Depreciation** — `accounting.server.ts:postDepreciationRun()` (L225): per asset **Dr `depreciationExpenseAccountId` / Cr `accumulatedDepreciationAccountId`** (`sourceType: 'Asset Depreciation'`), bumps `accumulatedDepreciation`, adds deferred-tax lines when `assetTaxDepreciationEnabled`, flips to `Fully Depreciated` at residual. Math in `accounting.utils.ts` (SL / DB-200% / Units-of-Production / MACRS + bonus).

> Manual "register" path (`$fixedAssetId.register`) is a **pure status flip with no journal** — an asset can appear on the books with no acquisition GL entry unless acquired through the receipt/invoice posting path.

### 2b. Sale (disposal) — net-correct but comingled

- **`$fixedAssetId.sell.tsx`** (the selling entry point): validates a customer, calls `insertSalesOrder` (Draft), then directly inserts a `salesOrderLine` with `salesOrderLineType:"Fixed Asset"`, `assetId`, `saleQuantity:1`, and **`unitPrice = NBV`**. **No GL is posted here.**
- **`post-shipment/index.ts` (~548-697)** (Fixed Asset SO line — the asset physically leaves):
  ```
  Dr  accumulatedDepreciationAccountId    accumulated depreciation
  Dr  writeOffAccountId                    NBV
      Cr  assetAccountId                   gross cost
  ```
  Sets asset `Disposed`, `disposalMethod:"Sale"`, and inserts `fixedAssetDisposal` with **`saleProceeds:0, gainLoss:-NBV`**.
- **`post-sales-invoice/index.ts` (~571-860)** (Fixed Asset invoice line):
  - If already shipped: **Dr AR / Cr `writeOffAccountId`** ("Disposal proceeds") for `saleProceeds`, then updates the disposal row `gainLoss = saleProceeds − NBV` and the asset's `saleProceeds`.
  - If not previously shipped: does the full write-off + AR/proceeds in one shot, inserting the disposal row with `gainLoss = saleProceeds − NBV`.
- **Manual disposal (scrap)** — `$fixedAssetId.dispose.tsx` → `accounting.server.ts:postDisposal()` (L37): **Dr accumDep, Dr `writeOffAccountId` (NBV), Cr `assetAccountId` (cost)**; writes disposal with `gainLoss = -NBV`. The route **hardcodes `disposalMethod="Scrapping"`**.

**Net effect of a sale across both postings:**
```
Cr  Asset            (cost)        — asset removed ✓
Dr  Accum. Deprec.   (accumDep)    — accumulated depreciation cleared ✓
Dr  writeOff (NBV) then Cr writeOff (proceeds)  → writeOff net = NBV − proceeds = the LOSS (gain if negative)
Dr  Accounts Receivable (proceeds) — receivable booked ✓
```
Proceeds are **correctly not routed through the Sales/Revenue account** (the FA line has its own branch and credits `writeOffAccountId`, not `salesAccount`), which is GAAP-correct. The gain/loss *does* land — but only as the **net balance of `writeOffAccountId`**, never as an explicit gain/loss line.

---

## 3. Gap Analysis (Carbon vs GAAP)

### Purchase — minor gaps only
| Area | GAAP | Carbon | Verdict |
|---|---|---|---|
| Capitalize at cost | ✓ | Dr Asset / Cr GR/IR at receipt | ✓ Correct |
| GR/IR reconciliation | ✓ | AP invoice drains GR/IR, PPV for diff | ✓ Correct |
| Not through inventory/COGS | ✓ | Separate FA line path | ✓ Correct |
| Acquisition control | Every capitalized asset has a GL entry | Manual `register` path posts **no journal** | ⚠ Control gap |

### Sale/disposal — material gaps
1. **No dedicated Gain/Loss-on-Disposal account.** GAAP wants gain/loss on a distinct non-operating P&L line. Carbon nets it inside `writeOffAccountId` (NBV debit at shipment, proceeds credit at invoice). `fixedAssetClass.disposalAccountId` **and** `writeDownAccountId` are NOT NULL but **unused in every posting path** — the intended gain/loss / impairment accounts are dead columns. **Result:** the P&L shows disposal activity comingled in one "write-off" account; there is no clean gain/loss figure without netting.
2. **Interim full-loss mis-statement.** At shipment the disposal row is `gainLoss = -NBV`, `saleProceeds = 0`; `writeOffAccountId` carries the full NBV as an expense until the invoice posts. A period-end that falls between shipment and invoicing overstates the loss and understates receivables/proceeds. An asset shipped but never invoiced records a **permanent full loss**.
3. **No catch-up depreciation to disposal date.** Depreciation is entirely manual (no Inngest/cron job). GAAP requires depreciation recognized through the disposal date. Carbon computes NBV from whatever `accumulatedDepreciation` happens to be posted, so an under-depreciated asset yields an inflated NBV and a distorted gain/loss.
4. **`unitPrice` defaults to NBV in `sell.tsx`.** If the user doesn't override it, proceeds = NBV → gain/loss = 0. Reasonable default, but it means an un-edited sale silently records no gain/loss.
5. **Sale vs Scrap asymmetry.** The manual disposal route hardcodes `Scrapping`; genuine sales must go through sell → SO → ship → invoice. There is no manual "sale with proceeds" disposal path.

### Summary
- **Purchase:** effectively GAAP-correct; only the manual-register no-journal path is a control concern.
- **Sale:** arithmetically the balance sheet ends correct (asset & accum-dep removed, AR booked, gain/loss implicitly captured), but the **P&L presentation is not GAAP-clean** (no explicit gain/loss account; `disposalAccountId`/`writeDownAccountId` unused), plus **timing** (interim full loss) and **completeness** (no depreciation catch-up) issues.

---

## 4. Root Cause — "failed to create sales order line"

### Finding: PR #1155 is the fix, and it is missing from local `main`
- **PR #1155** = *"fix(sales): don't require method type when selling a Fixed Asset"* (branch `dalat`, upstream merge `5a1e6a2cc`, **state MERGED**). It changed exactly two files, **no migration**: `apps/erp/app/modules/sales/sales.models.ts` and `apps/erp/app/modules/invoicing/invoicing.models.ts`.
- The merge commit `5a1e6a2cc` is **not present in the local checkout** (`git show` → "bad object"); local `main` still has the **pre-fix (buggy)** validator at `sales.models.ts:756-760`.

### The mechanism
The sales-order-line form always posts a hidden `methodType` field. For a **Fixed Asset** (and **Comment**) line, that value is the empty string `""`.

- **Buggy validator (local `main`):**
  ```ts
  methodType: z.enum(methodType, { errorMap: () => ({ message: "Method is required" }) }).optional(),
  ```
  `.optional()` accepts only `undefined`, **not `""`.** So `""` is validated against the enum and **rejected at the field level**, *before* the conditional `.refine()` (lines 803-818) that exempts Comment/Fixed Asset lines can ever run. The route (`x+/sales-order+/$orderId.new.tsx:42-48`) returns `validationError(...)` → the line is **never created** and the user sees an inline **"Method is required"** error.
- **PR #1155 fix:**
  ```ts
  methodType: zfd.text(z.enum(methodType, {...}).optional()),
  ```
  `zfd.text` coerces `""` → `undefined`, so `.optional()` passes and the refine correctly exempts Fixed Asset / Comment lines.

### Why the literal flash string is a red herring for `methodType`
The flash **"Failed to create sales order line."** (`$orderId.new.tsx:77`) fires **only** on a *service/DB* error from `upsertSalesOrderLine`, which the `methodType` issue never reaches:
- **Pre-#1155:** creation is blocked earlier, at validation (a 422 field error), not at the DB.
- **Post-#1155:** `methodType` becomes `undefined`; `salesOrderLine.methodType` is **NOT NULL but has a DB default `'Pull from Inventory'`** (migration `20260321143847`), and the only insert-required columns are `companyId`, `createdBy`, `salesOrderId`, `salesOrderLineType`. `assetId` is nullable. So the insert **succeeds** (the asset line just gets a semantically-irrelevant default method).

**Conclusion:** The reported failure is the pre-#1155 validation rejection of Fixed Asset / Comment lines, most likely observed on an environment that did **not** actually have #1155 applied (exactly the state of this local checkout). It was misattributed to the fixed-asset work; #1155 is the remediation. If the team is literally seeing the DB flash *after* confirming #1155 is deployed, the cause is a genuine DB/RLS/FK error on the `salesOrderLine` insert (e.g. the referenced `fixedAsset` row absent, or an `accounting`/`sales` RLS mismatch) — **not** `methodType`.

---

## 5. Recommended Fixes (description only — no implementation)

### A. Restore Fixed Asset / Comment sales-order line creation (the reported bug)
- **Apply PR #1155 to this checkout** — either merge upstream commit `5a1e6a2cc`, or reproduce its change: wrap `methodType` in `zfd.text(...)` in **both** `sales.models.ts:756` (`salesOrderLineValidator`) and `invoicing.models.ts` (`salesInvoiceLineValidator`). This is the minimal, correct fix; the conditional `.refine()` already exempts Fixed Asset / Comment lines.
- **Verify** by creating a Fixed Asset SO line (and a Comment line) through `x+/sales-order+/$orderId.new.tsx` and confirming no validation error.

### B. GAAP-correctness for fixed-asset disposal (accounting)
1. **Introduce an explicit Gain/Loss-on-Disposal posting.** Use the existing `fixedAssetClass.disposalAccountId` (currently unused): when the sales invoice posts, reclass the `writeOffAccountId` residual (`proceeds − NBV`) into `disposalAccountId` as an explicit gain (credit) or loss (debit) line, so the P&L carries a clean non-operating gain/loss figure and `writeOffAccountId` nets to zero. Alternatively, post proceeds directly against `disposalAccountId` and the NBV write-off against `disposalAccountId`, letting the net *be* the gain/loss on one account. Either way, stop comingling NBV write-off and proceeds — decide the role of `writeOffAccountId` vs `disposalAccountId` vs `writeDownAccountId` and document it.
2. **Fix interim mis-statement.** Reconsider writing `gainLoss = -NBV, saleProceeds = 0` at shipment. Options: (a) hold the NBV in a **disposal clearing** account (asset/holding, not expense) at shipment and only recognize gain/loss at invoice; or (b) require the invoice to accompany the shipment for FA lines. Ensure a shipped-but-uninvoiced asset does not sit as a permanent full loss.
3. **Depreciation catch-up on disposal.** Before computing NBV for a disposal, post depreciation up to the disposal date (or block disposal of assets not depreciated to the current period), so NBV and gain/loss are GAAP-accurate. Longer term, add a scheduled depreciation run (Inngest) since depreciation is currently entirely manual.
4. **Acquisition control.** Consider posting an acquisition journal (or explicitly requiring the receipt/invoice path) when an asset is registered manually, so no capitalized asset exists without a GL entry.

### C. Follow the established posting pattern
Any new/changed GL posting should follow the `bookAdjustment()` template from PR #1149 (`packages/database/supabase/functions/shared/post-adjustment.ts`): post only when `accountingEnabled`, fail-closed on read failures, one balanced journal per movement in a single Kysely transaction, dimension tags on every line, `companyId` + audit fields, and a reconcile/tie-out path.

---

## Appendix — Key file references
- Validators / bug: `apps/erp/app/modules/sales/sales.models.ts:739-828` (`salesOrderLineValidator`), `:756-760` (buggy `methodType`), `:803-818` (exempting refine). Invoice twin: `apps/erp/app/modules/invoicing/invoicing.models.ts`.
- SO line create route: `apps/erp/app/routes/x+/sales-order+/$orderId.new.tsx` (validate L42, flash L77).
- SO line service: `apps/erp/app/modules/sales/sales.service.ts:5500` (`upsertSalesOrderLine`).
- Selling flow: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.sell.tsx` (line insert L111-123, `unitPrice = NBV`).
- Fixed-asset schema: `packages/database/supabase/migrations/20260524143827_fixed-assets.sql` (`fixedAsset` :170, `fixedAssetClass` :98, SO/inv-line `assetId` FKs :252-256); enums `20260524143826_fixed-asset-enums.sql`.
- Disposal / depreciation posting: `apps/erp/app/modules/accounting/accounting.server.ts:postDisposal()` (L37), `postDepreciationRun()` (L225); math `accounting.utils.ts`.
- Edge-function GL: `post-receipt` / `post-purchase-invoice` (acquisition), `post-shipment` (~548-697, FA disposal), `post-sales-invoice` (~571-860, FA disposal + proceeds).
- GL helpers: `packages/database/supabase/functions/lib/utils.ts:57-83` (`debit`/`credit`), `shared/get-posting-group.ts`, `shared/calculate-cogs.ts`, `shared/post-adjustment.ts` (posting template).
- Rule doc: `.ai/rules/fixed-asset-lifecycle.md`.
