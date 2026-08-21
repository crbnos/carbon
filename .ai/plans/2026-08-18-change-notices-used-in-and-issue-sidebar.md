# Change Notices as a "where referenced" category — implementation plan

**Spec / source:** `.ai/specs/2026-08-18-change-notices-used-in-and-issue-sidebar.md`
**Branch:** `feat/cn-improvements`

No migrations, no schema changes, no new service functions. Every query already
exists and is already called by the routes being changed.

## Progress

- [x] Task 1: Add the `changeNotices` category to the shared `UsedIn` tree component
- [x] Task 2: Wire the Change Notices category into the Part detail route
- [x] Task 3: Wire the Change Notices category into the Tool detail route
- [x] Task 4: Widen `IssueAssociationNode` with a read-only, non-junction key
- [x] Task 5: Support read-only categories in `IssueAssociations.tsx`
- [x] Task 6: Wire the Change Notices category into the Issue detail route
- [x] Task 7: Remove the Change Notices block from `IssueProperties.tsx`
- [x] Task 8: Full verification pass (typecheck + biome + tests green; browser
      checks below still pending)

## Dependencies

- Task 2 needs Task 1
- Task 3 needs Task 1
- **Tasks 2 and 3 are independent of each other** — may run in parallel
- Task 5 needs Task 4
- Task 6 needs Tasks 4 and 5
- Task 7 is independent of Tasks 1–6 — may run in parallel with any of them
- Task 8 needs everything

---

## Task 1: Add the `changeNotices` category to the shared `UsedIn` tree component

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/UsedIn.tsx` — add the key, an
  optional `status` on children, a link case, a status badge, and an exported
  node builder.
- Copy from (precedent): the `jobs` trailing-`Badge` block already in
  `UsedInItem` at `apps/erp/app/modules/items/ui/Item/UsedIn.tsx:566-579`, and
  the `ChangeNoticeStatus` usage at
  `apps/erp/app/modules/quality/ui/Issue/IssueProperties.tsx:572`.

**Steps:**

1. Add the import after the existing `ItemChangeNoticeLock` import block (which
   currently ends at line 52):

   ```ts
   import ChangeNoticeStatus from "../ChangeNotice/ChangeNoticeStatus";
   ```

   `ChangeNoticeStatus` is a **default** export from
   `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeStatus.tsx`. It takes
   `{ status?: ChangeNoticeStatusType | null }` and returns `null` for an unknown
   or missing status, so no guard is needed at the call site.

2. Add `"changeNotices"` to the `UsedInKey` union (currently at lines 67–82).
   Insert it in alphabetical position, i.e. between `"assemblyInstructions"` and
   `"inspections"`:

   ```ts
   export type UsedInKey =
     | Database["public"]["Enums"]["itemType"]
     | "assemblyInstructions"
     | "changeNotices"
     | "inspections"
     // …rest unchanged
   ```

3. Add an optional `status` to `UsedInNode["children"]` (the type at lines
   115–129). Add it as the last field:

   ```ts
   export type UsedInNode = {
     key: UsedInKey;
     name: string;
     module: string;
     children: {
       id: string;
       documentReadableId: string;
       documentId?: string;
       documentParentId?: string;
       itemType?: ItemType;
       methodType?: string;
       revision?: string;
       version?: number;
       status?: string;
     }[];
   };
   ```

   This is additive and optional, so the existing `ImpactPanel.tsx` consumer and
   all current route call sites keep compiling unchanged.

4. In `getUseInLink` (the `switch` starting at line 599), add a case immediately
   after `case "assemblyInstructions":`:

   ```ts
   case "changeNotices":
     return path.to.changeNotice(child.documentId ?? child.id);
   ```

   `path.to.changeNotice` already exists (`apps/erp/app/utils/path.ts:387`) and
   returns `/x/items/change-notice/${id}`.

5. In `UsedInItem`, add the status badge. Insert this block immediately **after**
   the `node.key === "jobs"` badge block (which currently ends at line 579) and
   **before** the `{child.version && (` block at line 580:

   ```tsx
   {node.key === "changeNotices" && child.status && (
     <div className="ml-2">
       <ChangeNoticeStatus
         status={child.status as ChangeNoticeStatusType}
       />
     </div>
   )}
   ```

   Add the type-only import alongside the value import from step 1:

   ```ts
   import type { ChangeNoticeStatus as ChangeNoticeStatusType } from "../../types";
   ```

   (`apps/erp/app/modules/items/types.ts` is where `ChangeNoticeStatus` the
   **type** lives — this is the same pair of imports `ChangeNoticeStatus.tsx`
   itself uses at its line 2. The `as` cast is deliberate: `child.status` is a
   plain `string` on the shared node type, and `ChangeNoticeStatus` already
   returns `null` for any value not in its colour map.)

6. Also confirm the icon branch renders acceptably: `UsedInItem` picks the row
   icon at lines 541–550 by `child.methodType` / `node.module`. Change-notice
   children set neither `methodType` nor `module: "quality"`, so they fall
   through to `<MethodIcon type="Method" />`. Leave this as-is — do **not** add a
   change-notice icon branch. (Out of scope; the status badge is the
   distinguishing signal.)

7. At the end of the file (after `getUseInLink`), export the node builder so the
   four route call sites stay one line each:

   ```ts
   export function changeNoticesUsedInNode(
     changeNotices: { id: string; changeOrderId: string; status: string }[],
     name: string
   ): UsedInNode {
     return {
       key: "changeNotices",
       name,
       module: "parts",
       children: changeNotices.map((cn) => ({
         id: cn.id,
         documentId: cn.id,
         documentReadableId: cn.changeOrderId,
         status: cn.status
       }))
     };
   }
   ```

   `module: "parts"` is the change-notice permission domain, so the existing
   `permissions.can("view", node.module)` gate at line 493 applies with no new
   logic.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0. No errors mentioning UsedIn.tsx or ImpactPanel.tsx.
```

**Out of scope:** Do not touch `getPartUsedIn` or `getMaterialUsedIn` in
`items.service.ts`. Do not touch `ImpactPanel.tsx`. Do not refactor the
duplicated tree-building in the route files.

---

## Task 2: Wire the Change Notices category into the Part detail route

**Depends on:** Task 1

**Files:**
- Modify: `apps/erp/app/routes/x+/part+/$itemId.tsx` — fold the existing
  open-only change-notice query into an all-statuses one, return both, and append
  the category node at both tree-building sites.

**Steps:**

1. **Loader.** At lines 75–96 the loader destructures `openChangeNotices` from a
   `Promise.all` whose last entry is:

   ```ts
   // Locks manual version/revision creation while a CO owns this part
   findChangeNoticesForItem(client, {
     itemId,
     companyId,
     statuses: changeNoticeOpenStatuses
   })
   ```

   Rename the destructured binding to `allChangeNotices` and drop the `statuses`
   argument, so the array entry becomes:

   ```ts
   // Every CO that references this part, any status. The open subset (which
   // locks manual version/revision creation) is derived below.
   findChangeNoticesForItem(client, { itemId, companyId })
   ```

2. After the `partSummary.error` guard (i.e. after line 110, before the
   `const url = new URL(request.url);` line), add:

   ```ts
   const changeNotices = allChangeNotices.data ?? [];
   const openChangeNotices = changeNotices.filter((cn) =>
     changeNoticeOpenStatuses.includes(cn.status)
   );
   ```

3. In the returned object (lines 151–163), replace the existing
   `openChangeNotices: openChangeNotices.data ?? []` line with:

   ```ts
   changeNotices,
   openChangeNotices
   ```

   `changeNoticeOpenStatuses` is already imported in this file — do not add the
   import again. **If `changeNoticeOpenStatuses.includes(cn.status)` produces a
   TypeScript error because the const array is narrowly typed, widen the check to
   `(changeNoticeOpenStatuses as readonly string[]).includes(cn.status)`** rather
   than changing the const array in `items.models.ts`.

   `openChangeNotices` keeps its exact previous shape and meaning, so
   `useItemOpenChangeNotices` / `ItemChangeNoticeLock` / `MakeMethodTools` need no
   changes.

4. **Component.** At line 178 the component reads
   `const { usedIn, methodTree } = useLoaderData<typeof loader>();`. Change it to:

   ```ts
   const { usedIn, methodTree, changeNotices } = useLoaderData<typeof loader>();
   ```

5. **Tabbed branch.** At line 381 there is a `tree.push({ key: "inspections", … })`
   followed by `return (<UsedInTree tree={tree} … />)`. Immediately after that
   `tree.push(...)` call (i.e. after line 386), add:

   ```ts
   tree.push(changeNoticesUsedInNode(changeNotices, t`Change Notices`));
   ```

6. **Buy (no-tabs) branch.** The same structure is duplicated lower in the file:
   `tree.push({ key: "inspections", name: "Inspections", … })` ending at line 553.
   Immediately after it add — note this branch uses **plain string literals, not
   `t\`\``**, matching its neighbours:

   ```ts
   tree.push(changeNoticesUsedInNode(changeNotices, "Change Notices"));
   ```

7. Add `changeNoticesUsedInNode` to the existing import from
   `~/modules/items/ui/Item/UsedIn` in this file (the file already imports
   `UsedInSkeleton, UsedInTree` from that path).

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0. No errors mentioning x+/part+/$itemId.tsx.
```

**Out of scope:** Do not touch `apps/erp/app/routes/x+/part+/$itemId.details.tsx`
— its separate `getItemChangeNoticeData` call, the `ItemOpenChangeNoticeAlert`
banner, and the `ItemChangeNotices` history card all stay exactly as they are.
Do not deduplicate the two tree-building branches.

---

## Task 3: Wire the Change Notices category into the Tool detail route

**Depends on:** Task 1

**Files:**
- Modify: `apps/erp/app/routes/x+/tool+/$itemId.tsx` — identical treatment to
  Task 2.
- Copy from (precedent): the finished `apps/erp/app/routes/x+/part+/$itemId.tsx`
  from Task 2 (this route is a near-verbatim clone of it).

**Steps:**

1. **Loader.** At lines 70–91 the `Promise.all`'s last entry is the same
   `findChangeNoticesForItem(client, { itemId, companyId, statuses:
   changeNoticeOpenStatuses })` call, destructured as `openChangeNotices` at line
   77. Apply the identical change as Task 2 step 1: rename the binding to
   `allChangeNotices` and drop the `statuses` argument.

2. After the `toolSummary.error` guard (after line 101, before `const url = new
   URL(request.url);` at line 103), add:

   ```ts
   const changeNotices = allChangeNotices.data ?? [];
   const openChangeNotices = changeNotices.filter((cn) =>
     changeNoticeOpenStatuses.includes(cn.status)
   );
   ```

3. In the returned object (lines 135–147), replace
   `openChangeNotices: openChangeNotices.data ?? []` (line 146) with:

   ```ts
   changeNotices,
   openChangeNotices
   ```

4. **Component.** Find the `useLoaderData<typeof loader>()` destructure in the
   default-exported component and add `changeNotices` to it.

5. **Tabbed branch.** The tree is built at line 263 (`const tree: UsedInNode[] =
   [`) and there is a `tree.push({ key: "inspections", … })` at line 356 followed
   by `<UsedInTree` at line 363. Insert after that `tree.push(...)` closes:

   ```ts
   tree.push(changeNoticesUsedInNode(changeNotices, t`Change Notices`));
   ```

6. **Buy (no-tabs) branch.** Second tree at line 419, second `key: "inspections"`
   push at line 512, `<UsedInTree` at line 519. Insert after that `tree.push(...)`
   closes. **Check whether this branch uses `t\`Inspections\`` or the plain string
   `"Inspections"`** and match it exactly — use `t\`Change Notices\`` if the
   neighbour is translated, `"Change Notices"` if it is a bare literal.

7. Add `changeNoticesUsedInNode` to the existing import from
   `~/modules/items/ui/Item/UsedIn` (line 47 already imports `UsedInSkeleton,
   UsedInTree`).

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0. No errors mentioning x+/tool+/$itemId.tsx.
```

**Out of scope:** `apps/erp/app/routes/x+/tool+/$itemId.details.tsx`. Do not
touch the material, consumable, or service routes — they use `getMaterialUsedIn`
and are deliberately excluded (change notices cannot target those item types).

---

## Task 4: Widen `IssueAssociationNode` with a read-only, non-junction key

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/modules/quality/types.ts` — widen `key`, add `readOnly`,
  add `status` to children.

**Steps:**

1. Change the `IssueAssociationNode` type (lines 44–70) as follows. Only the
   `key` line, the new `readOnly` line, and the new `status` child field change —
   everything else stays byte-identical:

   ```ts
   export type IssueAssociationNode = {
     key: IssueAssociationKey | "changeNotices";
     name: string;
     pluralName: string;
     module: string;
     readOnly?: boolean;
     children: {
       id: string;
       documentId: string;
       documentReadableId: string;
       documentLineId: string;
       type: string;
       quantity?: number;
       disposition?: string | null;
       status?: string;
       links?: {
         // …unchanged
       }[];
     }[];
   };
   ```

2. Leave `IssueAssociationKey` (lines 41–42) **unchanged**. It must stay derived
   from `nonConformanceAssociationType`, which is the contract for the 10 real
   junction tables and drives the `switch` statements in
   `apps/erp/app/routes/x+/issue+/$id.association.new.tsx` and
   `$id.association.delete.$type.$associationId.tsx`. A change notice is a
   reverse foreign key on `changeOrder.nonConformanceId`, not a junction row.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: type errors ONLY in apps/erp/app/modules/quality/ui/Issue/IssueAssociations.tsx,
# where node.key (now widened) is passed to getAssociationIcon / getAssociationLink /
# NewAssociationModal, which all still expect IssueAssociationKey. Task 5 fixes these.
# If errors appear in any OTHER file, STOP and report — do not improvise.
```

**Out of scope:** Do not add `"changeNotices"` to `nonConformanceAssociationType`
in `quality.models.ts`. Do not create any `nonConformanceChangeOrder` table.

---

## Task 5: Support read-only categories in `IssueAssociations.tsx`

**Depends on:** Task 4

**Files:**
- Modify: `apps/erp/app/modules/quality/ui/Issue/IssueAssociations.tsx`
- Copy from (precedent): the existing `node.key === "items"` inline `<Count>`
  render at lines 252–254 (same slot, same pattern), and the
  `ChangeNoticeStatus` usage at
  `apps/erp/app/modules/quality/ui/Issue/IssueProperties.tsx:572`.

**Steps:**

1. Add imports. `ChangeNoticeStatus` is already imported into the quality module
   elsewhere the same way — use the identical specifier:

   ```ts
   import type { ChangeNoticeStatus as ChangeNoticeStatusType } from "~/modules/items";
   import { ChangeNoticeStatus } from "~/modules/items/ui/ChangeNotice";
   ```

   Add `LuGitPullRequestArrow` to the existing `react-icons/lu` import list.

2. **Widen the two helper signatures.** Change `getAssociationIcon` (line 299)
   and `getAssociationLink` (lines 1043–1046) to take the widened key:

   ```ts
   function getAssociationIcon(key: IssueAssociationNode["key"]) {
   ```

   ```ts
   function getAssociationLink(
     child: IssueAssociationNode["children"][number],
     key: IssueAssociationNode["key"]
   ) {
   ```

3. Add a case to `getAssociationIcon`, immediately after the `"inspections"` case
   at line 319–320:

   ```tsx
   case "changeNotices":
     return <LuGitPullRequestArrow className="text-purple-600" />;
   ```

4. Add a case to `getAssociationLink`, immediately after the `"inspections"` case
   at lines 1071–1072:

   ```ts
   case "changeNotices":
     return path.to.changeNotice(child.documentId);
   ```

5. **Hide the `+` button for read-only nodes.** In `IssueAssociationItem`, change
   the condition at line 211 from:

   ```tsx
   {permissions.can("create", node.module) && (
   ```

   to:

   ```tsx
   {!node.readOnly && permissions.can("create", node.module) && (
   ```

6. **Hide the per-row delete menu for read-only nodes.** Change the condition at
   line 257 from:

   ```tsx
   {permissions.can("delete", node.module) && (
   ```

   to:

   ```tsx
   {!node.readOnly && permissions.can("delete", node.module) && (
   ```

7. **Guard the new-association modal.** The modal at lines 286–294 passes
   `type={node.key}`, which no longer type-checks against the widened key. Change
   the guard at line 286 from:

   ```tsx
   {newAssociationModal.isOpen && (
   ```

   to:

   ```tsx
   {newAssociationModal.isOpen && node.key !== "changeNotices" && (
   ```

   This narrows `node.key` back to `IssueAssociationKey` inside the block, so
   `type={node.key}` compiles with no cast. (It is also unreachable — step 5 means
   the modal can never be opened for a read-only node — but the narrowing is what
   makes it type-safe.)

8. **Render the status badge.** In the child row, add a branch alongside the
   existing `node.key === "items"` `<Count>` at lines 252–254. Replace that block
   with:

   ```tsx
   {node.key === "items" && <Count count={child.quantity ?? 0} />}
   {node.key === "changeNotices" && child.status && (
     <ChangeNoticeStatus status={child.status as ChangeNoticeStatusType} />
   )}
   ```

9. Leave `IssueAssociationsTree`'s `trackedEntities` filter (lines 121–130)
   untouched — change notices must not be filtered out when empty. The empty
   state ("No change notice found" at lines 227–233) renders for them like every
   other category.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0. The errors Task 4's verify predicted are gone and no new ones appear.
```

**Out of scope:** Do not add a `NewChangeNoticeAssociation` form component. Do
not touch `NewAssociationModal` itself, `$id.association.new.tsx`, or
`$id.association.delete.$type.$associationId.tsx`.

---

## Task 6: Wire the Change Notices category into the Issue detail route

**Depends on:** Tasks 4 and 5

**Files:**
- Modify: `apps/erp/app/routes/x+/issue+/$id.tsx` — add one node to the hardcoded
  sidebar tree.

**Steps:**

1. The loader already fetches this data — `getChangeNoticesForNonConformance` at
   line 70, returned as `changeNotices: changeNotices.data ?? []` at line 88.
   **Make no loader change.**

2. In the component, line 94 currently reads:

   ```ts
   const { associations } = useLoaderData<typeof loader>();
   ```

   Change it to:

   ```ts
   const { associations, changeNotices } = useLoaderData<typeof loader>();
   ```

3. In the `tree` array (lines 110–182), append one node after the existing
   `inspections` node (which ends at line 181, before the closing `];` at line
   182). Add a comma after the `inspections` node's closing brace, then:

   ```ts
   {
     key: "changeNotices",
     name: t`Change Notice`,
     pluralName: t`Change Notices`,
     module: "parts",
     readOnly: true,
     children: changeNotices.map((cn) => ({
       id: cn.id,
       documentId: cn.id,
       documentReadableId: cn.changeOrderId,
       documentLineId: "",
       type: "changeNotices",
       status: cn.status
     }))
   }
   ```

   `documentLineId` and `type` are required on the child type but unused for this
   category: `getAssociationLink`'s `changeNotices` case reads only `documentId`,
   and `type` is only read by the delete `ConfirmDelete` path, which read-only
   nodes never reach.

   `module: "parts"` gates the whole category behind the change-notice permission
   domain via the existing `permissions.can("view", node.module)` check — a user
   without `parts` view sees no category at all, matching every other category in
   this tree.

4. `IssueAssociationsTree` sorts by `name`, so "Change Notice" lands between
   "Customer" and "Inspection". No ordering work needed.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0. No errors mentioning x+/issue+/$id.tsx.
```

**Out of scope:** Do not change the loader. Do not remove the "Create Change
Notice" item from the `IssueHeader` ⋮ menu
(`apps/erp/app/modules/quality/ui/Issue/IssueHeader.tsx:75-89`) — that stays as
the way to create one from an issue.

---

## Task 7: Remove the Change Notices block from `IssueProperties.tsx`

**Depends on:** none (independent of Tasks 1–6)

**Files:**
- Modify: `apps/erp/app/modules/quality/ui/Issue/IssueProperties.tsx`

**Steps:**

1. Delete the entire block at lines 557–577 — the
   `{changeNotices.length > 0 && ( … )}` expression ending just before the
   closing `</VStack>` at line 578.

2. Delete line 69: `const changeNotices = routeData?.changeNotices ?? [];`

3. Delete the `changeNotices` field from the `useRouteData` generic (lines
   61–66), i.e. remove:

   ```ts
   changeNotices: {
     id: string;
     changeOrderId: string;
     name: string;
     status: ChangeNoticeStatusType;
   }[];
   ```

4. Delete the two now-unused imports at lines 32–33:

   ```ts
   import type { ChangeNoticeStatus as ChangeNoticeStatusType } from "~/modules/items";
   import { ChangeNoticeStatus } from "~/modules/items/ui/ChangeNotice";
   ```

5. Check whether `Link` (from `react-router`) and `path` (from `~/utils/path`,
   line 36) are still used elsewhere in the file. **They almost certainly are** —
   `path.to.issue(id)` is used at line 67. Only remove an import if Biome flags it
   as unused in Task 8; do not remove `path`.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0. No "declared but never used" errors in IssueProperties.tsx.
```

**Out of scope:** Do not touch any other block in this properties panel
(assignee, priority, source, tags, custom fields).

---

## Task 8: Full verification pass

**Depends on:** Tasks 1–7

**Files:** none modified (unless a check fails).

**Steps:**

1. Typecheck the ERP app. Note the package is named `erp`, **not** `@carbon/erp`
   — a wrong filter silently no-ops and gives a false pass:

   ```bash
   pnpm exec turbo run typecheck --filter=erp
   ```

2. Lint. Biome is its own CI gate. This repo has roughly 419 pre-existing
   warnings — fix only **error**-severity findings introduced by this change and
   leave the pre-existing warnings alone:

   ```bash
   pnpm exec biome check apps/erp/app/modules/items/ui/Item/UsedIn.tsx apps/erp/app/routes/x+/part+/\$itemId.tsx apps/erp/app/routes/x+/tool+/\$itemId.tsx apps/erp/app/modules/quality/types.ts apps/erp/app/modules/quality/ui/Issue/IssueAssociations.tsx apps/erp/app/routes/x+/issue+/\$id.tsx apps/erp/app/modules/quality/ui/Issue/IssueProperties.tsx
   ```

3. Run the unit tests:

   ```bash
   pnpm run test
   ```

4. Report the actual output of each command. If any command fails, report the
   failure verbatim — do not claim the task is complete.

**Verify:**

```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run test
# Expected: typecheck exits 0; test suite reports 0 failures.
```

**Out of scope:** Do **not** run `pnpm lingui:extract` or `pnpm translate`. On
this branch the extractor rewrites roughly 120k lines of unrelated `.po` churn,
which would bury the real diff. New `t\`Change Notices\`` strings will be picked
up by the next intentional extract run.

---

## Manual acceptance checks (after Task 8, requires a running app)

These map 1:1 to the spec's acceptance criteria and need a browser. Ask the user
before starting the dev server.

1. Part with an open change notice → Used In tab shows **Change Notices** with
   count 1, the readable id (e.g. `CN-000004`), and an `Implementation` badge;
   clicking navigates to `/x/items/change-notice/{id}`.
2. Part whose only change notice is `Done` → still listed, `Done` badge, **and**
   the Details-tab warning banner is absent and the `+` new-revision button is
   **not** locked.
3. Part with a `Cancelled` change notice → listed with a `Cancelled` badge.
4. Part with none → header row, no count, "No change notices found" when expanded.
5. A **Buy** part (no Manufacturing/Used In tabs) → category present.
6. Tool detail page → checks 1–4 behave identically.
7. Issue with a linked change notice → left sidebar shows **Change Notices**
   with the id + status badge, and the right properties panel no longer shows a
   Change Notices block.
8. The Change Notices sidebar row has **no** `+` button and its rows have **no**
   delete option, while Items / Job Operations still have both.
9. A change notice's own **Impact** panel is unchanged — no Change Notices
   category inside it.
