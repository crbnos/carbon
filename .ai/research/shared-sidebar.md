# Shared Sidebar Research: ERP `PrimaryNavigation` vs MES `AppSidebar`

Repo root: worktree `carbon-feat-shared-sidebar` (branch `feat/shared-sidebar`, from origin/main at cad42b9499). All paths are relative to the repo root. Findings come from a read-only codebase survey; citations are file:line.

TL;DR: ERP builds its own hover-expand icon rail. MES uses the `@carbon/react` `Sidebar` primitives. No shared app-nav component exists. `@carbon/react` already peers on `react-router`, `@lingui/react` and `react-icons`, and its strings are extracted into both the erp and mes catalogs, so a shared sidebar can live there.

## 1. ERP sidebar (apps/erp)

### Files
- `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx`: the desktop icon rail, which expands on hover. Default export is `memo(PrimaryNavigation)` (:383). `getModule(link)` = `link.split("/")[2]` (:385-387).
- `apps/erp/app/components/Layout/Navigation/MobileNavigation.tsx`: below `md`, a hamburger opens a left `Drawer` (:31-129). `NavRow` is at :142-191.
- `SortableNavItem.tsx`: draggable row for Customize mode (`@dnd-kit/sortable`, :13-92).
- `HiddenModulesPopover.tsx`: the "Add module" popover. The "Add module" label is not translated (:40).
- `NavigationEditBar.tsx`: Save/Cancel bar (:11-45).
- `useNavigationEditMode.tsx`: draft, reorder and hide state. It POSTs to `/api/module-preferences` (:94-109).
- `CollapsibleSidebar.tsx`: not the primary nav. It is the module content sub-nav; its state lives in zustand `useUIStore`.

### Data
- `apps/erp/app/hooks/useModules.tsx`:
  - `useModuleDefinitions()` (:47-157): hard-coded `{key, permission|role, name (t), to, icon}`.
  - `filterByPermissions` (:32-45).
  - `PINNED_MODULES = {"settings"}` (:159).
  - `useModules()` (:161-192): sorted, then reordered and hidden by `modulePreferences`.
  - `useSettingsModule()` (:194-203).
  - `useAllModules()` (:205-227).
- `apps/erp/app/hooks/useImplementationNavItem.tsx:46-66`: the "Get Started" item, with a `tag` badge.
- Types (`apps/erp/app/types/index.ts`): `NavItem` (:64-69), `Route` with `tag?` and `isActive?` (:78-94).
- Persistence:
  - `getModulePreferences` and `upsertModulePreferences` (`apps/erp/app/modules/users/users.server.ts:882-901`), table `userModulePreference`.
  - Route: `routes/api+/module-preferences.tsx`.
  - Loaded in `x+/_layout.tsx:195`.

### Behaviour
- Hover-expand: `onMouseEnter`/`onMouseLeave` → `useDisclosure` (:133-138). Hover is ignored during edit mode and while search is open.
- Width goes from `w-14` (56px) to `w-[13rem]` (208px), with `transition-[width] duration-200` (:118-125). Content is pushed, not overlaid.
- Labels are absolutely positioned and animate opacity from 0 to 100 (:368-377).
- Edit mode forces the rail open (:112).
- Search-modal phantom-mouseenter fix (:82-96).
- Nothing is persisted: no cookie, no toggle.
- ⌘B is listed in `ShortcutHelp.tsx:62-65`, but the ERP never mounts `SidebarProvider`, so it has no binding.

### Search and shortcuts
- `NavigationSearchButton` (:262-316) is shown for employees only. It binds ⌘K (:266-269) and mounts `SearchModal` (`Topbar/Search.tsx:71`).
- `apps/erp/app/shortcuts.ts` defines `g` + letter per module (`MODULE_GO_TO`, :70-85). It is bound with `useShortcutSequence` (:62-80).
- Escape is handled by a hand-rolled keydown listener (:103-110), which goes against the rules.

### Styling
- Rail: `bg-background` (:129).
- Item: 40px square, `rounded-md`, `text-foreground/70`, hover `bg-active/60`.
- Active: `bg-active text-active-foreground dark:shadow-button-base`.
- Focus: custom `after:` blue-500 ring.
- Tag badge: a pill at `top-1 right-1`, `bg-primary`, 10px text (:362-366).
- A11y quirk: label `aria-hidden={isOpen || undefined}` looks inverted (:369).

### User and company
The ERP user menu and company switcher are in the **Topbar**, not the rail:
- `AvatarMenu.tsx:50-276`
- `Topbar/Breadcrumbs.tsx:139+` (`CompanyBreadcrumb`)
- `Topbar/CompanySwitcher.tsx` (mobile)
- `Topbar.tsx:15-62`

### Primitives
From `@carbon/react`: `cn`, `ShortcutKey`, `useDisclosure`, `useShortcutKeys`, `useShortcutSequence`, `VStack`, `Popover*`, `Button`, `Drawer*`, `IconButton`, `useRouteData`, `useOptimisticLocation`.

The ERP does not use the `Sidebar*` primitives. It also uses `@dnd-kit/*` and `@carbon/onboarding`.

## 2. MES sidebar (apps/mes)

### Files
- `apps/mes/app/components/AppSidebar.tsx` (681 lines):
  - `Sidebar collapsible="icon"`, with a className override for a `bg-background`, borderless look (:111-115).
  - Header: `TeamSwitcher` (:162-195). This is only a link to the ERP with the company logo and name; it is not actually a switcher.
  - Content: `OperationsNav` (:197-340) and `ToolsNav` (:342-378).
  - Footer: `TimeCardButton` (:127-146) and `UserNav` (:400-681).
  - `SidebarRail` (:157).
- Tool buttons that open modals: `AdjustInventory.tsx:113-121`, `EndShift.tsx:71-76`, `Suggestion.tsx:141-146`, `TimeCardButton.tsx:70-97`.

### Data
- Items are inline in `OperationsNav` (:255-293): Schedule, Assigned, Active (count), Recent, Jobs, Maintenance (count), Picking.
- Tools: Add/Remove Inventory, End Operations, Suggestion, Displays (opens in a new tab).
- All data comes from `x+/_layout` loader props.
- **No permission gating in the sidebar.** Each route is auth-only.
- Conditional parts:
  - `timeCardEnabled`
  - The console switch (`consoleEnabled && (consoleMode || canEnterConsoleMode)`)
  - The location submenu (only when there is more than one location)
  - The simplified menu when an operator is pinned in

### Behaviour (from `packages/react/src/Sidebar.tsx`)
- `SidebarProvider defaultOpen={false} touch` (mes `x+/_layout.tsx:503`). It writes the cookie `sidebar:state`, but nothing reads it back.
- ⌘B toggles (:108-114).
- Widths:
  - Expanded: 16rem.
  - Collapsed: 4rem (touch).
  - Mobile: a Drawer, 18rem.
  - MES `tailwind.css:30` sets `--sidebar-width: 240px`, but it is overridden.
- Toggle sources:
  - `SidebarTrigger` in each page header (active, operations, assigned, recent, jobs, maintenance, picking, dispatch, job, `AssemblyView`, `InspectionView`, `JobOperation`)
  - `SidebarRail`
  - ⌘B
- Tooltips on items when collapsed.
- Touch sizing:
  - Collapsed buttons are 48px.
  - Expanded rows are at least 44px.

### Styling
- Active: `bg-sidebar-accent/50 text-foreground font-medium`, which is subtle.
- Counts above 0 turn the row emerald. Counts are right-aligned and muted.
- Uppercase group labels: Operations, Inventory Adjustments, Tools.

### Shortcuts
- alt+1..7 (`apps/mes/app/shortcuts.ts:15-23`). No bare letters, because scanners type into the page.
- ⌘B.

### User menu
The footer `UserNav` contains:
- Switch Operator / Station
- Account Settings (link to the ERP)
- Company submenu
- Location submenu
- Dark Mode
- Console Mode
- About (ITAR)
- Sign Out

### Bugs spotted
- The Schedule highlight relies on `item.title === "Schedule"`, which is a translated string (:307). It breaks in any locale other than English.
- `useIsMobile` is false during SSR, so MES flashes the desktop sidebar before switching to the drawer.

## 3. Differences

| Aspect | ERP | MES |
|---|---|---|
| Impl | Hand-rolled `<nav>` | `@carbon/react` `Sidebar*` |
| Collapsed / expanded width | 56px / 208px | 64px / 256px |
| Expand trigger | Hover | Toggle (header trigger, rail, ⌘B) |
| Item size | 40px | 48px collapsed, 44px rows |
| Collapsed labels | Opacity fade on hover | Hidden, with tooltips |
| Active style | Solid `bg-active` | Subtle `bg-sidebar-accent/50` |
| Active match | Path segment [2] or `handle.module` | `pathname.includes` plus the Schedule hack |
| Badges | `bg-primary` pill at top-right | Right-aligned count, row turns emerald |
| Groups | Flat list, Settings pinned at the bottom | Labelled groups |
| Header | None | Company logo and name |
| Top | ⌘K Search, Get Started | none |
| Footer | Settings and Customize (drag-and-drop) | TimeCard and user dropdown |
| User menu / company switch | Topbar | Sidebar footer |
| Shortcuts | `g`+letter, ⌘K | alt+1..7, ⌘B |
| Mobile | Separate hamburger Drawer in the Topbar | Same `Sidebar` becomes a Drawer |
| Actions | Nav only | Modal-opening tool buttons and an external link |

## 4. ERP modules

The modules are accounting, documents, inventory, invoicing, parts (Items), people, production, purchasing, quality, resources, sales, settings (pinned), shopFloor (role employee, external link to MES), users and workflows. Each module is gated by `permissions.can("view", key)`. Commercial-licensing rule 3 says gated features stay visible in the nav.

## 5. Shared packages
- `@carbon/react`:
  - Peer dependencies: `react-router`, `@lingui/react`, `react-icons`, `framer-motion`.
  - No `@dnd-kit`. Adding it is an Ask First item.
  - No build step; each app compiles the source directly.
  - It already imports `react-router` in 9 files and `@lingui/react/macro` in 9 files.
- `lingui.config.js` extracts `packages/react/src` into both the erp and mes catalogs. `packages/onboarding` and `packages/ee` go to erp only.
- Tailwind: `packages/config/tailwind/theme.css` uses `@source "../../"`, which scans all packages.
- Components already shared between the apps:
  - `ItarDisclosure` (`packages/react/src/Acknowledge.tsx`)
  - `PrintingProvider`
  - `SHORTCUTS` and `ShortcutHelpOverlay`
- Components that are copy-pasted instead:
  - `SessionLockOverlay`
  - `Suggestion`
  - `OperationStatusIcon`
- `packages/react/src/Sidebar.tsx` exports the full shadcn-style primitive set. It is used by MES and `apps/starter`.

## 6. Layouts

### ERP: `apps/erp/app/routes/x+/_layout.tsx:483-502`
- `TooltipProvider` → `div.flex.h-screen` → `PrimaryNavigation` plus the inset content panel (`md:rounded-2xl ... shadow-md`) → `Topbar` and `main`.

### MES: `apps/mes/app/routes/x+/_layout.tsx:491-522`
- `SidebarProvider defaultOpen={false} touch` → `TooltipProvider` → `AppSidebar` plus the inset panel (no `shadow-md`).
- MES has no global topbar. Each page has a sticky header with `SidebarTrigger`.

## 7. Guidance
- `.claude/skills/carbon-design/references/shop-floor-mes.md`:
  - MES uses **no hover-reveal**, **no bare-letter shortcuts**, and touch-sized controls. This conflicts with the ERP rail.
  - Rule 9: "Where MES and ERP share a concept, share the component … MES is converging on ERP's visual language."
- `packages/react/AGENTS.md`, Ask First:
  - Barrel export changes
  - New primitive dependencies
- `packages/react/AGENTS.md`, Never:
  - `transition-all`
  - Icon-only buttons without `aria-label`
- `.claude/rules/conventions-ui.md`:
  - Shortcut constants must be named.
  - No hand-rolled keydown listeners.
  - Hit areas must be about 40px or more.
- `.claude/rules/keep-sources-in-sync.md`: shell or nav changes must update `packages/react/AGENTS.md` and the carbon-design references (page-archetypes §1/§14, shop-floor-mes).
- `.ai/lessons.md` (~1470-1490): do not add the content inset to `PrimaryNavigation`.
- No existing spec covers a shared sidebar.
