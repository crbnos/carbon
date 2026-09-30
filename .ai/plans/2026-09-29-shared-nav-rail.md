# Shared Nav Rail (ERP + MES) — implementation plan

**Spec / source:** `.ai/specs/2026-09-29-shared-nav-rail.md` (approved 2026-09-29)
**Research:** `.ai/research/shared-sidebar.md`
**Branch:** `feat/shared-sidebar` (worktree `/Users/aashu/work/carbon/carbon-feat-shared-sidebar`)

## Progress
- [x] Task 1: Create `NavRail` components in `@carbon/react` (+ tests, barrel export) — deviation: pure helpers live in `packages/react/src/utils/navRail.ts` and the test covers only them (importing `NavRail.tsx` under vitest pulls the hooks barrel → `@carbon/env`, which throws without server env; the markup render test was dropped)
- [x] Task 2: Mount `SidebarProvider` in the ERP layout
- [x] Task 3: Rebuild ERP `PrimaryNavigation` on `NavRail`
- [x] Task 4: Replace ERP mobile drawer with the shared rail drawer
- [x] Task 5: Move MES tool buttons to `NavRailButton`
- [x] Task 6: Rebuild MES `AppSidebar` on `NavRail`
- [x] Task 7: Extract Lingui strings
- [x] Task 8: Sync docs (AGENTS.md, carbon-design references)
- [ ] Task 9: End-to-end verification in the browser (ERP + MES) — PARTIAL: ERP collapsed 56px / hover 208px / leave 56px / ⌘B pin+unpin verified; OrbStack (Docker) quit mid-run, rest blocked. A "Maximum update depth exceeded" client warning appeared in the ERP log right after a `g`,`s` go-to — cause not yet determined

## Deviations
- Task 2: no inner `TooltipProvider` — `TooltipProvider` already defaults to delay 0 (`packages/react/src/Tooltip.tsx:29`), so nesting changes nothing.
- Task 3: ⌘K binding + `SearchModal` moved to a `GlobalSearch` sibling outside `NavRail` (on phones the rail is a drawer that unmounts when closed). Escape uses a new named constant `navigationEditCancelShortcut` in `apps/erp/app/shortcuts.ts`.
- Task 5: `closeOnClick` NOT set on AdjustInventory / EndShift — their modals live inside the drawer and would unmount with it (old MES did not close the drawer for these either).
- Task 6: MES rail gets `className="sticky top-0 h-svh"` — below lg the MES page scrolls as a whole and the old sidebar was `fixed`.

- Thermo-nuclear review fixes (all blockers + should-fixes applied):
  `NavRailContext`, `NavRailButton`, `closeOnClick`, `data-collapsible`, `utils/navRail.ts` + its test are gone; one `NavRailItem` (button / `asChild`) + thin `NavRailLink`;
  drawer closes on pathname change inside `NavRail`; rail owns `sticky top-0 h-svh`; MES queues + ⌥ shortcuts come from one `QUEUES` list;
  `UserNav` moved to `apps/mes/app/components/UserNav.tsx`; the 2px `group-has-[[data-collapsible=icon]]` header variant removed from 10 MES headers.

## Dependencies
- Task 1 must be done before everything else.
- Tasks 2 → 3 → 4 run in order (ERP).
- Tasks 5 → 6 run in order (MES).
- The ERP chain (2–4) and the MES chain (5–6) are independent of each other.
- Task 7 needs Tasks 3–6.
- Task 8 needs Tasks 3 and 6.
- Task 9 needs all the others.

## Stop-points
The user asked for check-ins between big steps. Stop and report after Task 1, after Task 4 (ERP done) and after Task 6 (MES done).

## Conventions (all tasks)
- Use `cn()`. Scope transitions to specific properties; never use `transition-all`.
- Every user-facing string goes through Lingui (`Trans` / `t` from `@lingui/react/macro`).
- Shortcut combos must be named constants. Never hand-roll `document.addEventListener("keydown")`.
- Never import from deep `@carbon/react/src/...` paths.
- Never name customers or sources in code or comments.

---

## Task 1: Create `NavRail` components in `@carbon/react`

**Depends on:** none

**Files:**
- Create: `packages/react/src/NavRail.tsx`
- Create: `packages/react/src/__tests__/NavRail.test.tsx`
- Modify: `packages/react/src/index.tsx`. Add the NavRail exports next to the existing `./Sidebar` import/export blocks (~:292-316 and ~:591-662).
- Precedents to copy from:
  - Markup and classes: `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx` (wrapper :118-125, nav :126-139, `NavigationIconLink` :333-381, search button :273-311).
  - Context: `packages/react/src/Sidebar.tsx` (`useSidebar`, :33-53).
  - Test style: `packages/react/src/__tests__/Number.test.tsx` (`renderToStaticMarkup`, node env).

**Steps:**

1. In `NavRail.tsx`, export the pure helpers first, so they can be tested without a DOM:
   ```ts
   export function isNavRailExpanded(s: { forceExpanded?: boolean; pinned: boolean; hovered: boolean }) {
     return Boolean(s.forceExpanded || s.pinned || s.hovered);
   }
   // Taps must not hover-expand the rail on touch tablets.
   export function shouldHoverExpand(pointerType: string) {
     return pointerType === "mouse";
   }
   ```

2. Export `navRailItemClasses`: the shared base class list for the item geometry. Copy it verbatim from `NavigationIconLink`'s `classes`, without the active/inactive lines:
   `relative text-foreground/70 hover:text-foreground`, `h-10 w-10 group-data-[state=expanded]:w-full`, `flex items-center rounded-md`, `group-data-[state=collapsed]:justify-center`, `group-data-[state=expanded]:-space-x-2`, `font-medium shrink-0 inline-flex items-center justify-center select-none`, `disabled:opacity-50`, `transition-[background-color,color,width] duration-100 ease-out`, `focus:!outline-none focus:!ring-0 active:!outline-none active:!ring-0`, the `after:` focus-ring string, and `group/item`.

   Export `navRailItemStateClasses(isActive: boolean)`, which returns:
   - active: `bg-active text-active-foreground dark:shadow-button-base`
   - inactive: `hover:bg-active/60 hover:text-active-foreground`

3. Internal pieces:
   - **`NavRailIcon({children})`**: `<span className="absolute left-2 top-2 flex size-6 items-center justify-center [&>svg]:size-4">`. A 16px icon centred in this 24px box sits exactly where the ERP's `left-3 top-3` icon sits, and the box also fits an `Avatar size="xs"`.
   - **`NavRailLabel({children})`**: copy the ERP label span (`min-w-[128px] text-sm text-left absolute left-7 group-data-[state=expanded]:left-12 opacity-0 group-data-[state=expanded]:opacity-100`) with `aria-hidden` set **only when collapsed**. Read the state from `NavRailContext` (step 4).
   - **`NavRailTag({children})`**: copy the ERP pill (`absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium leading-4 text-center tabular-nums`).
   - **`trailing` slot**: copy the ERP ⌘K hint wrapper classes (`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-100 group-data-[state=expanded]:opacity-100`).

4. Create `NavRailContext = createContext<{ expanded: boolean; inDrawer: boolean }>({ expanded: false, inDrawer: false })`.

5. **`NavRail`** props:
   `{ children: ReactNode; footer?: ReactNode; className?: string; forceExpanded?: boolean; disableHover?: boolean; drawerTitle?: ReactNode }`.

   Body:
   - `const { open, isMobile, openMobile, setOpenMobile } = useSidebar();`
   - `const [hovered, setHovered] = useState(false);`
   - When `disableHover` becomes true, `setHovered(false)`.
   - When it goes from true back to false, run `requestAnimationFrame(() => setHovered(false))` and cancel it in cleanup. This moves in the ERP's phantom-`mouseenter` fix from `PrimaryNavigation.tsx:82-96`; keep its comment.
   - `expanded = isNavRailExpanded({ forceExpanded, pinned: open, hovered })`.
   - The inner content is a `VStack spacing={1} className="flex flex-col justify-between h-full px-2"` holding two `VStack spacing={1}`: `children` on top, `footer` at the bottom (same as the ERP :144-145).
   - **Mobile** (`isMobile`): render `<Drawer open={openMobile} onOpenChange={setOpenMobile}>` → `<DrawerContent position="left" size="content" className="w-[17rem] max-w-[85vw] p-0">` → `<DrawerTitle className="px-6 py-4">{drawerTitle ?? <Trans>Navigation</Trans>}</DrawerTitle>` → `<nav data-state="expanded" className="group flex-1 overflow-y-auto py-2">`. The inner content uses context `{expanded: true, inDrawer: true}`. Copy the Drawer usage from `apps/erp/app/components/Layout/Navigation/MobileNavigation.tsx:56-72`.
   - **Desktop**: copy the ERP wrapper and nav exactly.
     - Wrapper: `h-full flex-col z-50 hidden md:flex shrink-0 w-14 data-[state=expanded]:w-[13rem] transition-[width] duration-200`, with `data-state` and `data-collapsible={open ? undefined : "icon"}`. MES page headers read `group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12`; the attribute follows the *pinned* state, not hover, so headers do not jump on hover.
     - Nav: `bg-background py-2 group z-10 h-full w-full flex flex-col justify-between hide-scrollbar overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent`, with `data-state`.
     - Handlers: `onPointerEnter={(e) => !disableHover && shouldHoverExpand(e.pointerType) && setHovered(true)}` and `onPointerLeave={(e) => shouldHoverExpand(e.pointerType) && setHovered(false)}`.
     - Context: `{expanded, inDrawer: false}`.

6. **`NavRailLink`**: a `forwardRef<HTMLAnchorElement>`.

   Props: `{ to: string; icon: ReactNode; label: ReactNode; isActive?: boolean; tag?: ReactNode; external?: boolean; onClick?: MouseEventHandler<HTMLAnchorElement>; className?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children">`.

   Render the react-router `<Link>` with:
   - `role="button"`, `aria-current={isActive ? "page" : undefined}`
   - `aria-label={typeof label === "string" ? label : undefined}`
   - `to`, `prefetch={external ? "none" : "intent"}`
   - classes `cn(navRailItemClasses, navRailItemStateClasses(isActive), className)`

   Children: `NavRailIcon`, `NavRailTag` (when `tag`), `NavRailLabel`.

   `onClick`: call the prop, then call `setOpenMobile(false)` when `isMobile`.

7. **`NavRailButton`**: a `forwardRef<HTMLButtonElement>`.

   Props: `{ icon: ReactNode; label: ReactNode; isActive?: boolean; tag?: ReactNode; trailing?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>`.

   - Render `<button type="button" aria-label={typeof label === "string" ? label : undefined} {...rest}>` with the same classes.
   - Spread `...rest` **before** `className` and `onClick` handling, so that when Radix passes `onClick` and `data-state` through `asChild` triggers, they are kept.
   - On mobile, close the drawer after `onClick` only when `closeOnClick` (default `false`) is set. MES Time Card uses it; Popover/Dropdown triggers must not close the drawer.

8. **`NavRailDivider`**: `<Separator className="my-1 mx-auto w-6 group-data-[state=expanded]:w-full transition-[width] duration-200" />`. Reuse `Separator` from `./Separator`.

9. In `index.tsx`, import and export `NavRail`, `NavRailButton`, `NavRailDivider`, `NavRailLink`, `navRailItemClasses`, `navRailItemStateClasses`, `isNavRailExpanded` and `shouldHoverExpand`.

10. Write the test `NavRail.test.tsx`:
    - `isNavRailExpanded`: covers all combinations (forceExpanded wins; pinned or hovered expand; none collapses).
    - `shouldHoverExpand`: `"mouse"` → true, `"touch"` and `"pen"` → false.
    - Render `<MemoryRouter><SidebarProvider defaultOpen={false}><NavRailLink to="/x/sales" icon={<svg/>} label="Sales" isActive tag="3" /></SidebarProvider></MemoryRouter>` with `renderToStaticMarkup`. Expect the output to contain `aria-current="page"`, `bg-active`, `>3<` and `aria-label="Sales"`.

    If `SidebarProvider`/`useIsMobile` throws under the node test environment, STOP and report. Do not add jsdom.

**Verify:**
```bash
pnpm --filter @carbon/react test -- NavRail
# Expected: NavRail.test.tsx passes, 0 failed
pnpm --filter @carbon/react typecheck
# Expected: exits 0, no errors
pnpm exec biome check packages/react/src/NavRail.tsx packages/react/src/__tests__/NavRail.test.tsx packages/react/src/index.tsx
# Expected: "Checked 3 files" with no errors
```

**Out of scope:** changing `Sidebar.tsx` primitives or `SidebarProvider`'s API; `apps/starter`.

---

## Task 2: Mount `SidebarProvider` in the ERP layout

**Depends on:** Task 1

**Files:**
- Modify: `apps/erp/app/routes/x+/_layout.tsx` (~:495-503)
- Precedent: `apps/mes/app/routes/x+/_layout.tsx:503-504`

**Steps:**

1. Replace `<div className="flex h-screen">…</div>` (which wraps `<PrimaryNavigation />` and the content panel) with:
   ```tsx
   <SidebarProvider defaultOpen={false} className="h-screen min-h-0">
     {/* SidebarProvider sets a 0ms tooltip delay; restore ERP's default for everything inside. */}
     <TooltipProvider>
       <PrimaryNavigation />
       <div className="…unchanged content panel classes…">…</div>
     </TooltipProvider>
   </SidebarProvider>
   ```
   Import `SidebarProvider` from `@carbon/react`. `TooltipProvider` renders no DOM, so the flex row is unchanged.

2. Do not add the content inset to the rail (`.ai/lessons.md` ~1470-1490).

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exits 0
```
Manual check in Task 9: the ERP shell looks identical, and ⌘B toggles the rail.

**Out of scope:** `TrainingPanel`, `AgentRoot`, `ShortcutHelp`, `TimeCardWarning` placement.

---

## Task 3: Rebuild ERP `PrimaryNavigation` on `NavRail`

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx`
- Modify: `apps/erp/app/components/Layout/Navigation/SortableNavItem.tsx`. Replace its duplicated geometry classes with `navRailItemClasses` plus its drag-specific extras.

**Steps:**

1. Keep all of the existing logic: modules, settings, implementation nav, `matchedModules`, `goToModules`/`useShortcutSequence`, `editMode`, `sensors`, `getModule` (still exported and used by `MobileNavigation`).

2. Remove:
   - `useDisclosure`
   - The wrapper `<div>` and `<nav>`
   - The hover handlers
   - The rAF effect (it now lives inside `NavRail`)
   - `NavigationIconLink`

3. Return:
   ```tsx
   <NavRail
     forceExpanded={editMode.isEditing}
     disableHover={editMode.isEditing || isSearchModalOpen}
     footer={…settings NavRailLink (not editing) + NavigationEditBar or Customize NavRailButton…}
   >
     {permissions.is("employee") && <NavigationSearchButton />}
     {!editMode.isEditing && implementationNav ? <NavRailLink … /> : null}
     {editMode.isEditing ? <DndContext…>…SortableNavItem…</DndContext> : links.map(link => <NavRailLink key={link.name} to={link.to} icon={<link.icon />} label={link.name} tag={link.tag} external={link.external} isActive={…same calc…} />)}
     {editMode.isEditing && <HiddenModulesPopover … />}
   </NavRail>
   ```

4. **Customize button**: `<NavRailButton icon={<LuSettings2 />} label={t\`Customize\`} onClick={editMode.enterEditMode} className="hover:bg-accent hover:text-accent-foreground" />`. The ERP's Customize and Search hover used `bg-accent`, not `bg-active/60`; keep that.

   Customize is hidden on mobile, as it is today. Wrap it in `useSidebar().isMobile ? null : …`.

5. **`NavigationSearchButton`**: keep `useShortcutKeys(searchShortcut)` and `<SearchModal />`, and render:
   ```tsx
   <NavRailButton icon={<LuSearch />} label={t`Search`} onClick={openSearchModal} className="hover:bg-accent hover:text-accent-foreground" trailing={<ShortcutKey shortcut={searchShortcut} variant="small" className="mx-0" />} />
   ```
   On mobile, close the drawer before `openSearchModal`. The old `MobileNavigation` did `disclosure.onClose(); openSearchModal()`, so use `closeOnClick`.

6. **Escape during edit mode**: replace the hand-rolled `document.addEventListener` effect (:103-110) with `useShortcutKeys({ shortcut: SHORTCUTS.escape ?? "escape", action: editMode.cancelEditMode, disabled: !editMode.isEditing })`.

   First check `packages/react/src/shortcuts.ts` and `packages/react/src/hooks/useShortcutKeys.ts` for the exact escape constant name and the `disabled` option. If neither an escape constant nor a disable option exists, STOP and report. Do not add a new listener.

7. **`SortableNavItem`**: import `navRailItemClasses` and use `cn(navRailItemClasses, "hover:bg-accent hover:text-accent-foreground border border-transparent", isDragging && "opacity-50 border-primary")`. Keep its custom `left-8`/`left-12` icon and label offsets (drag handle). Remove `text-foreground/70` via `cn` override only if the visual differs. Compare in Task 9.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exits 0
pnpm exec biome check apps/erp/app/components/Layout/Navigation/
# Expected: no errors
grep -n "addEventListener\|NavigationIconLink\|onMouseEnter" apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx
# Expected: no output
```

**Out of scope:** `useModules`, `useNavigationEditMode`, `HiddenModulesPopover` (its untranslated "Add module" is a separate fix), `CollapsibleSidebar`.

---

## Task 4: Replace ERP mobile drawer with the shared rail drawer

**Depends on:** Task 3

**Files:**
- Modify: `apps/erp/app/components/Layout/Navigation/MobileNavigation.tsx`. Reduce it to a trigger.
- Precedent: `packages/react/src/Sidebar.tsx:279-300` (`SidebarTrigger` calling `toggleSidebar`).

**Steps:**

1. Replace the whole component body with:
   ```tsx
   const { t } = useLingui();
   const { toggleSidebar } = useSidebar();
   return <IconButton aria-label={t`Open navigation`} icon={<LuMenu />} variant="ghost" onClick={toggleSidebar} />;
   ```
   On mobile, `toggleSidebar` flips `openMobile`, which `NavRail` renders as the drawer holding the same items as the desktop rail.

2. Delete `NavRow`, the drawer imports and the unused hooks. Update the doc comment: the drawer is now rendered by the shared `NavRail`, and this is only its trigger.

3. `Topbar.tsx:28` needs no change; it still renders `<MobileNavigation />`.

**Verify:**
```bash
pnpm --filter erp typecheck
# Expected: exits 0
pnpm exec biome check apps/erp/app/components/Layout/
# Expected: no errors
```

**🛑 Stop-point:** report to the user that the ERP side is done and ask before starting MES.

**Out of scope:** the Topbar "Sections" content sub-nav (`useUIStore.toggleSidebar`, a different sidebar).

---

## Task 5: Move MES tool buttons to `NavRailButton`

**Depends on:** Task 1

**Files:**
- Modify: `apps/mes/app/components/AdjustInventory.tsx` (:113-121)
- Modify: `apps/mes/app/components/EndShift.tsx` (:71-76)
- Modify: `apps/mes/app/components/Suggestion.tsx` (:141-146)
- Modify: `apps/mes/app/components/TimeCardButton.tsx` (all `SidebarMenuItem`/`SidebarMenuButton` usages)
- Precedent: the ERP Customize button from Task 3

**Steps:**

1. **AdjustInventory**: `<NavRailButton icon={add ? <LuGitPullRequestCreateArrow /> : <LuGitBranchPlus />} label={add ? t\`Add Inventory\` : t\`Remove Inventory\`} onClick={modal.onOpen} closeOnClick />`.

2. **EndShift**: `<NavRailButton icon={<LuCircleStop />} label={t\`End Operations\`} onClick={openModal} closeOnClick />`.

3. **Suggestion**: `<PopoverTrigger ref={popoverTriggerRef} asChild><NavRailButton icon={<LuMailbox />} label={t\`Suggestion\`} /></PopoverTrigger>`. No `closeOnClick`, because the popover anchors to the button.

4. **TimeCardButton**:
   - Remove `SidebarMenuItem` wrappers and return a fragment of rail items.
   - Clock In: `NavRailButton icon={<LuPlay />} label={t\`Clock In\`} onClick={handleClockIn} disabled={fetcher.state !== "idle"} closeOnClick`.
   - Clock Out: same with `LuSquare`, `trailing={openClockEntry && <Badge variant="red">{formatElapsed(openClockEntry.clockIn)}</Badge>}`.
   - My Hours: `NavRailLink to={path.to.timeCardPage} icon={<LuClock />} label={t\`My Hours\`} isActive={isOnTimeCardPage}`.
   - Drop the manual `isMobile && setOpenMobile(false)` calls, since `NavRailLink` and `closeOnClick` handle them.
   - Read the entire file first. If it holds rows beyond Clock In, Clock Out and My Hours, convert each the same way.

5. Remove the now-unused `SidebarMenuButton`, `SidebarMenuItem` and `useSidebar` imports.

**Verify:**
```bash
pnpm exec biome check apps/mes/app/components/AdjustInventory.tsx apps/mes/app/components/EndShift.tsx apps/mes/app/components/Suggestion.tsx apps/mes/app/components/TimeCardButton.tsx
# Expected: no errors
```
MES typecheck runs in Task 6, because `AppSidebar` still wraps these in `SidebarMenuItem` until then.

**Out of scope:** the modal and popover contents of these components.

---

## Task 6: Rebuild MES `AppSidebar` on `NavRail`

**Depends on:** Task 5

**Files:**
- Modify: `apps/mes/app/components/AppSidebar.tsx`
- Modify: `apps/mes/app/routes/x+/_layout.tsx` (:503). Change `<SidebarProvider defaultOpen={false} touch>` to `<SidebarProvider defaultOpen={false}>`.
- Precedent: the ERP `PrimaryNavigation` from Task 3

**Steps:**

1. Change the `AppSidebar` props type from `ComponentProps<typeof Sidebar> & {…}` to just the explicit `{…}` data props. Render:
   ```tsx
   <NavRail footer={<>{timeCardEnabled && <Suspense…><Await…><TimeCardButton…/></Await></Suspense>}<UserNav …/></>}>
     <OperationsNav activeEvents={activeEvents} activeMaintenanceCount={activeMaintenanceCount} />
     <NavRailDivider />
     <ToolsNav />
   </NavRail>
   ```
   Keep the existing `Suspense`/`Await` block as-is.

2. Delete `TeamSwitcher`. Grep for other importers first: `grep -rn "TeamSwitcher" apps/mes/app`. If anything else imports it, STOP and report.

3. **`OperationsNav`**:
   - Keep the shortcut map and `go()`.
   - Build `links` with `{ key, title, icon, to, count? }`, and add `match: path.to.operations.split("?")[0]` for Schedule (other items: `match = to`).
   - `isActive = pathname.startsWith(item.match)`. This removes the `item.title === "Schedule"` check, which was the translated-title bug.
   - Render `<NavRailLink key={item.key} to={item.to} icon={<item.icon />} label={item.title} isActive={isActive} tag={item.count ? String(item.count) : undefined} />`.
   - No `SidebarGroup`/`SidebarGroupLabel`, and no emerald class.

4. **`ToolsNav`**: return a fragment with `<AdjustInventory add />`, `<AdjustInventory add={false} />`, `<EndShift />`, `<Suggestion />`, `<DisplaysLink />`.

   `DisplaysLink` becomes `<NavRailLink to={path.to.displays} icon={<LuMonitorPlay />} label={t\`Displays\`} external target="_blank" rel="noreferrer" />`. Check that `NavRailLink` passes `target`/`rel` through `...rest`.

5. **`UserNav`**:
   - Keep all dropdown content unchanged.
   - Replace the trigger with `<DropdownMenuTrigger asChild><NavRailButton icon={<Avatar size="xs" src={displayAvatar ?? undefined} name={displayName} />} label={displayName} trailing={<LuChevronDown className="size-4" />} /></DropdownMenuTrigger>`.
   - Change `side={isMobile ? "bottom" : "right"}` to keep using `useSidebar().isMobile`.
   - Replace the trigger-width class on `DropdownMenuContent` with `min-w-56 rounded-lg`; the rail is only 56px when collapsed.
   - Replace the outer `SidebarMenu`/`SidebarMenuItem` wrappers with a fragment. Keep `<ItarDisclosure>`.

6. Remove unused imports (`Sidebar*`, `BsFillHexagonFill`, `ERP_URL` if now unused, `cn` if unused).

7. `SidebarTrigger` in the MES page headers needs no change: it calls `toggleSidebar`, which pins the rail on desktop and opens the drawer on mobile.

**Verify:**
```bash
pnpm --filter mes typecheck
# Expected: exits 0
pnpm exec biome check apps/mes/app/components/ apps/mes/app/routes/x+/_layout.tsx
# Expected: no errors
grep -n "SidebarMenuButton\|SidebarGroup\|TeamSwitcher\|=== \"Schedule\"" apps/mes/app/components/AppSidebar.tsx
# Expected: no output
```

**🛑 Stop-point:** report to the user that the MES side is done and ask before continuing.

**Out of scope:** MES page headers, `MES_NAV_SHORTCUTS`, the `display+` layout, and `apps/mes/app/styles/tailwind.css` `--sidebar-width`.

---

## Task 7: Extract Lingui strings

**Depends on:** Tasks 3–6

**Files:**
- Modify (generated): `packages/locale/locales/*/*.po`

**Steps:**
1. Run the extract.
2. Confirm the new and moved msgids exist in both the erp and mes catalogs: "Navigation", "Customize", "Search", "Displays" and "My Hours".
3. Leave filling non-English msgstrs to the `/translate` skill, which runs at commit time (check-and-commit). Do not hand-write translations.

**Verify:**
```bash
pnpm run lingui:extract
# Expected: completes; the summary table lists erp and mes with 0 errors
grep -c 'msgid "Navigation"' packages/locale/locales/en/mes.po
# Expected: 1 (if the catalog file names differ, `ls packages/locale/locales/en/` and use the mes catalog)
```

**Out of scope:** changing `lingui.config.js`.

---

## Task 8: Sync docs

**Depends on:** Tasks 3, 6

**Files:**
- Modify: `packages/react/AGENTS.md`. Add a one-line entry: app shells use `NavRail*` for the primary left nav; the `Sidebar*` primitives remain for other layouts.
- Modify: `.claude/skills/carbon-design/references/page-archetypes.md`:
  - §1: the rail is the shared `NavRail`, used by ERP and MES.
  - §14: below md the rail's own drawer opens from the Topbar hamburger (ERP) or the page-header trigger (MES).
- Modify: `.claude/skills/carbon-design/references/shop-floor-mes.md`:
  - The ERP/MES nav row now says both use `NavRail`.
  - The exemplar points to `apps/mes/app/components/AppSidebar.tsx` on `NavRail`.
  - The no-hover rule becomes "hover-expand is mouse-only; touch uses the pin toggle (header trigger / ⌘B)".

**Steps:**
1. Before editing, `grep -rn "PrimaryNavigation\|AppSidebar" .claude/ packages/react/AGENTS.md apps/*/AGENTS.md` and update every hit that describes the old behaviour.
2. Keep the edits to the minimum wording change.

**Verify:**
```bash
grep -rn "NavRail" packages/react/AGENTS.md .claude/skills/carbon-design/references/page-archetypes.md .claude/skills/carbon-design/references/shop-floor-mes.md
# Expected: at least one hit in each of the three files
```

**Out of scope:** the docs site (`docs/`).

---

## Task 9: End-to-end verification in the browser

**Depends on:** Tasks 1–8

**Files:** none (evidence goes to `.ai/scratch/e2e/`, which is gitignored)

**Steps:**
1. Boot the stack from the worktree: `crbn up` (both ERP and MES).
2. Log in with the `/auth` skill.
3. Walk each acceptance criterion in the spec using `agent-browser`, and take a screenshot for each:
   - ERP desktop:
     - Rail at 56px, 208px on hover.
     - Active module highlighted.
     - Get Started pill.
     - Customize → drag → Save persists after reload.
     - ⌘K opens search.
     - `g` `s` goes to Sales.
     - ⌘B pins and unpins the rail.
   - MES desktop:
     - Same widths and hover.
     - Active highlights on `/x/active`.
     - Schedule highlights on `/x/operations` after switching locale to Spanish via the ERP avatar menu → Language.
     - Pill counts; no pill at 0.
     - Header toggle and ⌘B pin the rail.
     - Alt+1 goes to Schedule.
   - MES footer:
     - Clock In, then Clock Out.
     - Avatar menu: company, location, dark mode, console mode, sign out.
   - MES tools: each modal or popover opens; Displays opens a new tab.
   - Phone width: `agent-browser set viewport 390 844` in both apps. The trigger opens the drawer, and clicking a link closes it.
   - Touch: `agent-browser set device "iPad"` (or the closest available). Tapping a MES item navigates without the rail expanding first.
4. On any error screen, use the `/error` skill and fix the cause before continuing.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/react --filter=erp --filter=mes
# Expected: 3 successful tasks, 0 failed
pnpm --filter @carbon/react test
# Expected: all tests pass
```
Every acceptance-criteria box in the spec is ticked, each with a screenshot path.

**Out of scope:** committing. The user commits only on explicit request (check-and-commit).
