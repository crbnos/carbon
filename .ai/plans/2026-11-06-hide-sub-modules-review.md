# Thermo-nuclear review: hide sub-modules

**Target:** the uncommitted working tree on `feat/hide-sub-modules`, against `origin/main`.
**Out of scope:** the generated files `packages/database/src/types.ts` and `swagger-docs-schema.ts`.
**Rounds:** 2. Round 1 found 3 blockers. Round 2 re-read the changed code and re-ran the checks.

## Blockers

All 3 are fixed in the working tree. Nothing has a commit SHA, because the user's standing rule forbids commits without a request.

| # | File | Problem | Fix | Status |
|---|---|---|---|---|
| B1 | `packages/react/src/NavRail.tsx` | The sticky footer used `bg-background`. A color theme makes the rail transparent (`theme-colors.ts:328`), so the footer would paint a solid patch on the frame. | Only the list scrolls now. The footer sits under it and needs no background. | Fixed. `real-theme.png` shows no patch. |
| B2 | `apps/erp/app/hooks/useModules.tsx` | `useModules` called `useModuleSubmodules`. That made an import cycle through the `~/hooks` barrel. It also ran 15 hooks for consumers that never read `to`, such as `ShortcutHelp`. | Added `useModuleLinks` outside the barrel. The rail, the phone menu and Home read it. `useModules` is a plain list again. | Fixed. |
| B3 | `apps/erp/app/components/Layout/Topbar/Search.tsx` | `useNavigationItems` kept a second map of module to sub-module hooks, beside `useModuleSubmodules`. | Search reads `useModuleSubmodules`. This removes 15 imports and 15 hook calls. | Fixed. See the behavior note below. |

A browser test also found a bug that the first draft missed. A module row with an open tree is tall, so `closestCenter` compared the wrong centers and the row did not reorder. `moduleUnderPointer` in `PrimaryNavigation.tsx` now follows the pointer, with `closestCenter` as the fallback. Mouse and keyboard reordering both pass.

**Behavior note for B3:** Search rows for Documents now show their own icon, like every other module. Before this change they showed the module icon.

## Code-judo / simplification

Applied:

- `visibleGroups` and `moduleLanding` dropped their extra generics.
- `PrimaryNavigation.tsx` dropped the `NO_GROUPS` constant, because nothing memoized on it.
- `useHiddenSubmodules` and `useNavigationEditMode` dropped their `?? []` fallbacks, because `useAllModules` and the column default already supply the list.

Considered and kept:

- The `useUIStore` draft and its effect. The sidebar and the rail are in different React trees, and the effect syncs to an external store. Removing it removes the approved live preview.

## Performance

| Measure | Result |
|---|---|
| `useModuleSubmodules`, page load, dev build | 6 calls, median 0.5 ms, total 4 ms |
| `useModuleSubmodules`, one module navigation, dev build | 6 calls, median 0.3 ms, total 1.8 ms |
| New database query | None. `get_app_shell` returns 1 more field from the row it already reads. |
| `userModulePreference` rows per user | 1 row per module, 18 in the test. No list or per-row query depends on it. |

`EXPLAIN ANALYZE` at scale does not apply, because the read is still by `userId` and `companyId` on the existing index.

## Risks / questions

- **Second user:** the test used one login. `get_app_shell` for another user returned `[]`, and RLS and the row key limit each row to its owner. No second browser login ran.
- **Production build:** `react-router build` did not run. The dev server, typecheck and the ERP test suite all pass, and B2 removed the import cycle that made a build risk.
- **MES rail:** the MES rail now scrolls its list and keeps its footer in view. Before this change, the whole rail scrolled when it overflowed. At 1440x900 the MES rail overflowed by 63 px, so a list row can show cut off above the footer.
- **Accounting before cutover:** if `hasAccountingCutover` is false and Reporting is hidden, the rail opens the first sub-module left, not the activation page. The test data has a cutover, so this path did not run.
- **Deploy order:** if new app code runs before the migration, a Save fails until the migration runs. Reads still work. Old app code on the new schema is safe, because the new column has a default and `upsertModulePreferences` writes it only when the request sends it.

## Suggested improvements

Not done. Each one is small.

- `SortableNavItem.tsx`: give the arrow button a visible keyboard focus style.
- `SubmoduleTree.tsx`: the group eye shows on hover. A touch tablet in Customize has no hover, so the rows must be hidden one at a time.
- `users.models.ts`: limit the size of `hiddenSubmodules`. The list only affects its owner, but the shell loads it on every page.
- Add a browser playbook under `.ai/playbooks/` for this flow.

## Docs freshness

- `packages/database/AGENTS.md:16` names the table and stays correct.
- `docs/content` has no page about Customize, so no product page is stale.
- Added a lesson to `.ai/lessons.md` for B1 and the drag bug.
- Move the spec to `.ai/specs/implemented/` after the change merges.

## Passes run

| Pass | Evidence |
|---|---|
| 3a Assumptions | Route keys: 0 duplicates in 168 captured links, and a source scan found only Documents sharing a path, which `q` separates. All 16 sidebars use `GroupedContentSidebar` or `ContentSidebar`. |
| 3b Correctness | The 14 acceptance criteria ran in the browser, except for the second-user limit above. |
| 3c Security | `requirePermissions` gives the user client, so RLS applies. `userId` and `companyId` come from the session. `get_app_shell` stays `SECURITY INVOKER`, and the function diff is 1 changed line and 1 added line. |
| 3e Concurrency | The save is 1 upsert statement, on the existing unique key. |
| 3f Deploy | `ADD COLUMN` with a constant default does not rewrite the table. `db:check:backups` and `db:check:datasets` pass. `clobbers` reports no risks. |
| 3g Edge inputs | Keys come from code, not user text. A stale or unknown key matches nothing. |
| 3h Test realism | Reverting `submoduleKey`'s `q` part, the group removal, the empty fallback or the landing rule turns a test in `submodule-visibility.test.ts` red. |

## TLDR

- Blocker B1: footer patch on color themes. Fixed.
- Blocker B2: import cycle and extra hook calls in `useModules`. Fixed.
- Blocker B3: second sub-module map in Search. Fixed.
- Bug: reorder failed on a row with an open tree. Fixed.
- Simplification: removed extra generics, a constant and fallbacks.
- Performance: under 5 ms per page, no new query.
- Risks: second user login, production build, MES rail scrolling, Accounting before cutover, deploy order.
- Suggested: focus style, tablet group eye, list size limit, playbook.

## Verdict

**Approve with changes.** All blockers are fixed. The suggested improvements remain as follow-ups.
