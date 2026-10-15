# Thermo-nuclear review — phone redesign (uncommitted work on feat/mobile-redesign)

Scope: `git diff HEAD` (164 files, +8482 / −3605). Three read-only reviewers: shared phone parts, ERP screens, MES. No typecheck or build ran during the review.

## A. Shared phone parts

| # | Sev | Where | Problem | Simpler alternative |
|---|---|---|---|---|
| A1 | MAJOR | `packages/react/src/SplitButton.tsx`, `PurchaseOrderHeader.tsx`, `JobHeader.tsx` | In a bar cell the split dropdown is dropped, so each caller copies its items into the ⋯ by hand behind `isPhone`. The Job copy already drifted (extra `isDisabled`). | Give the `bar` presentation an `overflow` render function that `RecordAction` points at the overflow slot. SplitButton renders its own `dropdownItems` there. Delete both copies. |
| A2 | MAJOR | `RecordHeader.tsx` (`recordMenuSlot`), `Table.tsx` → `CompactList` → `CompactToolbar` (`mobileMenuItems`) | Three ways now put actions in an app-bar ⋯. Two of them make pages write their desktop actions twice (MakeMethodTools, JobMakeMethodTools, both planning tables). | Keep one primitive: the overflow portal slot with the `row` presentation. Pages wrap their existing desktop Button. Delete `recordMenuSlot`, `mobileMenuItems`, `menuItems`. |
| A3 | MAJOR | `Input`, `Textarea`, `InputOTP`, `Editor`, `BottomSheet`, `PickerList`, `Drawer`, `Modal` | "No autofocus on phones" exists in 8 copies; `usePickerOpenAutoFocus` keeps a dead `_optionCount`. | Two hooks in `Viewport.tsx`: `usePhoneAutoFocus(autoFocus)` and `usePhoneOpenAutoFocus(handler)`. Use them at all 8 sites; drop `_optionCount`. |
| A4 | MAJOR | `CompactToolbar.tsx` (`useHideListAppBarMenu`), `InventoryItemHeader.tsx` | A module flag with one caller works around two owners filling `AppBarActions` at once. | Make `AppBarActions` newest-wins (like `useSetAppBarOverride`). Delete the flag. |
| A5 | MAJOR | `ActionTaskList.tsx`, `ActionTaskAddModal.tsx`, `ReviewersList.tsx` | The same phone pattern twice (`trigger` enum, `isPhone` branches, "No … yet.", `pr-14` gap for the collapse button; `pr-14` now 8× in ERP). | `Card` keeps the collapse-button gap itself when `isCollapsible`. Modals take a trigger node, not an enum. |
| A6 | minor | `Panels.tsx` | `RecordFrameContext`, `RecordPanelContext` and `recordFrameSlot` signal one fact. | One context `((panel) => void) \| null`. |
| A7 | minor | `packages/react/src/HTML.tsx` | `isRichTextEmpty` duplicates `hasContent` (`packages/documents/src/pdf/blocks/resolveTerms.ts:10`); exported, unused outside; a cast. | Do not export it; replace the cast with a guard. |
| A8 | minor | `NavRail.tsx` | Phone branch rebuilds `content`; its `max-md:` classes are dead. | Build body/footer once. |
| A9 | minor | `Assignee.tsx` | Third hand-written controlled/uncontrolled `open`. | One `useControllableState`. |
| A10 | minor | `MobileAppBar.tsx` | Two title buttons duplicate the subtitle; comment names one screen. | One button. |
| A11 | minor | `RecordHeader.tsx`, `ActionPresentation.tsx`, `Button.tsx` | Names still say "sheet" after the ⋯ moved to a menu. | Rename `useOverflowSheet` → `useOverflowMenu`; fix comments. |
| A12 | minor | `PrintButton.tsx` `label`, `BarProgress.tsx` `stackOnPhone` | Props for one caller each. | Drop `label`; one `value` node with flex `order`. |

## B. ERP screens

| # | Sev | Where | Problem | Simpler alternative |
|---|---|---|---|---|
| B1 | MAJOR | `QuoteSummary.tsx` | 963 → 1026 lines, past the 1000-line limit. | Move `LinePricingOptions` (about 390 lines) to `QuoteLinePricingOptions.tsx`. |
| B2 | MAJOR | `SalesOrderSummary.tsx:404`, `PurchaseOrderSummary.tsx:137`, `QuoteSummary.tsx:215`, `InventoryStorageUnits.tsx:383` | Four hand-rolled phone line rows; dead `max-md:` classes left in desktop-only branches. | One `SummaryLineRow` component next to `CompactRow`; delete the dead classes. |
| B3 | MAJOR | `SalesOrderSummary.tsx:773`, `QuoteSummary.tsx:177` | `getLineTotal` duplicates `packages/documents/src/utils/sales-order.ts:80`; the breakdown row still inlines it; Quote holds its total formula twice. | Use the documents helper for SO everywhere; one `getQuoteLineTotal`. |
| B4 | MAJOR | Part and Job BOP/BOM (4 files) | The same 22-line empty state copied 4×; `CompactEmpty` already has the icon tile. | Generalise `CompactEmpty({ icon, title, description, action })`. |
| B5 | MAJOR | `MakeMethodTools.tsx:370`, `JobMakeMethodTools.tsx:334` | Each tool declared twice (Menubar + memoized menu item with a `biome-ignore`). | Wrap each `MenubarItem` in `<RecordAction slot="overflow">`; delete `phoneMenu`. (Same fix as A2.) |
| B6 | MAJOR | 9 detail / planning routes | The same 4 imports + `useSetAppBarOverride(useMemo(…))` in each. | A `subtitle` on each route `handle`, read by `deriveAppBar`. |
| B7 | MAJOR | `InventoryDetails.tsx`, `InventoryStorageUnits.tsx` | `variant="quantity"` branches in 14 places for one caller of five. | Use the phone layout for every caller; delete the prop. |
| B8 | minor | `PivotTree.tsx` | Second row renderer and footer ternary copied; useless alias. | Shared `PivotRowLabel` and `formatColumnTotal`. |
| B9 | minor | `JobHeader.tsx`, `PurchaseOrderHeader.tsx` | Split-button items copied as phone overflow buttons. (Same as A1.) | SplitButton fills its own items. |
| B10 | minor | `InventoryStorageUnits.tsx`, `SalesOrderSummary.tsx:417` | `storageUnitLabel` not reused; third `(line as any).assetReadableId`. | Reuse the label helper; a typed line-label helper. |
| B11 | minor | `ReportFilters`, `PivotControlBar`, `PurchasesControlBar`, `MultiPeriodStatementTree`, `ExecutivePnlSummary`, `TrialBalanceTree` | Download copied as an app-bar icon 3×; period stepper code copied 2×; Trial Balance header and `columnLabels` kept apart. | `ReportDownloadAction`; `usePeriodStepper`; build the header from `columnLabels`. |
| B12 | minor | Both planning tables | The same 25-line phone MRP code twice. | One `useMrpRecalculate(locationId)`. |

Also noted: four `[a, b].filter(Boolean).join(" · ")` hero-subtitle builders; the "Locked while the quote is …" note copied in 2 forms.

## C. MES

| # | Sev | Where | Problem | Simpler alternative |
|---|---|---|---|---|
| C1 | MAJOR | `JobOperation.tsx` (3413 → 3809 lines) | A second materials renderer (phone list) beside the desktop table, no shared row model; 4 inline casts; the issue-button condition differs (`!isTracked` vs `=== false`). | Move the materials section to `JobOperation/components/Materials.tsx` with one per-row model read by both layouts. |
| C2 | MAJOR | `MesTabBar.tsx:82` + 5 bottom bars | Bottom bar heights hard-coded (`--mes-bottom-bar-h`), `54px` repeated 7×, an effect with no deps queries the DOM every render. | One `MesBottomBar` that measures itself (ERP precedent `BottomBar` + `useCompactCssVar`). |
| C3 | MAJOR | `AdjustInventory`, `EndShift`, `Suggestion` | Each tool switches modal vs More-sheet page by hand in 3 places and builds its body twice. | One `ToolDialog` / `useToolSurface` from `MoreSheet.tsx`. |
| C4 | MAJOR | `OperationsList.tsx`, `Kanban/components/ItemCard.tsx` | The same phone card parts copied line for line. | Shared `CardThumbnail`, `QuantityStat`, `AssigneeTags`. |
| C5 | MAJOR | `AppSidebar.tsx:230` (`useOrigin`), 4 hidden `from` writers, 3 `withOrigin` ternaries | Origin logic split across files; one writer ignores `ORIGIN_PARAM`. | `utils/origin.tsx` owns `useOrigin`, `<OriginInput/>`, null-safe `withOrigin`. |
| C6 | MAJOR | `timecard.tsx:510`, `jobs.tsx` | Phone list copies the table's edit branch; the editor exists twice in the DOM. | `TimeEntryEditor` / `TimeEntrySummary`; a `JobRowData` mapper. |
| C7 | minor (regression) | `MesAppBar.tsx:47` | Desktop titles changed ("Open Jobs" → "Jobs", "Assigned to Me" → "Assigned"); `actions` mount twice (TimerControl ×2 in AssemblyView). | `desktopTitle` prop; render actions once. |
| C8 | minor | `JobOperation.tsx:1540` | Due label ×3, projected-completion badge ×2, context row and meters mount twice. | Compute once; `<ProjectedCompletion>`. |
| C9 | minor | `operations.tsx:599`, `assigned.tsx:238` | `displayPopoverContent` copied (50 lines) with casts, mounted twice. | `<DisplaySettingsPopover>`. |
| C10 | minor (regression) | `dispatch.$dispatchId.tsx` | `hasText` duplicates `isRichTextEmpty`; desktop Complete now asks for confirmation (desktop behaviour change). | Use `RichTextView`; keep the confirmation phone-only. |
| C11 | minor | `MoreSheet.tsx`, `Kanban.tsx:70`, `JobDag.tsx:166` | 3 effects mirror props into state. | Derive instead. |
| C12 | minor | `apps/mes/app/root.tsx`, `JobOperation.tsx`, `UserNav.tsx`, `InspectionView.tsx` | Commented-out devtools, trailing commas against `biome.jsonc`, inert classes, a dead branch, a copied form. | Clean up. |

## Outcomes (2026-10-08)

The majors were fixed one area at a time (shared, then ERP, then MES). Each area ended with a single typecheck. Final state: typecheck passes for `@carbon/react`, `@carbon/documents`, `erp` and `mes`. Biome reports no new findings on the changed files.

- **Done:** A1, A3, B1–B6, C1–C6. C7 and C10 (the two desktop regressions) were done first.
- **A2, partly done:** `recordMenuSlot` is deleted. The method tools wrap their Menubar items in `<RecordAction slot="overflow">`. List pages keep `mobileMenuItems` on `Table` because a list has no record header that could own an overflow slot.
- **C1:** The materials section is now `JobOperation/components/Materials.tsx`. `toMaterialGroups` builds one row model, and both layouts read it. Only one layout mounts (`useViewport`). The direct-issue rule is the desktop rule (`=== false`) on both layouts. The 4 casts are deleted: `JobMaterial` already has the pick fields. `JobOperation.tsx` went from 3809 to 3007 lines. Checked in the browser at 393 px and 1440 px, and Issue opens the modal.
- **Skipped:**
  - **A4:** making `AppBarActions` newest-wins changes every page that fills it. The flag has one caller.
  - **A5:** the `Card` collapse gap is shared by desktop cards, and desktop must not change.
  - **B7:** the four other `InventoryDetails` callers are desktop layouts.
- **Kept:** `Suggestion` keeps `useMorePage` because it has no modal form to share.
- **Not done (minor):** A6, A8–A12, B8–B12, C8, C9, C11, C12.
