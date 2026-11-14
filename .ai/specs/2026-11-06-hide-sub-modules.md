# Hide sub-modules

**Status:** Approved
**Branch:** `feat/hide-sub-modules`
**Mockup:** Option B in `/Users/aashu/conductor/workspaces/carbon/moscow/.context/hide-submodules/hide-submodules-mockup.html`

## TL;DR

- A user can hide sub-modules from the module sidebar, not only whole modules.
- The control lives in Customize. A module row in the rail opens a tree of its sub-modules.
- Each sub-module and each group has an eye button. One Save or Cancel covers all the changes.
- In Customize, a user can also drag sub-modules into their own order, inside each group.
- Hiding works like hidden modules: it applies to one user in one company.
- Hiding tidies the menu only. It does not remove access, and a direct link still opens the page.

## Problem

The sidebar of a large module has many links. Sales shows 16 and Accounting shows 16. A user who needs 4 of them must scan past the other 12 every day. Customize can hide a whole module, but it cannot hide part of one.

## Goals

- Let a user hide any sub-module or any sidebar group of a module they can see.
- Keep one place for menu changes: Customize.
- Apply the hidden list to every place that lists sub-modules: the desktop sidebar, the phone sheet and Search.

## Non-goals

- Hiding for a whole company, or a company default set by an admin.
- Reordering groups, or moving a sub-module to another group. A sub-module moves only inside its group.
- Hiding sub-modules of Settings. Settings is pinned, and a user could otherwise hide the pages that manage the company.
- Customize on phones. Phones do not offer Customize today. A list saved on desktop still applies on phones.
- MES navigation. MES does not read `userModulePreference`.
- Access control. Permissions do not change.

## Sibling

The sibling is module hiding in Customize:

| Part | File |
|---|---|
| Edit state and save | `apps/erp/app/components/Layout/Navigation/useNavigationEditMode.tsx` |
| Rail row | `apps/erp/app/components/Layout/Navigation/SortableNavItem.tsx` |
| Read and filter | `apps/erp/app/hooks/useModules.tsx` |
| Save endpoint | `apps/erp/app/routes/api+/module-preferences.tsx` |
| Storage | `userModulePreference` |

This feature copies that shape. The only deviation is D5.

## Design

### Data model

Add 1 column to the existing table:

```sql
ALTER TABLE "userModulePreference"
  ADD COLUMN "hiddenSubmodules" TEXT[] NOT NULL DEFAULT '{}';
```

- The table already has one row per user, company and module. A new table adds nothing.
- The existing RLS policies already limit each row to its owner. They do not change.
- `get_app_shell` must return the new column. Replace the function with `CREATE OR REPLACE`, and keep the rest of its body the same.
- The default keeps old rows and old company backups valid.

A second migration adds the order:

```sql
ALTER TABLE "userModulePreference"
  ADD COLUMN "submoduleOrder" TEXT[] NOT NULL DEFAULT '{}';
```

- `submoduleOrder` holds the keys of the module's sub-modules, in the user's order.
- `get_app_shell` returns it too, with the same `CREATE OR REPLACE` rule.

### Sub-module key

A sub-module has no id in code. The key is its link: `route.to`, plus `?q=${route.q}` when the route has `q`.

- Documents needs the `q` part. 4 of its 5 links differ only by `q`.
- A check of the 168 links visible to the test user found 0 duplicate keys.
- If a route path changes later, the old key matches nothing and the link shows again. The failure is safe.

### Reading the list

Add 2 hooks in `hooks/useModuleSubmodules.tsx`. `useModuleSubmodules()` returns the sidebar groups of each module, keyed by the module `key`. It calls the existing `use*Submodules` hooks. `parts` maps to `useItemsSubmodules`. `shopFloor` and `settings` have no entry. `useModuleLinks()` returns the modules with the landing rule applied. Search also reads `useModuleSubmodules`, in place of its own copy of that map.

Add 1 pure helper file for the rules below, so that unit tests can cover them:

| Helper | Rule |
|---|---|
| `submoduleKey(route)` | Returns the key described above. |
| `visibleGroups(groups, hidden)` | Removes hidden routes. Removes a group with no routes left. If no route is left in any group, returns `groups` unchanged. |
| `submoduleLayout(rows)` | Joins the hidden lists and the order lists of all module rows into one layout. `useSubmoduleLayout` returns it, or the unsaved layout while Customize is open. |
| `orderedGroups(groups, order)` | Sorts each group into the user's order. A sub-module with no saved place goes last, in code order. |
| `arrangedGroups(groups, layout)` | Applies `orderedGroups`, then `visibleGroups`. |
| `moduleLanding(to, opensOn, groups, layout)` | Returns `to`, unless the module opens on a hidden sub-module. Then returns the first sub-module still showing, in the user's order, inside the module's own URL segment. A page outside it, such as My Time (`/x/timesheet`), has no module sidebar, so it is skipped. If nothing is left inside, it returns `to`, and the hidden page opens. |

The fallback in `visibleGroups` covers a permission change. A user can lose access to the only sub-module they kept. The sidebar must not become empty.

### Where the list applies

| Place | Change |
|---|---|
| `GroupedContentSidebar` | Renders `arrangedGroups` in the panel and the sheet: the user's order, without hidden sub-modules. |
| `ContentSidebar` (Documents) | Renders the same order and filter in the panel and the sheet. |
| Phone title | Keeps reading all routes, so the app bar still names a hidden page. |
| `useModuleLinks` | Applies `moduleLanding` to `to`. The rail, the `g` shortcuts, the Home cards, and the phone menu all read it. `useModules` stays a plain list. The landing page stays in the module's own URL segment, so the rail highlight still matches on `to`. |
| Breadcrumbs | Unchanged. The module crumb always opens the module's own path, even if that sub-module is hidden. The page still opens (D6) and shows the full module sidebar, so the user can always reach every sub-module. |
| Search (`useNavigationItems`) | Leaves out hidden sub-modules, the same way it leaves out those of a hidden module. It lists the other sub-modules in the user's order. |

Records still show in Search results. Only the navigation rows go away.

9 modules open directly on a sub-module:

| Module | Opens on |
|---|---|
| Accounting | Reporting, through a redirect in `routes/x+/accounting+/_index.tsx` |
| Documents | All Documents |
| Inventory | Quantities |
| Items | Parts |
| People | Employees |
| Projects | Projects |
| Service | Jobs |
| Users | Accounts |
| Workflows | Workflows |

`moduleLanding` must treat the Accounting redirect target as its landing route. The other modules with a landing page, such as Sales, always open that page.

### Customize (Option B)

| Element | Behavior |
|---|---|
| Module row | Adds an arrow, and a count when sub-modules are hidden. A click on the row or the arrow opens or closes the tree. |
| Open state | The current module opens when Customize starts. More than one tree can stay open. |
| Tree | Shows group names and sub-module names, in sidebar order. A module with no groups, such as Documents, shows only sub-modules. |
| Sub-module row | Has an eye button that shows the state. An open eye means the row shows in the sidebar. A crossed eye means the row is hidden. A hidden row stays in place, dimmed. |
| Drag handle | Each sub-module row has a drag handle. The handle shows only while the pointer is on the row, while the handle has keyboard focus, or on a touch screen. A sub-module moves only inside its own group. |
| Module row | The eye button is an open eye, because a hidden module leaves the list. This replaces the crossed eye that the row used before. |
| Group row | Shows its eye button on hover or keyboard focus. The button hides or shows all rows in the group. If all rows are hidden, the button always shows. |
| Last sub-module | The eye button is disabled. The tooltip says "Keep one, or hide {module} itself". The group button follows the same rule. |
| Live preview | The module sidebar on screen updates as the user clicks. Save or Cancel decides the result. |
| Save and Cancel | Stay the single pair that exists today. Esc still cancels. |
| Drag to reorder | Still reorders modules. An open tree moves with its module row. |
| Shop Floor | Has no arrow, because it has no sub-modules. |

The rail must keep Save and Cancel in view. Before this change, the whole desktop rail scrolled, so an open tree pushed them out of view. `NavRail` in `packages/react` now scrolls only its list, and the footer stays under the list. MES also uses `NavRail`, so it gets the same behavior.

### Save endpoint

`/api/module-preferences` accepts `hiddenSubmodules: string[]` on each preference. The action validates the body with a zod schema in `users.models.ts`. `upsertModulePreferences` writes the column. A hidden module keeps its `hiddenSubmodules`. Its list returns when the user adds the module back.

## Design decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Who does hiding affect? | One user in one company. | The user chose parity with module hiding. |
| D2 | Where is the list stored? | A `TEXT[]` column on `userModulePreference`. | The table already has the scope and the RLS. |
| D3 | What identifies a sub-module? | Its link, with `q`. | Adding an id to about 170 routes in 16 files gives no extra benefit. |
| D4 | Does Search still list a hidden sub-module? | No. | Search already leaves out the sub-modules of a hidden module. |
| D5 | Does a hidden row leave the list in Customize? | No, it stays in place, dimmed. | This differs from hidden modules, which move to "Add module". A sub-module needs its group for context. |
| D6 | Does a page redirect when its sub-module is hidden? | No, the page opens with no sidebar highlight. | A hidden module's page already behaves this way, and links from records must keep working. |
| D7 | Can a user hide all sub-modules of a module? | No. They hide the module instead. | An empty sidebar is a dead end. |
| D8 | Are Settings sub-modules included? | No. | `PINNED_MODULES` already keeps Settings out of Customize. |
| D9 | Can a sub-module move to another group? | No. It moves only inside its group. | A group name describes its rows. A move across groups makes the heading wrong. |
| D10 | Where does a new sub-module go in a saved order? | Last in its group, in code order. | The user's order stays as they left it, and a new page is easy to find at the end. |

## Risks

| Risk | Control |
|---|---|
| `useModuleLinks` calls 15 hooks. It runs in the rail, the phone menu and Home. | Measured at under 5 ms per page in a dev build. |
| The ERP app is near the TypeScript instantiation limit. | Run `tsgo` directly after the change, not only a cached Turbo run. |
| `NavRail` is shared with MES. | Check the MES rail in the browser after the footer change. |

## Acceptance criteria

1. In Customize, the user opens Sales and hides "Return Reasons". Save is enabled. After Save, the Sales sidebar does not show "Return Reasons".
2. The Sales row in Customize shows the count 1 after step 1.
3. The user hides all 2 rows in Pricing with the group button. After Save, the "Pricing" heading is gone.
4. The user hides "Parts", then clicks Items in the rail. The Materials page opens, and Materials is highlighted.
5. The `g` shortcut for Items and the Items card on Home also open Materials.
6. The user hides "My Documents" and "All Documents" still shows. This proves that the `q` part of the key works.
7. With 1 sub-module left in Workflows, its eye button is disabled and its tooltip shows.
8. The user changes 3 rows and presses Esc. The sidebar shows the 3 rows as before, and no request saves.
9. With "Return Reasons" hidden, ⌘K does not list it. A direct link to `/x/sales/return-reasons` still opens the page.
10. A second user in the same company still sees "Return Reasons".
11. On a phone, the section sheet does not list "Return Reasons". The app bar still names the page on a direct link.
12. With 3 trees open in a short window, Save and Cancel stay in view and the rail scrolls.
13. The user reorders modules and hides a sub-module in one session. One Save keeps both changes, and hidden modules still work.
14. A user with no saved preferences sees all sub-modules.
15. In Customize, the user drags "Portals" above "Customers" and saves. After a reload, the Sales sidebar lists Portals first.
16. The drag handle of a sub-module row shows only while the pointer is on that row, or while the handle has keyboard focus.
17. The user hides "Parts" and moves "Tools" above "Materials". The Items link in the rail opens Tools.
18. A row dropped on a row of another group stays in its own group.

## Open questions

- [x] Who does hiding affect? — **Answer:** One user in one company, like module hiding. The user chose this.
- [x] Which design? — **Answer:** Option B, the tree in the rail. The user approved it from the mockup.
- [x] Do Search, Settings and phones follow module hiding? — **Answer:** Yes. The user asked for "a similar way", and the code shows how module hiding treats each one (D4, D8, Non-goals).

## Autonomous Decisions

The user turned on autonomous mode after this spec's first draft. Each item below is a call made in place of the user.

### High-stakes

- [x] Schema shape — **Autonomous:** Add `hiddenSubmodules TEXT[] NOT NULL DEFAULT '{}'` to `userModulePreference`. The options were this column, a new table, or a JSON column. Codebase precedent settles it: the table already has the scope and the RLS.
- [x] Save contract — **Autonomous:** `/api/module-preferences` gets a new optional field, and the route now validates its body with zod. An old client that omits the field keeps working, and the column default applies. Codebase precedent.
- [x] Shared `NavRail` — **Autonomous:** Scroll only the list, and keep the footer under it. The options were a sticky footer, or this change. A color theme makes the rail transparent, so a sticky footer cannot paint over a scrolling list. MES gets the same behavior. Product judgement.
- [x] Module links — **Autonomous:** Add `useModuleLinks` outside the `~/hooks` barrel, and keep `useModules` plain. The options were this, or the landing rule inside `useModules`. The second option makes an import cycle through the barrel and runs 15 hooks for consumers that never read `to`. A later consumer that links to a module must use `useModuleLinks`. Codebase precedent.

### Other

- [x] Search — **Autonomous:** Hidden sub-modules leave ⌘K navigation rows. Rung 1: the user asked for "a similar way".
- [x] Hidden row in Customize — **Autonomous:** Stay in place, dimmed (D5). Rung 5, and the user approved this look in the mockup.
- [x] Direct link to a hidden page — **Autonomous:** The page opens with no highlight (D6). Rung 2.
- [x] Hiding every sub-module — **Autonomous:** Not allowed (D7). Rung 5.
- [x] Settings — **Autonomous:** Excluded (D8). Rung 2.
- [x] Drag with an open tree — **Autonomous:** The tree moves with its row, and the drag follows the pointer. The first draft closed trees at drag start, but that moves rows under the pointer. Rung 5.
- [x] Live preview — **Autonomous:** `useUIStore` holds the draft list while Customize is open. The sidebar and the rail are in different React trees, and this store already holds shell state. Rung 2.
- [x] Commits — **Autonomous:** No commits. The user's standing rule forbids commits without a request, and autonomous mode does not override it. Rung 1.

## Research

N/A. This is an internal menu preference with no domain logic. The existing Customize feature is the precedent.

## Changelog

- 2026-11-10: Added the sub-module order. A user drags a sub-module inside its group in Customize. A second migration adds `submoduleOrder`.
- 2026-11-06: First draft.
- 2026-11-06: Autonomous mode on. Added the Autonomous Decisions section.
- 2026-11-06: The eye buttons show the state, not the action, at the user's request.
- 2026-11-06: Built the feature. Review fixes changed the rail footer, the module links and Search. Review: `.ai/plans/2026-11-06-hide-sub-modules-review.md`.
