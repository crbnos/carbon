---
task: fix typecheck failure on PR #1090 (Avalara foundation)
branch: loop/1061
pr: https://github.com/crbnos/carbon/pull/1090
---

# Fix: Stale @ts-expect-error on loop/1061 → PR #1090

## Problem

CI typecheck is failing on branch `loop/1061` (PR #1090 — Avalara integration foundation) with:

```
app/modules/invoicing/ui/PurchaseInvoice/usePurchaseInvoiceAutoFill.ts(116,9): error TS2578: Unused '@ts-expect-error' directive.
```

The branch added a `@ts-expect-error TS2589: type instantiation depth - tsgo flakiness on composite relation` comment at line ~116 in `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/usePurchaseInvoiceAutoFill.ts`. However, in the meantime `main` was updated and that line was removed — the type issue was resolved upstream, leaving the `@ts-expect-error` directive stale.

## Steps

1. **Check out the branch:**
   ```bash
   cd /home/openclaw/carbon
   git fetch origin loop/1061
   git worktree add /tmp/wt-1090 origin/loop/1061
   cd /tmp/wt-1090
   ```

2. **Merge origin/main:**
   ```bash
   git fetch origin main
   git merge origin/main --no-edit
   ```
   Resolve any conflicts. After the merge, `usePurchaseInvoiceAutoFill.ts` line ~116 should already have the `@ts-expect-error` removed (it was removed on main). If the merge removes it, great. If there's a conflict, accept main's version for that file.

3. **Verify fix:**
   ```bash
   pnpm --filter erp typecheck 2>&1 | tail -20
   ```
   Should pass. Also run:
   ```bash
   pnpm run lint 2>&1 | tail -10
   ```

4. **If the @ts-expect-error is still present after merge**, manually remove it:
   - Open `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/usePurchaseInvoiceAutoFill.ts`
   - Remove the line: `// @ts-expect-error TS2589: type instantiation depth - tsgo flakiness on composite relation`
   - Run typecheck again to confirm it passes.

5. **Push the fix:**
   ```bash
   git push origin loop/1061
   ```

6. **Clean up:**
   ```bash
   cd /home/openclaw/carbon
   git worktree remove /tmp/wt-1090 --force
   ```

## Expected outcome

PR #1090 CI typecheck passes. No other changes needed — the Avalara code itself is correct.

## Notes

- Do NOT touch any Avalara code unless there's another typecheck error revealed after the merge.
- This is a housekeeping fix only — the PR logic was previously reviewed and accepted.
- Use `pnpm`, never `npm`.
- Do not merge the PR. Just push the fix to the branch.
