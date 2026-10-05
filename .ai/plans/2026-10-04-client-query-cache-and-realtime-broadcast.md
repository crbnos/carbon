# Client query cache and realtime broadcast — implementation plan

**Spec:** .ai/specs/2026-10-04-client-query-cache-and-realtime-broadcast.md
**Research:** .ai/research/2026-10-01-client-cache-on-react-router.md
**Branch:** claude/tanstack-query-caching-realtime-54567c

## Progress
- [x] Task 1: Install dependencies and prove broadcast on the local stack
- [x] Task 2: Add the realtime table lists
- [x] Task 3: Add the three broadcast functions and the `realtime.messages` policies (authz manifest)
- [x] Task 4: Write the attach migration
- [x] Task 5: Apply the migrations and regenerate types
- [x] Task 6: Add the database tests
- [x] Task 6b: Move event triggers and interceptor bodies out of migrations (user, 2026-10-05)
- [x] Task 7: Add the `realtime-table-has-trigger` check
- [x] Task 8: Add the private option to `useRealtimeChannel`
- [x] Task 9: Add `cachedClientLoader` and the company id value
- [x] Task 10: Add the invalidation middleware to both roots
- [x] Task 11: Convert the 27 cached `clientLoader` exports
- [x] Task 12: Delete the invalidation-only `clientAction` exports
- [x] Task 13: Add `useRealtime` and `useRouteRealtime` to `@carbon/react`
- [x] Task 14: Move the ERP lists to `useLiveList`
- [x] Task 15: Move the MES lists and remove nanostores
- [x] Task 16: Move notifications and the implementation hub
- [x] Task 17: Declare `handle.realtime` on the routes and convert the subscribers
- [x] Task 18: Add `useLoaderQuery` and migrate the `.load()` call sites (13 event-driven sites stay on `useFetcher`: Linear and Jira issue search, the Onshape sync steps, the Stripe customer lookup, the 2 report drill-downs, the MES issue-material modal)
- [x] Task 19: Add `useAction` and migrate the submit call sites (98 single-condition effects; the 133 effects with several branches are a follow-up PR, user decision 2026-10-05)
- [x] Task 20: Update the rules, the lessons and the `AGENTS.md` files
- [x] Task 21: Run the full verification and the browser tests

## Dependencies

- Task 1 gates everything. If it fails, stop.
- Tasks 2 → 3 → 4 → 5 → 6 run in order (database).
- Task 7 needs Task 2.
- Tasks 8, 9 are independent of the database tasks.
- Task 10 needs Task 9. Tasks 11 and 12 need Task 10.
- Task 13 needs Tasks 5, 8 and 10. Tasks 14, 15, 16 and 17 need Task 13.
- Task 18 needs Task 11. Task 19 is independent of Task 18.
- Tasks 11, 12, 18 and 19 are codemod sweeps. Run each sweep one module folder at a time.

Rules for every task:

- Run each typecheck alone: `pnpm exec turbo run typecheck --filter=<pkg> --concurrency=1`.
- Start each new source file with its SPDX header: `pnpm --filter @carbon/checks license-headers`.
- Never run `pnpm db:migrate`. The user runs it.
- Never push. Commit only through `/check-and-commit`.

---

## Task 1: Install dependencies and prove broadcast on the local stack

**Depends on:** none
**Files:**
- Create: `<scratchpad>/broadcast-spike.sql`, `<scratchpad>/broadcast-spike.mjs` (not committed)

**Steps:**
1. Ask the user to approve `pnpm install` in this worktree. Run it with no `--filter`.
2. Ask the user to start the stack with `crbn up`, if it is not running.
3. In `psql`, run `SELECT to_regprocedure('realtime.send(jsonb,text,text,boolean)');`.
4. If step 3 returns NULL, STOP and report. Do not improvise.
5. Write the spike script. It signs in as the `DEV_BYPASS_EMAIL` user with supabase-js.
6. The script joins `company:<companyId>:spike` with `{ config: { private: true } }`.
7. Before the policy exists, confirm that the join returns `CHANNEL_ERROR`.
8. In a `psql` transaction, create the company policy from the spec. Do not commit it.
9. Run `SELECT realtime.send('{"op":"INSERT"}'::jsonb, 'INSERT', 'company:<companyId>:spike', true);`.
10. Confirm that the script prints the message.
11. Roll the transaction back.

**Verify:**
```bash
node <scratchpad>/broadcast-spike.mjs
# Expected: "CHANNEL_ERROR" without the policy; "received INSERT" with it
```

**Out of scope:** any change to a tracked file. If Realtime v2.89.0 does not deliver the message, STOP and report.

---

## Task 2: Add the realtime table lists

**Depends on:** Task 1
**Files:**
- Create: `packages/database/src/realtime-tables.ts`
- Create: `packages/database/src/realtime-tables.test.ts`
- Modify: `packages/database/package.json` — add the export `./realtime-tables`
- Copy from (precedent): `packages/database/src/supersession-pick.ts` (a client-safe module with its own export)

**Steps:**
1. Export `REALTIME_TABLES` as a `const` array of table names, typed `keyof Database["public"]["Tables"]`.
2. Put these 66 names in it: `assemblyPlanJob`, `changeOrder`, `customField`, `customer`, `documentExtraction`, `documentTemplate`, `employee`, `implementationCheckState`, `implementationFieldValue`, `implementationHub`, `implementationRow`, `inspection`, `inventoryCount`, `item`, `itemLedger`, `itemStockQuantities`, `itemSupersession`, `job`, `jobMakeMethod`, `jobMaterial`, `jobOperation`, `jobOperationNote`, `jobOperationStep`, `jobOperationStepRecord`, `journal`, `maintenanceDispatch`, `material`, `materialForm`, `materialSubstance`, `modelUpload`, `nonConformance`, `nonConformanceActionTask`, `part`, `pickingList`, `pickingListLine`, `printJob`, `productionEvent`, `productionQuantity`, `purchaseInvoice`, `purchaseInvoiceLine`, `purchaseOrder`, `purchaseOrderLine`, `purchaseReturnOrder`, `purchasingRfq`, `quote`, `quoteLine`, `quoteMaterial`, `quoteOperation`, `receipt`, `receiptLine`, `salesInvoice`, `salesInvoiceLine`, `salesOrder`, `salesOrderLine`, `salesReturnOrder`, `salesRfq`, `salesRfqLine`, `shipment`, `shipmentLine`, `stockTransfer`, `supplier`, `supplierQuote`, `trackedEntity`, `warehouseTransfer`, `workflowRun`, `workflowStepRun`.
3. Export `REALTIME_REFERENCE_TABLES` with these 20 names: `ability`, `customerContact`, `customerLocation`, `customerType`, `itemPostingGroup`, `location`, `materialType`, `nonConformanceType`, `paymentTerm`, `procedure`, `process`, `qualityDocument`, `shippingMethod`, `storageUnit`, `supplierContact`, `supplierLocation`, `supplierProcess`, `supplierType`, `unitOfMeasure`, `workCenter`.
4. Export `REALTIME_USER_TABLES = ["notification"] as const`.
5. Export the type `RealtimeTable` as the union of the first list.
6. In the test, assert that the three lists share no name and hold no duplicate.
7. For each name, run `SELECT relkind FROM pg_class WHERE oid = '"<name>"'::regclass;`. If one is not `r`, STOP and report.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/realtime-tables.test.ts
# Expected: 1 file passed
```

**Out of scope:** a table for a settings or admin page. Task 17 may add a name here only when a route in the spec's folder list needs it.

---

## Task 3: Add the three broadcast functions and the `realtime.messages` policies

**Depends on:** Task 2
**Files:**
- Create: `packages/database/src/event-system/functions/broadcast_table_changes.sql`
- Create: `packages/database/src/event-system/functions/broadcast_user_changes.sql`
- Create: `packages/database/src/event-system/functions/broadcast_reference_changes.sql`
- Modify: `packages/database/src/event-dispatch.test.ts` — check the ignored-column list in the 3 new files
- Modify: `packages/database/src/authz/rules.ts`, `sync.ts`, `migration.ts`, `manifest.ts` — the manifest owns `"realtime.messages"`
- Modify: `packages/checks/src/conformance/no-authz-ddl-in-migrations.ts` — flag a policy on the `realtime` schema
- Copy from (precedent): `packages/database/src/event-system/functions/dispatch_event_batch.sql`

**Steps:**
1. Read `.claude/rules/authz-manifest.md` → "Event-system functions" before you write a file.
2. Write `broadcast_table_changes.sql` with the function body from the spec's Data Model section.
3. Write `broadcast_user_changes.sql`. Use the same body. Group by `c->>'userId'`. Send to `'user:' || user_id || ':' || TG_TABLE_NAME`.
4. Write `broadcast_reference_changes.sql`. Use the same body. Send `{ table, op }` to `'company:' || company_id || ':reference'`.
5. In each file, declare `ignored_columns CONSTANT TEXT[] := ARRAY['updatedAt', 'updatedBy', 'embedding'];` on one line.
6. In `event-dispatch.test.ts`, run the existing constant check for each of the 4 files in a loop.
7. Add `locate(key)` and `external()` to `rules.ts`. A key with a dot names `<schema>.<table>`.
8. Add the `"realtime.messages"` entry with the 2 policies to `manifest.ts`.
9. Make `sync.ts` and `migration.ts` read the schema from the key. Keep the `public` output byte for byte.
10. Run `pnpm --filter @carbon/database authz migration realtime-broadcast`.
11. If the timestamp is older than the newest migration on `main`, rename the file to a later timestamp.
12. Do not edit the content of the generated migration.
13. When the local stack runs, run `pnpm --filter @carbon/database authz sync` and the `sync.test.ts` file.

**Verify:**
```bash
pnpm --filter @carbon/database exec vitest run src/event-dispatch.test.ts src/authz
# Expected: all files passed; the generated migration lists the 3 function names
```

**Out of scope:** `dispatch_event_batch.sql` and `attach_statement_handler.sql`. If `authz sync` refuses a file, STOP and report.

---

## Task 4: Write the attach migration

**Depends on:** Task 3
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_realtime-broadcast-attach.sql` through `pnpm db:migrate:new realtime-broadcast-attach`
- Copy from (precedent): `packages/database/supabase/migrations/20260812002454_item-stock-quantities-incremental.sql` (the `attach_statement_handler` call)

**Steps:**
1. Run `pnpm db:migrate:new realtime-broadcast-attach`.
2. Confirm that its timestamp is later than the generated migration of Task 3.
3. Write no policy in this file. The generated migration of Task 3 ships the 2 policies.
4. Add one `SELECT attach_statement_handler('<table>', ARRAY['broadcast_table_changes']);` line for each name in `REALTIME_TABLES`, except `itemLedger`.
5. For `itemLedger`, pass `ARRAY['apply_item_stock_quantities', 'broadcast_table_changes']`.
6. Add one line with `ARRAY['broadcast_reference_changes']` for each name in `REALTIME_REFERENCE_TABLES`.
7. Add the line for `notification` with `ARRAY['broadcast_user_changes']`.
8. Query `pg_publication_tables` for `supabase_realtime`. Add one guarded `ALTER PUBLICATION supabase_realtime DROP TABLE` for each row.
9. Wrap each drop in a `DO` block that checks `pg_publication_tables` first, so the migration is idempotent.
10. Add `CREATE OR REPLACE FUNCTION public.list_checksums(p_company_id TEXT)` from the spec, with the fifth row `mesItems`.
11. The `mesItems` row hashes `id, readableIdWithRevision, name, type, replenishmentSystem, itemTrackingType, active, thumbnailPath` and the model's `thumbnailPath`.
12. Add `REVOKE ALL ON FUNCTION public.list_checksums(TEXT) FROM PUBLIC, anon;` and `GRANT EXECUTE ... TO authenticated;`.
13. Run `pnpm --filter @carbon/checks clobbers`.

**Verify:**
```bash
grep -c "attach_statement_handler(" packages/database/supabase/migrations/*_realtime-broadcast-attach.sql
# Expected: 87  (66 + 20 + 1)
pnpm --filter @carbon/checks exec vitest run src/conformance/no-authz-ddl-in-migrations.test.ts
# Expected: passed
```

**Out of scope:** any `CREATE POLICY`. The check rejects a policy on `public` or `realtime` in a hand-written migration.

---

## Task 6b: Move event triggers and interceptor bodies out of migrations

**Depends on:** Task 5
**Files:**
- Create: `packages/database/src/event-system/attachments.ts` — the triggers of 141 tables
- Create: `packages/database/src/event-system/attachments-sync.ts`, `attachments-sync.test.ts`
- Create: `packages/database/src/event-system/handlers/*.sql` — 64 functions, read from the database with `pg_get_functiondef`
- Create: `packages/database/src/event-system/functions/set_event_triggers.sql`
- Create: `packages/database/supabase/migrations/20261004193811_drop-stale-interceptor-overload.sql`
- Create: `packages/database/supabase/migrations/20261004194527_event-attachments.sql` (generated)
- Modify: `packages/database/src/authz/sync.ts`, `migration.ts`, `cli.ts`, `helpers.ts`
- Modify: `packages/database/src/realtime-tables.ts` — the 3 lists derive from `attachments.ts`
- Modify: `packages/database/supabase/migrations/20261004192633_realtime-broadcast-attach.sql` — no attach call stays
- Modify: `packages/checks/src/conformance/no-authz-ddl-in-migrations.ts` — reject attach calls

**Steps:**
1. Read the live triggers of each table from the local database. Write them to `attachments.ts`.
2. Read each attached function with `pg_get_functiondef`. Write each one to `handlers/<name>.sql`.
3. Make `authz sync` compare the live triggers with `attachments.ts`.
4. Make `authz migration` write one `SELECT set_event_triggers(...)` for each changed table.
5. Run `pnpm --filter @carbon/database authz migration event-attachments`.
6. Ask the user to run `pnpm db:migrate`.

**Verify:**
```bash
SUPABASE_DB_URL=<local url> pnpm --filter @carbon/database exec vitest run src/authz src/event-system
# Expected: all passed; `authz check` reports 0 helpers, 0 tables, 0 event triggers
```

**Out of scope:** a change to what a trigger does. The takeover ships the triggers and the bodies as the database has them.

---

## Task 5: Apply the migrations and regenerate types

**Depends on:** Task 4
**Files:**
- Modify: `packages/database/src/types.ts` (generated) — gains `list_checksums`

**Steps:**
1. Ask the user to run `pnpm db:migrate`. Wait for the user.
2. Run `pnpm run generate:types`.
3. Run `EXPLAIN ANALYZE INSERT` on `jobOperation` in a rolled-back transaction. Record the trigger time in `.ai/runs/2026-10-04-realtime-broadcast.md`.
4. Run `EXPLAIN ANALYZE SELECT * FROM list_checksums('<companyId>')`. Record the time in the same file.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime';"
# Expected: 0
pnpm exec turbo run typecheck --filter=@carbon/database --concurrency=1
# Expected: 0 errors
```

**Out of scope:** hand edits to `types.ts`.

---

## Task 6: Add the database tests

**Depends on:** Task 5
**Files:**
- Create: `packages/database/supabase/tests/realtime-broadcast.test.sql`
- Copy from (precedent): `packages/database/supabase/tests/rpc-privileges.test.sql`

**Steps:**
1. Copy the fixture block: 2 companies, 2 users, all inside one rolled-back transaction.
2. Assert: an `INSERT` into `item` for company A adds 1 row to `realtime.messages` with topic `company:<A>:item`.
3. Assert: an `UPDATE` that changes only `updatedAt` adds 0 rows.
4. Assert: an `UPDATE` of 150 rows adds 1 row with `ids` null.
5. Assert: an `INSERT` into `notification` adds 1 row with topic `user:<userId>:notification`.
6. Assert: an `INSERT` into `customerType` adds 1 row with topic `company:<A>:reference`.
7. Assert: as user A, a `SELECT` on `realtime.messages` with `realtime.topic` set to `company:<B>:item` returns 0 rows.
8. Assert: as user B, the topic `user:<A>:notification` returns 0 rows.
9. Assert: `list_checksums` as user A for company B returns hashes of empty lists.
10. Assert: `list_checksums` changes after a customer rename and after an item delete.

**Verify:**
```bash
pnpm exec tsx scripts/run-local-accounting-check.ts psql -X -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/realtime-broadcast.test.sql
# Expected: exit 0, ends with ROLLBACK
```

**Out of scope:** committed fixture rows.

---

## Task 7: Add the `realtime-table-has-trigger` check

**Depends on:** Task 2
**Files:**
- Create: `packages/checks/src/conformance/realtime-table-has-trigger.ts`
- Create: `packages/checks/src/conformance/realtime-table-has-trigger.test.ts`
- Modify: `packages/checks/src/index.ts`, `packages/checks/src/run.ts` — register the check
- Copy from (precedent): `packages/checks/src/conformance/index-redirect-before-loaders.ts`

**Steps:**
1. Scan each file under `apps/{erp,mes}/app` for `realtime: [` in a `handle` export and for `useRealtime("…")`.
2. Report a violation for each table name that `REALTIME_TABLES` lacks.
3. Report a violation for each `"postgres_changes"` string literal in `apps/` or `packages/react/src`.
4. In the test, cover 3 cases: a listed table passes, an unlisted table fails, a `postgres_changes` literal fails.

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/conformance/realtime-table-has-trigger.test.ts
# Expected: 3 tests passed
```

**Out of scope:** a baseline entry. The check must end with zero findings after Task 17.

---

## Task 8: Add the private option to `useRealtimeChannel`

**Depends on:** Task 1
**Files:**
- Modify: `packages/react/src/hooks/useRealtimeChannel.ts` — new `private?: boolean` option and an `onSubscribed?: (isReconnect: boolean) => void` option

**Steps:**
1. Pass `{ config: { private: true } }` to `carbon.channel(topic, …)` when `private` is true.
2. Call `onSubscribed(true)` on each `SUBSCRIBED` status after the first one. Call `onSubscribed(false)` on the first.
3. Add `private` to the effect dependencies.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/react --concurrency=1
# Expected: 0 errors
```

**Out of scope:** the retry schedule and the toast behavior.

---

## Task 9: Add `cachedClientLoader` and the company id value

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/utils/react-query.ts` — add `LOADER`, `LOADER_GC_TIME`, `loaderQueryKey`, `cachedClientLoader`, `setCompanyId`
- Modify: `apps/erp/app/utils/react-query.test.ts` — new cases
- Modify: `apps/erp/app/routes/x+/_layout.tsx` — call `setCompanyId(company.id)` before the first child renders

**Steps:**
1. Add `export const LOADER = "loader";` and `const LOADER_GC_TIME = 1000 * 60 * 30;`.
2. Replace the cookie read in `getCompanyId` with a module variable that `setCompanyId` writes.
3. Add `loaderQueryKey(url: string)`. It returns `[LOADER, companyId, pathname, search]`.
4. Add `cachedClientLoader` with the body from the spec.
5. Test: 2 concurrent calls for one URL call `serverLoader` 1 time.
6. Test: a call after `invalidateQueries({ queryKey: [LOADER] })` calls `serverLoader` again.
7. Test: with no company id, the function calls `serverLoader` and writes no cache entry.
8. Test: the returned function has `hydrate === true`.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/utils/react-query.test.ts
# Expected: all tests passed
```

**Out of scope:** the existing key factories. Task 12 deletes the unused ones.

---

## Task 10: Add the invalidation middleware to both roots

**Depends on:** Task 9
**Files:**
- Create: `packages/auth/src/middleware/invalidate.client.ts`
- Create: `packages/auth/src/middleware/invalidate.client.test.ts`
- Modify: `apps/erp/app/root.tsx` — add the middleware to `clientMiddleware`
- Modify: `apps/mes/app/root.tsx` — store the client on `window.clientCache`; add the middleware
- Modify: `apps/mes/app/types/global.d.ts` (create it if absent) — declare `window.clientCache`
- Copy from (precedent): `packages/auth/src/middleware/flash.client.ts`

**Steps:**
1. Export `createInvalidationMiddleware({ getCache, skipPaths })`.
2. After `await next()`, return if `request.method` is `GET`.
3. Return if `skipPaths` holds the request pathname.
4. Call `getCache()?.invalidateQueries({ queryKey: ["loader"] })`.
5. In each root, pass `skipPaths: [path.to.refreshSession]`.
6. In the MES root, copy the ERP `useState` initializer that reuses `window.clientCache`.
7. Test 3 cases: a `GET` invalidates nothing, a `POST` invalidates, a `POST` to `/refresh-session` invalidates nothing.

**Verify:**
```bash
pnpm --filter @carbon/auth exec vitest run src/middleware/invalidate.client.test.ts
# Expected: 3 tests passed
```

**Out of scope:** `flashClientMiddleware`. `@carbon/auth` gets no dependency on `@tanstack/react-query`; type the cache as `{ invalidateQueries(filter: { queryKey: unknown[] }): unknown }`.

---

## Task 11: Convert the 27 cached `clientLoader` exports

**Depends on:** Task 10
**Files:**
- Modify: each file that `grep -rlE "export (async function|const) clientLoader" apps/erp/app/routes/api+` prints (27 files)

**Steps:**
1. In each file, replace the `clientLoader` function and its `.hydrate` line with `export const clientLoader = cachedClientLoader<typeof loader>();`.
2. If the old code passed a `staleTime` other than `RefreshRate.Low`, pass the same `staleTime`.
3. Remove the imports that the file no longer uses.
4. `inventory.storage-units.ts` and `inventory.storage-units-with-quantities.ts` shared one key. Confirm that their URL keys now differ.

**Verify:**
```bash
grep -rLE "cachedClientLoader<typeof loader>" $(grep -rlE "clientLoader" apps/erp/app/routes/api+) | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

**Out of scope:** the server `loader` of each file.

---

## Task 12: Delete the invalidation-only `clientAction` exports

**Depends on:** Task 10
**Files:**
- Modify: each file that `grep -rlE "export (async function|const) clientAction" apps/erp/app/routes` prints (78 files)
- Modify: `apps/erp/app/utils/react-query.ts` — delete each export with zero importers
- Modify: `apps/erp/app/components/Form/Item.tsx`, `Form/Account.tsx`, `Form/EmailRecipients.tsx`, `components/Selectors/UserSelect/useUserSelect.ts` — move `cachedApiQuery` callers to `loaderQueryKey(url)`

**Steps:**
1. Read each `clientAction`. If it only invalidates or nulls a key and calls `serverAction()`, delete the export.
2. If it does other work, keep that work and delete the cache lines.
3. Change `cachedApiQuery(query, url)` to take only `url`. Key it with `loaderQueryKey(url)`.
4. Delete `invalidateUserSelectQueries` and `invalidateInspectionDocuments`, and their callers.
5. For each export left in `react-query.ts`, run `grep -rn "<name>" apps/erp/app`. Delete the export if only its definition matches.
6. Keep `ITEM_QUANTITIES_QUERY_KEY` and `itemQuantitiesQuery`.

**Verify:**
```bash
grep -rn "setQueryData\|getQueryData" apps/erp/app/routes | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

**Out of scope:** the server `action` of each file.

---

## Task 13: Add `useRealtime` and `useRouteRealtime` to `@carbon/react`

**Depends on:** Tasks 5, 8, 10
**Files:**
- Create: `packages/react/src/hooks/useRealtime.ts` — exports `useRealtime`, `useDebouncedRealtime`, `useRealtimeRevalidator`, `useRouteRealtime`, `matchesIdFilter`
- Create: `packages/react/src/hooks/useRealtime.test.ts`
- Modify: `packages/react/src/hooks/index.ts` — export them
- Modify: `apps/erp/app/hooks/useRealtime.tsx`, `apps/erp/app/hooks/useDebouncedRealtime.ts`, `apps/mes/app/hooks/useRealtime.tsx` — re-export from `@carbon/react`
- Modify: `apps/erp/app/routes/x+/_layout.tsx`, `apps/mes/app/routes/x+/_layout.tsx` — call `useRouteRealtime(company.id)`
- Copy from (precedent): `apps/mes/app/hooks/useRealtime.tsx` (`useRealtimeRevalidator`)

**Steps:**
1. Move `useRealtimeRevalidator` from the MES file. It skips the revalidation while a fetcher is submitting.
2. Change it to run the skipped revalidation when the fetcher returns to `idle`.
3. Write `matchesIdFilter(filter, ids)`. It parses `id=eq.<id>` and `id=in.(<ids>)`.
4. If the filter names another column, `matchesIdFilter` returns true.
5. If `ids` is null, `matchesIdFilter` returns true.
6. Write `useRealtime(table: RealtimeTable, filter?, debounceMs = 300)`. It takes `companyId` from a `RealtimeContext` that the shell provides.
7. `useRealtime` subscribes to `company:<companyId>:<table>` with `private: true` and event `"*"` on `"broadcast"`.
8. On a matching message, it restarts the debounce timer. When the timer ends, it invalidates `["loader"]` and revalidates.
9. Write `useRouteRealtime(companyId)`. It reads `handle.realtime` from `useMatches()` and subscribes for each unique table.
10. `useRouteRealtime` also subscribes to `company:<companyId>:reference`. On a message it invalidates `["loader"]` only.
11. On `onSubscribed(true)`, both hooks invalidate and revalidate one time.
12. Test `matchesIdFilter` with 5 cases: `id=eq`, `id=in`, a parent column, null ids, no filter.

**Verify:**
```bash
pnpm --filter @carbon/react exec vitest run src/hooks/useRealtime.test.ts
# Expected: 5 tests passed
pnpm exec turbo run typecheck --filter=@carbon/react --concurrency=1
# Expected: 0 errors
```

**Out of scope:** callers of `useRealtime`. Task 17 converts them. `@carbon/react` reads the cache from `window.clientCache`; it gets no new dependency in this task.

---

## Task 14: Move the ERP lists to `useLiveList`

**Depends on:** Task 13
**Files:**
- Create: `packages/react/src/hooks/useLiveList.ts`, `packages/react/src/hooks/useLiveList.test.ts`
- Modify: `packages/react/package.json` — add `@tanstack/react-query` at the version the apps use (`5.97.0`)
- Modify: `apps/erp/app/stores/items.ts`, `customers.ts`, `suppliers.ts`, `people.ts` — hooks read the query cache
- Modify: `apps/erp/app/components/RealtimeDataProvider.tsx` — 4 `useLiveList` calls and the `itemStockQuantities` listener
- Copy from (precedent): `apps/erp/app/components/RealtimeDataProvider.tsx` (the column lists and the IndexedDB keys)

**Steps:**
1. Add the dependency with a bare `pnpm install`. Check `git diff --stat pnpm-lock.yaml` for unrelated changes.
2. Write `defineLiveList({ name, table, view?, columns, sort, enrich? })`. It returns the definition and the key `["live", companyId, name]`.
3. Write the pure function `applyBroadcast(rows, { op, ids }, fetched, sort)`. Test it with 4 cases: insert, update, delete, duplicate insert.
4. Write `useLiveList(definition, companyId)`. It does the cold-load steps 1 to 6 of the spec.
5. It subscribes to the definition's topic. On a message it does the broadcast steps 1 to 5 of the spec.
6. It calls `list_checksums` one time for all lists that mount in the same tick.
7. Store each list in IndexedDB as `{ rows, checksum }` under `<name>:<companyId>`.
8. If a stored value is a bare array (the old format), treat the checksum as absent.
9. The items definition sets `enrich` to merge `itemSupersession` rows. It also listens to the `itemSupersession` topic and resyncs.
10. The people definition reads the `employees` view and listens to the `employee` topic. A message always resyncs.
11. In each store file, export the hook as `() => [rows, setRows]`. `setRows` calls `setQueryData` on the list key.
12. Change `useParts`, `useTools`, `useServices`, `useMaterials` to `useQuery` with a `select` filter.
13. Keep `upsertIntoListStore` and `latestRevisionByReadableId`.
14. In the provider, on an `itemStockQuantities` message, invalidate the queries whose key starts with `ITEM_QUANTITIES_QUERY_KEY`.

**Verify:**
```bash
pnpm --filter @carbon/react exec vitest run src/hooks/useLiveList.test.ts
# Expected: 4 tests passed
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors, with no change to a file that calls useItems, useCustomers, useSuppliers or usePeople
```

**Out of scope:** the about 200 consumer files. If a consumer fails the typecheck, fix the hook's return type, not the consumer.

---

## Task 15: Move the MES lists and remove nanostores

**Depends on:** Task 14
**Files:**
- Modify: `apps/mes/app/stores/items.ts`, `apps/mes/app/stores/people.ts`, `apps/mes/app/components/RealtimeDataProvider.tsx`
- Delete: `packages/react/src/hooks/useNanoStore.ts`
- Modify: `packages/react/src/hooks/index.ts`, `apps/erp/app/hooks/index.ts`, `apps/mes/app/hooks/index.ts` — remove `useNanoStore`
- Modify: `apps/erp/package.json`, `apps/mes/package.json`, `packages/react/package.json`, `pnpm-workspace.yaml` — remove `nanostores` and `@nanostores/react`

**Steps:**
1. Define the MES item list with name `mesItems` and the MES column list.
2. Define the MES people list with the same definition as the ERP.
3. Replace the MES provider body with 2 `useLiveList` calls.
4. Delete `useNanoStore` and its exports.
5. Remove the 2 packages from each `package.json` and from the catalog. Run a bare `pnpm install`.

**Verify:**
```bash
grep -rl "nanostores" apps packages --include="*.ts" --include="*.tsx" --include="package.json" | grep -v node_modules | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: 0 errors
```

**Out of scope:** `localforage`. The topbar search keeps its own keys.

---

## Task 16: Move notifications and the implementation hub

**Depends on:** Task 13
**Files:**
- Modify: `apps/erp/app/hooks/useNotifications.tsx`
- Modify: `apps/erp/app/hooks/useImplementationRealtime.tsx`

**Steps:**
1. In `useNotifications`, subscribe to `user:<userId>:notification` with `private: true`.
2. On `INSERT` or `UPDATE`, read the rows with `.in("id", ids).eq("companyId", companyId)`. Use the select string of the initial load.
3. Apply the existing `digestedInto` rules to each row.
4. On `DELETE`, remove the rows whose `_id` is in `ids`.
5. If `ids` is null, run the initial load again.
6. In `useImplementationRealtime`, replace the 4 `postgres_changes` listeners with 4 `useRealtime` calls.

**Verify:**
```bash
grep -rn "postgres_changes" apps/erp/app/hooks/useNotifications.tsx apps/erp/app/hooks/useImplementationRealtime.tsx | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

**Out of scope:** `markMessageAsRead` and the digest loader.

---

## Task 17: Declare `handle.realtime` on the routes and convert the subscribers

**Depends on:** Task 13
**Files:**
- Modify: each route layout or page under the folders in the spec's "Operational routes" list
- Modify: each route under `apps/mes/app/routes/x+` that has a `loader` and a default export
- Modify: the 41 files that `grep -rlE "useRealtime\(|useDebouncedRealtime\(|useRealtimeChannel\(" apps` prints
- Modify: `apps/erp/app/types/` — add `realtime?: RealtimeTable[]` to the `Handle` type

**Steps:**
1. For each route, list the tables that its `loader` reads. Follow each service function to its `.from("…")` call.
2. If the loader reads a view, list the base tables that the page must follow.
3. Add `realtime: [...]` to the route's `handle`. Merge it with an existing `breadcrumb` or `module` key.
4. If a table is not in `REALTIME_TABLES`, add it there and add its `attach_statement_handler` line to a new migration `realtime-broadcast-attach-2`.
5. Set the ERP job layout `x+/job+/$jobId.tsx` to `["job", "jobOperation", "jobMaterial", "jobMakeMethod", "jobOperationStep", "jobOperationStepRecord", "productionEvent", "pickingListLine", "modelUpload"]`.
6. For each of the 41 subscriber files: if the file is a route, delete its `useRealtime` call and use `handle.realtime`.
7. If the file is a component that only revalidates, keep `useRealtime(table, filter)`.
8. If the file reads `payload.new` or `payload.old`, read the rows by `ids` through `carbon.from(table).select().in("id", ids)`.
9. `JobBillOfProcess.tsx` has 3 channels. Convert the `productionEvent` and `jobOperationNote` channels by step 8. Delete the `bop-steps` channel.
10. Delete each `companyId` guard on a payload row. The topic carries the company.
11. Run the check of Task 7. Fix each finding.

**Verify:**
```bash
grep -rn "postgres_changes" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "realtime-table-has-trigger" | wc -l
# Expected: 0
pnpm --filter @carbon/checks exec vitest run
# Expected: all passed, 0 findings for realtime-table-has-trigger
pnpm exec turbo run typecheck --filter=erp --concurrency=1
pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: 0 errors each
```

**Out of scope:** routes under settings, users, account, accounting, people, resources, documents, templates and workflows that have no subscription today. If step 4 adds more than 15 tables, STOP and report the list.

---

## Task 18: Add `useLoaderQuery` and migrate the `.load()` call sites

**Depends on:** Task 11
**Files:**
- Create: `packages/react/src/hooks/useLoaderQuery.ts`
- Modify: each file that `grep -rlE "\.load\(" apps/erp/app apps/mes/app` prints (137 call sites)

**Steps:**
1. Write `useLoaderQuery<L>(url: string | null, options?)`. It calls `useQuery` with the key `["loader", companyId, pathname, search]`.
2. The `queryFn` fetches `<url>` with `.data` handling equal to `fetcher.load`: use `fetch(url)` and `res.json()` for `api+` routes.
3. If `url` is null, set `enabled: false`.
4. Migrate one module first: `apps/erp/app/components/Form/` (the pickers). Run the browser check of Task 21 step 2 on it.
5. Then migrate each remaining call site where the URL is under `path.to.api`.
6. Replace `fetcher.data` with `data`, and `fetcher.state === "loading"` with `isPending`.
7. Leave a call site on `useFetcher` if its URL is a page route. Add no comment.

**Verify:**
```bash
grep -rnE "\.load\(path\.to\.api" apps/erp/app apps/mes/app | wc -l
# Expected: 0
pnpm exec turbo run typecheck --filter=erp --concurrency=1
# Expected: 0 errors
```

**Out of scope:** suspense variants and `refetchInterval`. If an `api+` route returns a turbo-stream body that `res.json()` cannot read, STOP and report.

---

## Task 19: Add `useAction` and migrate the submit call sites

**Depends on:** Task 13
**Files:**
- Create: `packages/react/src/hooks/useAction.ts`, `packages/react/src/hooks/useAction.test.tsx`
- Modify: each file that `grep -rlE "fetcher\w*\.submit\(" apps/erp/app apps/mes/app` prints

**Steps:**
1. Write `useAction<A>({ onSuccess?, onError?, key? })`. It wraps `useFetcher<A>({ key })`.
2. Return `{ submit, Form, data, isPending, pending }`. `pending` is `fetcher.formData`.
3. Call `onSuccess(data)` one time when the state returns to `idle` with data whose `success` is not false.
4. Call `onError(data)` one time when the data has `success === false` or an `error` key.
5. Hold the callbacks in refs, so a new closure on each render fires nothing.
6. Test 3 cases with `createRoutesStub`: success, error, and a second submit that fires `onSuccess` again.
7. Migrate `apps/erp/app/modules/sales` first. Run its playbooks under `.ai/playbooks/` before you continue.
8. Then migrate each file where an effect reads `fetcher.data` or `fetcher.state` to close, toast or navigate.
9. Delete the effect. Move its body into `onSuccess` or `onError`.
10. Leave a call site on `useFetcher` if no effect reads its result.

**Verify:**
```bash
pnpm --filter @carbon/react exec vitest run src/hooks/useAction.test.tsx
# Expected: 3 tests passed
pnpm --filter @carbon/checks exec vitest run src/conformance/no-unguarded-submit.test.ts
# Expected: passed
pnpm exec turbo run typecheck --filter=erp --concurrency=1
pnpm exec turbo run typecheck --filter=mes --concurrency=1
# Expected: 0 errors each
```

**Out of scope:** `ValidatedForm` and `packages/form`. Optimistic cache writes. The MES "Complete Batch" fetcher owner (`.ai/lessons.md` line 1994) keeps its place in `JobOperation`.

---

## Task 20: Update the rules, the lessons and the `AGENTS.md` files

**Depends on:** Tasks 12, 15, 17, 19
**Files:**
- Modify: `.claude/rules/clientAction-patterns.md` — rewrite for `cachedClientLoader` and the middleware
- Modify: `.claude/rules/coding-conventions.md` — the State section
- Create: `.claude/rules/realtime-system.md` — topics, the 3 functions, `handle.realtime`, `useLiveList`, the check
- Modify: `.claude/rules/event-system.md`, `.claude/rules/authz-manifest.md` — the 3 new managed functions (37 → 40)
- Modify: `.ai/lessons.md` — 2 lessons
- Modify: `packages/react/AGENTS.md`, `packages/database/AGENTS.md`, `AGENTS.md` (Task Router row for realtime)
- Modify: the spec — status `implemented`, changelog entry

**Steps:**
1. Write the lesson "a subscription to an unpublished table fails silently" in the `Context → Problem → Rule → Applies to` format.
2. Write the lesson "`getCompanyId()` read an httpOnly cookie and always returned null".
3. In each rule, describe committed code only.
4. Do the STE-80 review pass on the spec after the edit.

**Verify:**
```bash
grep -rn "window.clientCache?.setQueryData\|nanostores\|postgres_changes" .claude/rules | wc -l
# Expected: 0
```

**Out of scope:** product docs under `docs/`. The change adds no user-facing feature that needs a page.

---

## Task 21: Run the full verification and the browser tests

**Depends on:** all tasks
**Files:**
- Create: `.ai/playbooks/realtime-broadcast.md` (through `/test`)
- Modify: `.ai/runs/2026-10-04-realtime-broadcast.md` — results

**Steps:**
1. Run `pnpm run lint`, `pnpm run test`, and the 5 scoped typechecks of the spec, one at a time.
2. Run `/auth`, then `/test` with these 8 checks:
3. Complete an operation in the MES. The ERP job page shows it as complete within 3 seconds, with no reload.
4. Add a customer type in tab A. The picker in tab B shows it within 3 seconds.
5. Reload with no data change. The network log shows 1 `list_checksums` call and 0 calls to `item`, `supplier`, `customer`, `employees`, `itemSupersession`.
6. Rename a customer in tab A, close tab B first, then open tab B. The log shows a `customer` fetch only.
7. Send a notification to the user. The bell shows it within 3 seconds.
8. Switch company. No item, customer or cached list of the first company shows.
9. Run the MES "Complete Batch" flow. The redirect to the operations page happens.
10. Open the ERP job page, the sales order page and the MES operations page. The console shows 0 realtime errors.
11. Run `/self-review`.

**Verify:**
```bash
pnpm run lint && pnpm run test
# Expected: exit 0
```

**Out of scope:** a push or a pull request. Ask the user before each one.
