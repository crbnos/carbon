# Strict backflush — implementation plan

**Spec:** .ai/specs/2026-10-14-strict-backflush.md
**Research:** none (every decision came from the user in the design chat)
**Branch:** naveenkash/mxnb2

## Progress
- [x] Task 1: Write the migration (column + `backflush_job_materials` fork)
- [x] Task 2: Apply the migration and regenerate the types
- [x] Task 3: Add the pure rule module `@carbon/database/strict-backflush`
- [x] Task 4: Add the server-function helpers and enforce them in `issue`
- [x] Task 5: Gate method activation in `convert`
- [x] Task 6: Show the activation refusal in the ERP
- [x] Task 7: Refuse job release with a line that has no storage unit
- [x] Task 8: Add the settings card and its services
- [x] Task 9: Mark Pull From as required in the BoM editor
- [x] Task 10: MES dry run and refusal messages
- [x] Task 11: Docs, MCP digest, translations
- [x] Task 12: Final verification

## Dependencies
Task 2 needs Task 1. Tasks 3–10 need Task 2 (types). Tasks 4, 5 and 7 need Task 3. Task 10 needs Task 4. Task 6 needs Task 5. Tasks 8 and 9 are independent of each other. Task 12 is last.

No task commits. The user asks before each commit.

---

## Task 1: Write the migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_strict-backflush.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20261009010412_job-costing-always-post.sql`, lines 13 to the end of `backflush_job_materials`

**Steps:**
1. Run `pnpm db:migrate:new strict-backflush`.
2. Add the column:
   ```sql
   ALTER TABLE "companySettings"
     ADD COLUMN IF NOT EXISTS "requireBackflushStorageUnit" BOOLEAN NOT NULL DEFAULT false;
   ```
3. Copy `backflush_job_materials` from `20261009010412` without changes.
4. Declare `v_strict BOOLEAN;` and `v_item_tracking_type TEXT;`.
5. Before the loop, read `requireBackflushStorageUnit` from `companySettings` into `v_strict`. Use `COALESCE(…, false)`.
6. Add `LEFT JOIN "item" i ON i.id = jm."itemId"` to the loop query. Select `i."itemTrackingType"`.
7. If `v_strict` and the tracking type is not `Non-Inventory`, replace the whole storage unit step with the strict branch:
   - If `jm."storageUnitId"` is null, raise `'% has no Pull From storage unit on job %'`.
   - Sum the untracked on-hand of the item at that bin, location and company.
   - If the sum is less than the quantity to issue, raise `'Not enough % in %: need %, have %'`.
8. Keep the existing storage unit step unchanged in the `ELSE` branch.
9. Diff the new function body against the `20261009010412` body.

**Verify:**
```bash
diff <(awk '/FUNCTION public.backflush_job_materials/,/^\$function\$;/' packages/database/supabase/migrations/20261009010412_job-costing-always-post.sql) <(awk '/FUNCTION public.backflush_job_materials/,/^\$function\$;/' packages/database/supabase/migrations/*_strict-backflush.sql)
# Expected: only the declarations, the settings read, the join, and the strict branch differ
```

**Out of scope:** `complete_job_to_inventory`. Do not copy it.

## Task 2: Apply the migration and regenerate the types

**Depends on:** 1
**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -c "requireBackflushStorageUnit" packages/database/src/types.ts
# Expected: 3 or more (Row, Insert, Update)
```

If the local database is down, STOP and report. Do not hand-edit the types.

## Task 3: Add the pure rule module

**Depends on:** 2
**Files:**
- Create: `packages/database/src/strict-backflush.ts`
- Create: `packages/database/src/strict-backflush.test.ts`
- Modify: `packages/database/package.json` — add the export `"./strict-backflush": "./src/strict-backflush.ts"`
- Copy from (precedent): `packages/database/src/supersession-pick.ts` and its test

**Steps:**
1. Export `PULLED_ITEM_TYPES = ["Material", "Part", "Consumable"]`.
2. Export `needsPullFrom({ methodType, itemType, itemTrackingType })`. It returns true for a pulled, stocked line (spec decision 2).
3. Export `missingPullFromLocations(storageUnitIds, locationIds)`. It returns each location id with no non-empty storage unit.
4. Export `binShortfall({ onHand, alreadyDrawn, quantity })`. It returns the quantity the bin cannot cover, or 0.
5. Test each function. Include a null `itemTrackingType`, a `Make to Order` line, an empty-string bin, and stock drawn earlier in the same call.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/strict-backflush.test.ts
# Expected: all tests pass
```

## Task 4: Add the server-function helpers and enforce them in `issue`

**Depends on:** 3
**Files:**
- Create: `packages/server-functions/src/lib/strict-backflush.ts`
- Modify: `packages/server-functions/src/issue/index.ts` — `issueJobOperationMaterials`, the `partToOperation` planned-material branch, the `jobOperation` input and case

**Steps:**
1. In the new file, write `isStrictBackflush(trx, companyId)`. It reads `companySettings.requireBackflushStorageUnit`.
2. Write `assertBinCovers(trx, { companyId, itemId, locationId, storageUnitId, quantity, plannedRows })`.
3. If `storageUnitId` is null, throw `ServerFnError("<part> has no Pull From storage unit on this job", 409)`.
4. Otherwise sum the untracked on-hand at the bin. Subtract the planned rows for the same item and bin. Use `binShortfall`.
5. If there is a shortfall, throw `ServerFnError("Not enough <part> in <bin>: need <n>, have <m>", 409)`.
6. In `issueJobOperationMaterials`, read `isStrictBackflush` once.
7. If strict and the item is Inventory-tracked, give the remainder `material.storageUnitId`, then run `assertBinCovers` with `itemLedgerInserts`.
8. In that strict branch, skip the pick-method lookup, the fullest-bin lookup and the short-bin switch.
9. In `partToOperation` with a `materialId`, apply the same strict branch to a consuming issue only.
10. Add `dryRun: z.boolean().optional()` to the `jobOperation` input.
11. In the `jobOperation` case, if `dryRun` and not strict, return at once.
12. If `dryRun` and strict, run the issue and throw a private rollback sentinel at the end of the transaction. Catch only that sentinel.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 errors
pnpm --filter @carbon/server-functions test
# Expected: same pass/fail count as before the change
```

**Out of scope:** the unplanned-part branch, `maintenanceDispatchInventory`, batch and serial issue.

## Task 5: Gate method activation in `convert`

**Depends on:** 3
**Files:**
- Modify: `packages/server-functions/src/convert/index.ts` — `methodVersionToActive`

**Steps:**
1. Before the transaction, read `isStrictBackflush(db, companyId)`.
2. If strict, load the version's `methodMaterial` rows with `item.itemTrackingType` and `item.readableIdWithRevision`.
3. Load the location ids and names that have an active work center for the company.
4. Filter the lines with `needsPullFrom`. Then find their gaps with `missingPullFromLocations`.
5. If any gap exists, throw `InvalidInputError`. The message lists each part once, separated by "; ".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: 0 errors
```

## Task 6: Show the activation refusal in the ERP

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/routes/x+/items+/methods+/versions.activate.$id.tsx` — return `update.error.message` when it is not empty
- Modify: `apps/erp/app/modules/items/items.server.ts` — `applyChangeNotice` returns `activated.error.message` when it is not empty

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

## Task 7: Refuse job release with a line that has no storage unit

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `JobReleaseReadiness`, `getJobReleaseReadiness`
- Modify: `apps/erp/app/modules/production/ui/Jobs/job-release-logic.ts` — `jobReleaseProblems`
- Modify: `apps/erp/app/routes/x+/job+/$jobId.status.tsx` — the Release dialog branch
- Modify: `apps/erp/test/job-release-logic.test.ts`, `apps/erp/test/job-release-readiness.test.ts`

**Steps:**
1. Add `materialsWithoutStorageUnit: { id: string; description: string }[]` to each readiness job.
2. In `getJobReleaseReadiness`, read the setting. If it is off, return empty lists.
3. If it is on, load the jobs' `jobMaterial` rows with `item.itemTrackingType`. Keep the `needsPullFrom` lines with no `storageUnitId`.
4. In `jobReleaseProblems`, add `set a Pull From storage unit on <parts>`.
5. In `$jobId.status.tsx`, refuse with that text when the list is not empty.
6. Update both tests for the new field. Add one test for the new problem text.

**Verify:**
```bash
pnpm --filter erp exec vitest run test/job-release-logic.test.ts test/job-release-readiness.test.ts
# Expected: all tests pass
```

## Task 8: Add the settings card and its services

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — `updateRequireBackflushStorageUnitSetting(client, companyId, enabled)` and `getActiveMethodsMissingPullFrom(db, companyId)`
- Modify: `apps/erp/app/routes/x+/settings+/items.tsx` — intent `requireBackflushStorageUnit`, loader count, the card
- Copy from (precedent): the "BoM Explorer" card and `updateBomExplorerReadableIdSetting` in the same files

**Steps:**
1. `getActiveMethodsMissingPullFrom` uses Kysely. It loads Active make methods with their lines and the work-center locations. It returns `{ count, methods }`, with at most 10 methods.
2. The loader calls it only when the setting is on.
3. Add the card under "Bill of Materials". Copy the BoM Explorer card layout.
4. When the count is above 0, list the parts with links to `path.to.partMake(itemId, makeMethodId)`.

If an Active method's parent item is not a Part, link to the item's own make route. If no such route exists, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

## Task 9: Mark Pull From as required in the BoM editor

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx`
- Copy from (precedent): `useCompanySettings` in `apps/erp/app/hooks/useCompanySettings.tsx`

**Steps:**
1. Read `requireBackflushStorageUnit` with `useCompanySettings()`.
2. If strict, pass `isOptional={false}` to the Storage Unit field of a pulled line.
3. If strict and the line has no bin for the location, show the badge "No storage unit".

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 0 errors
```

## Task 10: MES dry run and refusal messages

**Depends on:** 4
**Files:**
- Modify: `apps/mes/app/routes/x+/complete.tsx`, `apps/mes/app/routes/x+/end.$operationId.tsx`, `apps/mes/app/services/quality.server.ts` — dry run before `insertProductionQuantity`
- Modify: the same files plus `apps/mes/app/routes/x+/scrap.tsx` and `apps/mes/app/routes/x+/issue.tsx` — show `error.message || <old fallback>`

**Steps:**
1. Before each untracked `insertProductionQuantity`, invoke `issue` with `type: "jobOperation"`, the same id and quantity, and `dryRun: true`.
2. If the dry run fails, return the old error response with the server's message. Record nothing.
3. In each `issue` error toast, use the server's message, with the old text as the fallback.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: 0 errors
```

## Task 11: Docs, MCP digest, translations

**Depends on:** 4–10
**Steps:**
1. Add a "Strict backflush" section to `.claude/rules/inventory-system.md`. Name the setting, the three gates, and the files.
2. Run `pnpm run generate:mcp`.
3. Run `pnpm run lingui:extract`.
4. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
git status --short
# Expected: the digest, the .po catalogs and the rule file changed; no unrelated files
```

## Task 12: Final verification

**Depends on:** all
**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/server-functions --filter=erp --filter=mes
# Expected: 0 errors
pnpm --filter @carbon/database test && pnpm --filter @carbon/server-functions test
# Expected: no new failures
pnpm exec biome check <changed files>
# Expected: no errors
```
