# Inventory count for tracked units — implementation plan

**Spec:** .ai/specs/2026-10-30-inventory-count-tracked-units.md
**Research:** .ai/research/inventory-count-tracked-items.md
**Closest sibling:** the inventory count itself; the grouped table copies Inventory → Receiving (`ui/Receiving/ReceivingTable.tsx`)
**Branch:** `feat/inventory-count-tracked-units`, cut from `main`

## Progress

- [x] Task 0: Create the branch
- [x] Task 1: Write the migration
- [x] Task 2: Apply the migration and regenerate types
- [x] Task 3: Add the validators
- [x] Task 4: Add the unit state helper
- [x] Task 5: Plan moves in `planInventoryCountPost` (test first)
- [x] Task 6: Read groups and group lines
- [x] Task 7: Show the grouped, collapsible table
- [x] Task 8: Resolve a code and record a scan
- [x] Task 9: Post moves, Unexpected units and new units
- [x] Task 10: Add the scan bar and Add unit
- [x] Task 11: Count unnumbered units and assign serial numbers
- [x] Task 12: Export and import count results as CSV
- [x] Task 13: Update docs and regenerate the MCP manifest
- [ ] Task 14: Run the full gate
- [ ] Task 15: Verify in the browser

## Dependencies

- Task 1 needs Task 0. Task 2 needs Task 1.
- Tasks 3, 4 and 5 need Task 2. They are independent of each other.
- Task 6 needs Tasks 2 and 4. Task 7 needs Task 6.
- Task 8 needs Task 3. Task 9 needs Tasks 5 and 8.
- Task 10 needs Tasks 7 and 8.
- Task 11 needs Tasks 7 and 9.
- Task 12 needs Tasks 8 and 7.
- Tasks 13, 14 and 15 run last, in order.

## Rules for every task

- Work only in the inventory module, its routes, and the files each task names.
- Start every new source file with its SPDX header. Run `pnpm --filter @carbon/checks license-headers` after you create files.
- Never use JavaScript `Date` for business dates. Use `datetime.timestamp()` from `@carbon/utils` for `countedAt` and `updatedAt`.
- Every Kysely write scopes by `companyId`.
- Never query inside a loop. Collect the ids and make one `.in()` / `where in` read.
- Wrap every new UI string in Lingui (`useLingui().t` or `<Trans>`).
- 🛑 Never rebuild the database. If `pnpm db:migrate` fails, STOP and report.

---

## Task 0: Create the branch

**Depends on:** none
**Files:** none

**Steps:**
1. Run `git fetch origin main`.
2. Run `git switch -c feat/inventory-count-tracked-units origin/main`.
3. Copy the spec, the research file and this plan onto the branch if they are not on `main`.

**Verify:**
```bash
git branch --show-current
# Expected: feat/inventory-count-tracked-units
```

**Out of scope:** the branch `feat/ui-text-size`. Do not commit there.

## Task 1: Write the migration

**Depends on:** 0
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_inventory-count-tracked-units.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260716153000_inventory-count-lines-view.sql`

**Steps:**
1. Run `pnpm db:migrate:new inventory-count-tracked-units`.
2. Add the 2 columns:
   ```sql
   ALTER TABLE "inventoryCountLine"
     ADD COLUMN IF NOT EXISTS "foundDuringCount" BOOLEAN NOT NULL DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS "assignedReadableId" TEXT;
   ```
3. Add the indexes:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS "inventoryCountLine_unit_key"
     ON "inventoryCountLine" ("inventoryCountId", "storageUnitId", "trackedEntityId")
     NULLS NOT DISTINCT
     WHERE "trackedEntityId" IS NOT NULL;

   CREATE UNIQUE INDEX IF NOT EXISTS "inventoryCountLine_newUnit_key"
     ON "inventoryCountLine" ("inventoryCountId", "itemId", "readableId")
     WHERE "trackedEntityId" IS NULL AND "readableId" IS NOT NULL;

   CREATE INDEX IF NOT EXISTS "inventoryCountLine_group_idx"
     ON "inventoryCountLine" ("inventoryCountId", "itemId", "storageUnitId");
   ```
4. Recreate `inventoryCountLines`. Copy the whole `CREATE OR REPLACE VIEW` from the precedent file without changes. Postgres expands `icl.*` at create time, so the view needs this to show the new columns. Add `te."readableId" IS NULL AND icl."trackedEntityId" IS NOT NULL AS "isUnnumbered"` as the last column, with a `LEFT JOIN "trackedEntity" te ON te."id" = icl."trackedEntityId" AND te."companyId" = icl."companyId"`.
5. Create `inventoryCountGroups` with `SECURITY_INVOKER = true`. Use the SQL in the spec's Data Model section. Add the same item, material and storage-unit columns as `inventoryCountLines`. Add `i."itemTrackingType"`, and a stable group key: `icl."inventoryCountId" || ':' || icl."itemId" || ':' || COALESCE(icl."storageUnitId", '') AS "id"`. Add `string_agg(COALESCE(icl."assignedReadableId", icl."readableId"), ' ') AS "unitNumbers"` so a search can match a unit's number. Group by every non-aggregate column.
6. Add a comment at the top of the file that says what the 2 columns mean.

If the unique index fails on existing rows, STOP and report the duplicate rows. Do not delete rows.

**Verify:**
```bash
grep -c "inventoryCountGroups\|foundDuringCount\|NULLS NOT DISTINCT" packages/database/supabase/migrations/*_inventory-count-tracked-units.sql
# Expected: a number of 3 or more
```

**Out of scope:** RLS policies on `inventoryCountLine` (they stay as they are). Any other table.

## Task 2: Apply the migration and regenerate types

**Depends on:** 1
**Files:**
- Modify: generated types (written by the command, never by hand)

**Steps:**
1. Run `pnpm db:migrate`.
2. Run `pnpm run generate:types`.

**Verify:**
```bash
grep -c "inventoryCountGroups\|assignedReadableId" packages/database/src/types.ts
# Expected: a number of 2 or more
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: Tasks successful
```

**Out of scope:** editing `packages/database/src/types.ts` by hand.

## Task 3: Add the validators

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.models.ts` — add 4 validators after `inventoryCountLineValidator`
- Modify: `apps/erp/app/modules/inventory/inventory.models.test.ts` — add tests
- Copy from (precedent): `inventoryCountLineValidator` in the same file

**Steps:**
1. Add `inventoryCountScanValidator`: `storageUnitId: zfd.text(z.string().optional())`, `code: z.string().trim().min(1)`, `itemId: zfd.text(z.string().optional())`, `quantity: zfd.numeric(z.number().min(0).optional())`.
2. Add `inventoryCountUnitValidator`: the same fields, with `code` labelled "Serial / Batch" and `itemId` required.
3. Add `inventoryCountUnnumberedValidator`: `itemId: z.string().min(1)`, `storageUnitId: zfd.text(z.string().optional())`, `quantity: zfd.numeric(z.number().int().min(0))`.
4. Add `inventoryCountSerialValidator`: `lineId: z.string().min(1)`, `readableId: z.string().trim().min(1)`.
5. Write one test per validator: a valid input passes, an empty `code` or a negative `quantity` fails.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/inventory/inventory.models.test.ts
# Expected: all tests pass
```

**Out of scope:** changing `inventoryCountLineValidator`.

## Task 4: Add the unit state helper

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.utils.ts`
- Modify: `apps/erp/app/modules/inventory/inventory.utils.test.ts`

**Steps:**
1. Export `type InventoryCountLineState = "Not counted" | "Found" | "Missing" | "Unexpected"`.
2. Export `inventoryCountLineState(line: { countedQuantity: number | null; foundDuringCount: boolean })`.
3. Return "Unexpected" when `foundDuringCount` is true.
4. Return "Not counted" when `countedQuantity` is null.
5. Return "Missing" when `countedQuantity` is 0. Else return "Found".
6. Test each of the 4 states.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/inventory/inventory.utils.test.ts
# Expected: all tests pass
```

**Out of scope:** storing the state in a column.

## Task 5: Plan moves in `planInventoryCountPost` (test first)

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `PlannableLine`, `planInventoryCountPost`
- Modify: `apps/erp/app/modules/inventory/inventory.plan-post.test.ts`

**Steps:**
1. Write the failing tests first. Run them and confirm they fail.
2. Widen `PlannableLine` with `trackedEntityId: string | null`, `storageUnitId: string | null` and `foundDuringCount: boolean`.
3. Keep `planned` as it is today: one `{ line, delta }` per line.
4. Add `moves: { trackedEntityId: string; fromStorageUnitId: string | null; toStorageUnitId: string | null; quantity: number }[]` to the result.
5. For each `trackedEntityId`, match the negative deltas against the positive deltas, largest first. Each match is one move.
6. Reduce each matched line's `delta` by the moved quantity. A fully matched line ends with `delta` 0.
7. Round every quantity with `round` from `@carbon/utils`.
8. Return the lines with no entity (untracked lines and new units) unchanged.

Tests to write:

| Test | Lines | Expected |
|---|---|---|
| Serial moved inside the count | unit U: A1 system 1 counted 0; B2 added counted 1 | 1 move A1→B2 qty 1; both deltas 0 |
| Batch partly moved | lot L: A1 system 10 counted 6; B2 added counted 4 | 1 move A1→B2 qty 4; deltas 0 and 0 |
| Batch moved and short | lot L: A1 system 10 counted 5; B2 added counted 3 | 1 move qty 3; A1 delta −2; B2 delta 0 |
| No pair | unit U: A1 system 1 counted 0 | no move; delta −1 |
| Untracked line | item I: A1 system 5 counted 7 | no move; delta 2 |

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/inventory/inventory.plan-post.test.ts
# Expected: all tests pass, the old test too
```

**Out of scope:** the move from a bin outside the count. Task 9 adds it, because it needs a database read.

## Task 6: Read groups and group lines

**Depends on:** 2, 4
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — add `INVENTORY_COUNT_GROUPS_PAGING`, `getInventoryCountGroups`, `getInventoryCountGroupLines`
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` — add 2 operations
- Copy from (precedent): `getInventoryCountLines` and `INVENTORY_COUNT_LINES_PAGING` (service, line 2399), `getInventoryCountLines` (server, line 5512)

**Steps:**
1. Add `INVENTORY_COUNT_GROUPS_PAGING` with sorts `itemReadableIdWithRevision`, then `storageUnitId`, then `id`.
2. Add `getInventoryCountGroups(client, inventoryCountId, companyId, args)`. Copy `getInventoryCountLines` and read `inventoryCountGroups`.
3. Search with `searchFilter(["itemName", "itemReadableIdWithRevision", "unitNumbers"], args.search)`. A search for a serial number then finds its group.
4. Add `getInventoryCountGroupLines(client, { inventoryCountId, itemId, storageUnitId, companyId, blind })`. Read `inventoryCountLines` for the group. Filter `storageUnitId` with `.is(null)` when it is null.
5. If `blind` is true, return only lines with `countedQuantity` not null.
6. Add operation `getInventoryCountGroups` (`view: inventory`, `@mcp read`). Copy the `getInventoryCountLines` operation.
7. Add operation `getInventoryCountGroupLines` (`view: inventory`, `@mcp read`). Read the count header and pass `blind = isBlind && status !== "Posted"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: Tasks successful
```

**Out of scope:** removing `getInventoryCountLines`. The MCP tool `inventory_getInventoryCountLines` stays.

## Task 7: Show the grouped, collapsible table

**Depends on:** 6
**Files:**
- Create: `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountGroups.tsx`
- Create: `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountGroupUnits.tsx`
- Create: `apps/erp/app/routes/api+/inventory-count.$id.group.ts`
- Modify: `apps/erp/app/modules/inventory/ui/InventoryCount/index.ts` — export the 2 components
- Modify: `apps/erp/app/routes/x+/inventory-count+/$id.tsx` — read groups, render `InventoryCountGroups`
- Modify: `apps/erp/app/utils/path.ts` — add `path.to.api.inventoryCountGroup(id)`
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/Receiving/ReceivingTable.tsx` (`renderExpandedRow`, `expandRowsFor`), `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountLines.tsx` (columns, filters, blind handling, inline edit), `apps/erp/app/routes/api+/items.$itemId.serial-costs.ts` (cached loader)

**Steps:**
1. Copy `InventoryCountLines.tsx` to `InventoryCountGroups.tsx`. Keep its props, filters, quick filters and blind rules.
2. Change the row type to the `inventoryCountGroups` row.
3. Replace the Batch / Serial column with a Units column: "Found N · Missing N · Unexpected N". Hide Missing while blind.
4. Rename System Qty to Expected (`expectedQuantity`). Keep Counted and Variance.
5. Pass `renderExpandedRow` and `canExpandRow={(row) => row.itemTrackingType === "Serial" || row.itemTrackingType === "Batch"}`.
6. Pass `expandRowsFor={search || null}`. Rows start collapsed.
7. Keep the Counted cell editable only for untracked rows. Its edit calls `path.to.inventoryCountLineUpdate` with the group's one line id.
8. In the route loader, call `getInventoryCountGroups` in place of `getInventoryCountLines`. Use `INVENTORY_COUNT_GROUPS_PAGING` in `toPage`. Keep the blind filter and sort drops; also drop `expectedQuantity`.
9. Create `api+/inventory-count.$id.group.ts`. Its loader reads `itemId` and `storageUnitId` from the search params and calls `api.inventory.getInventoryCountGroupLines`. Export `clientLoader = cachedClientLoader<typeof loader>()`.
10. In `InventoryCountGroupUnits.tsx`, read the lines with `useLoaderQuery(path.to.api.inventoryCountGroup(...))`. Show one row per line: number (or "No serial number"), Expected, Counted, and a state badge from `inventoryCountLineState`.
11. Color the badges with the `--status-*` tokens: Found green, Missing red, Unexpected blue, Not counted gray.
12. On a Draft count, a batch line's Counted is editable through `path.to.inventoryCountLineUpdate`.
13. Keep `InventoryCountLines.tsx` until Task 12 moves its CSV export. Then delete it.

If `Table` cannot page a view whose `id` is a text key, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: Tasks successful
pnpm exec biome check apps/erp/app/modules/inventory/ui/InventoryCount
# Expected: no errors
```

**Out of scope:** the scan bar (Task 10). The unnumbered line (Task 11).

## Task 8: Resolve a code and record a scan

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — add `resolveInventoryCountCode`, `recordInventoryCountUnit`
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` — add `recordInventoryCountScan`, `addInventoryCountUnit`, `removeInventoryCountUnit`
- Create: `apps/erp/test/database/inventory-count-scan.test.ts`
- Copy from (precedent): `updateInventoryCountLine` (service line 2654: the Draft guard), `apps/erp/test/database/always-post-inventory-documents.test.ts` (fixture setup)

**Steps:**
1. Add `resolveInventoryCountCode(db, { companyId, locationId, code, itemId? })`. It returns one of:
   - `{ kind: "entity", trackedEntityId, itemId, itemTrackingType, status }`
   - `{ kind: "item", itemId, itemTrackingType }`
   - `{ kind: "ambiguous", itemIds }`
   - `{ kind: "unknown" }`
2. Read `trackedEntity` by `readableId = code` and `companyId`. If `itemId` is set, filter by it.
3. If no entity matches, read `item` by `readableId = code`.
4. Add `recordInventoryCountUnit(db, { inventoryCountId, companyId, userId, storageUnitId, resolved, code, quantity })`. Run it in `withTransaction`.
5. Lock the count header `FOR UPDATE`. Return `null` if the status is not Draft.
6. If the entity has a line in this bin, the item is Serial and the line has `countedQuantity` 1, return `{ outcome: "alreadyCounted" }`.
7. If the entity has a line in this bin otherwise, set `countedQuantity`: 1 for Serial, `quantity` for Batch.
8. For an entity with no line in this bin: insert a line with `foundDuringCount` true, `systemQuantity` 0, the entity's `readableId`, and the counted quantity.
9. For `unknown` with an `itemId`: insert a line with `trackedEntityId` null, `readableId = code`, `foundDuringCount` true.
10. For an untracked `item`: set `countedQuantity` on the group's one line. If none exists, insert one with `foundDuringCount` true.
11. Stamp `countedBy`, `countedAt`, `updatedBy`, `updatedAt` on every write.
12. Add the operations, `permission: { update: "inventory" }`, `@mcp`:
    - `recordInventoryCountScan`: resolve, then record. Return `ctx.error("rule", …)` for `ambiguous` (with the item ids) and for `unknown` with no `itemId`.
    - `addInventoryCountUnit`: the same body. Requires `itemId`.
    - `removeInventoryCountUnit({ lineId })`: delete the line only when `foundDuringCount` is true and the count is Draft.
13. Return `ctx.error("conflict", "Counts can only be edited while the document is Draft")` when the record step returns `null`.
14. Write the database test. Seed a count with 2 serial units in bin A1 and 1 in bin B2. Assert each row of the scan table in the spec.

**Verify:**
```bash
pnpm --filter erp exec vitest run test/database/inventory-count-scan.test.ts
# Expected: all tests pass (or skipped with no local database: then STOP and report)
```

**Out of scope:** posting. Task 9.

## Task 9: Post moves, Unexpected units and new units

**Depends on:** 5, 8
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — `postInventoryCount` (line 6794)
- Create: `apps/erp/test/database/inventory-count-post-tracked.test.ts`
- Copy from (precedent): `postInventoryAdjustment` (line 18520: the `isStorageUnitTransfer` branch near line 18815, and the new entity insert near line 19494), `getTrackedEntityBins` (`shared.service.ts`, line 17165)

**Steps:**
1. Read `foundDuringCount`, `trackedEntityId`, `storageUnitId` and `readableId` with each counted line. Pass them to `planInventoryCountPost`.
2. Before the transaction, read the status of every tracked entity on an Unexpected line in one query.
3. Refuse with `InvalidLinesError` when an Unexpected line names a `Rejected` or `Scrapped` entity.
4. Refuse when 2 lines of one serial both have `countedQuantity` 1.
5. For each Unexpected serial line with no move from the planner, call `getTrackedEntityBins` once for all of them.
6. If the unit's bin is at this location, add a move from that bin. If its stock is at another location, refuse.
7. Inside the transaction, for each move, lock the entity `FOR UPDATE`.
8. Insert 2 `itemLedger` rows per move: `entryType` `Transfer`, `documentType` `Inventory Count`, `documentId` the count id, −qty at the source bin and +qty at the target bin. Post no journal and no cost layer.
9. For an Unexpected `Consumed` serial, book the line's positive delta with `bookAdjustment`. Set the entity to `Available`.
10. For a line with no `trackedEntityId` and a `readableId`, insert a `trackedEntity` as `postInventoryAdjustment` does: `readableId`, `itemId`, `quantity`, `status` `Available`, attribute `"Inventory Count": { userId, at, countId }`. Then book the positive delta against it.
11. Keep every other line on its current path.
12. Write the database test. One case per row of the spec's "Rules for an Unexpected line" table, plus a moved batch. Assert the ledger rows, the entity bin and status, and that a move writes no `journalLine`.

**Verify:**
```bash
pnpm --filter erp exec vitest run test/database/inventory-count-post-tracked.test.ts test/database/always-post-inventory-documents.test.ts
# Expected: all tests pass
```

**Out of scope:** `assignedReadableId` (Task 11). Moves between locations.

## Task 10: Add the scan bar and Add unit

**Depends on:** 7, 8
**Files:**
- Create: `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountScanBar.tsx`
- Create: `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountUnitForm.tsx`
- Create: `apps/erp/app/routes/x+/inventory-count+/$id.scan.tsx`
- Create: `apps/erp/app/routes/x+/inventory-count+/$id.units.new.tsx`
- Create: `apps/erp/app/routes/x+/inventory-count+/$id.units.$lineId.delete.tsx`
- Modify: `apps/erp/app/utils/path.ts` — 3 paths
- Modify: `InventoryCountGroups.tsx`, `InventoryCountGroupUnits.tsx`, `$id.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/stock-transfer+/$id.scan.$lineId.tsx` (scan route), `apps/erp/app/modules/inventory/ui/Kanbans/KanbanForm.tsx` (`ValidatedForm` in a modal with `StorageUnit` and `Item`)

**Steps:**
1. Write each route action as `validator(...).request(args, { params: ["id"] })`, then one `carbon(request)` call, then `return result`.
2. Build the scan bar with `ValidatedForm` and `useAction`. It holds `StorageUnit` (location of the count) and an `Input` named `code`.
3. Keep focus in `code` after each submit. Clear it on success.
4. On `alreadyCounted`, show a toast "Already counted".
5. On an `ambiguous` or `unknown` refusal, open `InventoryCountUnitForm` with the code filled in and an `Item` picker.
6. For a Batch item, ask for the quantity in the same modal.
7. On success, set `expandRowsFor` on the table to the scanned group's id. Highlight the scanned line.
8. Show the scan bar only on a Draft count.
9. Add an "Add unit" button and a Remove action (Unexpected lines only) to the expanded row.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: Tasks successful
pnpm --filter @carbon/checks test
# Expected: all tests pass. A failing conformance test names the file; fix each finding in the new routes (route-action-shape, no-unguarded-submit)
```

**Out of scope:** MES. A camera scanner.

## Task 11: Count unnumbered units and assign serial numbers

**Depends on:** 7, 9
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — add `setInventoryCountUnnumberedQuantity`, `assignInventoryCountSerial`; extend `postInventoryCount`
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` — 2 operations
- Create: `apps/erp/app/routes/x+/inventory-count+/$id.unnumbered.tsx`
- Create: `apps/erp/app/routes/x+/inventory-count+/$id.serial.tsx`
- Modify: `InventoryCountGroupUnits.tsx`
- Modify: `apps/erp/test/database/inventory-count-post-tracked.test.ts`

**Steps:**
1. `setInventoryCountUnnumberedQuantity`: read the group's unnumbered snapshot lines, joined to `trackedEntity`, ordered by `trackedEntity.createdAt`, then `id`.
2. Refuse when `quantity` is above the number of lines. The message is "Scan or type a serial number for each extra unit."
3. Set `countedQuantity` 1 on the first `quantity` lines and 0 on the rest, in one `UPDATE … FROM (VALUES …)` statement.
4. `assignInventoryCountSerial`: refuse unless the line is Found and its unit has no `readableId`.
5. Refuse a number that a `trackedEntity` of the same item holds, or that another line of this count holds as `readableId` or `assignedReadableId`.
6. Set `assignedReadableId`.
7. In `postInventoryCount`, after the moves and adjustments, write each `assignedReadableId` to `trackedEntity.readableId`. Check the duplicate rule again under `FOR UPDATE`.
8. In `InventoryCountGroupUnits.tsx`, show the unnumbered snapshot lines as one "No serial number" row with an editable quantity (Draft only).
9. Under it, show one serial input per Found unnumbered unit.
10. Add database tests: 5 unnumbered, count 3, post, the 2 newest are `Consumed`; the function refuses 6; the post writes an assigned number to the unit.

**Verify:**
```bash
pnpm --filter erp exec vitest run test/database/inventory-count-post-tracked.test.ts
# Expected: all tests pass
```

**Out of scope:** requiring a serial number on `inventoryAdjustmentValidator`. That is a separate change.

## Task 12: Export and import count results as CSV

**Depends on:** 7, 8
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.utils.ts` — add `INVENTORY_COUNT_CSV_COLUMNS`, `parseInventoryCountCsv`
- Modify: `apps/erp/app/modules/inventory/inventory.utils.test.ts`
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — add `importInventoryCountRows`
- Modify: `apps/erp/app/modules/inventory/inventory.server.ts` — add `importInventoryCountResults`
- Create: `apps/erp/app/routes/x+/inventory-count+/$id.import.tsx`
- Create: `apps/erp/app/routes/api+/inventory-count.$id[.]csv.tsx`
- Create: `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountImportErrors.tsx`
- Delete: `apps/erp/app/modules/inventory/ui/InventoryCount/InventoryCountLines.tsx`
- Copy from (precedent): `apps/erp/app/modules/accounting/account-import-csv.ts` (`parseChartCsv`), `apps/erp/app/routes/x+/accounting+/chart-import.tsx` (file upload), `apps/erp/app/routes/api+/accounting.chart-of-accounts[.]csv.tsx` (CSV download), `ui/ChartOfAccounts/AccountImportCsvErrors.tsx`

**Steps:**
1. Set `INVENTORY_COUNT_CSV_COLUMNS` to `["Item", "Storage Unit", "Serial / Batch", "Counted Quantity"]`.
2. `parseInventoryCountCsv(text)` uses `parseCsv` from `@carbon/files/csv`. It returns `{ rows, errors }`. Each error has a line number and a message.
3. Refuse a missing column, a negative or non-numeric quantity, and a serial row with a quantity other than 0 or 1.
4. Test the parser: a good file, a missing column, a bad quantity.
5. `importInventoryCountRows(db, { inventoryCountId, companyId, userId, rows })`: resolve every row with `resolveInventoryCountCode`, after one read of the items by `readableId` and the storage units by name.
6. Collect every row that does not resolve as an error. If there is 1 error or more, write nothing and return the errors.
7. Else, in one transaction, record each row with `recordInventoryCountUnit`.
8. For each group the file names, set `countedQuantity` 0 on every snapshot line the file did not list.
9. Operation `importInventoryCountResults({ inventoryCountId, rows })`, `update: inventory`, `@mcp`. API callers send rows as JSON.
10. The route reads the uploaded file, parses it, returns parser errors, then calls the operation.
11. The CSV download route writes one row per line with the 4 columns plus `State`, from `inventoryCountLines`. While the count is blind, leave out Not counted and Missing lines.
12. Point the table's download button at this route. Then delete `InventoryCountLines.tsx` and its export in `index.ts`.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/inventory/inventory.utils.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: Tasks successful
```

**Out of scope:** `ImportCSVModal` and `/x/shared/import`. Column mapping.

## Task 13: Update docs and regenerate the MCP manifest

**Depends on:** 9, 10, 11, 12
**Files:**
- Modify: `apps/erp/app/modules/inventory/AGENTS.md` — the Inventory Count concept, the operations table, `generateInventoryCountLines`
- Modify: `.claude/rules/inventory-system.md` — one paragraph on count moves
- Modify: generated MCP files (written by the command)
- Modify: `packages/locale/locales/*/erp.po` (written by the command)

**Steps:**
1. Describe group rows, unit states, the post's moves and the CSV columns in the module `AGENTS.md`.
2. Add the 8 new operations to the operations table.
3. Run `pnpm run generate:mcp`.
4. Run `pnpm run lingui:extract`.

**Verify:**
```bash
git diff --stat apps/erp/app/routes/api+/mcp+/lib/
# Expected: tool-manifest.digest.json and tool-metadata.json changed
```

**Out of scope:** the product docs site. A changelog entry (write it only when the user asks).

## Task 14: Run the full gate

**Depends on:** 13
**Files:** none

**Steps:**
1. Run each command below. Fix each failure in the file that caused it.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/inventory apps/erp/app/routes/x+/inventory-count+ apps/erp/app/routes/api+
# Expected: no errors
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: Tasks successful
pnpm --filter erp exec vitest run app/modules/inventory test/database/inventory-count-scan.test.ts test/database/inventory-count-post-tracked.test.ts test/database/always-post-inventory-documents.test.ts
# Expected: all tests pass
pnpm --filter @carbon/checks license-headers --check
# Expected: no files listed
pnpm --filter @carbon/checks test
# Expected: all tests pass
pnpm db:check:datasets
# Expected: every dataset passes
pnpm db:check:backups
# Expected: backups restore
```

**Out of scope:** whole-repo typecheck.

## Task 15: Verify in the browser

**Depends on:** 14
**Files:** none

**Steps:**
1. Run `/auth`, then `/test` with the spec's Acceptance Criteria as the test plan.
2. Use a serial item with 9 units in one bin, a batch item in 2 bins, and an untracked item.
3. Record each criterion as pass or fail with a screenshot in `.ai/runs/2026-10-30-inventory-count-tracked-units.md`.

**Verify:**
```bash
grep -c "PASS" .ai/runs/2026-10-30-inventory-count-tracked-units.md
# Expected: 16 (one per acceptance criterion)
```

**Out of scope:** fixing a failure in this task. Report it, then fix it in the task that owns the file.
