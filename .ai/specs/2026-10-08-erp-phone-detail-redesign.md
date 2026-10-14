# ERP phone redesign: 12 screens that failed the phone review

> Status: approved
> Author: Claude (with the branch owner)
> Date: 2026-10-08
> Branch: `feat/mobile-redesign`

## TL;DR

- 12 ERP screens scored 80 or less in the phone review. This spec builds the approved new versions.
- Every detail page gets the same top: the ID and the record type in the app bar, then `RecordHero` with one muted line and the status, then the usual tab row.
- Every record page gets one ⋯, in the app bar. The second ⋯ in the bottom action bar goes away.
- Changes are phone only (below 768px). Desktop stays the same.
- No new data, no schema change, no new feature. Layout, copy and a few shared phone parts only.

Sources:
- Approved designs: `local-docs/mobile-design/review-2026-10-08/index.html` (specs `after-*.json`, scores `review.json`).
- Code mapping: `.ai/research/2026-10-08-erp-phone-redesign-mapping.md`.
- Earlier phone chrome spec: `.ai/specs/2026-10-07-mobile-chrome-structure.md` (`RecordHeader`, slots).

## Problem

A phone review of 20 main ERP screens scored each one out of 100. 8 list screens passed. 12 screens failed:

| Screen | Score | Main problems |
|---|---|---|
| Part detail | 55 | No identity at the top; clipped method button row |
| Quantity detail | 56 | Six full-width number cards; empty Storage Units table has no message |
| Sales Order detail | 59 | No customer at the top; clipped customer name; two ⋯ |
| Purchase Order detail | 59 | Same as Sales Order; meaningless "1 ⇄" badge |
| Job detail | 60 | Clipped method button row; "Looks empty here 👀" |
| Quote detail | 61 | No customer at the top; no primary action when Expired |
| Picking List detail | 69 | Unlabelled tick bar; Short and Pick crammed in a row |
| Storage Unit edit | 73 | Half sheet; Save at the bottom under the keyboard |
| Issue detail | 64 | Dashed add tiles; Files table header over "No files" |
| Production Planning | 76 | No way to act on a row; Recalculate in the body |
| Purchasing Planning | 77 | Same as Production Planning |
| Quotes list | 79 | Bare progress bar; no expiry date |

## Goals

- Each of the 12 screens matches its approved design, with the changes in "Resolved questions".
- The 8 detail pages share one top made of existing phone parts.
- Every record page has exactly one ⋯ on phones.
- Every action that a screen offers today stays reachable on phones.

## Non-goals

- Desktop layout or behaviour. Every change is behind `max-md:` or `useViewport().isPhone`.
- New features, new data, new KPIs, schema changes.
- A swipe-to-dismiss gesture for sheets.
- Hiding the number field −/+ steppers.
- The 8 screens that passed. Their review issues stay in the backlog.

## Design

### 1. Shared phone parts

| # | Part | Change | Files | Reach |
|---|---|---|---|---|
| S1 | Record hero subtitle | Each detail header passes `subtitle` to `RecordHeader`. The value is per screen (table 2). | `*Header.tsx` | Phone only (hero renders only on phones) |
| S2 | App bar subtitle | Each detail route sets the record type ("Sales Order", "Job") with `useSetAppBarOverride({ subtitle })`. Breadcrumbs do not change. | detail routes, `components/Layout/Mobile/useAppBarOverride.ts` | Phone only |
| S3 | One ⋯ per record | `RecordPhoneChrome` drops the bottom-bar ⋯. The app-bar ⋯ shows Copy ID, then the header `menu`, then every `slot="overflow"` action. | `components/Layout/RecordHeader.tsx` | All 25 record headers |
| S4 | Icon cell in the action bar | A new `RecordAction slot="icon"` renders one square secondary `IconButton` before the primary. Preview uses it. | `RecordHeader.tsx`, `packages/react/src/ActionPresentation.tsx` | Opt-in |
| S5 | Split button in the bar | In the bar, a `SplitButton` shows only its main action. Its menu items move to the app-bar ⋯. | `packages/react/src/SplitButton.tsx`, PO and Job headers | PO, Job |
| S6 | Page items in the app-bar ⋯ | A new value slot lets a child route add items to the record's app-bar ⋯. The method tools use it. | `RecordHeader.tsx`, slot module | Opt-in |
| S7 | Record tab setter | `CompactRecordTabs` exposes a setter, so "See all N" can switch to the Lines tab. | `components/Layout/Panels.tsx` | Opt-in |
| S8 | Files cards | On phones, hide the card-header "New" button, and hide the table header while the list is empty. The phone dropzone keeps its one "Upload" button. | `OpportunityDocuments.tsx`, `SupplierInteractionDocuments.tsx`, `components/Documents.tsx` | 10 record pages |
| S9 | Neutral empty state in sorted lists | `SortableList` takes an `emptyState` prop. Job and Part BOP/BOM pass an icon, one sentence and the add action. Without the prop, nothing changes. | `components/SortableList.tsx` | Opt-in |
| S10 | Trailing row action in phone lists | A new column meta `mobile: "action"` renders the cell as a trailing 44pt button. It hides in selection mode. | `components/Table/types.ts`, `resolveSlots.ts` (+ test), `CompactRow.tsx` | Opt-in |
| S11 | Extra items in the list toolbar ⋯ | A new `mobileMenuItems` prop on `Table` adds items to the phone toolbar ⋯. | `Table.tsx`, `CompactList.tsx`, `CompactToolbar.tsx` | Opt-in |
| S12 | Subtitle on root screens | `MobileAppBar` renders `subtitle` under the section switcher title too. | `components/Layout/Mobile/MobileAppBar.tsx` | Root screens that set a subtitle |

### 2. Detail page tops

Each top has 3 parts: the app bar (ID, record type, ⋯), then `RecordHero` (subtitle and status), then the tab row. Tab rows do not change.

| Screen | App bar subtitle | Hero subtitle | Status | Tabs |
|---|---|---|---|---|
| Sales Order | Sales Order | customer name | `SalesStatus` badges | Overview · Lines · Properties |
| Purchase Order | Purchase Order | supplier name, then " · Rev N" if revised | status badges | Overview · Lines · Properties |
| Quote | Quote | customer name, then " · Rev N" if revised | `QuoteStatus` | Overview · Lines · Properties |
| Job | Job | item readable ID · "Qty N" | `JobStatus` badges | Overview · Bill of Materials · Properties |
| Part | Part | part name | lifecycle status (only when set) | the part's sub-page tabs |
| Quantity | Quantities | item name | none | Details · Activity |
| Picking List | Picking List | first job ID (+N if more jobs) · assignee name | `PickingListStatus` | none |
| Issue | Issue | issue name | `IssueStatus` | Overview · Associations · Properties |

SO, PO and Quote keep `OpportunityState` / `SupplierInteractionState` as the first Overview card, as today.

### 3. Per-screen body changes

**Sales Order**
1. Overview order: state bar, summary (lines, totals), then Notes, Files, Shipping, Payment, as today.
2. Phone line row: part number with the line total, then the part name, then "1 × $250.00 EA". No Edit link, no badges, no expand.
3. A tap on the row opens the line page (`path.to.salesOrderLine`).
4. In the totals, "Add Shipping" becomes a Shipping row. The row uses the existing `onEditShippingCost`.
5. Action bar: Preview (icon cell), then the status primary (Confirm when Draft). Cancel and the other overflow actions go to the app-bar ⋯ (S3).

**Purchase Order**
1. Same template as Sales Order.
2. Overview shows the first 3 lines and "See all N". "See all N" opens the Lines tab (S7).
3. The "1 ⇄" badge goes. It always shows the same icon today (no `methodType` on `purchaseOrderLines`).
4. Action bar: Preview (icon), Finalize. "Mark as Planned" moves to the app-bar ⋯ (S5).

**Quote**
1. Same template. The line row keeps its tap-to-expand, because the expand holds the quantity-break picker. Only the row look changes (no Edit link, no badges).
2. If the quote is Expired, Reopen is the bar primary on phones. The ⋯ menu keeps Reopen for desktop.
3. On phones, locked Payment and Shipping cards show one line: "Locked while the quote is {status}. Reopen it to edit."

**Quotes list**
1. Draft quotes: a Draft status pill and the text "N of M lines complete" replace the bar (phone only).
2. Line 2: the customer, then "Exp. Sep 21" (phone-only text in the customer cell).

**Job**
1. Get Method, Save Method, Configure and Item Master move to the app-bar ⋯ (S6). The phone hides the method `Menubar`.
2. Bill of Process and Bill of Material use the neutral empty state (S9): "No operations yet" / "No materials yet", one sentence, the add action.
3. Estimates vs Actual: the title on its own line, then the Processes / Material tabs at full width.
4. Action bar: Release is the primary. Pause shows only when the job is Ready or In Progress. "Mark as Planned" moves to the ⋯ (S5).

**Part**
1. Get Method, Save Method and Item Master move to the app-bar ⋯ (S6).
2. The method version control renders as a chip above Bill of Process on phones.
3. Bill of Process and Bill of Material rows show their full text. Execute checks the rows on a phone first and fixes only the clipped parts.
4. The Manufacturing card Save is a full-width button. On phones it is disabled until a field in the card changes.
5. Number fields keep their −/+ steppers.

**Quantity detail** (changes gated so the part, material, tool and consumable inventory tabs stay the same)
1. The six cards become a 2-column grid of tiles.
2. Under the order figures: "↑ Incoming" and "↓ Outgoing". The jobs tile reads "Supply / demand".
3. The usage window select shows as a chip with the label "Daily usage".
4. The external-link icon moves to the app-bar ⋯ as "Item Master".
5. "Update Inventory" moves to the bottom action bar.
6. The Storage Units table becomes phone rows: unit, quantity, tracking ID, expiry. Batch groups and the per-row ⋯ stay. If no unit holds stock, one line says so.
7. Fix: the hidden list's toolbar ⋯ must not add a second ⋯ to this page's app bar.

**Storage Unit edit** (edit sheet only; the New sheet and the inline create modal stay the same)
1. The sheet fills the screen on phones (a phone-only class, not `size="full"`).
2. Save moves to the sheet header, left of the existing ×. The footer holds "Print label" as one full-width secondary button.
3. The × and the overlay keep their close behaviour and the existing unsaved-changes prompt.
4. The read-only Location field shows a lock and the line "Set when the unit was created".
5. The ⓘ help icons go on phones where the field has help text under it (Parent, Work Center). Storage Types keeps its ⓘ, because it has no help text.

**Picking List detail**
1. The grey tick bar becomes an overline header: the job, then "N% picked" on the right.
2. The inner bordered box goes. Each line is its own card at the full gutter width.
3. Quantities use words: "To pick 4 EA", "Picked 0 LB". A shorted line shows a "Short" pill with an icon.
4. Short and Pick are two equal 44pt buttons on their own row. Pick is secondary on phones. Tracked lines get the same treatment for Scan and Unpick.
5. Action bar: the status primary only (Start when Draft, Finish when In Progress). Assign, Cancel, Reopen and Delete are in the app-bar ⋯ (S3). "Assign" opens the existing assignee picker in a sheet.

**Issue detail**
1. Files: S8.
2. Actions and Approval Requirements are cards with one "Add" in the card header and a one-line empty sentence. The dashed tiles go on phones.
3. While empty, the Approval Requirements "Add" opens today's empty-state modal. With requirements, it opens today's "Add Requirement" modal.
4. Properties stay in the Properties tab. No Overview card.
5. Action bar: no change (Start primary, Complete secondary when Registered).

**Production and Purchasing Planning**
1. Each phone row gets the desktop "Make N" / "Order N" button as a trailing action (S10). It opens the existing order sheet.
2. Recalculate moves to the toolbar ⋯ (S11). It is disabled while MRP runs.
3. One muted line under the location chip: "MRP runs every 3 hours. To run it now, use ⋯ › Recalculate."
4. The app bar shows "Material Planning" with the subtitle "Production" or "Purchasing" (S12).
5. Production rows show on hand on line 2. Purchasing rows show the supplier (or the red "No Supplier" pill), then on hand.
6. Totals stay as the collapsed card. Bulk actions stay in ⋯ › Select, as today.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Build the top from what parts? | `RecordHero` subtitle + status, existing tab row | Owner rejected new header styling; these parts already ship on phones |
| Where the record type comes from on phones | `useSetAppBarOverride` per detail route | Changing breadcrumbs would change desktop |
| Second ⋯ in the bar | Removed on all 25 records | Owner choice; one menu everywhere |
| Preview button | New `slot="icon"` cell | Bar presentation forces full-width buttons today |
| Split buttons in the bar | Main action only; menu items to ⋯ | The chevron is a second target in a 44pt bar |
| Method tools on Job and Part | New value slot into the app-bar ⋯ | Tools live in a child route; the header owns the ⋯ |
| PO "See all N" | Setter on `CompactRecordTabs` | Tab state is local today |
| Files cards | Hide header New and empty table header on phones | The phone dropzone already gives one Upload; precedent `RecordDocuments.tsx:129` |
| Empty BOP/BOM | `emptyState` prop on `SortableList` | `Empty` has about 49 users; a prop keeps the change opt-in |
| Planning row action | New `mobile: "action"` slot | `CompactRow` has no trailing action; opt-in per column |
| Recalculate | New `mobileMenuItems` on `Table` | A second `AppBarActions` would show two ⋯ |
| Quotes list expiry | Phone-only text in the customer cell | `resolveSlots` takes only the first P3 column |
| Purchasing on hand | Phone-only text after the supplier | Same P3 limit |
| Quantity tiles and rows | Gated by a prop | The same components render on 4 item inventory tabs |
| Storage Unit full screen | Phone-only class | `size="full"` widens desktop drawers |
| Picking list subtitle | First job ID, "+N" if more | A list can span jobs; `pickingList` has no job column |
| "Print label" text | New `label` prop on `PrintButton` | The label is hard-coded "Print" |

## Acceptance criteria

All checks run at 393×852 unless the row says 1440.

1. On SO000025, the hero line reads "ZZ_Mobile_Audit_CustomerVeryLongNameNoSp Industrial…" with an ellipsis, and the app bar subtitle reads "Sales Order".
2. On a revised PO, the hero line ends with " · Rev 1".
3. Each of the 25 record pages shows one ⋯, in the app bar. Every action that the old bottom-bar ⋯ held is in it.
4. On SO000025, the action bar shows a square Preview icon and Confirm. Preview opens the PDF menu.
5. Tapping an SO or PO line opens its line page. Tapping a Quote line expands it and shows the quantity-break picker.
6. On PO000019, Overview shows 3 lines and "See all 30". Tapping it selects the Lines tab.
7. On J000022, the ⋯ holds Get Method, Save Method, Configure and Item Master. No method button row shows. BOP and BOM show "No operations yet" and "No materials yet" with an add button.
8. On a Draft job, the bar shows only Release. On an In Progress job, Pause shows too.
9. On ADCS-001, the version chip shows above Bill of Process. The Manufacturing Save is disabled until a field changes.
10. On the ADCS-001 quantity page, 6 tiles form 2 columns, Update Inventory is in the bottom bar, and the app bar has one ⋯ with Item Master.
11. On the ADCS-001 Part → Inventory tab, the tiles and the Storage Units table look as they do today.
12. The Storage Unit edit sheet fills the screen, Save is in the header, and Print label is the only footer button. The New sheet looks as it does today.
13. On PL000002, Short and Pick are two equal buttons. The header shows "N% picked". The bar shows only Finish.
14. On NCR000006, Actions and Approval Requirements each show a card with "Add" in the header. No dashed tile shows.
15. On both planning pages, each row has a "Make N" / "Order N" button that opens the order sheet. ⋯ holds Recalculate.
16. On the Quotes list, Q000005 shows a Draft pill and "0 of 2 lines complete". Line 2 shows "Exp." and a date.
17. At 1440×900, all 12 screens match their desktop screenshots from before this change.
18. No screen scrolls sideways at 393px. Typecheck, Biome and `pnpm lingui:extract` pass.

## Resolved questions

- [x] How far should the ⋯ merge go? — **Answer:** every record page (25 headers).
- [x] What does a tap on an SO, PO or Quote line do? — **Answer:** SO and PO open the line page. Quote keeps the expand for the quantity-break picker.
- [x] Hide the Part number steppers? — **Answer:** no. Keep the phone −/+ steppers.
- [x] How does the Storage Unit sheet close? — **Answer:** Save in the header, keep the ×. No swipe gesture.
- [x] What does the PO / Quote hero line show when revised? — **Answer:** the name, then " · Rev N".
- [x] Add an Issue properties card on Overview? — **Answer:** no. The Properties tab stays the only place.
- [x] What does the single Approval Requirements "Add" open? — **Answer:** the same modal as today for each state.
- [x] How does the Job bar read on a Draft job? — **Answer:** Release only. Pause shows when the job is Ready or In Progress.

## Changelog

- 2026-10-08: First draft after the owner approved the redesigned screens and answered 8 questions.
