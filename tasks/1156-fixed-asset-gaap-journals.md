# Task Brief — Issue #1156: GAAP-correct journal entries for fixed asset registration, purchase, and sale/disposal

**Issue:** https://github.com/crbnos/carbon/issues/1156
**Branch to create:** `fix/1156-fixed-asset-gaap-journals`
**Repo:** /home/openclaw/carbon
**No merge.** Open a PR and stop.

---

## Context

A research audit (2026-07-16) found three GAAP gaps in Carbon's fixed-asset GL posting. The research report is at `/home/openclaw/.openclaw/workspace/tasks/fixed-asset-journal-entries-report.md` — read it fully before writing any code; it has exact file/line references.

The `methodType` validation bug (failing to create SO lines) is already handled by PR #1155. This task is accounting-only.

---

## Acceptance Criteria

### 1. Manual registration posts an acquisition journal entry
- Route: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` (or the server action it calls)
- After a successful registration, post:
  ```
  Dr  assetAccountId         acquisitionCost
      Cr  [equity/owner equity or a "Direct Registration" clearing account]   acquisitionCost
  ```
  Use `fixedAssetClass.assetAccountId` for the debit. For the credit, look at how other direct-registration postings work in the codebase (check `accounting.server.ts` for any existing `registerAsset` / `postRegistration` helpers). If none exists, create a `sourceType: 'Asset Registration'` journal. Use the `bookAdjustment()` pattern from `packages/database/supabase/functions/shared/post-adjustment.ts` as your template.
- Only post when `accountingEnabled` for the company.
- No capitalized asset should exist without a GL entry.

### 2. Explicit Gain/Loss-on-Disposal using `disposalAccountId`

Currently `writeOffAccountId` receives both the NBV debit (at shipment) and the proceeds credit (at invoice), leaving gain/loss implicit. `fixedAssetClass.disposalAccountId` is NOT NULL but never used.

**Fix in `post-shipment/index.ts` (~548-697):**
- Change: instead of `Dr writeOffAccountId (NBV)`, post `Dr Disposal Clearing account` (see AC#3 below)

**Fix in `post-sales-invoice/index.ts` (~571-860) — both the "already shipped" and "not yet shipped" branches:**
- Clear the Disposal Clearing account (see AC#3)
- Compute `gainLoss = saleProceeds − NBV`
- If `gainLoss > 0`: `Cr disposalAccountId (gain)` — credit to non-operating income
- If `gainLoss < 0`: `Dr disposalAccountId (loss)` — debit to non-operating expense (post abs value as debit)
- If `gainLoss = 0`: no gain/loss line needed (or a zero-amount line for audit trail)
- `writeOffAccountId` must net to zero after a completed disposal cycle

**Fix in `accounting.server.ts:postDisposal()` (L37, the scrap path):**
- Same pattern: scrap has proceeds = 0, so entire NBV becomes a loss to `disposalAccountId`
- Change `Dr writeOffAccountId (NBV)` → `Dr disposalAccountId (full loss)` + remove the scrap NBV from writeOffAccountId

### 3. No interim full-loss mis-statement (Disposal Clearing account)

The problem: at shipment `gainLoss = -NBV` and `saleProceeds = 0` is posted as an expense, causing a full P&L loss until the invoice arrives.

**Solution:** introduce a Disposal Clearing / Asset Held-for-Disposal account.

- Check if `fixedAssetClass` already has a disposal-clearing FK column in the migration `20260524143827_fixed-assets.sql`. If not, you may need to add one (migration required).
  - Alternative if you want to avoid a migration: reuse `writeOffAccountId` as the clearing account at shipment but ensure the invoice explicitly credits it back to zero before booking the gain/loss to `disposalAccountId`. The key invariant is `writeOffAccountId` nets to zero.
- **At shipment** (post-shipment edge function):
  ```
  Dr  accumulatedDepreciationAccountId    accumulated depreciation
  Dr  Disposal Clearing                   NBV   ← balance-sheet holding account, not expense
      Cr  assetAccountId                  gross cost
  ```
  Asset is removed from books; no P&L impact yet.
- **At invoice** (post-sales-invoice edge function):
  ```
  Dr  Accounts Receivable                 proceeds
      Cr  Disposal Clearing               NBV   ← clears the holding account
  ```
  Then: `gainLoss = proceeds − NBV`
  ```
  If gain: Cr disposalAccountId (gain)
  If loss: Dr disposalAccountId (loss)
  ```
  The Disposal Clearing account ends at zero; `disposalAccountId` carries only the net gain/loss.

### 4. Update `.ai/rules/fixed-asset-lifecycle.md`
After implementing the above, update the rule doc to reflect the corrected journal entry patterns.

---

## Implementation Notes

- **Posting template:** follow `packages/database/supabase/functions/shared/post-adjustment.ts` exactly — `accountingEnabled` guard, Kysely transaction, `debit()`/`credit()` helpers, dimension tags (`fixedAssetClassId`), `companyId` + audit fields.
- **No schema change if avoidable:** try to reuse existing account FKs before adding columns. If a migration IS needed for a Disposal Clearing FK, keep it minimal and non-breaking (nullable column with a default).
- **pnpm, never npm.**
- **After any migration changes:** run `pnpm run generate:types` before typechecking.
- **Lint + typecheck** before opening the PR.
- **Behavior gate:** write at least one unit test covering the gain/loss calculation (can be in `accounting.utils.ts` test file if one exists, or a new test file adjacent to the function being changed).

---

## Key File References (from research report)
- `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` — registration route
- `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.sell.tsx` — sell entry (L111-123 inserts SO line with `unitPrice = NBV`)
- `apps/erp/app/modules/accounting/accounting.server.ts` — `postDisposal()` L37, `postDepreciationRun()` L225
- `packages/database/supabase/functions/post-shipment/index.ts` — FA disposal at shipment ~L548-697
- `packages/database/supabase/functions/post-sales-invoice/index.ts` — FA disposal at invoice ~L571-860
- `packages/database/supabase/functions/post-receipt/index.ts` — acquisition posting (reference for how purchase works correctly)
- `packages/database/supabase/functions/post-purchase-invoice/index.ts` — acquisition invoice (reference)
- `packages/database/supabase/functions/lib/utils.ts:57-83` — `debit()`/`credit()` helpers
- `packages/database/supabase/functions/shared/post-adjustment.ts` — posting template
- `packages/database/supabase/migrations/20260524143827_fixed-assets.sql` — FA schema (fixedAssetClass :98, fixedAsset :170)
- `.ai/rules/fixed-asset-lifecycle.md` — rule doc to update

---

## PR Requirements
- Title: `fix(accounting): GAAP-correct journal entries for fixed asset registration and sale/disposal`
- Reference `Closes #1156` in the PR body
- Include a short summary of the three accounting changes made
- Do NOT merge
