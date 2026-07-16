# Task: PR #1157 — CodeRabbit Round 3 Feedback

## Context
PR #1157: `fix(accounting): GAAP-correct journal entries for fixed asset registration and sale/disposal`
Branch: `fix/1156-fixed-asset-gaap-journals`
Working directory: `/home/openclaw/carbon` (already on the right branch)
Latest commit: `df19d0de4`

## Objective
Address all 5 actionable CodeRabbit round-3 comments. Push a single clean commit on the same branch.

---

## Items to Fix

### 1. `accounting.utils.ts` — Validate accumulated depreciation ≤ acquisition cost
**File:** `apps/erp/app/modules/accounting/accounting.utils.ts` around line 59-81 (the `acquisitionLines` function)
**Issue:** The function doesn't validate that `accumulatedDepreciation` doesn't exceed `acquisitionCost` before calculating NBV or building journal lines. Over-depreciated inputs are invalid and should be rejected with a clear error.
**Fix:** Before computing `nbv = acquisitionCost - accumulatedDepreciation`, check that `accumulatedDepreciation <= acquisitionCost`. If it exceeds, throw/return an error (match the existing error-return pattern of the file). Preserve all existing behavior for valid inputs.

### 2. `register.tsx` — Add companyId filter for tenant scoping
**File:** `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` around lines 86-92 and 194-203
**Issue A (L86-92):** The asset lookup `.from("fixedAsset").select(...).eq("id", params.fixedAssetId)` is missing a `.eq("companyId", companyId)` predicate.
**Issue B (L194-203):** The accounting-disabled update path `.from("fixedAsset").update({...}).eq("id", params.fixedAssetId).eq("status", "Draft")` is also missing `.eq("companyId", companyId)`.
**Fix:** Add `.eq("companyId", companyId)` to both queries. The `companyId` is already available in scope (it comes from the session/context — check how other routes in the same file or nearby routes access it).

### 3. `register.tsx` — Handle zero-row update case  
**File:** `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx` around line 194-203
**Issue:** The accounting-disabled update flow can return `{ error: null }` even when zero rows were matched (e.g. if the row is no longer in Draft status due to a concurrent update). The current code flashes success regardless.
**Fix:** After the update, check that a row was actually affected. Either:
- Use `.select()` chained after `.update()` and treat an empty result as a failure, OR  
- Use the Supabase `count` option to verify rowCount > 0
Return an appropriate error response if zero rows were updated.

### 4. `post-sales-invoice/index.ts` — Wrap asset record updates in same transaction
**File:** `packages/database/supabase/functions/post-sales-invoice/index.ts` around lines 710-726
**Issue:** After posting journals, the code updates `fixedAssetDisposal` and `fixedAsset` records separately outside any transaction. If either update fails, the journals are already posted but the asset state is wrong — partial inconsistency.
**Fix:** Move the `fixedAssetDisposal` update and the `fixedAsset` update to execute within the same Postgres transaction as the journal posting. Check and propagate errors from each update so any failure aborts the whole transaction. Match the existing transaction pattern used elsewhere in this file.

### 5. `tr/erp.po` — Correct Turkish inventory-count GL account translation
**File:** `packages/locale/locales/tr/erp.po` around lines 5625-5626
**Issue:** The `msgstr` at L5626 describes the source-company debit account for an intercompany transaction instead of the GL account used when physical inventory counts differ from system inventory.
**Fix:** Replace the current msgstr with an accurate Turkish translation for the physical inventory-count variance GL account. Look at the msgid to understand the meaning, then translate it properly into Turkish.

---

## Verification
After implementing:
1. Run `pnpm --filter @carbon/erp typecheck` to confirm no type errors
2. Run `pnpm --filter @carbon/erp test` (or the relevant test file for accounting.utils)
3. Confirm the `tr/erp.po` file has the correct msgid/msgstr alignment
4. Confirm no other locales were accidentally touched

## Commit
Push one commit on the existing branch:
```
git add -A
git commit -m "fix(accounting): address CodeRabbit round-3 review feedback on PR #1157"
git push origin fix/1156-fixed-asset-gaap-journals
```

## Output
Write a brief summary of what was done to:
`/home/openclaw/.openclaw/workspace/loop-runs/1157-review-feedback-3.log`
