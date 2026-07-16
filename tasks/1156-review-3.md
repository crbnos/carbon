# PR #1157 — Round 3 CodeRabbit Feedback: Fix remaining 5 unresolved threads

## Context

You are working in the worktree `/home/openclaw/carbon-loop-1156` on branch `loop/1156`, which tracks `fix/1156-fixed-asset-gaap-journals` (PR #1157). The PR fixes GAAP-correct journal entries for fixed asset registration and sale/disposal.

There are **5 unresolved CodeRabbit review threads** to fix. All are from CodeRabbit (no human comments). Fix all of them in a single commit, push, and resolve each thread.

---

## Items to Fix

### 1. [Major] Reject failed/incomplete dimension resolution before posting
**File:** `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx`

`dimensionsResult.error` is ignored, and absent identifiers are passed to `postAssetRegistration`. This can produce a registration journal without the required dimensions.

Fix: Check `dimensionsResult.error` and throw/redirect with an error flash before proceeding. Also validate that required location and asset-class dimension identifiers are present before invoking `postAssetRegistration`.

Proposed fix:
```diff
+if (dimensionsResult.error) {
+  throw redirect(
+    path.to.fixedAsset(fixedAssetId),
+    await flash(
+      request,
+      error(dimensionsResult.error, "Failed to get accounting dimensions")
+    )
+  );
+}
+
 const locationDimensionId = (dimensionsResult.data ?? []).find(
   (d) => d.entityType === "Location"
 )?.id;
 const assetClassDimensionId = (dimensionsResult.data ?? []).find(
```

### 2. [Major] Correct Russian disposal-clearing account msgstr
**File:** `packages/locale/locales/ru/erp.po` around line 11680-11681

The Russian locale entry for the disposal-clearing account has an empty `msgstr` or incorrect wording. It must describe invoicing as **crediting** the account by the asset's net book value (not sale proceeds), while shipment debits NBV and gain/loss posts separately to the Disposal Account. Provide an accurate Russian translation that is consistent with the English msgid.

The English msgid describes:
- Shipment: debits NBV to this clearing account (balance-sheet holding, not P&L)
- Invoice: credits the clearing account by NBV (returning it to zero), then net gain/loss posts to the Disposal Account
- This account nets to zero over a completed disposal cycle

### 3. [Major] Validate opening depreciation bounds in `acquisitionLines()`
**File:** `apps/erp/app/modules/accounting/accounting.utils.ts` around lines 59-81

`acquisitionLines()` can produce incorrect journal entries when `accumulatedDepreciation > acquisitionCost` — the offset line flips into a debit instead of the intended credit.

Fix: Validate that `accumulatedDepreciation` does not exceed `acquisitionCost` before calculating NBV or constructing lines. Throw or return an error for invalid over-depreciated inputs. Preserve existing behavior for valid values.

Also add a unit test in `apps/erp/app/modules/accounting/accounting.utils.test.ts` for the over-depreciated rejection case.

### 4. [Critical] Scope both fixed-asset operations by `companyId`
**File:** `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.register.tsx`

The disabled-accounting path can activate a Draft asset belonging to another company. The accounting-enabled path also reads assets without tenant scope.

Fix:
- Line ~86-92: add `.eq("companyId", companyId)` to the asset lookup (accounting-enabled path)
- Line ~194-203: add `.eq("companyId", companyId)` to the disabled-accounting update

Also handle zero-row case for the accounting-disabled update path: check the affected row count after the update and return an error if no row was matched.

### 5. [Major] Wrap fixed-asset writes in the same transaction as journal posting
**File:** `packages/database/supabase/functions/post-sales-invoice/index.ts` around lines 710-726

Both `.update()` results are ignored and run outside the journal transaction. A failed write or later abort can leave `fixedAssetDisposal`/`fixedAsset` out of sync with the posted journals.

Fix: Move the `fixedAssetDisposal` and `fixedAsset` update calls into the same transaction as the journal posting. Check and propagate each update error so any failure aborts the transaction.

---

## After Fixing

1. Run tests: `pnpm exec vitest run accounting.utils.test.ts` (should still pass all tests including the new one)
2. Run typecheck on changed files
3. Run biome lint on changed files
4. Commit with message: `fix(accounting): round 3 — companyId scope, dimension guard, depreciation bound, disposal tx, ru locale`
5. Push to `loop/1156` (which updates PR #1157)
6. After push, resolve the review threads on PR #1157 using `gh` CLI

## Resolution

After pushing, resolve the 5 threads using the GitHub GraphQL API:
```bash
gh api graphql -f query='{ repository(owner: "crbnos", name: "carbon") { pullRequest(number: 1157) { reviewThreads(first: 50) { nodes { id isResolved } } } } }'
```
Then for each unresolved thread ID, call:
```bash
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<id>"}) { thread { id isResolved } } }'
```
