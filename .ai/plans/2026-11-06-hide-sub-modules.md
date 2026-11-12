# Hide sub-modules: implementation plan

**Spec / source:** `.ai/specs/2026-11-06-hide-sub-modules.md`
**Branch:** `feat/hide-sub-modules`
**Mode:** Autonomous. No commits, because the user's standing rule forbids them without a request.

## Progress

- [x] Task 1: Add the column and return it from `get_app_shell`
- [x] Task 2: Add the pure helpers and their tests
- [x] Task 3: Add the shared hooks and apply the landing rule
- [x] Task 4: Filter the sidebars and Search
- [x] Task 5: Save the list
- [x] Task 6: Add the tree to Customize
- [x] Task 7: Keep the rail footer in view
- [x] Task 8: Verify end to end
- [x] Task 9: Run the thermo-nuclear review and fix blockers
- [x] Task 10: Add the sub-module order

## Dependencies

Task 3 needs Tasks 1 and 2. Tasks 4 to 6 need Task 3. Task 7 is independent. Tasks 8 and 9 need all earlier tasks.

---

## Task 1: Add the column and return it from `get_app_shell`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_user-module-hidden-submodules.sql`
- Regenerate: `packages/database/src/types.ts`
- Copy from (precedent): `packages/database/supabase/migrations/20261003222137_app-shell-read.sql`

**Steps:**
1. Add the column with `ALTER TABLE`.
2. Copy `get_app_shell` from the precedent migration, the only migration that defines it.
3. Add `'hiddenSubmodules', mp."hiddenSubmodules"` to the `modulePreferences` object.
4. Run `pnpm db:migrate`.

**Verify:**
```bash
grep -n '"hiddenSubmodules"' packages/database/src/types.ts
# Expected: 3 lines, in the Row, Insert and Update types of userModulePreference.
```

**Out of scope:** RLS policies, because they do not change.

## Task 2: Add the pure helpers and their tests

**Depends on:** none
**Files:**
- Create: `apps/erp/app/utils/submodule-visibility.ts`
- Create: `apps/erp/app/utils/submodule-visibility.test.ts`

**Steps:**
1. Export `submoduleKey`, `visibleGroups` and `moduleLanding`, with the rules in the spec.
2. Import types only, so vitest does not load the module barrels.
3. Test the `q` key, group removal, the empty fallback, and the landing rule.

**Verify:**
```bash
cd apps/erp && npx vitest run app/utils/submodule-visibility.test.ts
# Expected: all tests pass.
```

**Out of scope:** React code.

## Task 3: Add the shared hooks and apply the landing rule

**Depends on:** 1, 2
**Files:**
- Create: `apps/erp/app/hooks/useModuleSubmodules.tsx`
- Modify: `apps/erp/app/hooks/useModules.tsx` — read `hiddenSubmodules`, and export `useSubmoduleLayout`
- Modify: `apps/erp/app/stores/ui.ts` — add the draft list for the preview
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — widen the `Pick` in `AppShellRows`
- Modify: `apps/erp/app/modules/users/users.service.ts` — add the column to `getModulePreferences`
- Copy from (precedent): `useNavigationItems` in `apps/erp/app/components/Layout/Topbar/Search.tsx`

**Steps:**
1. Map module keys to groups in `useModuleSubmodules`. Map `parts` to the items hook. Wrap the Documents `links` in one unnamed group.
2. Make `useSubmoduleLayout` return the draft layout if it exists. Otherwise, make it return the saved layout.
3. In `useModuleLinks`, treat `path.to.reports` as the landing route of `path.to.accounting`.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit
# Expected: no new errors.
```

**Out of scope:** The Settings module, because `PINNED_MODULES` excludes it.

## Task 4: Filter the sidebars and Search

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/components/Layout/Navigation/GroupedContentSidebar.tsx`
- Modify: `apps/erp/app/components/Layout/Navigation/ContentSidebar.tsx`
- Modify: `apps/erp/app/components/Layout/Topbar/Search.tsx`

**Steps:**
1. Render `arrangedGroups` in the panel and the sheet of `GroupedContentSidebar`.
2. Keep all routes for the title and the location match.
3. Apply the same filter to the panel and the sheet of `ContentSidebar`.
4. Leave hidden keys out of `useNavigationItems`.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit
# Expected: no new errors.
```

**Out of scope:** Saved view reordering and deletion.

## Task 5: Save the list

**Depends on:** 1
**Files:**
- Modify: `apps/erp/app/modules/users/users.models.ts` — add `modulePreferencesValidator`
- Modify: `apps/erp/app/routes/api+/module-preferences.tsx` — validate the body
- Modify: `apps/erp/app/modules/users/users.service.ts` — write the column

**Steps:**
1. Add the validator, with `hiddenSubmodules` as an optional array of strings.
2. Return status 400 if the body is not valid.
3. Write `hiddenSubmodules` only when the request sends it. An old client must not clear the list.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit
# Expected: no new errors.
```

**Out of scope:** Permissions of the route.

## Task 6: Add the tree to Customize

**Depends on:** 3, 5
**Files:**
- Create: `apps/erp/app/components/Layout/Navigation/SubmoduleTree.tsx`
- Modify: `apps/erp/app/components/Layout/Navigation/useNavigationEditMode.tsx` — keep the list in the draft
- Modify: `apps/erp/app/components/Layout/Navigation/SortableNavItem.tsx` — add the arrow, the count and the tree
- Modify: `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx` — mount the list only while editing
- Copy from (precedent): `SortableNavItem.tsx`

**Steps:**
1. Add `setSubmodulesHidden` to the edit mode, and include the list in `isDirty` and `save`.
2. Push the draft list to `useUIStore` while editing. Clear it when editing ends.
3. Render the tree inside the sortable wrapper, so that it moves with its row.
4. Disable the last eye button, with a `Tooltip` and `aria-disabled`.
5. Open the current module when Customize starts.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit
# Expected: no new errors.
```

**Out of scope:** Reordering sub-modules.

## Task 7: Keep the rail footer in view

**Depends on:** none
**Files:**
- Modify: `packages/react/src/NavRail.tsx` — make the desktop footer sticky

**Steps:**
1. Scroll only the desktop list, and keep the footer under it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/react
# Expected: the task passes.
```

**Out of scope:** The mobile drawer, which already has a fixed footer.

## Task 8: Verify end to end

**Depends on:** 1 to 7

**Steps:**
1. Run the helper tests, `tsgo`, and `pnpm exec biome check`.
2. Run `pnpm --filter @carbon/checks clobbers` for the function redefinition.
3. Walk all 14 acceptance criteria in the browser at 1440 px.
4. Check the phone sheet at 390 px and the MES rail.

**Verify:** Record each result in the final report, with screenshots under `.context/`.

## Task 9: Run the thermo-nuclear review and fix blockers

**Depends on:** 8

**Steps:**
1. Run the `thermo-nuclear-review` skill on the branch diff.
2. Write the output to `.ai/plans/2026-11-06-hide-sub-modules-review.md`.
3. Fix every Blocker. Run the review once more. Stop after 2 rounds.

**Verify:** The review file marks each Blocker as fixed, or gives the reason it is not.

## Task 10: Add the sub-module order

**Depends on:** 1 to 9
**Files:**
- Create: `packages/database/supabase/migrations/20261110045731_user-module-submodule-order.sql`
- Modify: `apps/erp/app/utils/submodule-visibility.ts` — add `submoduleLayout`, `orderedGroups` and `arrangedGroups`
- Modify: `apps/erp/app/components/Layout/Navigation/SubmoduleTree.tsx` — one drag context for each group, and a drag handle that shows on hover
- Modify: the edit mode, the save path, the sidebars and Search, to carry `submoduleOrder`

**Verify:**
```bash
cd apps/erp && npx vitest run app/utils/submodule-visibility.test.ts
# Expected: 12 tests pass.
```

