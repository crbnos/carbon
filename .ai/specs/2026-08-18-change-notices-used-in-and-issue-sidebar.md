# Change Notices as a "where referenced" category

- **Status:** Approved (design), ready to plan
- **Date:** 2026-08-18
- **Modules:** `items` (Change Notices, Used In tree), `quality` (Issue detail)
- **Schema changes:** none
- **Research:** N/A — purely internal wiring of two existing surfaces onto two
  existing queries. No external precedent applies; both link paths, both service
  functions, and both tree components already exist.

## Summary

Today you can only find out that a part is involved in a change notice from a
warning banner on the part's **Details** tab, and only while a change notice is
still open. And on an issue, the change notices that reference it are tucked into
the bottom of the right-hand properties panel, away from every other "where is
this referenced" list.

This spec adds **Change Notices** as a first-class category in the two places
users already go to answer "where is this referenced":

1. The **Used In** tree on the Part and Tool detail pages (left explorer panel).
2. The **associations sidebar** on the Issue detail page (left explorer panel).

Both lists show every linked change notice regardless of status, with its status
badge on the row.

## Problem

The two "where is this referenced" surfaces are the Used In tree (part/tool) and
the associations sidebar (issue). Change notices are absent from both:

- **Part/Tool** — `UsedIn.tsx` has 15 categories (Issues, Jobs, Job Materials,
  Method Materials, Purchase Orders, Receipts, Quotes, Sales Orders, Shipments,
  Supplier Quotes, Inspections, …) but no Change Notices. The only change-notice
  signals are `ItemOpenChangeNoticeAlert` (open ones only, Details tab) and the
  `ItemChangeNotices` history card (Details tab, further down the page). Neither
  is visible from the Used In tab, which is where a user goes to ask this
  question.
- **Issue** — `IssueAssociationsTree` has 10 categories in the left sidebar, and
  change notices are instead rendered as the last block of `IssueProperties` on
  the bottom-right (`IssueProperties.tsx:557–577`), hidden entirely when empty.
  Same class of information, different corner of the screen.

## Goals

- A **Change Notices** category in the Part and Tool Used In tree, listing every
  change notice that references the item, each row linking to the change notice
  and showing its status.
- A **Change Notices** category in the Issue left sidebar, listing every change
  notice whose `nonConformanceId` is this issue, each row linking to the change
  notice and showing its status.
- The issue's right-panel Change Notices block is removed — the sidebar is the
  single home for it.
- No new tables, columns, migrations, or service queries.

## Non-goals

- No new way to create or link a change notice from either surface. The issue
  sidebar row is **read-only** (no `+` button, no delete) — creating a change
  notice from an issue already exists in the `IssueHeader` ⋮ menu.
- No change to `ItemOpenChangeNoticeAlert` or the `ItemChangeNotices` history
  card on the part Details tab. They serve a different purpose (an open-work
  warning and a full history card) and stay as-is.
- No Change Notices category on Material, Consumable, or Service pages — change
  notices cannot target those item types, so the list would always be empty.
- No Change Notices row in the change-notice `ImpactPanel` (it builds its own
  category list; listing change notices inside a change notice is circular).
- No schema, RLS, or permission changes.

## Design

### Data — nothing new

Both queries already exist and are already called by the routes in question.

| Surface | Query | Link path |
|---|---|---|
| Part / Tool | `findChangeNoticesForItem(client, { itemId, companyId, statuses? })` — `items.service.ts:6542` | 5 union'd paths: `changeOrderAffectedItem.itemId`, `.newItemId`, BOM components on CO-owned draft methods, `changeOrderSupersession.predecessor/successorItemId`, and the `item.changeOrderId` release back-link |
| Issue | `getChangeNoticesForNonConformance(client, nonConformanceId, companyId)` — `items.service.ts:6651` | `changeOrder.nonConformanceId` FK |

`findChangeNoticesForItem` is the module's designated single canonical query for
this (`items/AGENTS.md` — "Do not add a second query for this"). Omitting the
`statuses` argument returns every status, which is exactly the "all, with status
shown" behaviour chosen.

### Part / Tool — Used In tree

**Loader change (a query saved, not added).** `x+/part+/$itemId.tsx:91` and
`x+/tool+/$itemId.tsx` currently call `findChangeNoticesForItem` with
`statuses: changeNoticeOpenStatuses` to produce `openChangeNotices` (which feeds
`ItemChangeNoticeLock`). Change that single call to fetch **all** statuses and
return both values from one result:

```ts
const changeNotices = allChangeNotices.data ?? [];
return {
  // …
  changeNotices,
  openChangeNotices: changeNotices.filter((cn) =>
    changeNoticeOpenStatuses.includes(cn.status)
  )
};
```

`openChangeNotices` keeps its exact current meaning and shape, so
`useItemOpenChangeNotices` / `ItemChangeNoticeLock` / `MakeMethodTools` are
untouched. Net effect on the page: the same number of queries, not more.

**`UsedIn.tsx` changes** (the one shared tree component):

- Add `"changeNotices"` to the `UsedInKey` union.
- Add an optional `status?: string` to `UsedInNode["children"]`.
- Add a `changeNotices` case to `getUseInLink` returning
  `path.to.changeNotice(child.documentId ?? child.id)`.
- In `UsedInItem`, when `node.key === "changeNotices"`, render a
  `<ChangeNoticeStatus status={child.status} />` badge on the row — the same
  trailing-badge slot the `jobs` / `jobMaterials` / version badges already use.
- Export a small builder so the four route call sites stay one line each:

```ts
export function changeNoticesUsedInNode(
  changeNotices: { id: string; changeOrderId: string; status: string }[],
  name: string
): UsedInNode
// → { key: "changeNotices", name, module: "parts", children: [...] }
```

`module: "parts"` matches the change-notice permission domain, so the existing
`permissions.can("view", node.module)` gate in `UsedInItem` applies unchanged.

**Route wiring.** The Used In tree is built inline inside the route file, twice
per route (a manufactured/tabbed branch and a Buy/no-tabs branch) in both
`x+/part+/$itemId.tsx` and `x+/tool+/$itemId.tsx` — four call sites. Each appends
one node:

```tsx
tree={[...usedInNodes, changeNoticesUsedInNode(changeNotices, t`Change Notices`)]}
```

`UsedInTree` sorts categories alphabetically, so the row lands between
"Assembly Instructions" and "Inspections" on its own. Empty categories already
render a header plus a muted "No Change Notices found" line — consistent with
every other category, so no empty-state special case.

Note the change-notice list comes from the **awaited** loader value, not from the
deferred `usedIn` promise, so it renders immediately; `getPartUsedIn` and
`ImpactPanel` are not touched.

### Issue — associations sidebar

**Loader.** `x+/issue+/$id.tsx` already awaits `getChangeNoticesForNonConformance`
and returns it as `changeNotices`. No loader change.

**Type change** (`modules/quality/types.ts`):

```ts
export type IssueAssociationNode = {
  key: IssueAssociationKey | "changeNotices";
  // …
  readOnly?: boolean;
};
```

`IssueAssociationKey` stays derived from `nonConformanceAssociationType` — that
const array is the source of truth for the 10 real junction tables and drives the
`$id.association.new.tsx` / `.delete.$type.$associationId.tsx` switches. Change
notices are a **reverse FK**, not an association junction, so widening the node's
`key` at the UI layer is correct and adding a fake 11th association type is not.

**`IssueAssociations.tsx` changes:**

- `IssueAssociationItem` — when `node.readOnly`, do not render the `+` button and
  do not render the per-row delete. (Read-only was the explicit choice; the other
  ten categories keep their `+`.)
- `getAssociationIcon` — a `changeNotices` case (`LuGitPullRequestArrow`, the icon
  `ItemOpenChangeNoticeAlert` already uses for change notices).
- `getAssociationLink` — a `changeNotices` case returning
  `path.to.changeNotice(id)`.
- Row content renders `<ChangeNoticeStatus status={…} />` next to the readable id,
  mirroring what the removed right-panel block showed.

**Route wiring** (`x+/issue+/$id.tsx`, the hardcoded node list at L110–182) — one
more node, built from the already-loaded `changeNotices`:

```tsx
{
  key: "changeNotices",
  name: t`Change Notice`,
  pluralName: t`Change Notices`,
  module: "parts",
  readOnly: true,
  children: changeNotices.map((cn) => ({ id: cn.id, name: cn.changeOrderId, status: cn.status }))
}
```

`module: "parts"` gates the category behind the change-notice permission domain —
a user without `parts` view will not see the category at all, which is the
existing behaviour of every other category in this tree.

**Removal.** Delete the Change Notices block at `IssueProperties.tsx:557–577`,
along with its now-unused `changeNotices` read (L69), `ChangeNoticeStatus` /
`ChangeNoticeStatusType` imports (L32–33), and the `changeNotices` field of its
`useRouteData` generic if unused elsewhere in that file.

One behaviour change worth calling out: the old right-panel block hid itself when
empty; the sidebar category is always visible with a count of 0, like every other
sidebar category. That is the intended consistency.

## Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Show change notices of **every** status, with the status badge on each row | The user's stated ask ("not just the open ones"). Matches the existing `ItemChangeNotices` history card, which also shows `Done` rows. A user hunting for a cancelled change notice can still find it. |
| 2 | Part **and** Tool; not Material / Consumable / Service | `changeOrderAffectedItem` only ever targets Parts and Tools; the other item types would show a permanently empty category. Tool's detail page is a near-clone of Part's and would look broken without it. |
| 3 | Reuse `findChangeNoticesForItem` with no `statuses` filter; **fold** the existing open-only call into it | `items/AGENTS.md` names it the single canonical item↔CN query and forbids a second one. Deriving `openChangeNotices` by filtering keeps the page at the same query count instead of adding one. |
| 4 | Do **not** extend `getPartUsedIn` | It is a flat 15-query `.eq("itemId")` fan-out; `findChangeNoticesForItem` is a multi-step union with a different shape. Bolting it in would also push a Change Notices row into `ImpactPanel` and `getMaterialUsedIn` consumers that shouldn't have one. |
| 5 | Issue sidebar category is **read-only** (no `+`, no delete) | The user's choice. A change notice points at one issue via a nullable FK, so "add association" has no meaning here; creating one from an issue already exists in the `IssueHeader` ⋮ menu. |
| 6 | Widen `IssueAssociationNode["key"]` rather than add to `nonConformanceAssociationType` | That const array is the contract for the 10 real junction tables and drives the association create/delete route switches. A change notice is a reverse FK on `changeOrder`, not a junction row — a fake 11th type would put an undeletable, uninsertable key into both switches. |
| 7 | **Move**, not duplicate — remove the right-panel block | The user described it as moving to the sidebar. Two copies of one list on the same screen is noise. |
| 8 | `module: "parts"` on both new categories | Change-notice routes and RLS all use the `parts` permission domain. Reuses the existing per-category permission gate in both tree components with no new logic. |
| 9 | Empty categories stay visible | Both trees already render empty categories with a header and a count; special-casing this one would be the inconsistency. |
| 10 | Add `changeNoticesUsedInNode()` builder to `UsedIn.tsx` | The Used In tree is hand-built at 4 call sites (2 branches × part/tool). One exported builder keeps each site to a single line and the node shape in one place. No refactor of the existing duplication — out of scope. |

## Acceptance Criteria

**Part page**

1. Open a Part that is an affected item on a change notice in `Implementation`
   status → the Used In tab shows a **Change Notices** category with a count of 1;
   expanding it shows one row with the change notice's readable id (e.g.
   `CN-000004`) and an `Implementation` status badge.
2. Clicking that row navigates to `/x/items/change-notice/{id}`.
3. A Part whose only change notice is `Done` still shows it in the category, with
   a `Done` badge. (Before this change it appeared nowhere on the Used In tab.)
4. A Part with a `Cancelled` change notice shows it, with a `Cancelled` badge.
5. A Part with no change notices shows the **Change Notices** header row with no
   count badge and a muted "No Change Notices found" line when expanded.
6. A Part that is a BOM component on another part's change-notice-owned draft
   method appears in that part's list too (the `methodMaterial` union path is
   preserved because the same query is reused).
7. A **Buy** part (no Manufacturing/Used In tabs — the explorer is the tree)
   shows the category too.
8. The open-change-notice warning banner on the part **Details** tab and the
   `+` new-revision lock in the Revisions row behave exactly as before — a part
   whose only change notice is `Done` is **not** locked and shows **no** banner.

**Tool page**

9. Criteria 1–5 hold identically on a Tool detail page.

**Issue page**

10. Open an issue that has a change notice created from it → the left sidebar
    shows a **Change Notices** category with a count of 1; expanding it shows the
    change notice's readable id and its status badge, linking to the change
    notice.
11. That same issue's right-hand properties panel **no longer** shows a Change
    Notices block.
12. The Change Notices sidebar row has **no** `+` button and its rows have **no**
    delete action, while every other category (Items, Job Operations, …) keeps
    both.
13. An issue with no change notices shows the **Change Notices** header row with
    a count of 0.
14. A user without `parts` view permission sees no Change Notices category on the
    issue sidebar (and none in the part Used In tree).

**Regression**

15. `pnpm exec turbo run typecheck --filter=erp` passes.
16. `pnpm exec biome check` reports no new error-severity findings.
17. The change-notice `ImpactPanel` (properties panel of a change notice) is
    unchanged — no Change Notices category appears in it.
18. Material, Consumable, and Service detail pages are unchanged.

## Open Questions (resolved)

- [x] **Which change notices appear — all statuses, all-but-cancelled, or open
      only?** — **Answer:** All, with the status shown on each row. Matches the
      user's "not just the open ones" and the existing part Details history card;
      a cancelled change notice stays findable.
- [x] **Which item types get the new Used In category?** — **Answer:** Parts and
      Tools. They are the only types `changeOrderAffectedItem` targets; Materials
      / Consumables / Services would show a permanently empty category, and Tool
      pages are clones of Part pages so omitting Tools would look broken.
- [x] **Does the existing bottom-right Change Notices block on the issue page
      stay?** — **Answer:** Remove it. This is a move to the sidebar, not a
      duplication.
- [x] **Should the issue sidebar Change Notices row get a `+` button like the
      other categories?** — **Answer:** No — read-only list. Creating a change
      notice from an issue already lives in the `IssueHeader` ⋮ menu, and there
      is no "link an existing change notice" concept (the FK is one-way and
      one-to-one).

## Changelog

- **2026-08-18** — Initial spec. All four open questions resolved with the user
  before writing. No autonomous resolutions.
