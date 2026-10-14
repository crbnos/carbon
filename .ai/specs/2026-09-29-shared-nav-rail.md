# Shared Nav Rail (ERP + MES)

> Status: draft
> Author: Aashu
> Date: 2026-09-29
> Research: [.ai/research/shared-sidebar.md](../research/shared-sidebar.md)

## TLDR

The ERP and MES each build their own left sidebar, and the two look and behave differently. This spec moves the ERP's icon rail into `@carbon/react` as a set of `NavRail*` components. Both apps then render the rail from that one source. MES is rebuilt on it, so it matches the ERP: same widths, item look, active style, hover-to-expand, badges and mobile drawer. MES adds a tap/⌘B toggle for touch tablets. The ERP keeps its app-specific pieces, such as the module list, Customize, search and `g`+letter shortcuts. It passes them to the shared rail as children, so they are not baked into the package.

## Problem Statement

- ERP `PrimaryNavigation` (`apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx`):
  - A hand-rolled rail.
  - 56px collapsed and 208px when expanded on hover.
  - A solid `bg-active` active style and a `bg-primary` tag pill.
  - A separate `MobileNavigation` drawer on phones.
- MES `AppSidebar` (`apps/mes/app/components/AppSidebar.tsx`, 681 lines):
  - Built on the shadcn-style `Sidebar*` primitives.
  - 64px collapsed and 256px expanded, toggle-only.
  - A subtle `bg-sidebar-accent/50` active style.
  - Labelled groups, an emerald count highlight, a company header and a user dropdown in the footer.
- Result: moving between the two apps feels like two products. Any styling fix has to be made twice and drifts. The carbon-design rule "where MES and ERP share a concept, share the component" (`.claude/skills/carbon-design/references/shop-floor-mes.md`, rule 9) is not being followed.
- Bugs found along the way:
  - The MES "Schedule" item never highlights outside English. `AppSidebar.tsx:307` compares a translated title.
  - The ERP lists ⌘B in its shortcut help (`ShortcutHelp.tsx:62-65`), but nothing binds it, because the ERP never mounts `SidebarProvider`.
  - The ERP rail labels use an inverted `aria-hidden` (`PrimaryNavigation.tsx:293, :369`).

## Proposed Solution

### Units

1. **`packages/react/src/NavRail.tsx`** (new): the presentational rail. It is the single source of truth for look and behaviour.
   - **`NavRail`**: the container, lifted from `PrimaryNavigation`'s wrapper and `<nav>`.
     - Desktop: an animated-width wrapper (`w-14` → `w-[13rem]`, `transition-[width] duration-200`) and `bg-background`.
     - It has two slots, `children` (top list) and `footer` (bottom list).
     - It sets `data-state="expanded|collapsed"` for the item styles.
     - On mobile (`useSidebar().isMobile`), it renders the same slots inside a left `Drawer` (`w-[17rem]`, forced expanded). The drawer is driven by `openMobile`.
     - Props: `className`, `disableHover?: boolean` (used by ERP edit mode and while its search modal is open), `forceExpanded?: boolean` (ERP edit mode).
   - **`NavRailLink`**: lifted from `NavigationIconLink`. It wraps react-router `Link`.
     - Props: `to`, `icon: IconType`, `label: ReactNode`, `isActive`, `tag?: ReactNode`, `external?`, `onClick?`.
     - Same classes as the ERP today. The label's `aria-hidden` bug is fixed: labels are hidden from assistive technology only while collapsed, and the link gets `aria-label` from the label so the collapsed state stays accessible.
     - On mobile, clicking a link closes the drawer.
   - **`NavRailButton`**: same visual as `NavRailLink`, but a `<button>` that forwards its ref.
     - Used for Search, Customize, MES tools and the Time Card.
     - It can be a `DropdownMenuTrigger`/`PopoverTrigger` child via `asChild` at the call site.
     - Props: `icon`, `label`, `isActive?`, `tag?`, `trailing?: ReactNode` (for the ⌘K hint), plus button props.
   - **`NavRailDivider`**: a thin separator between item groups. It replaces MES group labels.
   - Exported from `packages/react/src/index.tsx`.
2. **Rail state: reuse `SidebarProvider` / `useSidebar`** (`packages/react/src/Sidebar.tsx`).
   - `open` means pinned-open (⌘B, the header `SidebarTrigger`).
   - `isMobile` and `openMobile` drive the drawer.
   - `NavRail` keeps a local `hovered` flag.
   - Expanded = `forceExpanded || open || hovered`.
   - Hover is tracked with `onPointerEnter`/`onPointerLeave` and only reacts when `event.pointerType === "mouse"`. Taps never trigger hover-expand; on touch, expand happens only through the toggle.
   - Both apps mount `SidebarProvider defaultOpen={false}`. The ERP gains it, which makes the ⌘B listed in its help actually work.
3. **ERP `PrimaryNavigation`** keeps its data, but renders shared parts:
   - `NavRail` → search as a `NavRailButton` (ERP-owned; ⌘K, `SearchModal`), Get Started, then modules as `NavRailLink`.
   - Footer: Settings plus Customize (`NavRailButton`).
   - Edit mode stays ERP-only: the `@dnd-kit` `SortableNavItem`, `HiddenModulesPopover` and `NavigationEditBar`. It passes `forceExpanded`/`disableHover`.
   - `SortableNavItem` reuses the shared item class string. The shared file exports a `navRailItemVariants` (cva) for this.
   - The hand-rolled Escape listener is replaced with `useShortcutKeys`.
4. **ERP mobile**:
   - `MobileNavigation`'s drawer is removed. The Topbar hamburger now calls `useSidebar().toggleSidebar()`.
   - `NavRail` shows the same items in its drawer (search, modules, settings; Customize is hidden on mobile, as it is today).
5. **MES `AppSidebar`**, rebuilt on `NavRail`:
   - Top: Schedule, Assigned, Active (`tag` = count), Recent, Jobs, Maintenance (`tag` = count), Picking.
   - Then `NavRailDivider`, then Add Inventory, Remove Inventory, End Operations, Suggestion and Displays (external).
   - Footer: Time Card (when enabled) and the user menu. The user menu is an avatar `NavRailButton` that opens the existing `UserNav` dropdown content to the right. It keeps company switch, location, dark mode, console mode, switch operator, About and Sign out.
   - The company logo/name header is removed.
   - `AdjustInventory`, `EndShift`, `Suggestion` and `TimeCardButton` swap `SidebarMenuButton` for `NavRailButton`.
   - Active match uses the path without its query string (`path.to.operations` minus `?saved=1`), which fixes the Schedule bug.
   - The MES layout drops `touch` from `SidebarProvider`, since the rail sizes itself.
   - Page-header `SidebarTrigger`s are kept. On desktop they pin the rail open or closed; on phones they open the drawer.
6. **Docs sync** (`.claude/rules/keep-sources-in-sync.md`):
   - `packages/react/AGENTS.md`: add NavRail.
   - `.claude/skills/carbon-design/references/page-archetypes.md` §1/§14: shared rail, mobile drawer.
   - `.claude/skills/carbon-design/references/shop-floor-mes.md`: the nav row and exemplar now point to `NavRail`. The no-hover rule becomes "hover-expand is mouse-only; touch uses the toggle".

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where the shared rail lives | `packages/react/src/NavRail.tsx` | `@carbon/react` already peers on `react-router`, `@lingui/react` and `react-icons`. Its source is extracted into both the erp and mes Lingui catalogs, and Tailwind scans all packages (research §5). |
| Base implementation | Lift the ERP markup and classes, not the shadcn `Sidebar` primitives | The target look *is* the ERP. Lifting its classes guarantees the match; restyling shadcn primitives would only approximate it. |
| Rail state | Reuse the `SidebarProvider` context | MES page-header `SidebarTrigger`s, ⌘B and the mobile `openMobile` already run through it. There is no second state store. |
| Expand behaviour | Hover (mouse pointers only) OR pinned toggle | User answer Q1. The pointer-type check stops taps from triggering hover-expand on tablets. |
| App-specific features | Passed as children and slots, not props-driven config | Search, Customize (`@dnd-kit`) and the MES tools/user menu stay in their apps. There are no new deps in `@carbon/react`. |
| Badges | ERP `tag` pill for MES counts, hidden at 0; emerald row highlight dropped | Matches the ERP exactly. |
| MES group labels | Replaced by one `NavRailDivider` between queues and tools | The ERP rail has no labels, and labels are invisible when collapsed anyway. |
| Keyboard shortcuts | Stay app-owned (ERP `g`+letter and ⌘K; MES alt+1..7) | MES must avoid bare letters because scanners type into the page (`apps/mes/app/shortcuts.ts`). |
| ERP mobile nav | Replaced by the shared rail's drawer | One source of truth for the item list on mobile too. The ERP drawer content is unchanged in substance. |
| Rail open-state persistence | Not persisted (unchanged; `defaultOpen={false}`) | Out of scope. The cookie is written but was never read before this change either. |
| Item size on MES | 40px (ERP size) instead of 48px touch | User asked for an exact match. 40px meets the repo's ~40px minimum hit area (`.claude/rules/conventions-ui.md`). |

## Data Model Changes

N/A. UI-only; no tables, migrations or RLS.

## API / Service Changes

N/A. There are no loader or action changes. The MES layout loader already returns every prop the rail needs.

## UI Changes

- **ERP:** no intended visual change on desktop. The only change is that ⌘B now pins the rail open. On phones the drawer is the shared one, with the same items.
- **MES:** the sidebar now looks and behaves like the ERP rail:
  - 56px icon rail that expands to 208px on mouse hover, or when pinned by ⌘B or the header trigger.
  - Solid active item and pill count badges.
  - Time Card and avatar menu at the bottom.
  - No company header.
- All new copy (`Open navigation`, avatar `aria-label`) uses Lingui. Existing translated strings are reused.

## Acceptance Criteria

- [ ] `packages/react/src/NavRail.tsx` exists and is exported. `apps/erp/.../PrimaryNavigation.tsx` and `apps/mes/.../AppSidebar.tsx` both render `NavRail`/`NavRailLink`/`NavRailButton`, and neither defines its own item class strings.
- [ ] ERP desktop:
  - The rail is 56px collapsed and 208px on mouse hover.
  - The active module has `bg-active`.
  - The Get Started pill badge still shows.
  - Customize → drag → Save still persists order.
  - ⌘K opens search.
  - `g` then `s` goes to Sales.
  - ⌘B pins the rail open, and pressing it again collapses it.
- [ ] MES desktop:
  - Same 56px/208px widths and hover expand.
  - Visiting `/x/active` highlights Active.
  - Visiting `/x/operations` highlights Schedule, also with the locale set to a non-English language.
  - With 3 active events, Active shows a "3" pill; with 0, no pill.
  - Header toggle and ⌘B pin the rail.
  - Alt+1 goes to Schedule.
- [ ] MES tablet (touch pointer):
  - Tapping an item navigates without first expanding the rail.
  - The page-header toggle expands the rail.
- [ ] MES footer:
  - The Time Card clocks in and out when enabled.
  - The avatar menu switches company and location, toggles dark mode and console mode, and signs out.
  - When an operator is pinned in, the menu shows Switch Operator and hides Sign out.
- [ ] MES tools: Add Inventory, Remove Inventory, End Operations and Suggestion each open their modal from the rail. Displays opens in a new tab.
- [ ] Phone width (<768px) in both apps:
  - The rail is hidden.
  - The trigger (ERP Topbar hamburger, MES page-header toggle) opens a left drawer with the same items.
  - Clicking a link closes it.
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/react --filter=erp --filter=mes` passes, and biome is clean.
- [ ] `packages/react/AGENTS.md` and the carbon-design references (page-archetypes, shop-floor-mes) are updated.

## Non-goals

- MES module customization (reorder/hide), per the Q3 answer.
- Adding a top bar to MES.
- Persisting the pinned state across reloads.
- Migrating `apps/starter` or other `Sidebar*` users. The shadcn primitives stay for them.

## Open Questions

- [x] How should the rail open on MES, where tablets can't hover? — **Answer:** ERP look plus a tap/⌘B toggle. Mouse hover expands, and touch uses the toggle.
- [x] Where do MES's extras go (company header, tools, Time Card, user menu)? — **Answer:** In rail slots. Queues go on top, tools go under a divider, and Time Card plus the avatar user menu go at the bottom. The company header is dropped to match the ERP.
- [x] Should Customize (drag-and-drop reorder/hide) be shared? — **Answer:** No, it stays ERP-only. The shared rail exposes slots, and `@dnd-kit` stays out of `@carbon/react`.
- [x] What happens to MES page-header sidebar toggles? — **Answer:** They are kept and wired to the rail: they pin it on desktop and open the drawer on phones.

## Risks

- `SidebarProvider` renders a wrapper div (`group/sidebar-wrapper flex min-h-svh w-full`). In the ERP layout it has to take over the `flex h-screen` div's role, or wrap it without breaking the inset content panel (`.ai/lessons.md` ~1470: do not add the inset to the rail).
- The ERP search-modal phantom-`mouseenter` fix (`PrimaryNavigation.tsx:82-96`) must survive. The ERP passes `disableHover` while the modal is open and collapses hover on close. The shared `NavRail` needs a way to clear `hovered`, exposed as a `collapseHover()` on an imperative ref or as a `hoverResetKey` prop. The plan picks one.
- Adding exports to `@carbon/react`'s barrel is an Ask First item in `packages/react/AGENTS.md`. Approving this spec covers it.

## Changelog

- 2026-09-29: Spec written after research and four resolved questions.
