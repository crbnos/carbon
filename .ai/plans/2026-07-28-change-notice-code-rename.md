
# Change Notice code-layer rename — implementation plan

**Spec:** none — explicit user decision (see Scope below)
**Branch:** new branch off `feat/change-orders-iteration` (or off `main` once that merges)

## Scope decision (already made — do not re-litigate)

The feature was renamed "Change Order" → "Change Notice" for users in an earlier PR.
This plan renames the **TypeScript layer only** so the code matches what users see.

**RENAME:** exported functions, consts, validators, types, React components, file and
directory names, local variables, props, and import paths.

**DO NOT RENAME — this is the whole risk of the task:**

1. **Database table names** in query strings: `changeOrder`, `changeOrders` (view),
   `changeOrderType`, `changeOrderAffectedItem`, `changeOrderActionTask`,
   `changeOrderRequiredAction`, `changeOrderSupersession`. These appear as
   `.from("changeOrder")` etc.
2. **Database column names** in query strings and object literals sent to the DB:
   `changeOrderId`, `changeOrderTypeId`. A local variable *named* `changeOrderId` may be
   renamed, but the object KEY in an insert/update/select and the string in `.eq("changeOrderId", …)`
   must not.
3. **Database enum type names**: `Database["public"]["Enums"]["changeOrderStatus"]`,
   `changeOrderTaskStatus`, `changeOrderChangeType`.
4. **Stored data values** — strings persisted in rows, not identifiers. Chiefly
   `"changeOrderActionTask"` used as `externalIntegrationMapping.entityType` (36 occurrences).
   Renaming these orphans every existing row. Also `sequence.table = 'changeOrder'` and the
   `audit.config.ts` entity key + `tables:` keys.
5. **Migrations** under `packages/database/supabase/migrations/` — never edit applied migrations.
6. **Generated files**: `packages/database/src/types.ts`, `swagger-docs-schema.ts`,
   `supabase/functions/lib/types.ts`, `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`,
   `apps/erp/app/modules/agent/kb/**`.
7. **Glossary term ids**: `termId="change-order"`, `termId="change-order-change-type"`.
8. **URL slugs already shipped**: the redirect shims under `routes/x+/items+/change-order*`
   and docs URLs `/docs/reference/change-orders/...`, `/guides/change-order`.

**Safety net:** Supabase's generated types make table and column names *literal* types, so
renaming one of those strings by mistake fails `typecheck` loudly. The dangerous cases are the
ones typecheck CANNOT catch: item 4 (plain strings) and item 7. Those must be checked by grep,
not by the compiler.

## Progress
- [x] Task 1: Create the branch and record the pre-rename baseline
- [x] Task 2: Rename the models layer (`items.models.ts`)
- [x] Task 3: Rename the service + server layer
- [x] Task 4: Rename the UI directories and component files
- [x] Task 5: Rename component identifiers, props and local variables
- [x] Task 6: Rename route file-internal identifiers and remaining call sites
- [x] Task 7: Audit the do-not-rename list
- [ ] Task 8: Full verification + browser check

## Dependencies

Tasks 2 → 3 → 4 → 5 → 6 run **strictly in order**: each one leaves the tree failing
typecheck for the next to fix, and that failure list is the checklist. Do not parallelize.
Task 7 needs 2–6. Task 8 needs everything.

## Conventions that apply throughout

- `pnpm` only, never `npm`.
- ERP typecheck filter is **`erp`**, not `@carbon/erp` — the wrong filter silently passes.
- Whole-repo typecheck OOMs. Always scope with `--filter`.
- After any turbo run, `git status` and revert unintended regeneration under
  `packages/database/`.
- This is a **pure rename**. No behaviour change, no logic change, no reformatting beyond what
  Biome does automatically. If you find yourself "improving" something, stop — it belongs in a
  different PR and it destroys this PR's reviewability.
- Commit after each task so a bad step can be reverted in isolation.

---

## Task 1: Create the branch and record the pre-rename baseline

**Depends on:** none
**Files:** none (git + a scratch file)

**Steps:**

1. Branch from the current head:
   ```bash
   git checkout -b refactor/change-notice-code-rename
   ```
2. Record the baseline so Task 8 can prove nothing changed behaviourally:
   ```bash
   pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs
   pnpm run lint 2>&1 | grep -E "Found .* warnings" | tee /tmp/rename-baseline-lint.txt
   pnpm run test 2>&1 | grep -E "Tasks:" | tee /tmp/rename-baseline-test.txt
   ```
3. Record the counts that must go to zero (identifiers) and the counts that must NOT change
   (DB strings):
   ```bash
   grep -rl "changeOrder\|ChangeOrder" apps packages --include=*.ts --include=*.tsx | wc -l
   grep -ro '\.from("changeOrder[A-Za-z]*")' apps packages --include=*.ts --include=*.tsx | wc -l
   grep -ro '"changeOrderActionTask"' apps packages --include=*.ts --include=*.tsx | wc -l
   ```
   Write all three numbers into the plan file under this task before continuing.

**Baseline recorded 2026-07-28** (branch cut from `feat/change-orders-iteration` @ `8ba77e911`):

| Measure | Baseline | After the rename |
|---|---|---|
| Files containing `changeOrder`/`ChangeOrder` | 103 | must drop sharply |
| `.from("changeOrder*")` DB strings | 49 | **must stay 49** |
| `"changeOrderActionTask"` stored values | 36 | **must stay 36** |
| `eq("changeOrderId"` DB filters | 8 | **must stay 8** |
| `termId="change-order*"` glossary ids | 3 | **must stay 3** |
| Lint warnings | 16 | must stay 16 |

**Verify:**
```bash
git branch --show-current
# Expected: refactor/change-notice-code-rename
```

**Out of scope:** any code change.

---

## Task 2: Rename the models layer

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/items/items.models.ts`

**Steps:**

1. Rename these exported identifiers (left → right). This is the complete list; if you find one
   not on it, add it and say so in your report:

   | Old                                          | New                                           |
   | -------------------------------------------- | --------------------------------------------- |
   | `changeOrderStatus`                          | `changeNoticeStatus`                          |
   | `changeOrderStatusTransitions`               | `changeNoticeStatusTransitions`               |
   | `changeOrderStatusValidator`                 | `changeNoticeStatusValidator`                 |
   | `changeOrderOpenStatuses`                    | `changeNoticeOpenStatuses`                    |
   | `changeOrderBroadcastStages`                 | `changeNoticeBroadcastStages`                 |
   | `changeOrderChangeTypes`                     | `changeNoticeChangeTypes`                     |
   | `changeOrderPriority`                        | `changeNoticePriority`                        |
   | `changeOrderTaskStatus`                      | `changeNoticeTaskStatus`                      |
   | `changeOrderType`                            | `changeNoticeType`                            |
   | `changeOrderValidator`                       | `changeNoticeValidator`                       |
   | `changeOrderTypeValidator`                   | `changeNoticeTypeValidator`                   |
   | `changeOrderRequiredActionValidator`         | `changeNoticeRequiredActionValidator`         |
   | `changeOrderActionStatusValidator`           | `changeNoticeActionStatusValidator`           |
   | `changeOrderAffectedItemValidator`           | `changeNoticeAffectedItemValidator`           |
   | `changeOrderAffectedItemChangeTypeValidator` | `changeNoticeAffectedItemChangeTypeValidator` |
   | `changeOrderAffectedItemCutoverValidator`    | `changeNoticeAffectedItemCutoverValidator`    |
   | `changeOrderNewPartValidator`                | `changeNoticeNewPartValidator`                |
   | `changeOrderStageFlow`                       | `changeNoticeStageFlow`                       |
   | `isChangeOrderLocked`                        | `isChangeNoticeLocked`                        |
   | `isAllowedChangeOrderTransition`             | `isAllowedChangeNoticeTransition`             |
   | `canEditChangeOrderEngineering`              | `canEditChangeNoticeEngineering`              |
   | `canEditChangeOrderWorkflow`                 | `canEditChangeNoticeWorkflow`                 |
   | `changeOrderLockedMessage`                   | `changeNoticeLockedMessage`                   |

2. **`changeOrderStatus` is the dangerous one.** It is BOTH a TS const being renamed AND a
   Postgres enum name. Anywhere the file references the DB enum type — e.g.
   `Database["public"]["Enums"]["changeOrderStatus"]` — the **string inside the brackets must
   stay `changeOrderStatus`**. Same for `changeOrderTaskStatus` and `changeOrderChangeType`.
   Check every occurrence individually; do not sed this one.
3. Likewise `changeOrderType` is both a TS const and a DB table name. The const renames; any
   `.from("changeOrderType")` does not.
4. Do NOT touch zod field names that map to DB columns (e.g. a validator field literally named
   `changeOrderId` that is submitted as form data and written to that column).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -c "error TS"
# Expected: a NON-ZERO number — every consumer of the renamed exports now fails.
# That failure list is the work inventory for Tasks 3-6. Record the count.
grep -n 'Enums\["changeOrder' apps/erp/app/modules/items/items.models.ts
# Expected: the DB enum references are still spelled changeOrder*.
```

**Out of scope:** every file other than `items.models.ts`. Do not start fixing the consumers yet.

---

## Task 3: Rename the service + server layer

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/items/items.service.ts`
- Modify: `apps/erp/app/modules/items/items.server.ts`
- Modify: `apps/erp/app/modules/items/types.ts`

**Steps:**

1. Update every import of the Task 2 identifiers.
2. Rename these exported functions (`ChangeOrder` → `ChangeNotice` in each name):
   `getChangeOrder`, `getChangeOrders`, `insertChangeOrder`, `updateChangeOrder`,
   `deleteChangeOrder`, `updateChangeOrderStatus`, `applyChangeOrder`,
   `getChangeOrderActions`, `setChangeOrderActionTasks`, `updateChangeOrderActionOrder`,
   `updateChangeOrderActionStatus`, `deleteChangeOrderAction`,
   `getChangeOrderAffectedItems`, `addChangeOrderAffectedItem`,
   `removeChangeOrderAffectedItem`, `updateChangeOrderAffectedItemChangeType`,
   `updateChangeOrderAffectedItemCutover`, `createChangeOrderDraftMethod`,
   `getChangeOrderDiff`, `getChangeOrderType`, `getChangeOrderTypes`,
   `getChangeOrderTypesList`, `upsertChangeOrderType`, `deleteChangeOrderType`,
   `getChangeOrderRequiredAction`, `getChangeOrderRequiredActions`,
   `getChangeOrderRequiredActionsList`, `upsertChangeOrderRequiredAction`,
   `deleteChangeOrderRequiredAction`, `seedDefaultChangeOrderActions`,
   `findChangeOrdersForItem`, `findOtherOpenChangeOrdersForItem`,
   `getChangeOrdersForNonConformance`, `getItemChangeOrderData`,
   `notifyChangeOrderTransition`, `changeOrderStageEvent`,
   `requireChangeOrderEditable`, `requireEditableChangeOrderRoute`,
   `requireChangeOrderChildRoute`.
3. Rename exported types in `types.ts`: `ChangeOrder` → `ChangeNotice`,
   `ChangeOrderListItem` → `ChangeNoticeListItem`, `ChangeOrderActionTask` →
   `ChangeNoticeActionTask`, `ChangeOrderAffectedItem*` → `ChangeNoticeAffectedItem*`, and any
   sibling type carrying the name.
4. **Every `.from("…")`, `.eq("changeOrderId", …)`, `.select("changeOrderId, …")` and every
   object key written to the database stays exactly as it is.** Rename the surrounding
   function and variable names only.
5. Local variables and parameters named `changeOrderId` may become `changeNoticeId`, but where
   that variable is used as a DB object key you must write it explicitly, e.g.
   `{ changeOrderId: changeNoticeId }`. Do not rely on shorthand property names.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep "error TS" | grep -c "items.service.ts\|items.server.ts\|items/types.ts"
# Expected: 0 — these three files are internally consistent. Errors remain elsewhere.
grep -c 'from("changeOrder' apps/erp/app/modules/items/items.service.ts
# Expected: unchanged from the Task 1 baseline for this file.
```

**Out of scope:** UI components, routes.

---

## Task 4: Rename the UI directories and component files

**Depends on:** Task 3
**Files:**
- Rename: `apps/erp/app/modules/items/ui/ChangeOrder/` → `ui/ChangeNotice/`
- Rename: `apps/erp/app/modules/items/ui/ChangeOrderTypes/` → `ui/ChangeNoticeTypes/`
- Rename: `apps/erp/app/modules/items/ui/ChangeOrderActions/` → `ui/ChangeNoticeActions/`
- Rename: the 29 files whose names start `ChangeOrder`

**Steps:**

1. Use `git mv` for every directory and file so history is preserved:
   ```bash
   git mv apps/erp/app/modules/items/ui/ChangeOrder apps/erp/app/modules/items/ui/ChangeNotice
   ```
   then each file, e.g. `ChangeOrderHeader.tsx` → `ChangeNoticeHeader.tsx`.
2. List the files first and rename them one by one; do not glob-rename blind:
   ```bash
   find apps packages -name "ChangeOrder*" -o -name "changeOrder*"
   ```
3. Update the barrel `apps/erp/app/modules/items/ui/ChangeNotice/index.ts` and every import
   path that referenced the old directory or filename.
4. Files whose name contains `ChangeOrder` but which are NOT part of this feature's UI (e.g.
   `packages/documents/src/email/previews/ChangeOrderStarted.tsx`) — rename them too for
   consistency, but check first that nothing imports them by a path built at runtime.

**Verify:**
```bash
find apps packages -name "ChangeOrder*" -o -name "changeOrder*" | grep -v node_modules
# Expected: no output.
pnpm exec turbo run typecheck --filter=erp 2>&1 | grep -c "Cannot find module"
# Expected: 0 — every import path resolves.
```

**Out of scope:** the migrations directory; the agent KB; anything under `docs/`.

---

## Task 5: Rename component identifiers, props and local variables

**Depends on:** Task 4
**Files:**
- Modify: every file under `apps/erp/app/modules/items/ui/ChangeNotice*/`
- Modify: the consumers the typecheck flags

**Steps:**

1. Rename the React component names to match their new filenames (`ChangeOrderHeader` →
   `ChangeNoticeHeader`, and so on for all 29).
2. Rename props, local state and helper functions inside those files.
3. Fix every consumer the typecheck flags, including `ItemChangeOrders.tsx` →
   `ItemChangeNotices.tsx`, `ItemOpenChangeOrderAlert.tsx`, `ItemChangeOrderLock.tsx`,
   `CreateChangeOrderModal.tsx`, and the cross-module callers in
   `modules/quality/ui/Issue/`, `modules/items/ui/Parts/`, `modules/items/ui/Tools/`,
   `modules/items/ui/Item/MakeMethodTools.tsx`.
4. `useRouteData<{ changeOrder: ChangeNotice }>(...)` — the KEY `changeOrder` here is the
   loader's return-object key, not a DB column. Rename it, but rename it in the loader at the
   same time or the lookup silently returns `undefined` at runtime. **Typecheck will not
   always catch this.** Grep for `changeOrder:` object keys in loaders and their readers and
   change them as a matched pair.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: clean.
grep -rn "changeOrder:" apps/erp/app/routes/x+/items+/change-notice+/ apps/erp/app/modules/items/ui/ChangeNotice/
# Expected: no output — loader keys and their readers renamed together.
```

**Out of scope:** DB strings.

---

## Task 6: Rename route file-internal identifiers and remaining call sites

**Depends on:** Task 5
**Files:**
- Modify: every file under `apps/erp/app/routes/x+/items+/change-notice+/`,
  `change-notices+/`, `x+/change-notice+/`, the flat `change-notice-types.*` /
  `change-notice-actions.*` files
- Modify: `packages/ee/src/lib/actionTaskEntity.ts`, `packages/jobs/src/inngest/functions/**`,
  `packages/notifications/src/index.ts` — identifiers only

**Steps:**

1. Rename local variables, imported identifiers and helper functions inside the route files.
2. **Route FILE names stay as they are** — they were already renamed to `change-notice` in the
   previous PR and they determine the URL.
3. In `packages/ee/src/lib/actionTaskEntity.ts`: the type `ActionTaskEntityType` and the map key
   `changeOrderActionTask` are **stored data values** — do NOT rename them. Only rename
   surrounding local identifiers if any.
4. Sweep for any straggler:
   ```bash
   grep -rn "changeOrder\|ChangeOrder" apps packages --include=*.ts --include=*.tsx \
     | grep -v node_modules | grep -v "packages/database/src/types.ts"
   ```
   Every remaining hit must be justifiable against the do-not-rename list. Put the surviving
   list in your report grouped by reason.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs
# Expected: clean.
pnpm run lint
# Expected: same warning count as /tmp/rename-baseline-lint.txt.
```

**Out of scope:** behaviour changes of any kind.

---

## Task 7: Audit the do-not-rename list

**Depends on:** Tasks 2–6
**Files:** none (verification only)

**Steps:**

1. Confirm the DB-bound strings are untouched, comparing to the Task 1 baseline numbers:
   ```bash
   grep -ro '\.from("changeOrder[A-Za-z]*")' apps packages --include=*.ts --include=*.tsx | wc -l
   grep -ro '"changeOrderActionTask"' apps packages --include=*.ts --include=*.tsx | wc -l
   grep -rn 'eq("changeOrderId"' apps packages --include=*.ts --include=*.tsx | wc -l
   ```
   All three must EQUAL the Task 1 baseline. A drop means a DB string was renamed — find it and
   restore it before continuing.
2. Confirm no migration was edited:
   ```bash
   git diff --name-only main...HEAD -- packages/database/supabase/migrations
   # Expected: no output.
   ```
3. Confirm generated files were not hand-edited:
   ```bash
   git diff --name-only main...HEAD -- packages/database/src/types.ts packages/database/src/swagger-docs-schema.ts
   # Expected: no output.
   ```
4. Confirm the glossary term ids survive:
   ```bash
   grep -rn 'termId="change-order' apps/erp/app | wc -l
   # Expected: unchanged from baseline.
   ```
5. Confirm the sequence table value survives:
   ```bash
   grep -rn "'changeOrder'" packages/database/supabase/functions/lib/seed.data.ts
   # Expected: the sequence entry still has table: "changeOrder".
   ```

**If ANY of these fails, STOP and report — do not improvise a fix.**

**Out of scope:** everything else.

---

## Task 8: Full verification + browser check

**Depends on:** all
**Files:** none

**Steps:**

1. Full gate:
   ```bash
   pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs
   pnpm run lint
   pnpm run test
   pnpm run build:erp
   ```
   Every result must match the Task 1 baseline. `build:erp` must exit 0.
2. Confirm translations are untouched — this is a code rename, so the `.po` files must not
   change:
   ```bash
   git diff --name-only main...HEAD -- packages/locale
   # Expected: no output. If .po files changed, a user-visible string was renamed by mistake.
   ```
3. Browser verification via the `/test` skill. Because this is a pure rename, the check is that
   nothing changed:
   - the Change Notices list loads and shows existing records
   - opening one shows its affected items, BOM/BOP, and action tasks
   - adding an affected item still works
   - advancing a stage still works, and the Implementation lock still locks
   - an old `/x/items/change-order/{id}/details` link still redirects
4. Report which flows you exercised and their result. Do not claim success for a flow you did
   not run.

**Out of scope:** fixing anything you find that is unrelated to the rename — report it instead.
