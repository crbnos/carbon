# Record header catalogue (mobile redesign)

Read-only survey of every call site of `RecordChrome` / `RecordAction` in the
working tree (2026-10-07). It is input to `.ai/specs/2026-10-07-mobile-chrome-structure.md`.

## Building blocks

- **`RecordChrome`** (`apps/erp/app/components/Layout/RecordChrome.tsx`)
  - Props: `hero {title, subtitle, status}`, `menu`, `copyValue`, `bleed` (`-mx-4 -mt-4`).
  - It writes `--header-height` and `--hero-height` from the hero element.
  - The app bar ⋯ shows "Copy ID" plus `menu`.
  - The bottom bar has a primary cell, a secondary cell, and a ⋯ button. The ⋯ button opens the "Actions" BottomSheet when the overflow count is above 0.
- **`RecordAction({slot})`**
  - Desktop: renders its children in place.
  - Phones: portals the children into the slot's zustand-held target and counts them.
  - The overflow sheet closes when a `button` or `a` is clicked, unless the click is inside `[aria-haspopup]`.
  - Sheet rows get their look from `[&_button]` / `[&_a]` overrides, plus `[&_.bg-destructive]:text-destructive` and `[&>*_button+button]:w-11` for the split-button chevron.
- **`DocumentHeader`**
  - Props: `{title: string, subtitle?, status?, menuItems?, actions?, className?}`. It renders `CardHeader` with an h3 heading, `Copy`, a ⋯ menu when there are items, the status, the subtitle and an actions HStack.
  - This branch only added `className`.
- **The common desktop ⋯ trigger** is `IconButton aria-label=t\`More options\` icon=LuEllipsisVertical variant="secondary" size="sm"`.

## Call sites (38)

**Shell A** (11): SalesOrder, Quote, SalesRFQ, SalesReturnOrder, PurchaseOrder, PurchaseReturnOrder, PurchasingRFQ, SupplierQuote, PurchaseInvoice, SalesInvoice, Job.
- Class: `flex flex-shrink-0 items-center justify-between gap-x-4 p-2 bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide compact:hidden`.
- Left side: explorer toggle, Link > Heading h4 > id (plus `RevisionSuffix` in Quote and PO), Copy, ⋯, status.
- Right side: actions, then the properties toggle.
- Job has no `HStack w-full` wrapper.

**Shell B** (14):
- Members:
  - 5 item headers: Material, Part, Tool, Service, Consumable.
  - ChangeNotice, Issue, MaintenanceDispatch, PickingList, StockTransfer, Procedure, Training, QualityDocument, AssemblyInstruction.
- Class: `flex flex-shrink-0 items-center justify-between gap-x-4 px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide compact:hidden`.
- Item headers:
  - Order: Link, Copy, status, ⋯. The right side holds `<DetailsTopbar links>`.
  - They have 0 actions.
  - On phones, DetailsTopbar registers the record tabs from inside the hidden shell.
- Status-first order (status, Copy, ⋯): ChangeNotice, Issue, Maintenance.
- Plain heading with no Link: PickingList, StockTransfer, Procedure, Training, QualityDocument.
- Badges inside the Heading: Procedure, Training, QualityDocument.
- Assembly:
  - The title is a controlled `Input`, guarded by `{!isCompact && nameInput}`.
  - It has no Copy.
  - It has an "edited by" meta span.

**Other topbar headers:**
- InspectionView:
  - Raw `h1`, status, and a `metaLine` subtitle.
  - No Copy and no ⋯.
- BuilderHeader:
  - A `<header>` with `h-[var(--topbar-height)]`.
  - The `WorkflowTitle` is stateful, guarded by `{!isCompact && …}`, with an `inHero` variant.
  - It also has a lock indicator and a SaveMarker.

**Company cards:** Customer, Supplier.
- `CardTitle` with name, ⋯, then `Copy label icon`.
- No hero. Supplier also has `CardAction` actions.

**Card headers** (7):
- Receipt, Shipment, WarehouseTransfer, Payment, Memo and FixedAsset use `DocumentHeader className="compact:hidden"`.
- JournalEntryForm hand-rolls the same CardHeader.
- `bleed` is set everywhere except WarehouseTransfer, which mounts RecordChrome inside the Card.
- Payment and Memo mount RecordChrome inside the `ValidatedForm`.

**Actions-only:**
- InventoryCount:
  - The actions live in the table header's `primaryAction`.
  - The Notes action is an icon-only IconButton.
- Reimbursement: `<RecordChrome />` with no props.

## Facts that drive the design

- `menu` and `copyValue` always equal the desktop ⋯ and `Copy text`. I found no mismatch.
- `hero.title` is used only by Assembly and Builder.
- `hero.subtitle` is used only by Quote and PO (`RevisionSubtitle`) and by Inspection (`metaLine`).
- **Slot and variant duplicate each other:** 9 files compute a slot and then restate the same condition as the Button's `variant`.
- **About 14 action pairs disagree**: the phone bar would show two filled buttons, or a primary-slot button styled secondary. The pairs:
  - SO Invoice; Quote Lost; SalesRFQ No Quote.
  - PI/SI Payment.
  - Job Complete and Resume.
  - Issue Complete; Maintenance Complete.
  - PickingList Finish; StockTransfer Complete.
  - WarehouseTransfer Shipments and Receive.
  - Receipt Invoice and Post; Shipment Packing Slip.
  - Builder Unpublish; Inspection Add Sample.
- PO alone patches its mismatch with `isCompact`.
- **Non-Button action children:**
  - DropdownMenu triggers.
  - `fetcher.Form`, `<form>`, `<Form>`.
  - SplitButton (PO Finalize, Job Release).
  - PrintButton, which owns its own Modal.
  - Tooltip wrappers.
  - Suspense/Await, including VersionMenu with `fallback={null}`.
  - Assignee, a raw `<button>` built from `buttonVariants`.
  - An icon-only IconButton.
- **Hazards:**
  1. The item headers' DetailsTopbar must stay mounted on phones.
  2. Modals sit inside the hidden shell in 12 files.
  3. PrintButton sits in the overflow slot, so its Modal unmounts when the sheet closes.
  4. RecordAction counts children that render null, which can open an empty sheet.
- **Button**
  - It reads no context itself; it gets OperatingSystem context indirectly through `useShortcutKeys`.
  - `IconButton` wraps Button.
  - `bg-destructive` only comes from `buttonVariants.variant.destructive`.
- **SplitButton**
  - It is a `div.flex` holding two Buttons, and the chevron is a Radix trigger with `aria-haspopup`.
  - Its `disabled` prop is declared but never used.
