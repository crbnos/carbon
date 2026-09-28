# Page archetypes, layout and navigation

Every Carbon screen is one of a small number of archetypes. **Identify the archetype first**,
then open its exemplar and match the shape. Paths below are relative to `apps/erp/app/`
unless they start with `apps/` or `packages/`.

## Contents
1. App shell
2. Two navigation contexts: module mode vs document mode
3. Archetype A — Module list page
4. Archetype B — Document workspace (3-pane)
5. Archetype C — Item master (route tabs)
6. Archetype D — Party / master record (Customer, Supplier, Person)
7. Archetype E — Posting document (single column)
8. Archetype F — Settings preference page
9. Archetype G — Config collection (table + drawer)
10. Archetype H — Module dashboard
11. Archetype I — Split list/detail lookup
12. Where "create" opens — decision rule
13. Navigation: sub-nav, breadcrumbs, handles, command palette
14. Responsive behaviour
15. Choosing an archetype for something new

---

## 1. App shell (don't rebuild — plug into it)

```
┌──────┬──────────────────────────────────────────────────────────────────┐
│ RAIL │ ╭ content panel: bg-card, md:inset + rounded-2xl + border ───────╮ │
│ w-14 │ │ TOPBAR 49px  Company ▾ / Module / List / ID     ✎ 🔔 Avatar    │ │
│ ⌕    │ ├────────────────────────────────────────────────────────────────┤ │
│ mods │ │ <main>  module layout (sub-nav + Outlet) or document workspace │ │
│ ⚙    │ ╰────────────────────────────────────────────────────────────────╯ │
└──────┴──────────────────────────────────────────────────────────────────┘
```
- Shell: `routes/x+/_layout.tsx`. Rail: `components/Layout/Navigation/PrimaryNavigation.tsx`
  (icon rail, hover-expands, pushes content). Modules are registered in `hooks/useModules.tsx`
  (`{ key, permission, name, to, icon }`, Lucide icons, Settings pinned bottom).
- Topbar: breadcrumbs (from route `handle`), global ✎ Create menu
  (`components/Layout/Topbar/CreateMenu.tsx`), notifications, avatar.
- ⌘K command palette (`components/Layout/Topbar/Search.tsx`) indexes every module's
  `use{Module}Submodules` hook, so new sub-pages become searchable by registering them there.
- Layout CSS vars: `--topbar-height` 49px, `--header-height` 50px, `--content-inset`.

## 2. Two navigation contexts

| Context | Route folder | Chrome | Purpose |
|---|---|---|---|
| **Module mode** | plural: `routes/x+/sales+/…` | `GroupedContentSidebar` sub-nav (240px) + `<Outlet/>` | browse collections |
| **Document mode** | singular: `routes/x+/quote+/$quoteId…` | no sub-nav; full-width workspace | work on one record |

Both set `handle.module` so the rail stays highlighted. A detail route nested under a module
folder hides the sub-nav with `handle.hideModuleSidebar` (`utils/handle.ts`).

## 3. Archetype A — Module list page

```
┌ sub-nav ─────┬──────────────────────────────────────────────────────────────┐
│ ─ MANAGE ─   │ [◧] Quotes (serif h2)                  [⊕ Add Quote  n] [⋮]  │
│ ◉ Customers  │ [✓3▾] [🔍 Search] [Filter]   [Sort][Columns][◇View][⇩][‹›]   │
│ ◉ Quotes  ▾  │ (active filter chips — only when filters set)                │
│    · My view │ ┌──────────┬─────────┬────────┬─────────┬────┐               │
│ ─ CONFIGURE ─│ │Q-00012 📌│Customer │ STATUS │ Expires │ ⋮  │ ← ID pinned   │
│ ◉ Price Lists│ └──────────┴─────────┴────────┴─────────┴────┘  (drawer Outlet)│
└──────────────┴──────────────────────────────────────────────────────────────┘
```
- Route: `<VStack spacing={0} className="h-full"><XTable data count /><Outlet /></VStack>`;
  loader uses `getGenericQueryFilters(searchParams)` (`utils/query.ts`) → service →
  `{ data, count }`. Exemplar: `routes/x+/sales+/rmas.tsx` +
  `modules/sales/ui/SalesReturnOrders/SalesReturnOrdersTable.tsx`.
- **The `Table` `title` prop is the page title.** No bespoke header above a table.
- Everything else (columns, filters, row menu, empty state) → `tables-and-lists.md`.
- Sub-nav entries come from `modules/{module}/ui/use{Module}Submodules.tsx`. Group naming:
  first group = the module's main work ("Manage" or a domain name), middle groups =
  sub-domains, **last group = "Configure"** for lookup tables (often `role: "employee"`-gated).

## 4. Archetype B — Document workspace (3-pane)

For transactional/lifecycle records with lines or rich sub-content: Quote, Sales Order, PO,
RFQs, invoices, RMA, Job, Issue, Change Notice, Maintenance, Procedure, Training.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [◧] SO-000123 ⧉ [⋮] (TO SHIP)      [Preview▾] [Ship] [Invoice▾] [RMAs▾] [◨] │ 50px
├──────────────┬──────────────────────────────────────────┬───────────────────┤
│ EXPLORER     │ CONTENT  p-4, VStack spacing 4, scrolls   │ PROPERTIES w-96   │
│ resizable    │ ┌ Summary card (lines, totals) ─────────┐ │ PROPERTIES 🔗 #  ⧉│
│ ▸ Line 1   ⋮ │ ┌ Notes card ───────────────────────────┐ │ Customer   ▸      │
│ ▸ Line 2     │ ┌ Documents card ───────────────────────┐ │ Assignee   ▸      │
│              │ ┌ Payment / Shipping card forms ────────┐ │ Dates, custom…    │
│ [⊕ Add Line ⌘⇧L]│  (selecting a line routes to it here)  │ Tags              │
└──────────────┴──────────────────────────────────────────┴───────────────────┘
```
- Route shell: `PanelProvider` → header component → `ResizablePanels explorer content
  properties` (`components/Layout/Panels.tsx`). Exemplar (newest, cleanest):
  `routes/x+/sales-return-order+/$id.tsx`, `$id.details.tsx`, `$id.$lineId.details.tsx` with
  `modules/sales/ui/SalesReturnOrders/SalesReturnOrder{Header,Explorer,Properties,LineForm}.tsx`.
  Richer: `modules/sales/ui/Quotes/QuoteHeader.tsx`,
  `modules/purchasing/ui/PurchaseOrder/PurchaseOrderHeader.tsx` (downstream-doc dropdowns),
  `modules/production/ui/Jobs/JobHeader.tsx` (derived badges, view switcher),
  `modules/quality/ui/Issue/IssueProperties.tsx` (autosave properties).
- **Capabilities** (add/edit/delete/reorder lines, autosave Properties, lifecycle routes,
  notes, documents, downstream docs, audit log) — the full contract with exemplars is in
  `functionality.md` §2. The shape above is only half the archetype.
- `$id._index.tsx` redirects to `$id.details`. Parent loader loads the record + lines; children
  read them via `useRouteData(path.to.x(id))`.

**Header grammar** (container: `flex flex-shrink-0 items-center justify-between gap-x-4 p-2
bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide` — it never wraps):

| Left = identity, in order | Right = lifecycle, in order |
|---|---|
| 1. ghost `IconButton` `LuPanelLeft` "Toggle Explorer" | 1. cross-links to related docs (secondary) |
| 2. `<Link>` → `Heading size="h4"` readable ID (+ `RevisionSuffix`) | 2. outputs: `Preview ▾` / `PDF` / `Reports ▾` |
| 3. `<Copy text={readableId} />` | 3. view switcher (only if the record has sub-views) |
| 4. ⋯ `DropdownMenu`: `IconButton variant="secondary" size="sm" icon={<LuEllipsisVertical/>}` — audit log, copy/revision, Reopen, separator, destructive Delete last | 4. lifecycle transitions — **next step is the only `primary`** |
| 5. `<EntityStatus />` + derived badges (Overdue, "3d late") | 5. downstream docs: plain button before any exist, `Receipts ▾` dropdown after |
| | 6. ghost `IconButton` `LuPanelRight` "Toggle Properties" |

Modals launched from the header are rendered after the header div and mounted only when open.

**Explorer:** full-height list, rows = thumbnail + `font-semibold` ID + muted description,
hover `bg-accent/30`, selected `bg-accent/60`, hover-revealed chevron + ⋮; pinned footer
`border-t p-4` with a full-width secondary "Add Line Item" (`EXPLORER_SHORTCUTS.addLine`, ⌘⇧L);
`Empty` + the same button when there are no lines. Hierarchical lines use `TreeView`.
Reorder is an explicit edit mode (`components/LineReorder/`).

**Properties:** `w-96 bg-background/30 h-full overflow-y-auto border-l border-border px-4 py-2
text-sm` (`w-[450px]` for rich documents). Top: `Subheading variant="light" as="h3"` "Properties"
+ small copy-link / copy-id icon buttons; then readable ID and inline-editable name; then
labelled inline fields, each saving on change/blur to a bulk-update route; assignee, custom
fields, tags. Read-only when locked.

**Content:** a vertical stack of Cards. Documents show a `…Summary` card (line rows with
96px thumbnail, heading ID, line total, badges; totals block with muted Subtotal/Tax/Shipping
and `text-xl font-semibold` Total, all `justify-between`) — see
`modules/purchasing/ui/PurchaseOrder/PurchaseOrderSummary.tsx`. Line items are **never** a
list `Table` in the content pane.

## 5. Archetype C — Item master (Part, Material, Tool, Consumable, Service)

Header with identity left and `DetailsTopbar` (segmented route links with ⌘⇧letter shortcuts,
tabs disabled when irrelevant) right; explorer with client `Tabs` (Manufacturing / Used In) +
search; Properties shows the selected BoM node. Exemplar: `routes/x+/part+/$itemId.tsx`,
`modules/items/ui/Parts/PartHeader.tsx`, `modules/items/ui/Parts/usePartNavigation.tsx`,
`components/Layout/Navigation/DetailsTopbar.tsx`.

## 6. Archetype D — Party / master record (Customer, Supplier, Person)

Centered `max-w-[80rem] p-4`: header Card (name + ⋮ + `CardAttributes` strip of key facts) over
a `md:grid-cols-[1fr_4fr]` of `DetailSidebar` (sections with `Count` badges) and routed content.
Exemplar: `routes/x+/customer+/$customerId.tsx`, `modules/sales/ui/Customer/CustomerHeader.tsx`,
`components/Layout/Navigation/DetailSidebar.tsx`. Use for long-lived records with many
sub-collections (contacts, locations, terms) and no line-based lifecycle.

## 7. Archetype E — Posting document (Receipt, Shipment, Journal Entry, Fixed Asset)

Centered `max-w-5xl mx-auto p-4` stack of cards, no explorer/properties; header via
`components/DocumentHeader.tsx` inside a Card or a `*Header` strip. Lines are a card-row list
with inline inputs (`.claude/rules/shipments-receipts-ui-patterns.md`). Use for short-lived,
often system-generated documents that are filled in then posted.

## 8. Archetype F — Settings preference page

```
ScrollArea → VStack py-12 px-4 max-w-[60rem] mx-auto gap-4
  Heading h3 "Sales"
  SettingsSectionHeader "Documents"
  Card [ CardHeader(Title + Description) | CardContent(max-w-[400px] fields) | CardFooter(Save) ]
  Card [ CardHeader(Title + Description) … Switch on the right → saves instantly + toast ]
```
One Card = one independently saved concern (one `intent` each in the route action). A single
on/off is a `Switch` / `Boolean bordered` toggle card that autosaves; multi-field groups have
a Save footer. Exemplars: `routes/x+/settings+/sales.tsx`, `routes/x+/settings+/inventory.tsx`,
`routes/x+/settings+/items.tsx` (toggles), `components/SettingsSectionHeader.tsx`. A toggle's
label states the current state plus a one-line consequence (`dd560505c1`).

Company-wide preferences go in Settings (`modules/settings/ui/useSettingsSubmodules.tsx`).
Module lookup tables (types, reasons, statuses) go in the module's **Configure** sub-nav group,
not in Settings.

## 9. Archetype G — Config collection (table + drawer)

Lookup/config rows (customer types, scrap reasons, payment terms, API keys): list `Table`
whose first column is `Hyperlink → Enumerable value={name}` (relative link) and a drawer form
rendered via nested routes `{collection}.new.tsx`, `{collection}.$id.tsx`,
`{collection}.delete.$id.tsx`. Exemplar: `routes/x+/sales+/customer-types.tsx` (+ `.new`,
`.$customerTypeId`, `.delete.$customerTypeId`) and
`modules/sales/ui/CustomerTypes/CustomerTypeForm.tsx`. Small **rich** config sets (approval
rules, assignments) use cards + drawer instead of a table (`ad9e436003`).

## 10. Archetype H — Module dashboard

Module `_index.tsx` is either a redirect to the main list or a dashboard of `MetricCard`s +
a chart (`routes/x+/sales+/_index.tsx`). Dashboards are the only multi-widget pages. Charts via
`@carbon/react/Chart` with theme vars.

## 11. Archetype I — Split list/detail lookup

For rapid lookup loops across many rows (inventory quantities): the table stays in a
`ResizablePanel`, the detail renders beside it via `<Outlet/>`, close ✕ returns with params
preserved. Exemplar: `routes/x+/inventory+/quantities.tsx`.

## 12. Where "create" opens — decision rule

| What is created | Opens as | Shape |
|---|---|---|
| A record that gets its own detail workspace (document, job, part, customer) | **full page** `routes/x+/{entity}+/new.tsx`, centered `max-w-4xl`, the record form in a Card; on save redirect to the detail page | `routes/x+/quote+/new.tsx` + `QuoteForm.tsx` |
| A flat lookup/config row (≤ ~5 fields, no children) | **right drawer** over the list via nested route; form written with `ModalDrawer` | CustomerTypeForm |
| The same row created from inside a picker | same form, `type="modal"` (ModalDrawer switches to Modal) | `components/Form/Customer.tsx` |
| A child line of an open document | **modal** from the Explorer "Add Line Item"; then edited as a Card in the content pane (`ModalCard`) | SalesReturnOrderLineForm |
| A downstream document derived from another (receipt from PO) | **no form**: action-only route creates it, redirects to it | `.claude/rules/shipments-receipts-ui-patterns.md` |
| Delete | `ConfirmDelete` modal, often its own `delete.$id` route | |

Top-level creates have two entry points by design: the list's "Add X" and the global ✎ Create
menu (add new document types to `CreateMenu.tsx`). Both link to the same `path.to.newX`.

## 13. Navigation

- **Breadcrumbs** come only from route `handle.breadcrumb` (Lingui `msg`). Detail routes use
  `detailBreadcrumb({ breadcrumb: msg\`Quotes\`, to: path.to.quotes }, data => data?.quote?.quoteId)`
  so crumbs end with the readable ID (`utils/handle.ts`). Never render breadcrumbs by hand.
- **Recently viewed** is automatic for any route whose handle has a detail breadcrumb and a module.
- **In-record navigation:** `DetailsTopbar` (item masters), `DetailSidebar` (party records),
  Explorer rows (document lines), a header view dropdown (Job).
- **Paths** always via `path.to.*` (`utils/path.ts`); never string-built URLs.

## 14. Responsive

One JS breakpoint: `useIsMobile` = `< 768px`. ERP is desktop-first:
- < md: rail hidden → hamburger drawer; module sub-nav → "Submodules" drawer; Explorer and
  Properties become overlay drawers that close on navigation; breadcrumbs hidden.
- 768–1023px: Properties starts collapsed.
- Form grids collapse to one column (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`).
- Headers never wrap — they scroll horizontally.
- Table gutters `px-0 md:px-4 lg:px-6`.

MES is tablet-first with `lg` as the pivot — see `shop-floor-mes.md`.

## 15. Choosing an archetype for something new

Ask in order:
1. Is it a collection users search, filter and open? → **A** (and **G** for its config rows).
2. Does one record have a lifecycle (statuses, next steps) and lines or rich sub-content? → **B**.
3. Is it a master record with many sub-collections and no lifecycle? → **D**.
4. Is it a short-lived document that is filled in and posted? → **E**.
5. Is it a company-wide preference? → **F**.
6. Is it a rapid lookup loop across many rows? → **I**.
7. Is it an item-like record with several facets (planning, costing, inventory)? → **C**.
8. Operator on the shop floor? → MES (`shop-floor-mes.md`).

If none fits, compose from these shells (header strip, 3-pane, card stack, table) before
inventing a new layout, and state in your design brief why no archetype fits.
