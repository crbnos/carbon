# Thermo-Nuclear Review: Part Bill of Material and Bill of Process Tabs

Target: `feat/bom-bop-redesign` against `origin/main`. Round 1.

## Blockers

| # | Finding | Location | Fix | State |
|---|---|---|---|---|
| 1 | New Version redirects to Details, where the method lists no longer are | `routes/x+/items+/methods+/version.new.tsx:21`, `modules/items/ui/Methods/utils.ts:15` | Send a part to Bill of Material | Fixed |
| 2 | Details link drops `methodId`. Bill of Material, then Details, then Bill of Process loses a selected Draft version | `usePartNavigation.tsx` | Keep the method search on Details | Fixed |
| 3 | `forceMount` keeps 5 hidden `Submit` buttons. `shouldSubmitOnShortcut` then finds more than 1 active Submit, so the save shortcut does nothing with body focus. Today only 1 Submit exists (`DirectionAwareTabs.tsx:41`) | `OperationWorkspace.tsx` | Mount only the active tab, as today | Fixed |
| 4 | An opened line hides the version, its status and the release lock alert. A reader cannot tell which version is open | `MethodLineNav` | Show the lock hint and the alert. The version stays on the table | Fixed |
| 5 | A second copy of about 150 lines across the 2 tables: order, select, delete, card header, configure, row cells, row menu | `BillOfProcessTable.tsx`, `BillOfMaterialTable.tsx` | Extract `MethodTable.tsx` | Fixed |
| 6 | The non-null `methodData` is a nullable inner object, so every consumer takes `page` and `methodData` and repeats a null branch. A bad `makeMethodId` renders a blank pane | `getPartMethodPage`, all consumers | Return null from the read, redirect in the loader, flatten the page | Fixed |
| 7 | Loaders return method data to any role with `view: parts`. Only the component checks `employee` | 4 new loaders | Add `role: "employee"` in `requirePermissions`. Delete the component checks | Fixed |

## Code-judo and simplification

| # | Finding | Fix | State |
|---|---|---|---|
| 8 | 2 `new` routes hold wrapper components only to call a hook. 2 line routes repeat a `Navigate` guard | Move the guard into the workspaces | Fixed |
| 9 | `useMemo` on `item` depends on a new array each render, so it never hits | Remove the fake memos | Fixed |
| 10 | Both workspaces and both tables repeat the configurator state | One `useMethodConfigurator` hook | Fixed |
| 11 | `useWorkCenters` runs in each row | Lift it to the table | Fixed |

## Performance

- No new SQL, index or view. `getPartMethodPage` calls the same reads as the old Details and make loaders.
- The Details loader now runs 3 fewer reads: materials, operations and tags.
- Measured only on the demo seed: `bill-of-process` loads in 93 to 166 ms on a warm dev server. This is not realistic-scale evidence. See Risks.

## Risks and questions

- **Scale not measured.** No company with 100+ lines was seeded. The reads are unchanged, but the table renders every row with `Reorder.Item`.
- **Instructions autosave skips server checks.** `OperationInstructions` writes `methodOperation` from the browser, as `BillOfProcess.tsx:386` does. It has no `checkRevisionLock` and no Draft check. RLS is the only server gate. The UI hides the editor when read-only. This is existing behavior, copied. It needs its own route in a later change.
- **Casts.** `as unknown as` bridges database rows to the form types. The old routes used `@ts-expect-error` for the same gap.
- **Preview.** It always shows the Assembly view, also for a Process operation. The tab now says this. Showing the Operation view is a later change.
- **Tool page.** See the verification section.

## Assumptions audit

| Assumption | Check | Result |
|---|---|---|
| RLS scopes every read | Loaders omit `bypassRls`. `getMakeMethodById` also filters `companyId` | Holds |
| Debounced text is not lost on Next | `useDebounce(fn, 1000, true)` runs the pending call on unmount (`useDebounce.ts:26`) | Holds |
| `getRevisionLock` for a sub-assembly | The old make route also passes the root `itemId`. The server re-checks the real method in `checkRevisionLock` | Same as today |
| Change notice lock for a sub-assembly | `getChangeNoticeDraftLock` locks on `changeOrderId` alone. The list only supplies the label | Holds |
| Version links | `versions.activate` uses the referrer with `methodToReplace`. `get` uses the referrer | Holds |
| Nothing reads the Details loader's removed fields | grep for `useRouteData` on `partDetails` returns 0 hits | Holds |

## Concurrency and deploy

- No new check-then-act. `order` takes max + 1 as today, so 2 people can still get the same order.
- No schema change. Old URLs keep working through the redirect.

## Docs freshness

- `modules/items/AGENTS.md` updated.
- `docs/content` mentions Bill of Process only in change order pages and changelogs. They do not say where the part page shows it.
- `.claude/skills/carbon-design/references/page-archetypes.md` and `tables-and-lists.md` still list BoM and BoP as `SortableList`. That stays true for Tool, Service, Job and Quote.

## TLDR

- Blockers: 7 found, 7 fixed.
- Simplifications: 4 found, 4 fixed.
- Risks: scale not measured, autosave server checks, casts, Preview view.

## Verification after the fixes

| Check | Result |
|---|---|
| Scoped typecheck | Pass |
| `pnpm --filter erp exec vitest run app/modules/items` | 5 files, 95 tests pass before the refactor. See Round 2 |
| Bill of Process table on SAT-1000 | 3 rows with type, work center, labor and a Procedure badge |
| Open row 1 | URL `/bill-of-process/:id`. Explorer shows Operations, Manufacturing, Used In |
| Steps on a procedure-linked operation | 5 real procedure steps, read-only |
| Next from Steps | Next operation, `?tab=steps` kept, its 6 procedure steps show |
| Labor edit on Draft | "Operation updated". Header shows the new value |
| Save shortcut with focus in the form | Saves |
| Bill of Material table | 7 rows with quantity, unit, Method Type, First Operation |
| Line edit on Draft | "Material updated". Table shows the new value |
| Add Operation | `/new`, then the new operation opens with all tabs enabled |
| Row menu Delete | Row leaves the table |
| Active method | Add and Save disabled, no reorder handle. `/new` redirects to the table |
| Tree click on a sub-assembly | Stays on the tab, shows that method |
| Old make URL | Redirects to Bill of Material with `makeMethodId` |
| Bad `makeMethodId` | Redirects to Details |
| Buy part | No method tabs. Tab URL redirects to Details |
| New Version from Bill of Process | Lands on Bill of Material with the new Draft. It does not return to Bill of Process |
| Make tool | Keeps the old cards on Details |
| 1024 and 390 px | Layout fits. The table scrolls on a phone |

Not exercised in a browser: drag reorder, Delete Selected, Configure, Add Item save.

## Round 2

Second pass over the refactored diff. No new blocker. Remaining items are in Risks.

- `tracked-entity-readable-id` invariant fails with 25 rows. It reads seed data, and this change writes no tracked entity.

## Verdict

**Approve with changes.** Blockers are fixed. The Risks section lists what a reviewer should still look at.
