# Mobile chrome structure — implementation plan

**Spec / source:** `.ai/specs/2026-10-07-mobile-chrome-structure.md`
**Status:** approved
**Research:** `.ai/research/2026-10-07-record-header-catalogue.md`
**Branch:** `feat/mobile-redesign` (uncommitted working tree, `/Users/aashu/work/carbon/carbon-feat-mobile-redesign`). Never commit.

## Progress
- [x] Task 1: Single compact query in `@carbon/utils`
- [x] Task 2: One compact store in `@carbon/react`
- [x] Task 3: ERP callers of `useIsMobile`
- [x] Task 4: Slot primitives
- [x] Task 5: App bar actions and bottom bar on portal slots
- [x] Task 6: App bar override on a value slot; `NewRecordPage` declares Back
- [x] Task 7: Audit full-page `/new` routes
- [x] Task 8: Record tabs on value slots
- [x] Task 9: Action presentation context in `@carbon/react`
- [x] Task 10: `RecordHeader`, `RecordAction`, `RecordPhoneChrome`, `RecordHeroTarget`
- [x] Task 11: `DocumentHeader` card variant
- [x] Task 12: Migrate shell-A headers (11)
- [x] Task 13: Migrate shell-B headers (14)
- [x] Task 14: Migrate other topbar headers and company cards (4)
- [x] Task 15: Migrate card forms, actions-only pages, fixed asset (9)
- [x] Task 16: Delete leftovers; Lingui extract
- [ ] Task 17: End-to-end verification (static checks done; browser checks need the go-ahead)

## Dependencies
- Tasks 1 → 2 → 3, in order.
- Task 4 has no dependencies. Tasks 5, 6 and 8 need Task 4. Task 7 needs Task 6.
- Task 9 has no dependencies. Task 10 needs Tasks 4 and 9, and Task 11 needs Task 10.
- Tasks 12–15 need Tasks 10 and 11; they are independent of each other but share files, so run them sequentially. Task 13 needs Task 8 (the item headers' DetailsTopbar).
- Task 16 needs Tasks 12–15. Task 17 needs everything.

Commands used below (all confirmed in package.json):
- `cd apps/erp && npx tsgo --noEmit` is the erp typecheck (`typecheck` script = `react-router typegen && tsgo --noEmit`).
- `cd packages/react && npx tsgo --noEmit`, and the same in `packages/utils`.
- `pnpm exec biome check <files>` from the repo root.
- `cd <pkg> && pnpm exec vitest run <paths>`.
- `pnpm lingui:extract && pnpm lingui:clean` from the repo root.

---

## Task 1: Single compact query in `@carbon/utils`

**Depends on:** none
**Files:**
- Modify: `packages/utils/src/viewport.ts` — delete `COMPACT_MAX_WIDTH` and make `COMPACT_QUERY = "(width < 48rem)"`. Update the doc comment to "Compact means below Tailwind `md` (48rem), the same query theme.css uses."
- Modify: `packages/utils/src/viewport.test.ts` — change the `"max-width: 767px"` expectation to `"width < 48rem"`.

**Verify:**
```bash
cd packages/utils && pnpm exec vitest run src/viewport.test.ts && npx tsgo --noEmit
# Expected: tests pass, no type errors
```
**Out of scope:** the inline script's logic (it already uses `COMPACT_QUERY`).

## Task 2: One compact store in `@carbon/react`

**Depends on:** 1
**Files:**
- Modify: `packages/react/src/Compact.tsx`
- Modify: `packages/react/src/hooks/useIsMobile.ts` — turn it into a re-export: `export { useIsMobile as default } from "../Compact";`
- Modify: `apps/erp/app/root.tsx` — `<CompactProvider initialCompact=…>`. Add a comment next to `data-compact-ui=""`: "With CompactProvider below, the two halves of the compact opt-in (CSS and JS)."

**Steps:**
1. In `Compact.tsx`:
   - Drop the `enabled` field and prop. The context becomes `{ initialCompact: boolean } | null`.
   - `useCompact()` returns `context !== null && matches`, with server snapshot `context?.initialCompact ?? false`.
   - Add `export function useIsMobile(): boolean | undefined`, which uses the same `subscribe`/`getSnapshot` with server snapshot `() => context ? context.initialCompact : undefined`. Doc: "Viewport below md, regardless of the compact opt-in; `undefined` until hydrated when no CompactProvider seeds it."
   - Delete `useCompactSeed`.
2. `rg "useCompactSeed|enabled=" packages apps --glob '*.tsx'` must not show any compact-related hits.

**Verify:**
```bash
cd packages/react && npx tsgo --noEmit && pnpm exec vitest run
cd ../../apps/erp && npx tsgo --noEmit
# Expected: both typecheck clean, react tests pass
```
**Out of scope:** the MES/starter callers (their API is unchanged).

## Task 3: ERP callers of `useIsMobile`

**Depends on:** 2
**Files:**
- Modify: `apps/erp/app/components/Layout/Panels.tsx`:
  - `PanelProvider`: `useIsMobile()` becomes `useCompact()` (same value in the ERP). Keep the effect body.
  - `ResizablePanels`: delete the `isMobile` variable, the pathname collapse effect, and the whole `if (isMobile) { …Drawer… }` branch. Remove the `Drawer*` imports and `useIsMobile` if they are unused.
- Modify: `apps/erp/app/components/Layout/Navigation/CollapsibleSidebar.tsx` — `useIsMobile` becomes `useCompact`. Rename `isMobile`/`wasMobile` to `isCompact`/`wasCompact`. Keep the effect: it still restores the desktop sidebar after a phone visit.
- Modify: `apps/erp/app/components/Layout/Topbar/Breadcrumbs.tsx` — delete `const isMobile = useIsMobile()` and render `<CompanyBreadcrumb />` unconditionally. Breadcrumbs only renders inside `Topbar`, which returns null when compact (`Topbar.tsx:21-22`).

**Verify:**
```bash
rg "useIsMobile" apps/erp
# Expected: no output
cd apps/erp && npx tsgo --noEmit
```
**Out of scope:** `packages/react/src/Sidebar.tsx` and `FunnelChart.tsx` (shared, unchanged API).

## Task 4: Slot primitives

**Depends on:** none
**Files:**
- Create: `apps/erp/app/components/Layout/Mobile/slots.tsx`. Precedent: `useAppBarOverride.ts` (the stack store) and `ChromeSlots.tsx` (the portal).

**Steps:**
1. Write:
```tsx
// SPDX header (copy from a sibling file)
import { useCompact } from "@carbon/react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

/**
 * A place in the shell that pages render into. The filler's React context
 * (forms, menus, route data) is kept, since it renders through a portal.
 * Phones only: on desktop `Fill` renders nothing and the caller keeps its
 * in-place copy.
 */
export function createPortalSlot() {
  const useStore = create<{
    target: HTMLElement | null;
    count: number;
    setTarget: (el: HTMLElement | null) => void;
    add: (delta: 1 | -1) => void;
  }>()((set) => ({
    target: null,
    count: 0,
    setTarget: (target) => set((s) => (s.target === target ? s : { target })),
    add: (delta) => set((s) => ({ count: Math.max(0, s.count + delta) }))
  }));
  // Stable, so React never detaches and re-attaches the target.
  const ref = (el: HTMLElement | null) => useStore.getState().setTarget(el);

  function Target(props: ComponentProps<"div">) {
    return <div {...props} ref={ref} />;
  }
  function Fill({ children }: { children: ReactNode }) {
    const isCompact = useCompact();
    const target = useStore((s) => s.target);
    const add = useStore((s) => s.add);
    useEffect(() => {
      if (!isCompact) return;
      add(1);
      return () => add(-1);
    }, [isCompact, add]);
    return isCompact && target ? createPortal(children, target) : null;
  }
  const useFilled = () => useStore((s) => s.count > 0);
  return { Target, Fill, useFilled };
}

/**
 * Data a page hands the shell. The newest provider wins; unmounting removes
 * only its own entry. Callers memoize `value`: a new object re-provides it.
 */
export function createValueSlot<T>() {
  const useStore = create<{
    entries: { id: string; value: T }[];
    put: (id: string, value: T) => void;
    remove: (id: string) => void;
  }>()((set) => ({
    entries: [],
    put: (id, value) =>
      set((s) => ({ entries: [...s.entries.filter((e) => e.id !== id), { id, value }] })),
    remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
  }));
  function useProvide(value: T | null) {
    const id = useId();
    const put = useStore((s) => s.put);
    const remove = useStore((s) => s.remove);
    useEffect(() => {
      if (value === null) return;
      put(id, value);
      return () => remove(id);
    }, [id, value, put, remove]);
  }
  const useValue = () => useStore((s) => s.entries.at(-1)?.value ?? null);
  return { useProvide, useValue };
}
```

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit && cd ../.. && pnpm exec biome check apps/erp/app/components/Layout/Mobile/slots.tsx
# Expected: clean
```
**Out of scope:** migrating callers (Tasks 5, 6, 8, 10).

## Task 5: App bar actions and bottom bar on portal slots

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/components/Layout/Mobile/ChromeSlots.tsx`:
  - Replace the context, provider, `useChromeSlotTargets` and the BottomBar count store with `const appBarActionsSlot = createPortalSlot(); const bottomBarSlot = createPortalSlot();`.
  - `AppBarActions` keeps its dev-only 2-child warning and returns `<appBarActionsSlot.Fill>{children}</appBarActionsSlot.Fill>`.
  - `BottomBar = bottomBarSlot.Fill`; `useBottomBarActive = bottomBarSlot.useFilled`.
  - Export `AppBarActionsTarget = appBarActionsSlot.Target`.
  - `MobileBottomChrome` renders `<bottomBarSlot.Target className="empty:hidden" />`.
  - Keep `useCompactCssVar` unchanged.
- Modify: `Mobile/MobileAppBar.tsx` — replace the `ref={appBarActionsRef}` div with `<AppBarActionsTarget className={…same classes…} />`. Drop `useChromeSlotTargets`.
- Modify: `Mobile/index.ts` — remove the `ChromeSlotsProvider` export.
- Modify: `apps/erp/app/routes/x+/_layout.tsx` — delete the `<ChromeSlotsProvider>` wrapper and its import, keeping the children.

**Verify:**
```bash
rg "ChromeSlotsProvider|useChromeSlotTargets" apps/erp
# Expected: no output
cd apps/erp && npx tsgo --noEmit
```
**Out of scope:** `useCompactCssVar` (review section C).

## Task 6: App bar override on a value slot; `NewRecordPage` declares Back

**Depends on:** 4
**Files:**
- Modify: `Mobile/appBar.ts`:
  - `AppBarState.kind` becomes `"root" | "pushed" | "selection"`.
  - Add `export type AppBarOverride = Partial<AppBarState> & { trailing?: ReactNode }`.
  - Add `export function mergeAppBar(base: AppBarState, override: AppBarOverride | null): AppBarState & { trailing?: ReactNode }`, which spreads the override over the base (an override with `kind: "pushed"` and no `subtitle` clears the subtitle).
- Modify: `Mobile/useAppBarOverride.ts` — rebuild on `createValueSlot<AppBarOverride>()`. Export `useAppBarOverride = slot.useValue` and `useSetAppBarOverride = slot.useProvide`. Delete the hand-written stack.
- Modify: `Mobile/useAppBar.ts`:
  - Delete the `/new` block and the `useLocation` import.
  - Return `mergeAppBar(state, override)` with `title` (the company name on Home), `moduleTitle`, and `Sidebar` only when the merged kind is `"root"`.
- Modify: `Mobile/MobileAppBar.tsx`:
  - Read everything from `useAppBar()`, without a separate override.
  - Back renders when `kind === "pushed" && backTo`.
  - `canSwitch = kind === "root" && Sidebar`.
  - Actions are hidden when `kind === "selection"`, and the subtitle only shows when `kind === "pushed"`.
  - `trailing` renders after the actions.
- Modify: `Mobile/MobileTabBar.tsx` — replace its `useAppBarOverride()` hide rule with `useAppBar().kind !== "root"`. Read the current rule first and keep its result for every case: selection hides, pushed hides.
- Modify: `components/Table/components/Compact/CompactList.tsx` — the override becomes `{ kind: "selection", title, trailing }`.
- Modify: `routes/x+/inventory+/quantities+/$itemId.tsx` and `routes/x+/issue-workflow+/new.tsx` — the override becomes `{ kind: "pushed", title, backTo }`. Delete the copied Back Button JSX and the unused imports (`LuChevronLeft`, `Link`, `Button`).
- Modify: `components/NewRecordPage.tsx`:
  - Call `useSetAppBarOverride(useMemo(() => (listTo ? { kind: "pushed", backTo: listTo } : null), [listTo]))`, where `listTo = useBreadcrumbs().at(-1)?.to`.
  - Import `useBreadcrumbs` from `~/components/Layout/Topbar/Breadcrumbs`.
  - If `listTo === pathname`, provide null (a create page whose last crumb is itself).
- Modify: `Mobile/appBar.test.ts` — add cases for `mergeAppBar`: a pushed override over a root base gives kind pushed with the override's backTo; a selection override keeps the base title when it has none; a null override returns the base.

**Verify:**
```bash
cd apps/erp && pnpm exec vitest run app/components/Layout && npx tsgo --noEmit
rg 'endsWith\("/new"\)' app/components/Layout
# Expected: tests pass, typecheck clean, rg prints nothing
```
**Out of scope:** the breadcrumb-derived root/pushed rules in `deriveAppBar`.

## Task 7: Audit full-page `/new` routes

**Depends on:** 6
**Files:** `apps/erp/app/routes/**/*new*.tsx` (read); modify only the ones found.

**Steps:**
1. For every route file whose path ends in `new.tsx` and that has a default export rendering UI, classify it:
   - (a) It renders `NewRecordPage`: done.
   - (b) It renders a Drawer/Modal/ModalCard or a form with `type="modal"`/`"drawer"` over a parent route: the list keeps its bar, so nothing changes.
   - (c) It is a full page without `NewRecordPage`: wrap its root in `<NewRecordPage>`, or move its existing wrapper's classes into `className`, keeping desktop layout identical.
2. Write the classification to `.ai/runs/2026-10-07-new-route-audit.txt`.
3. If a (c) route's layout can't be kept identical inside `NewRecordPage`, call `useSetAppBarOverride` there directly with the same value instead.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit
# Expected: clean; audit file lists every *new*.tsx route with a class
```
**Out of scope:** changing the forms themselves.

## Task 8: Record tabs on value slots

**Depends on:** 4
**Files:**
- Modify: `components/Layout/Panels.tsx`:
  - Remove `recordTabs`/`setRecordTabs` from `PanelContextType` and its default, the `inert` prop, `CompactPanelProvider` and the `RecordTab` type.
  - Add `export const recordTabsSlot = createValueSlot<CompactTabItem[]>(); export const recordFrameSlot = createValueSlot<true>();`.
  - `CompactRecordTabs` calls `recordFrameSlot.useProvide(true)`, reads `recordTabsSlot.useValue()`, and maps each item to `{ ...item, active: panel === "content" && item.active, onClick: showContent }`.
- Modify: `components/Layout/Navigation/DetailsTopbar.tsx`:
  - Build `items: CompactTabItem[]` in a `useMemo` over `[links, location.pathname, paramString, preserveParams]`, with `active` computed as the compact branch already does.
  - Phones: `recordTabsSlot.useProvide(isCompact ? items : null)`.
  - If `recordFrameSlot.useValue()` is set, return null; otherwise render `<CompactTabRow items={items} />`.
  - Delete `linksKey` and its effect.
  - `links` is a new array on every render: memoize `items` on a key string of `name|to|count|active` joined, so the provider doesn't re-put on every render. Comment: "Keyed on what the tabs show."
- Modify: `components/Layout/index.ts` — drop the `CompactPanelProvider` export if present.
- Modify: `routes/x+/{part,material,tool,consumable,service}+/$itemId.tsx` — restore the `HEAD` component shape: inline the `*RouteBody` function back into the default export and drop `CompactPanelProvider`. Keep this branch's other changes, such as `explorerLabel`. Diff each against `git show HEAD:<path>` to confirm the only remaining delta is non-provider changes.

**Verify:**
```bash
rg "CompactPanelProvider|setRecordTabs|linksKey" apps/erp
# Expected: no output
cd apps/erp && npx tsgo --noEmit
```
**Out of scope:** the `--header-height` override in `CompactRecordTabs`.

## Task 9: Action presentation context in `@carbon/react`

**Depends on:** none
**Files:**
- Create: `packages/react/src/ActionPresentation.tsx`
- Modify: `packages/react/src/Button.tsx`, `packages/react/src/SplitButton.tsx`, `packages/react/src/index.tsx` (export `ActionPresentationProvider`).

**Steps:**
1. `ActionPresentation.tsx`:
```tsx
export type ActionPresentation =
  | { kind: "bar"; emphasis: "primary" | "secondary" }
  | { kind: "row"; onSelect: () => void };
const Context = createContext<ActionPresentation | null>(null);
export const ActionPresentationProvider = Context.Provider;
export const useActionPresentation = () => useContext(Context);
```
2. `Button`: read `const presentation = useActionPresentation()`.
   - `bar`: override `variant` with `presentation.emphasis` and `size` with `"lg"`, and add `w-full min-w-0`.
   - `row`:
     - Use `variant="ghost"`, `size="lg"` and the classes `h-12 w-full min-w-0 justify-start rounded-sm px-3 text-[15px] font-normal text-foreground shadow-none`, plus `text-destructive` when the given variant was `destructive`.
     - Wrap `onClick` so it calls the original and then, unless `props["aria-haspopup"]` is set or the event was default-prevented, calls `setTimeout(presentation.onSelect, 0)`.
     - Comment: "Next task, so a submit button's form is still mounted when the browser submits it."
   - With no provider, behaviour is unchanged.
3. `SplitButton`: read the presentation. In `bar` or `row`, the chevron Button gets `w-11 shrink-0 justify-center px-0` and the main Button `min-w-0 flex-1`. The chevron's Radix trigger already has `aria-haspopup`, so it won't close the sheet.

**Verify:**
```bash
cd packages/react && npx tsgo --noEmit && pnpm exec vitest run
# Expected: clean, tests pass
```
**Out of scope:** `buttonVariants` itself; Assignee's raw button.

## Task 10: `RecordHeader`, `RecordAction`, `RecordPhoneChrome`, `RecordHeroTarget`

**Depends on:** 4, 9
**Files:**
- Create: `apps/erp/app/components/Layout/RecordHeader.tsx`. Precedent: `components/Layout/RecordChrome.tsx`, which this replaces (copy its hero, app-bar ⋯ and bottom-bar markup), and the shell-A desktop markup in `modules/sales/ui/SalesOrder/SalesOrderHeader.tsx:390-417`.
- Delete: `apps/erp/app/components/Layout/RecordChrome.tsx`, after Tasks 12–15 move its callers. Until then, keep it re-exporting the new parts so callers compile: `export { RecordAction } from "./RecordHeader"`, and `RecordChrome` implemented via `RecordPhoneChrome`.

**Steps:**
1. Slots: `recordPrimarySlot`, `recordSecondarySlot`, `recordOverflowSlot`, `recordHeroSlot` = `createPortalSlot()`.
2. `RecordAction({ slot, children })`:
   - Desktop: `<>{children}</>`.
   - Phones: wrap the children in the matching slot's `Fill`, inside `<ActionPresentationProvider>`:
     - `{kind: "bar", emphasis: "primary"}` for primary;
     - `{kind: "bar", emphasis: "secondary"}` for secondary;
     - `{kind: "row", onSelect: closeOverflow}` for overflow, where `closeOverflow` comes from a module zustand `useOverflowSheet` store `{ open, setOpen }`.
3. `RecordPhoneChrome({ menu?, copyValue? })`, which renders nothing on desktop:
   - the app-bar ⋯ (copy RecordChrome's `AppBarActions` block);
   - `<BottomBar>` with `<recordPrimarySlot.Target className={cellClassName} />`, `<recordSecondarySlot.Target className={cellClassName} />`, and the ⋯ IconButton shown when `recordOverflowSlot.useFilled()`. Use `cellClassName = "flex min-w-0 flex-1 empty:hidden [&>*]:min-w-0 [&>*]:w-full"`: layout only, no button reach-in. The bar is rendered when any of the three slots is filled.
   - the overflow `BottomSheet` with `open` from `useOverflowSheet`, its `BottomSheetContent forceMount` given `data-[state=closed]:hidden`, and `<recordOverflowSlot.Target className="flex flex-col [&>*]:w-full" />`. If `BottomSheetContent` doesn't forward `forceMount` to Radix `Content` and `Portal`, add that pass-through in `packages/react/src/BottomSheet.tsx`.
4. `RecordHero({ title, subtitle, status, bleed })`:
   - Copy RecordChrome's hero div.
   - Phones only. It keeps the empty hidden div so `--header-height`/`--hero-height` resolve to 0, using `useCompactCssVar`.
5. `RecordHeroTarget({ bleed })` renders `<recordHeroSlot.Target className={cn(bleed && "-mx-4 -mt-4")} />` on phones.
6. `RecordHeader(props)`, with props as in the spec:
   - **Desktop shell:**
     - `div` class `flex flex-shrink-0 items-center justify-between gap-x-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide compact:hidden`.
     - Padding: `pl-2` with an explorer toggle, else `pl-4`; `pr-2` with a properties toggle, else `pr-4`.
     - Left `HStack`: explorer IconButton (copy SalesOrderHeader), the title (on desktop only: `titleTo ? <Link to><Heading size="h4" className="flex items-center gap-2">{title}</Heading></Link> : <Heading size="h4" …>`), `{copyValue && <Copy text={copyValue} />}`, the ⋯ DropdownMenu when `menu`, then `{status}`.
     - Right `HStack`: `{aside}{actions}`, then the properties IconButton.
   - **Phones:** `<RecordHero title={isCompact ? title : undefined} subtitle status />` and `<RecordPhoneChrome menu copyValue />`. The desktop shell stays mounted (`compact:hidden`), but `title` is not rendered inside it while compact.
   - If `subtitle` is given, the desktop shell shows it as `<p className="text-sm text-muted-foreground">` under the heading only when the caller passes `showSubtitleOnDesktop`.
     - Inspection is the only caller with a desktop subtitle line today; see Task 14.
     - If the catalogue shows another caller needs it, STOP and report.
7. Export `RecordHeader`, `RecordAction`, `RecordPhoneChrome`, `RecordHero`, `RecordHeroTarget`, `recordHeroSlot`.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit && cd ../.. && pnpm exec biome check apps/erp/app/components/Layout/RecordHeader.tsx apps/erp/app/components/Layout/RecordChrome.tsx
# Expected: clean
```
**Out of scope:** call-site migration.

## Task 11: `DocumentHeader` card variant

**Depends on:** 10
**Files:**
- Modify: `apps/erp/app/components/DocumentHeader.tsx`:
  - Props: `{ title: string; subtitle?; status?; menuItems?; actions?; copyValue? = title; className? }`.
  - Desktop: the existing `CardHeader`, plus `compact:hidden` (always).
  - Phones: `<recordHeroSlot.Fill><RecordHero status={status} subtitle={subtitle} /></recordHeroSlot.Fill>` and `<RecordPhoneChrome menu={menuItems} copyValue={copyValue} />`.
  - The `actions` node keeps its `RecordAction` wrappers from the callers.
  - Translate the hard-coded `aria-label="More options"` with `t`.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit
```
**Out of scope:** callers (Task 15).

## Task 12: Migrate shell-A headers (11)

**Depends on:** 10, 11
**Files:** `modules/sales/ui/SalesOrder/SalesOrderHeader.tsx`, `modules/sales/ui/Quotes/QuoteHeader.tsx`, `modules/sales/ui/SalesRFQ/SalesRFQHeader.tsx`, `modules/sales/ui/SalesReturnOrders/SalesReturnOrderHeader.tsx`, `modules/purchasing/ui/PurchaseOrder/PurchaseOrderHeader.tsx`, `modules/purchasing/ui/PurchaseReturnOrders/PurchaseReturnOrderHeader.tsx`, `modules/purchasing/ui/PurchasingRfq/PurchasingRFQHeader.tsx`, `modules/purchasing/ui/SupplierQuote/SupplierQuoteHeader.tsx`, `modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx`, `modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader.tsx`, `modules/production/ui/Jobs/JobHeader.tsx`.

**Steps (per file):**
1. Replace `<RecordChrome …/>` plus the `compact:hidden` shell with one `<RecordHeader>`:
   - `title`: the id node. For Quote and PO, `<span className="flex items-center gap-0"><span>{id}</span><RevisionSuffix …/></span>` (and drop `subtitle`).
   - `titleTo`: the existing Link `to`.
   - `copyValue`, `menu`, `status`: the existing variables.
   - `onToggleExplorer={toggleExplorer}` and `onToggleProperties={toggleProperties}`.
   - `actions`: the existing right-hand HStack children, minus the properties toggle.
2. Modals, disclosures and dialogs that were inside the shell move to right after `<RecordHeader>`. They portal anyway, so the position is irrelevant to the DOM.
3. Where a slot and a variant restate one condition, name it once (`const isDraft = …`) and use it in both. Do not change any variant's resulting value.
4. PO: delete the `isCompact` term from `invoiceVariant`, and `useCompact` if unused.
5. Remove the now-unused imports.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit && cd ../.. && pnpm exec biome check <the 11 files>
# Expected: clean
```
**Out of scope:** action logic, permissions, fetchers.

## Task 13: Migrate shell-B headers (14)

**Depends on:** 8, 10, 11
**Files:** `modules/items/ui/{Materials/MaterialHeader,Parts/PartHeader,Tools/ToolHeader,Services/ServiceHeader,Consumables/ConsumableHeader}.tsx`, `modules/items/ui/ChangeNotice/ChangeNoticeHeader.tsx`, `modules/quality/ui/Issue/IssueHeader.tsx`, `modules/resources/ui/Maintenance/MaintenanceDispatchHeader.tsx`, `modules/inventory/ui/PickingLists/PickingListHeader.tsx`, `modules/inventory/ui/StockTransfers/StockTransferHeader.tsx`, `modules/production/ui/Procedures/ProcedureHeader.tsx`, `modules/resources/ui/Training/TrainingHeader.tsx`, `modules/quality/ui/Documents/QualityDocumentHeader.tsx`, `modules/production/ui/Assemblies/AssemblyInstructionHeader.tsx`.

**Steps:** these are the same as Task 12, with these specifics:
- **Item headers:** `aside={<DetailsTopbar links={…} />}`. Order becomes title · Copy · ⋯ · status (spec-approved).
- **ChangeNotice / Issue / Maintenance:** the status moves after the ⋯ (spec-approved). ChangeNotice keeps its `line-through` span around the status.
- **PickingList / StockTransfer / Procedure / Training / QualityDocument:** no `titleTo`.
  - The badges that sat inside the Heading become `status`.
  - The title is the live `displayName` where the file uses it.
  - StockTransfer's inline `ViolationModal`s move after the header.
- **Assembly:**
  - `title={nameInput}` and no `copyValue`.
  - `status={<>{statusBadge}{versionBadge}</>}`.
  - The "edited by" span goes at the end of `status` with its `hidden lg:inline` class.
  - Delete `{!isCompact && nameInput}` and `useCompact`.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit && cd ../.. && pnpm exec biome check <the 14 files>
```
**Out of scope:** `DetailsTopbar` internals (Task 8).

## Task 14: Migrate other topbar headers and company cards (4)

**Depends on:** 10, 11
**Files:** `modules/quality/ui/Inspections/InspectionView.tsx`, `modules/workflows/ui/Builder/BuilderHeader.tsx`, `modules/sales/ui/Customer/CustomerHeader.tsx`, `modules/purchasing/ui/Supplier/SupplierHeader.tsx`.

**Steps:**
- **InspectionView:** keep its own desktop shell. Its markup (a raw `h1` with a wrapping meta line) doesn't match `RecordHeader`'s shell. Replace `<RecordChrome hero=…/>` with `<RecordHero subtitle={metaLine} status={statusBadge} />` + `<RecordPhoneChrome />`. It still passes its data once to each layout.
- **BuilderHeader:** keep its `<header>` shell (topbar height, SaveMarker).
  - Replace `RecordChrome` with `<RecordHero title={isCompact ? <WorkflowTitle …/> : undefined} status={…} />` + `<RecordPhoneChrome />`.
  - The desktop renders `{!isCompact && <WorkflowTitle …/>}`, unchanged: the render-once rule is now expressed through `RecordHero`'s `title`, the same as RecordHeader.
  - Keep `inHero` only if its styling is still needed in the hero. Check that `WorkflowTitle` renders correctly in the hero without it, and delete it if so.
- **Customer / Supplier:** keep their Card markup. Replace `<RecordChrome menu copyValue/>` with `<RecordPhoneChrome menu={menuItems} copyValue={id} />`.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit && cd ../.. && pnpm exec biome check <the 4 files>
```
**Out of scope:** WorkflowTitle's rename logic.

## Task 15: Migrate card forms, actions-only pages, fixed asset (9)

**Depends on:** 10, 11
**Files:** `modules/inventory/ui/Receipts/ReceiptForm/ReceiptForm.tsx`, `modules/inventory/ui/Shipments/ShipmentForm/ShipmentForm.tsx`, `modules/inventory/ui/WarehouseTransfers/WarehouseTransferForm.tsx`, `modules/invoicing/ui/Payment/PaymentForm.tsx` (+ `PaymentForm.test.tsx` mocks), `modules/invoicing/ui/Memo/MemoForm.tsx`, `modules/accounting/ui/JournalEntries/JournalEntryForm.tsx`, `routes/x+/fixed-asset+/$fixedAssetId.tsx`, `modules/inventory/ui/InventoryCount/InventoryCount.tsx`, `routes/x+/reimbursements+/$reimbursementId._index.tsx`.

**Steps:**
- **DocumentHeader callers:**
  - Replace `<RecordChrome hero menu copyValue bleed />` with `<RecordHeroTarget bleed />` at the same spot. WarehouseTransfer: no `bleed`, at its current spot inside the Card.
  - Pass `status`/`menuItems` straight to `DocumentHeader`.
  - Drop `className="compact:hidden"`: DocumentHeader now owns it.
  - Inline the hoisted `statusNode`/`menuItems` variables back if they are used once.
- **JournalEntryForm:**
  - Replace the hand-rolled CardHeader with `<DocumentHeader title={displayId} status={…} menuItems={isDraft || isPosted ? menuItems : undefined} actions={…} />` + `<RecordHeroTarget bleed />`.
  - The desktop markup is the same: h3 heading, Copy, ⋯ and status. Check that the ⋯ IconButton's `type="button"` is preserved: DocumentHeader's IconButton defaults to `type="button"` through Button.
- **InventoryCount / Reimbursement:** `<RecordChrome …/>` becomes `<RecordHero status={…} />` (InventoryCount) or nothing (Reimbursement), plus `<RecordPhoneChrome />`.
- **PaymentForm.test.tsx:** update its mocks from `~/components/Layout/RecordChrome` to `~/components/Layout/RecordHeader`.

**Verify:**
```bash
cd apps/erp && npx tsgo --noEmit && pnpm exec vitest run app/modules/invoicing && cd ../.. && pnpm exec biome check <the 9 files>
# Expected: clean, tests pass
```
**Out of scope:** form validation and actions.

## Task 16: Delete leftovers; Lingui extract

**Depends on:** 12–15
**Steps:**
1. Delete `apps/erp/app/components/Layout/RecordChrome.tsx` and `apps/erp/app/modules/sales/ui/Quotes/RevisionSubtitle.tsx`.
2. Run the grep below and fix every hit.
3. Run `pnpm lingui:extract && pnpm lingui:clean`.

**Verify:**
```bash
rg "RecordChrome|ChromeSlotsProvider|useChromeSlotTargets|useCompactSeed|CompactPanelProvider|COMPACT_MAX_WIDTH|RevisionSubtitle" apps packages --glob '!*.md' --glob '!*.po'
rg "\[&_button\]|\[&_\.bg-destructive\]" apps/erp/app/components/Layout
# Expected: both print nothing
```

## Task 17: End-to-end verification

**Depends on:** all
**Steps:**
1. Run:
   ```bash
   cd packages/utils && npx tsgo --noEmit && pnpm exec vitest run
   cd ../react && npx tsgo --noEmit && pnpm exec vitest run
   cd ../../apps/erp && npx tsgo --noEmit && pnpm exec vitest run app/components app/modules/invoicing
   cd ../mes && npx tsgo --noEmit
   cd ../starter && npx tsgo --noEmit
   cd ../.. && pnpm exec biome check $(git diff HEAD --name-only -- '*.ts' '*.tsx'; git ls-files --others --exclude-standard -- '*.ts' '*.tsx')
   ```
   Expected: all pass. Record any failure verbatim in the final report.
2. Browser checks: the spec's acceptance criteria at 390px and at desktop width. These need the user's go-ahead to drive the browser; ask before starting.
3. Tick the spec's acceptance criteria and add a Changelog line.
