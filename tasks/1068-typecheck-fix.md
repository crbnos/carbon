# Task: Fix Typecheck Failures on PR #1068 (loop/1031)

## Context
PR #1068 (`feat: Accounting period close lifecycle`) is open on branch `loop/1031`.
After a recent merge of `origin/main` into `loop/1031` (commit `db2cf7dec1e09f7a30091bd970a2879a2c922b60`),
CI Typecheck is now failing with:

```
apps/erp/app/modules/invoicing/ui/PurchaseInvoice/usePurchaseInvoiceAutoFill.ts(116,9): error TS2578: Unused '@ts-expect-error' directive.
apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceForm.tsx(109,9): error TS2578: Unused '@ts-expect-error' directive.
apps/erp/app/modules/sales/ui/Quotes/QuoteForm.tsx(95,37): error TS2589: Type instantiation is excessively deep and possibly infinite.
```

## Root Cause
- The main branch changed the type environment such that the Supabase composite-key `@ts-expect-error` directives in
  `usePurchaseInvoiceAutoFill.ts` and `SalesInvoiceForm.tsx` are now **unused** (no error there anymore).
- `QuoteForm.tsx` at line 95 (`.from("customer").select("currencyCode, salesContactId, customerShipping!customerId(...)") `) 
  now triggers the deep type instantiation error that used to hit `SalesInvoiceForm.tsx`.

## Required Fixes

### 1. `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/usePurchaseInvoiceAutoFill.ts` line ~116
Remove the `// @ts-expect-error Supabase composite key issue` comment (it's now unused).
The Supabase call it was suppressing no longer errors in this context.

### 2. `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceForm.tsx` line ~109
Remove the `// @ts-expect-error TS2589: type instantiation depth - tsgo flakiness on composite relation` comment.

### 3. `apps/erp/app/modules/sales/ui/Quotes/QuoteForm.tsx` line ~95
Add `// @ts-expect-error TS2589: type instantiation depth on Supabase composite relation` 
immediately above the `.from("customer")` call at line 95.

## Acceptance Criteria
- `pnpm run typecheck` passes in `apps/erp` (exit code 0)
- No new lint errors introduced

## Work Location
Work in the `loop/1031` worktree. Since no worktree is currently checked out locally, you need to:

1. Create the worktree:
   ```bash
   cd /home/openclaw/carbon
   git fetch origin loop/1031
   git worktree add /home/openclaw/carbon-loop-1031 origin/loop/1031
   cd /home/openclaw/carbon-loop-1031
   git merge origin/main  # already done but ensure up to date
   ```

2. Make the three file edits above.

3. Run `cd apps/erp && pnpm run typecheck 2>&1 | tail -30` to verify.

4. Commit:
   ```bash
   git add apps/erp/app/modules/invoicing/ui/PurchaseInvoice/usePurchaseInvoiceAutoFill.ts
   git add apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoiceForm.tsx
   git add apps/erp/app/modules/sales/ui/Quotes/QuoteForm.tsx
   git commit -m "fix(typecheck): remove stale ts-expect-error directives; add suppression to QuoteForm composite relation (#1068)"
   git push origin loop/1031
   ```

5. Clean up the worktree:
   ```bash
   cd /home/openclaw/carbon
   git worktree remove /home/openclaw/carbon-loop-1031 --force
   ```

## Important Notes
- Only touch the 3 files listed. Do not change any functional code.
- After the push, CI will re-run automatically.
