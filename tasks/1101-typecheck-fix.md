# Task: Fix typecheck CI failure on PR #1101 (Claude MCP integration card)

## Context
PR #1101 (feat/claude-mcp-integration-v2) is open and passing everything except Typecheck CI.

The typecheck failure:
```
app/modules/purchasing/purchasing.service.ts(2365,10): error TS2589: Type instantiation is excessively deep and possibly infinite.
```

**Important:** `purchasing.service.ts` was NOT modified by this PR. The PR only touches:
- `packages/ee/src/types.ts` (added `linkOut?: boolean` field)
- `packages/ee/src/claude-mcp/config.tsx`
- `packages/ee/src/index.ts`
- `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx`

The error is at `purchasing.service.ts` line 2365, column 10 — which is the `return` statement of `getPurchasingRFQSuppliers` that calls `.select("*, supplier:supplierId(id, name)")`.

## Task

1. Navigate to the branch:
   ```bash
   cd /home/openclaw/carbon
   git stash
   git fetch origin feat/claude-mcp-integration-v2
   git checkout feat/claude-mcp-integration-v2
   git reset --hard origin/feat/claude-mcp-integration-v2
   ```

2. Look at `apps/erp/app/modules/purchasing/purchasing.service.ts` line ~2365. The error is TS2589 "Type instantiation is excessively deep" triggered by tsgo. 

3. Fix by adding a targeted suppression comment. The minimal fix is:
   ```typescript
   // eslint-disable-next-line @typescript-eslint/ban-ts-comment
   // @ts-expect-error TS2589 tsgo type-depth false positive
   return client
     .from("purchasingRfqSupplier")
     .select("*, supplier:supplierId(id, name)")
     .eq("purchasingRfqId", purchasingRfqId);
   ```
   
   If `@ts-expect-error` doesn't suppress it at the right location, try at the `.select()` call or use a type cast on the return value:
   ```typescript
   return client
     .from("purchasingRfqSupplier")
     .select("*, supplier:supplierId(id, name)")
     .eq("purchasingRfqId", purchasingRfqId) as any;
   ```

4. Run locally to verify: `cd /home/openclaw/carbon && pnpm --filter erp typecheck`

5. If that passes, commit:
   ```bash
   git add apps/erp/app/modules/purchasing/purchasing.service.ts
   git commit -m "fix: suppress TS2589 false positive in purchasing service (tsgo)"
   git push origin feat/claude-mcp-integration-v2
   ```

6. Done. Report what you did.

## Constraints
- Only touch purchasing.service.ts and only the minimal suppression
- Do NOT modify any other files
- Do NOT change the actual logic of purchasing.service.ts
