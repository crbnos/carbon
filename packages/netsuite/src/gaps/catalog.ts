import type { MigrationGapDefinition } from "./types.ts";

/**
 * Everything a NetSuite → Carbon migration does not carry across, or carries
 * across differently. Source of truth: `GAPS.md` is generated from this list and
 * `catalog.test.ts` fails if the two drift.
 *
 * Ids are stable and never renumbered — the run report, the docs site and the
 * support playbook all reference them.
 */
export const GAP_CATALOG: MigrationGapDefinition[] = [
  // ── Accounting ────────────────────────────────────────────────────────────
  {
    id: "NS-ACC-001",
    area: "accounting",
    severity: "high",
    status: "not-migrated",
    title: "General ledger transaction history does not come across",
    detail:
      "Carbon posts its own ledger from the documents it owns, so importing NetSuite's posted journal lines would create GL entries with no originating document and no way to reconcile them. The chart of accounts itself IS migrated; the postings against it are not.",
    workaround:
      "Keep NetSuite (or an export of it) as the system of record for periods before go-live, and start Carbon's ledger from an opening trial balance entered as a manual journal on the cutover date."
  },
  {
    id: "NS-ACC-002",
    area: "accounting",
    severity: "high",
    status: "not-migrated",
    title: "Open AR and AP balances are not migrated",
    detail:
      "Invoices, vendor bills, credit memos, customer payments and vendor payments stay in NetSuite. Carbon's invoice and settlement tables model applications and FX differently enough that a mechanical copy would produce balances that do not tie.",
    workaround:
      "Collect and pay the open NetSuite documents out of NetSuite, or re-enter the remaining open invoices in Carbon as of the cutover date. The migrated customers and suppliers are already there to post them against."
  },
  {
    id: "NS-ACC-003",
    area: "accounting",
    severity: "medium",
    status: "not-migrated",
    title: "Accounting periods and their close status are not migrated",
    detail:
      "NetSuite accounting periods, their lock/close state and any multi-book setup do not transfer. Carbon creates its own period calendar.",
    workaround:
      "Set up Carbon's period calendar in Settings → Accounting before posting anything."
  },
  {
    id: "NS-ACC-004",
    area: "accounting",
    severity: "medium",
    status: "partial",
    title:
      "Only the account tree comes across — not budgets, statistical accounts, or classes",
    detail:
      "Accounts, their numbers, their class and their parent/child structure are migrated. NetSuite budgets, statistical accounts, Classes and Locations-as-a-GL-dimension are not; Carbon's dimensions are configured separately.",
    workaround:
      "Re-create the segments you report on as Carbon dimensions (Settings → Accounting → Dimensions), then map them onto documents going forward."
  },
  {
    id: "NS-ACC-005",
    area: "accounting",
    severity: "low",
    status: "not-migrated",
    title: "Historical exchange rates are not migrated",
    detail:
      "Currencies are created with their code, name and precision. NetSuite's daily/historical exchange-rate table is not copied, so back-dated revaluation in Carbon has no rate history to draw on.",
    workaround:
      "Connect Carbon's exchange-rate integration (Settings → Integrations) for forward rates; enter any rate you need for a back-dated document on the document itself."
  },
  {
    id: "NS-ACC-006",
    area: "accounting",
    severity: "medium",
    status: "not-migrated",
    title: "Tax codes, tax groups and nexuses are not migrated",
    detail:
      "Carbon carries a single tax percentage per customer and per document line rather than NetSuite's tax-code/tax-group/nexus model. The customer's effective rate is migrated where NetSuite exposes one; the code structure behind it is not.",
    workaround:
      "Review Settings → Accounting → Tax after the migration and set each customer's rate, or connect a tax provider."
  },
  {
    id: "NS-ACC-007",
    area: "accounting",
    severity: "medium",
    status: "not-migrated",
    title:
      "Fixed assets, depreciation schedules, revenue recognition and amortization are not migrated",
    detail:
      "NetSuite's Fixed Asset Management, revenue-recognition schedules, amortization schedules and deferred-revenue balances have no automatic path into Carbon's equivalents.",
    workaround:
      "Re-create open assets in Carbon's Fixed Assets module with their remaining book value and life as of the cutover date."
  },

  // ── Platform ──────────────────────────────────────────────────────────────
  {
    id: "NS-PLT-001",
    area: "platform",
    severity: "high",
    status: "transformed",
    title: "One NetSuite subsidiary becomes one Carbon company",
    detail:
      "A OneWorld account holds many subsidiaries in one database. A migration run targets the single Carbon company you start it from, and pulls the records belonging to the subsidiary you pick. Consolidation, intercompany eliminations and subsidiary-level charts of accounts are not reproduced by the run.",
    workaround:
      "Run the migration once per subsidiary, into its own Carbon company, then link them as a company group in Settings → Companies."
  },
  {
    id: "NS-PLT-002",
    area: "platform",
    severity: "medium",
    status: "not-migrated",
    title: "Custom fields are not mapped onto Carbon custom fields",
    detail:
      "NetSuite `custentity_*`, `custitem_*` and `custbody_*` values are read during extraction and reported, but they are not written into Carbon custom fields: the two systems' field definitions have no shared identity, so an automatic mapping would guess.",
    workaround:
      "Define the custom fields you need in Settings → Custom Fields, then import their values from a CSV export — the migrated records already carry their NetSuite ids, so a CSV keyed on them will match."
  },
  {
    id: "NS-PLT-003",
    area: "platform",
    severity: "medium",
    status: "not-migrated",
    title:
      "Custom records, SuiteScripts, workflows and saved searches are not migrated",
    detail:
      "These are NetSuite customizations with no structural equivalent. Carbon's own automation (Workflows) and reporting are configured natively.",
    workaround:
      "Re-build the automations you depend on as Carbon workflows, and the reports you depend on as saved views."
  },
  {
    id: "NS-PLT-004",
    area: "platform",
    severity: "medium",
    status: "not-migrated",
    title: "File Cabinet attachments and item images are not migrated",
    detail:
      "Documents attached to records, item images and drawings stay in NetSuite's File Cabinet. Only record data moves.",
    workaround:
      "Download the File Cabinet folders you need and re-attach them in Carbon, or keep them in your PDM/PLM system and link from the item."
  },
  {
    id: "NS-PLT-005",
    area: "platform",
    severity: "low",
    status: "not-migrated",
    title: "Employees, roles and permissions are not migrated",
    detail:
      "Carbon users are invited and assigned permissions inside Carbon; NetSuite employee records, roles and permission sets do not transfer. NetSuite departments ARE migrated, since they are referenced by other records.",
    workaround:
      "Invite your team from Settings → People and assign Carbon permissions there."
  },
  {
    id: "NS-PLT-006",
    area: "platform",
    severity: "low",
    status: "transformed",
    title:
      "Document numbers are preserved; Carbon's numbering continues from the highest one seen",
    detail:
      "Migrated sales and purchase orders keep their NetSuite transaction numbers. Carbon advances its own sequence past the highest numeric suffix it recognizes, so the next order you create does not collide. A transaction number with no numeric suffix cannot advance the sequence and is reported.",
    workaround:
      "Check Settings → Sequences after the migration and set the next number yourself if your numbering scheme is unusual."
  },

  // ── Customers and suppliers ───────────────────────────────────────────────
  {
    id: "NS-CUS-001",
    area: "customers",
    severity: "low",
    status: "not-migrated",
    title:
      "Credit limits, holds and customer-specific pricing are not migrated",
    detail:
      "Carbon has no direct equivalent of NetSuite's credit limit / credit hold fields, and its pricing rules are authored separately from a customer's price level.",
    workaround:
      "Re-create the pricing you rely on as Carbon pricing rules, and track credit status in your finance process until Carbon models it."
  },
  {
    id: "NS-CUS-002",
    area: "customers",
    severity: "low",
    status: "not-migrated",
    title: "Leads and prospects are not migrated",
    detail:
      "Only NetSuite entities whose stage is Customer are migrated. Leads and prospects are CRM records that Carbon does not model as customers.",
    workaround:
      "Convert the ones you want in NetSuite before migrating, or add them in Carbon by hand."
  },
  {
    id: "NS-SUP-001",
    area: "suppliers",
    severity: "low",
    status: "partial",
    title: "Supplier capabilities and approvals are not migrated",
    detail:
      "Vendor records, their addresses, contacts, payment terms and the parts they supply come across. NetSuite vendor approval state, 1099 configuration and vendor-specific document templates do not.",
    workaround:
      "Re-approve suppliers in Carbon's Supplier module as part of your go-live checklist."
  },

  // ── Items ─────────────────────────────────────────────────────────────────
  {
    id: "NS-ITM-001",
    area: "items",
    severity: "medium",
    status: "transformed",
    title: "NetSuite item types are collapsed onto Carbon's six",
    detail:
      "Inventory and assembly items become Parts; service items become Services; non-inventory items become Consumables; other-charge items become Services. Carbon's Material and Tool types are never chosen automatically, because NetSuite carries nothing that distinguishes them.",
    workaround:
      "Re-type the items that should be Materials or Tools from the item list after the migration — changing an item's type is a normal edit."
  },
  {
    id: "NS-ITM-002",
    area: "items",
    severity: "medium",
    status: "not-migrated",
    title: "Kit/package items and matrix parents are not migrated",
    detail:
      "A NetSuite kit is a sales bundle that ships as its components, and a matrix parent is a template for its children. Carbon models neither, so both are skipped; matrix CHILD items are migrated normally.",
    workaround:
      "Re-create kits as a Carbon part with a bill of materials, or sell the components as separate order lines."
  },
  {
    id: "NS-ITM-003",
    area: "items",
    severity: "medium",
    status: "partial",
    title: "Only the base price level is migrated",
    detail:
      "Each item's base price becomes Carbon's unit sale price. NetSuite's additional price levels, quantity price breaks and customer-specific prices are not copied. Supplier prices ARE migrated, as one price per supplier part.",
    workaround:
      "Author the price breaks you need as Carbon pricing rules, or import them from a CSV against the migrated items."
  },
  {
    id: "NS-ITM-004",
    area: "items",
    severity: "low",
    status: "transformed",
    title: "Items arrive at a single revision",
    detail:
      "Carbon versions an item by revision; NetSuite does not. Every migrated item lands at revision 0, which is the revision the rest of the migrated data points at.",
    workaround:
      "Cut new revisions in Carbon as engineering changes happen from here on."
  },

  // ── Manufacturing ─────────────────────────────────────────────────────────
  {
    id: "NS-MFG-001",
    area: "manufacturing",
    severity: "high",
    status: "not-migrated",
    title: "Routings and manufacturing operations are not migrated",
    detail:
      "Carbon's bill of process is built from processes and work centers that a NetSuite account does not define in a comparable way — a NetSuite routing step names a manufacturing cost template and a work center that have no Carbon counterpart to match on. Bills of MATERIAL are migrated; bills of PROCESS are not.",
    workaround:
      "Set up your processes and work centers in Carbon first (Settings → Production), then add operations to the migrated bills of material — or import them with the Operations CSV import, which keys on the migrated part numbers."
  },
  {
    id: "NS-MFG-002",
    area: "manufacturing",
    severity: "medium",
    status: "partial",
    title: "Only the current BOM revision is migrated",
    detail:
      "An assembly's bill of materials is taken from the revision that is effective today. NetSuite BOM revision history, future-dated revisions and per-component effective dates are not copied.",
    workaround:
      "Keep NetSuite available for BOM history, and manage future changes through Carbon change orders."
  },
  {
    id: "NS-MFG-003",
    area: "manufacturing",
    severity: "high",
    status: "not-migrated",
    title: "Work orders and work in progress are not migrated",
    detail:
      "Open NetSuite work orders, their issued components, their completed quantities and their WIP value do not come across. Carbon jobs carry costs and a schedule that cannot be reconstructed from a work order header.",
    workaround:
      "Finish open work orders in NetSuite, or close them there and re-release the remaining quantity as a Carbon job against the migrated part."
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  {
    id: "NS-INV-001",
    area: "inventory",
    severity: "medium",
    status: "transformed",
    title:
      "Opening stock arrives as one positive adjustment per item and location",
    detail:
      "On-hand quantity is migrated as a Carbon inventory receipt dated the migration day. The NetSuite transaction history that produced that quantity is not replayed, so Carbon's cost layers start from the migration rather than from the original receipts.",
    workaround:
      "Review Inventory → Item Ledger after the migration; adjust the opening unit cost if your valuation needs to match NetSuite exactly."
  },
  {
    id: "NS-INV-002",
    area: "inventory",
    severity: "high",
    status: "not-migrated",
    title: "Lot and serial numbers on hand are not migrated",
    detail:
      "Opening stock is migrated as a quantity per item and location. The individual lot and serial records behind it — and their expiry dates — are not re-created, so a lot- or serial-tracked item arrives with stock that Carbon cannot issue until tracked entities exist for it.",
    workaround:
      "Count lot- and serial-tracked items into Carbon with an inventory count, or import the tracked entities, before you issue any of that stock."
  },
  {
    id: "NS-INV-003",
    area: "inventory",
    severity: "medium",
    status: "not-migrated",
    title: "Bins are not migrated; stock lands at the location",
    detail:
      "NetSuite bins and bin-level quantities are not copied into Carbon's storage units. Opening stock is posted against the location as a whole.",
    workaround:
      "Create your storage units (Inventory → Storage), then move the opening stock into them with a transfer or a count."
  },
  {
    id: "NS-INV-004",
    area: "inventory",
    severity: "low",
    status: "not-migrated",
    title: "Reorder points and preferred stock levels are not migrated",
    detail:
      "NetSuite's per-item, per-location reorder point, preferred stock level and safety stock are not copied into Carbon's item planning rows, which are created with Carbon's defaults.",
    workaround:
      "Set your planning policy in Carbon per item, or let Carbon's demand-driven planning derive it."
  },

  // ── Sales and purchasing ──────────────────────────────────────────────────
  {
    id: "NS-SLS-001",
    area: "sales",
    severity: "medium",
    status: "partial",
    title: "Only open sales orders are migrated",
    detail:
      "Sales orders that are still open — pending fulfilment or partially fulfilled — come across with their remaining quantities. Closed, cancelled and fully billed orders stay in NetSuite, as do estimates, opportunities, returns and fulfilments.",
    workaround:
      "Keep NetSuite for order history. Quotes can be re-created in Carbon against the migrated customers and items."
  },
  {
    id: "NS-SLS-002",
    area: "sales",
    severity: "low",
    status: "transformed",
    title: "Order lines without an item become comment lines",
    detail:
      "NetSuite description, discount, subtotal and markup lines carry no item. They are migrated as Carbon comment lines so the order reads the same, but they carry no value and do not affect the order total.",
    workaround:
      "Re-apply discounts as a Carbon line discount if the amount matters to the order total."
  },
  {
    id: "NS-PUR-001",
    area: "purchasing",
    severity: "medium",
    status: "partial",
    title: "Only open purchase orders are migrated",
    detail:
      "Purchase orders pending receipt or partially received come across with their remaining quantities. Closed and fully billed orders, item receipts, vendor bills, RFQs and blanket orders stay in NetSuite.",
    workaround:
      "Receive what is in transit against the migrated purchase orders; keep NetSuite for history."
  },
  {
    id: "NS-PUR-002",
    area: "purchasing",
    severity: "low",
    status: "not-migrated",
    title: "Drop-ship and special-order linkage is not migrated",
    detail:
      "A NetSuite purchase order created from a sales order keeps a link to it. That link is not reproduced, so a migrated drop-ship purchase order arrives as an ordinary purchase order.",
    workaround:
      "Re-link by creating the purchase order from the Carbon sales order line where it matters."
  }
];

export function gapById(id: string): MigrationGapDefinition | undefined {
  return GAP_CATALOG.find((gap) => gap.id === id);
}
