<!-- Generated from src/gaps/catalog.ts by `pnpm --filter @carbon/netsuite generate:gaps`. Do not edit by hand. -->

# What a NetSuite migration leaves behind

Carbon's one-click NetSuite migration brings across the records a manufacturer
needs to operate on day one: the chart of accounts, customers, suppliers, items,
bills of material, on-hand stock, and open sales and purchase orders.

This file is the complete list of what it does **not** bring, and what to do
instead. Each entry has a stable id that the in-app migration report, the docs
site and support all use.

**31 known gaps** — 6 high, 15 medium, 10 low.

Only the gaps that actually cost a given account something are shown in that
account's migration report: extraction counts the affected source records, and a
gap with a proven count of zero is dropped. A gap extraction could not probe is
still shown — "we could not check" and "there is nothing there" must not look
the same to somebody deciding whether to cut over.

## Platform

#### NS-PLT-001 — One NetSuite subsidiary becomes one Carbon company

**Severity:** high · **Status:** Transformed

A OneWorld account holds many subsidiaries in one database. A migration run targets the single Carbon company you start it from, and pulls the records belonging to the subsidiary you pick. Consolidation, intercompany eliminations and subsidiary-level charts of accounts are not reproduced by the run.

*What to do instead:* Run the migration once per subsidiary, into its own Carbon company, then link them as a company group in Settings → Companies.

#### NS-PLT-002 — Custom fields are not mapped onto Carbon custom fields

**Severity:** medium · **Status:** Not migrated

NetSuite `custentity_*`, `custitem_*` and `custbody_*` values are read during extraction and reported, but they are not written into Carbon custom fields: the two systems' field definitions have no shared identity, so an automatic mapping would guess.

*What to do instead:* Define the custom fields you need in Settings → Custom Fields, then import their values from a CSV export — the migrated records already carry their NetSuite ids, so a CSV keyed on them will match.

#### NS-PLT-003 — Custom records, SuiteScripts, workflows and saved searches are not migrated

**Severity:** medium · **Status:** Not migrated

These are NetSuite customizations with no structural equivalent. Carbon's own automation (Workflows) and reporting are configured natively.

*What to do instead:* Re-build the automations you depend on as Carbon workflows, and the reports you depend on as saved views.

#### NS-PLT-004 — File Cabinet attachments and item images are not migrated

**Severity:** medium · **Status:** Not migrated

Documents attached to records, item images and drawings stay in NetSuite's File Cabinet. Only record data moves.

*What to do instead:* Download the File Cabinet folders you need and re-attach them in Carbon, or keep them in your PDM/PLM system and link from the item.

#### NS-PLT-005 — Employees, roles and permissions are not migrated

**Severity:** low · **Status:** Not migrated

Carbon users are invited and assigned permissions inside Carbon; NetSuite employee records, roles and permission sets do not transfer. NetSuite departments ARE migrated, since they are referenced by other records.

*What to do instead:* Invite your team from Settings → People and assign Carbon permissions there.

#### NS-PLT-006 — Document numbers are preserved; Carbon's numbering continues from the highest one seen

**Severity:** low · **Status:** Transformed

Migrated sales and purchase orders keep their NetSuite transaction numbers. Carbon advances its own sequence past the highest numeric suffix it recognizes, so the next order you create does not collide. A transaction number with no numeric suffix cannot advance the sequence and is reported.

*What to do instead:* Check Settings → Sequences after the migration and set the next number yourself if your numbering scheme is unusual.

## Accounting

#### NS-ACC-001 — General ledger transaction history does not come across

**Severity:** high · **Status:** Not migrated

Carbon posts its own ledger from the documents it owns, so importing NetSuite's posted journal lines would create GL entries with no originating document and no way to reconcile them. The chart of accounts itself IS migrated; the postings against it are not.

*What to do instead:* Keep NetSuite (or an export of it) as the system of record for periods before go-live, and start Carbon's ledger from an opening trial balance entered as a manual journal on the cutover date.

#### NS-ACC-002 — Open AR and AP balances are not migrated

**Severity:** high · **Status:** Not migrated

Invoices, vendor bills, credit memos, customer payments and vendor payments stay in NetSuite. Carbon's invoice and settlement tables model applications and FX differently enough that a mechanical copy would produce balances that do not tie.

*What to do instead:* Collect and pay the open NetSuite documents out of NetSuite, or re-enter the remaining open invoices in Carbon as of the cutover date. The migrated customers and suppliers are already there to post them against.

#### NS-ACC-003 — Accounting periods and their close status are not migrated

**Severity:** medium · **Status:** Not migrated

NetSuite accounting periods, their lock/close state and any multi-book setup do not transfer. Carbon creates its own period calendar.

*What to do instead:* Set up Carbon's period calendar in Settings → Accounting before posting anything.

#### NS-ACC-004 — Only the account tree comes across — not budgets, statistical accounts, or classes

**Severity:** medium · **Status:** Partial

Accounts, their numbers, their class and their parent/child structure are migrated. NetSuite budgets, statistical accounts, Classes and Locations-as-a-GL-dimension are not; Carbon's dimensions are configured separately.

*What to do instead:* Re-create the segments you report on as Carbon dimensions (Settings → Accounting → Dimensions), then map them onto documents going forward.

#### NS-ACC-005 — Historical exchange rates are not migrated

**Severity:** low · **Status:** Not migrated

Currencies are created with their code, name and precision. NetSuite's daily/historical exchange-rate table is not copied, so back-dated revaluation in Carbon has no rate history to draw on.

*What to do instead:* Connect Carbon's exchange-rate integration (Settings → Integrations) for forward rates; enter any rate you need for a back-dated document on the document itself.

#### NS-ACC-006 — Tax codes, tax groups and nexuses are not migrated

**Severity:** medium · **Status:** Not migrated

Carbon carries a single tax percentage per customer and per document line rather than NetSuite's tax-code/tax-group/nexus model. The customer's effective rate is migrated where NetSuite exposes one; the code structure behind it is not.

*What to do instead:* Review Settings → Accounting → Tax after the migration and set each customer's rate, or connect a tax provider.

#### NS-ACC-007 — Fixed assets, depreciation schedules, revenue recognition and amortization are not migrated

**Severity:** medium · **Status:** Not migrated

NetSuite's Fixed Asset Management, revenue-recognition schedules, amortization schedules and deferred-revenue balances have no automatic path into Carbon's equivalents.

*What to do instead:* Re-create open assets in Carbon's Fixed Assets module with their remaining book value and life as of the cutover date.

## Customers

#### NS-CUS-001 — Credit limits, holds and customer-specific pricing are not migrated

**Severity:** low · **Status:** Not migrated

Carbon has no direct equivalent of NetSuite's credit limit / credit hold fields, and its pricing rules are authored separately from a customer's price level.

*What to do instead:* Re-create the pricing you rely on as Carbon pricing rules, and track credit status in your finance process until Carbon models it.

#### NS-CUS-002 — Leads and prospects are not migrated

**Severity:** low · **Status:** Not migrated

Only NetSuite entities whose stage is Customer are migrated. Leads and prospects are CRM records that Carbon does not model as customers.

*What to do instead:* Convert the ones you want in NetSuite before migrating, or add them in Carbon by hand.

## Suppliers

#### NS-SUP-001 — Supplier capabilities and approvals are not migrated

**Severity:** low · **Status:** Partial

Vendor records, their addresses, contacts, payment terms and the parts they supply come across. NetSuite vendor approval state, 1099 configuration and vendor-specific document templates do not.

*What to do instead:* Re-approve suppliers in Carbon's Supplier module as part of your go-live checklist.

## Items

#### NS-ITM-001 — NetSuite item types are collapsed onto Carbon's six

**Severity:** medium · **Status:** Transformed

Inventory and assembly items become Parts; service items become Services; non-inventory items become Consumables; other-charge items become Services. Carbon's Material and Tool types are never chosen automatically, because NetSuite carries nothing that distinguishes them.

*What to do instead:* Re-type the items that should be Materials or Tools from the item list after the migration — changing an item's type is a normal edit.

#### NS-ITM-002 — Kit/package items and matrix parents are not migrated

**Severity:** medium · **Status:** Not migrated

A NetSuite kit is a sales bundle that ships as its components, and a matrix parent is a template for its children. Carbon models neither, so both are skipped; matrix CHILD items are migrated normally.

*What to do instead:* Re-create kits as a Carbon part with a bill of materials, or sell the components as separate order lines.

#### NS-ITM-003 — Only the base price level is migrated

**Severity:** medium · **Status:** Partial

Each item's base price becomes Carbon's unit sale price. NetSuite's additional price levels, quantity price breaks and customer-specific prices are not copied. Supplier prices ARE migrated, as one price per supplier part.

*What to do instead:* Author the price breaks you need as Carbon pricing rules, or import them from a CSV against the migrated items.

#### NS-ITM-004 — Items arrive at a single revision

**Severity:** low · **Status:** Transformed

Carbon versions an item by revision; NetSuite does not. Every migrated item lands at revision 0, which is the revision the rest of the migrated data points at.

*What to do instead:* Cut new revisions in Carbon as engineering changes happen from here on.

## Manufacturing

#### NS-MFG-001 — Routings and manufacturing operations are not migrated

**Severity:** high · **Status:** Not migrated

Carbon's bill of process is built from processes and work centers that a NetSuite account does not define in a comparable way — a NetSuite routing step names a manufacturing cost template and a work center that have no Carbon counterpart to match on. Bills of MATERIAL are migrated; bills of PROCESS are not.

*What to do instead:* Set up your processes and work centers in Carbon first (Settings → Production), then add operations to the migrated bills of material — or import them with the Operations CSV import, which keys on the migrated part numbers.

#### NS-MFG-002 — Only the current BOM revision is migrated

**Severity:** medium · **Status:** Partial

An assembly's bill of materials is taken from the revision that is effective today. NetSuite BOM revision history, future-dated revisions and per-component effective dates are not copied.

*What to do instead:* Keep NetSuite available for BOM history, and manage future changes through Carbon change orders.

#### NS-MFG-003 — Work orders and work in progress are not migrated

**Severity:** high · **Status:** Not migrated

Open NetSuite work orders, their issued components, their completed quantities and their WIP value do not come across. Carbon jobs carry costs and a schedule that cannot be reconstructed from a work order header.

*What to do instead:* Finish open work orders in NetSuite, or close them there and re-release the remaining quantity as a Carbon job against the migrated part.

## Inventory

#### NS-INV-001 — Opening stock arrives as one positive adjustment per item and location

**Severity:** medium · **Status:** Transformed

On-hand quantity is migrated as a Carbon inventory receipt dated the migration day. The NetSuite transaction history that produced that quantity is not replayed, so Carbon's cost layers start from the migration rather than from the original receipts.

*What to do instead:* Review Inventory → Item Ledger after the migration; adjust the opening unit cost if your valuation needs to match NetSuite exactly.

#### NS-INV-002 — Lot and serial numbers on hand are not migrated

**Severity:** high · **Status:** Not migrated

Opening stock is migrated as a quantity per item and location. The individual lot and serial records behind it — and their expiry dates — are not re-created, so a lot- or serial-tracked item arrives with stock that Carbon cannot issue until tracked entities exist for it.

*What to do instead:* Count lot- and serial-tracked items into Carbon with an inventory count, or import the tracked entities, before you issue any of that stock.

#### NS-INV-003 — Bins are not migrated; stock lands at the location

**Severity:** medium · **Status:** Not migrated

NetSuite bins and bin-level quantities are not copied into Carbon's storage units. Opening stock is posted against the location as a whole.

*What to do instead:* Create your storage units (Inventory → Storage), then move the opening stock into them with a transfer or a count.

#### NS-INV-004 — Reorder points and preferred stock levels are not migrated

**Severity:** low · **Status:** Not migrated

NetSuite's per-item, per-location reorder point, preferred stock level and safety stock are not copied into Carbon's item planning rows, which are created with Carbon's defaults.

*What to do instead:* Set your planning policy in Carbon per item, or let Carbon's demand-driven planning derive it.

## Sales

#### NS-SLS-001 — Only open sales orders are migrated

**Severity:** medium · **Status:** Partial

Sales orders that are still open — pending fulfilment or partially fulfilled — come across with their remaining quantities. Closed, cancelled and fully billed orders stay in NetSuite, as do estimates, opportunities, returns and fulfilments.

*What to do instead:* Keep NetSuite for order history. Quotes can be re-created in Carbon against the migrated customers and items.

#### NS-SLS-002 — Order lines without an item become comment lines

**Severity:** low · **Status:** Transformed

NetSuite description, discount, subtotal and markup lines carry no item. They are migrated as Carbon comment lines so the order reads the same, but they carry no value and do not affect the order total.

*What to do instead:* Re-apply discounts as a Carbon line discount if the amount matters to the order total.

## Purchasing

#### NS-PUR-001 — Only open purchase orders are migrated

**Severity:** medium · **Status:** Partial

Purchase orders pending receipt or partially received come across with their remaining quantities. Closed and fully billed orders, item receipts, vendor bills, RFQs and blanket orders stay in NetSuite.

*What to do instead:* Receive what is in transit against the migrated purchase orders; keep NetSuite for history.

#### NS-PUR-002 — Drop-ship and special-order linkage is not migrated

**Severity:** low · **Status:** Not migrated

A NetSuite purchase order created from a sales order keeps a link to it. That link is not reproduced, so a migrated drop-ship purchase order arrives as an ordinary purchase order.

*What to do instead:* Re-link by creating the purchase order from the Carbon sales order line where it matters.
