/**
 * The docs glossary — one source of truth for the inline <Term> popovers.
 *
 * Keys are slugs (lowercase, hyphenated). Author usage in MDX:
 *   <Term>purchase to order</Term>          — slugifies the text to find the entry
 *   <Term id="purchase-to-order">bought</Term> — explicit key when display text differs
 *
 * Definitions are deliberately short: one crisp, grounded sentence to identify the
 * term — the full story lives behind the "Learn more" link. `href` (optional) points
 * that link at the exact section that explains the term, not just the page top; omit
 * it for terms with no home yet (popover still shows the definition). Anchors are
 * grounded against real headings in docs/content — fix them if a heading is renamed.
 * Enum values verified:
 *   methodType            → "Make to Order" | "Purchase to Order" | "Pull from Inventory"
 *                           (packages/database/.../20260321143847_method-type-migration.sql)
 *   itemReplenishmentSystem → "Buy" | "Make" | "Buy and Make"
 *                           (packages/database/.../20230330024716_parts.sql)
 */
export type GlossaryEntry = {
  /** Canonical name shown as the popover heading. */
  term: string;
  /** One crisp, grounded sentence. */
  definition: string;
  /** Optional internal route + section anchor for the "Learn more" link. */
  href?: string;
};

/** Slugify a term name into a stable anchor id (used for glossary row ids + search
 * deep-links). Mirrors the slug rule the <Term> component uses. */
export function termSlug(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The glossary as a deduped, alphabetically-sorted list. Several slugs are aliases
 * of one term (cogs / cost-of-goods-sold), so dedupe by display name. One source for
 * both the on-page <Glossary> render and the search index. */
export function glossaryEntries(): GlossaryEntry[] {
  const byTerm = new Map<string, GlossaryEntry>();
  for (const entry of Object.values(glossary)) {
    if (!byTerm.has(entry.term)) byTerm.set(entry.term, entry);
  }
  return [...byTerm.values()].sort((a, b) =>
    a.term.toLowerCase().localeCompare(b.term.toLowerCase()),
  );
}

export const glossary: Record<string, GlossaryEntry> = {
  oem: {
    term: "OEM (original equipment manufacturer)",
    definition:
      "A company that designs and builds its own finished products end to end (here, the shop building humanoid robots) rather than making parts to another company's specification.",
  },
  "method-type": {
    term: "Method type",
    definition:
      "How a part gets into its parent, set per line: Make to Order, Purchase to Order, or Pull from Inventory.",
    href: "/docs/reference/methods#method-type",
  },
  "make-to-order": {
    term: "Make to Order",
    definition:
      "The part is manufactured as its own job when the parent that needs it is built.",
    href: "/docs/reference/methods#method-type",
  },
  "purchase-to-order": {
    term: "Purchase to Order",
    definition:
      "The material is purchased from a supplier for that specific order, rather than made or pulled from stock.",
    href: "/docs/reference/methods#method-type",
  },
  "pull-from-inventory": {
    term: "Pull from Inventory",
    definition:
      "The part is taken from existing stock when its parent is built — no new job or purchase order.",
    href: "/docs/reference/methods#method-type",
  },
  "replenishment-system": {
    term: "Replenishment system",
    definition:
      "How an item is replenished overall (Buy, Make, or Buy and Make), set per item, unlike the per-line method type.",
    href: "/docs/reference/methods#method-type-vs-replenishment-system",
  },
  method: {
    term: "Method",
    definition:
      "Carbon's name for a bill of materials: the components plus the operations that make a part.",
    href: "/docs/reference/methods",
  },
  bom: {
    term: "Bill of materials",
    definition:
      "Called a method in Carbon — the components plus operations that produce a part.",
    href: "/docs/reference/methods",
  },
  wip: {
    term: "Work in process (WIP)",
    definition:
      "Not a table but a general-ledger balance: cost accumulates as job materials are issued and clears when the job is received to stock.",
    href: "/guides/job-costing#wip-isnt-a-table",
  },
  "outside-operation": {
    term: "Outside operation",
    definition:
      "An operation done by an outside supplier rather than an in-house work center, covered by a subcontracting purchase order.",
  },
  subassembly: {
    term: "Subassembly",
    definition:
      "A Make to Order component that gets its own job and routing inside the parent's build.",
    href: "/docs/reference/methods#kit-or-subassembly",
  },
  kit: {
    term: "Kit",
    definition:
      "A Make to Order component whose parts are issued together into the parent job — no separate build.",
    href: "/docs/reference/methods#kit-or-subassembly",
  },
  "lead-time": {
    term: "Lead time",
    definition:
      "Days from ordering a part to having it available; planning offsets demand backward by this much.",
    href: "/docs/reference/reordering#fields",
  },
  "reorder-point": {
    term: "Reorder point",
    definition:
      "The on-hand level that triggers a new replenishment order under the quantity-based policies.",
    href: "/docs/reference/reordering#policies",
  },
  "reordering-policy": {
    term: "Reordering policy",
    definition:
      "How an item is replenished: Manual Reorder, Demand-Based Reorder, Fixed Reorder Quantity, or Maximum Quantity.",
    href: "/docs/reference/reordering#policies",
  },

  // ── Production & the floor ──────────────────────────────────────────────
  // Enums verified: jobStatus (20240909194622_jobs.sql + 20260504000002_job-closed-status.sql),
  // productionQuantity.type (20241002012019_production-quantities.sql), rework (20260527142837_rework.sql),
  // backflush (20260511120000_backflush-job-materials.sql), getMethodValidator (sales.models.ts).
  job: {
    term: "Job",
    definition:
      "Carbon's production order — one job builds a quantity of one item from its own copied method and routing.",
    href: "/docs/reference/jobs",
  },
  routing: {
    term: "Routing",
    definition:
      "The ordered sequence of operations a job runs through, copied from the method's bill of process.",
    href: "/docs/reference/routings",
  },
  operation: {
    term: "Operation",
    definition:
      "One step in a job's routing, naming a process and a work center and carrying its own setup, labor, and machine times and rates.",
    href: "/docs/reference/routings",
  },
  "work-center": {
    term: "Work center",
    definition:
      "Where an operation runs; carries labor and quoting rates, with overhead the difference between them.",
    href: "/docs/reference/work-centers",
  },
  backflush: {
    term: "Backflush",
    definition:
      "Automatic, prorated consumption of a job's untracked materials when output is reported — tracked materials are issued manually.",
    href: "/guides/job-costing#issued-or-backflushed",
  },
  "material-issue": {
    term: "Issue (material)",
    definition:
      "Consuming material from inventory into a job, which writes a Consumption entry to the item ledger.",
    href: "/docs/reference/jobs",
  },
  "get-method": {
    term: "Get Method",
    definition:
      "The action that copies a saved method (its materials, operations, and work instructions) onto a job or quote line.",
    href: "/docs/reference/methods#get-method",
  },
  scrap: {
    term: "Scrap",
    definition:
      "Units reported as unrecoverable at an operation, with a reason — the alternative to rework.",
  },
  rework: {
    term: "Rework",
    definition:
      "Sending defective units back to an earlier operation to be corrected instead of scrapping them.",
  },

  // ── Sales & purchasing ──────────────────────────────────────────────────
  // Enums verified: salesOrderStatus (20250209170952_shipment.sql), purchaseOrderStatus
  // (20230510035345_purchasing.sql + later), quoteStatus (20240715024405_quotes.sql),
  // opportunity (20240815020752_opportunity.sql), dropShipment flag, GR/IR account 2125.
  "sales-order": {
    term: "Sales order",
    definition:
      "A firm customer commitment to deliver; fulfillment status splits across ship and invoice before reaching Completed.",
    href: "/docs/reference/sales-orders",
  },
  "purchase-order": {
    term: "Purchase order",
    definition:
      "A firm order to a supplier; status moves through receive and invoice before Completed as goods and bills arrive.",
    href: "/docs/reference/purchase-orders",
  },
  quote: {
    term: "Quote",
    definition:
      "A priced sales quotation; Draft → Sent → Ordered, or ends Lost, Expired, or Cancelled.",
    href: "/docs/reference/quotes",
  },
  rfq: {
    term: "RFQ (request for quote)",
    definition:
      "A sales RFQ (a customer asks you to quote) or a purchasing RFQ (you ask suppliers); both feed the opportunity thread.",
    href: "/guides/quote-to-cash#one-opportunity-many-documents",
  },
  opportunity: {
    term: "Opportunity",
    definition:
      "The thread linking a sales RFQ, its quote, and the resulting sales order — a join, not a document with its own status.",
    href: "/guides/quote-to-cash#one-opportunity-many-documents",
  },
  "quote-to-cash": {
    term: "Quote to cash",
    definition:
      "The end-to-end commercial flow from quoting a customer to collecting payment: RFQ to quote to sales order, then shipment, invoice, and settled payment.",
    href: "/guides/quote-to-cash",
  },
  "drop-ship": {
    term: "Drop-ship",
    definition:
      "A shipment line sent straight from supplier to customer, bypassing your warehouse — set per line, not on the header.",
    href: "/docs/reference/sales-orders#line-fields",
  },
  "three-way-match": {
    term: "Three-way match",
    definition:
      "Reconciling a purchase order against what was received and invoiced — implicit in Carbon, via the line quantities and GR/IR balance.",
    href: "/guides/receive-and-bill#match-and-post",
  },
  "gr-ir": {
    term: "GR/IR (goods received, not invoiced)",
    definition:
      "A clearing account holding the value of goods received but not yet billed; the supplier invoice clears it.",
    href: "/docs/reference/accounting",
  },

  // ── Inventory, tracking & costing ───────────────────────────────────────
  // Enums verified: trackedEntity status (20250225145619_tracked-entities.sql),
  // costingMethod (20230330024716_parts.sql), receipt/shipment status
  // (20230728025201_receipts.sql, 20250209170952_shipment.sql), conversionFactor.
  "tracked-entity": {
    term: "Tracked entity",
    definition:
      "One serial unit or one batch that Carbon follows individually, carrying its own status and attributes such as an expiry date.",
    href: "/docs/reference/traceability#tracked-entities",
  },
  serial: {
    term: "Serial tracking",
    definition:
      "Each physical unit gets its own tracked entity and unique number — one entity, one unit.",
    href: "/docs/reference/traceability#tracked-entities",
  },
  batch: {
    term: "Batch tracking",
    definition:
      "A quantity of identical units shares one tracked entity and batch number — one entity, many units.",
    href: "/docs/reference/traceability#tracked-entities",
  },
  traceability: {
    term: "Traceability",
    definition:
      "The recorded genealogy of tracked entities — which inputs were consumed to produce which outputs, receipt through shipment.",
    href: "/docs/reference/traceability",
  },
  genealogy: {
    term: "Genealogy",
    definition:
      "The parent-child chain of tracked entities — what a unit was built from and what it became.",
    href: "/docs/reference/traceability#genealogy",
  },
  "costing-method": {
    term: "Costing method",
    definition:
      "How an item's unit cost is valued: Standard, Average, FIFO, or LIFO. Set per item.",
    href: "/docs/reference/items#fields",
  },
  cogs: {
    term: "Cost of goods sold (COGS)",
    definition:
      "The inventory cost recognized when a shipment posts, valued by the item's costing method.",
    href: "/docs/reference/accounting",
  },
  // Alias of "cogs" so the spelled-out term also resolves — keep the definition in sync with it.
  "cost-of-goods-sold": {
    term: "Cost of goods sold (COGS)",
    definition:
      "The inventory cost recognized when a shipment posts, valued by the item's costing method.",
    href: "/docs/reference/accounting",
  },
  "conversion-factor": {
    term: "Conversion factor",
    definition:
      "Converts a supplier's purchase unit to your inventory unit on a PO, receipt, or bill line — buy in cartons of 12, stock in eaches.",
    href: "/guides/receive-and-bill#buy-by-the-box-stock-by-the-each",
  },
  posting: {
    term: "Posting",
    definition:
      "Committing a receipt, shipment, or invoice: quantities move, journal entries hit the ledger, and status becomes Posted.",
    href: "/docs/reference/accounting",
  },
  receipt: {
    term: "Receipt",
    definition:
      "The inbound posting document that takes goods into stock (from a PO, transfer, or job output) and creates any tracked entities.",
    href: "/docs/reference/receipts",
  },
  shipment: {
    term: "Shipment",
    definition:
      "The outbound posting document that takes goods out of stock to a customer, posting COGS as it goes.",
    href: "/docs/reference/shipments",
  },

  // ── Planning, quality & accounting ──────────────────────────────────────
  // Enums verified: nonConformance status + action/task types (20250327140050_ncr.sql),
  // accountingPeriod status Inactive/Active (20230705033432_ledgers.sql), journal model,
  // accountingEnabled gate (20260508000000_accounting-enabled.sql), MRP edge function.
  "demand-forecast": {
    term: "Demand forecast",
    definition:
      "Expected future demand for an item, bucketed by period, populated by the planning run alongside actual demand.",
    href: "/docs/reference/planning#what-feeds-it",
  },
  mrp: {
    term: "MRP (planning)",
    definition:
      "Carbon's planning run nets supply against demand and explodes methods, surfacing shortfalls — but it creates no orders itself.",
    href: "/docs/reference/planning",
  },
  nonconformance: {
    term: "Nonconformance (issue)",
    definition:
      "Carbon's quality issue — a logged deviation or defect with a configurable workflow of investigation and action tasks.",
    href: "/docs/reference/quality#issues",
  },
  "8d": {
    term: "8D",
    definition:
      "The eight-disciplines quality method, modeled with the nonconformance workflow's tasks rather than hard-coded.",
    href: "/docs/reference/quality#workflows-and-actions",
  },
  "corrective-action": {
    term: "Corrective action",
    definition:
      "A nonconformance task that fixes a confirmed root cause — as opposed to a preventive or immediate containment action.",
    href: "/docs/reference/quality#workflows-and-actions",
  },
  "preventive-action": {
    term: "Preventive action",
    definition:
      "A nonconformance task that stops the problem recurring elsewhere — distinct from the corrective fix and containment.",
    href: "/docs/reference/quality#workflows-and-actions",
  },
  "containment-action": {
    term: "Containment action",
    definition:
      "The immediate nonconformance task that quarantines affected stock or work before the root cause is known.",
    href: "/docs/reference/quality#workflows-and-actions",
  },
  journal: {
    term: "Journal",
    definition:
      "A posted accounting entry: a header plus balanced debit and credit lines against GL accounts.",
    href: "/docs/reference/accounting#the-journal",
  },
  "general-ledger": {
    term: "General ledger",
    definition:
      "The book of all posted journal lines, summed by account — written only when the company has accounting enabled.",
    href: "/docs/reference/accounting",
  },
  "accounting-period": {
    term: "Accounting period",
    definition:
      "A dated window postings fall into (Active or Inactive, not open or closed), opened automatically when needed.",
    href: "/docs/reference/accounting#periods",
  },

  // ── Documents & variances (batch 2) ─────────────────────────────────────
  // Grounded: supplierQuote status (20260202000000_supplier_quote_document_type.sql),
  // invoice posting + field-based payment, finished-goods at actual WIP
  // (20260508120000_complete-job-to-inventory.sql), production & PPV variance accounts.
  "supplier-quote": {
    term: "Supplier quote",
    definition:
      "A supplier's priced response to a purchasing RFQ — one per supplier; Draft → Active when they submit, or Declined.",
    href: "/guides/rfq-to-po#suppliers-quote-back",
  },
  invoice: {
    term: "Invoice",
    definition:
      "A sales invoice (you bill a customer) or purchase invoice (a supplier bills you); payment is a field, not a separate record.",
    href: "/docs/reference/invoices",
  },
  "finished-goods": {
    term: "Finished goods",
    definition:
      "A completed job's output, received into inventory at the job's actual accumulated WIP cost.",
    href: "/guides/job-finish-close#finish-into-inventory",
  },
  "production-variance": {
    term: "Production variance",
    definition:
      "The residual WIP a job has left at close, swept to a Production Variance account — the only variance Carbon books for a job.",
    href: "/guides/job-finish-close#close-the-job",
  },
  "purchase-price-variance": {
    term: "Purchase price variance",
    definition:
      "The gap between a purchase order's price and the supplier's bill, posted to a variance account when the invoice posts.",
    href: "/guides/receive-and-bill#match-and-post",
  },

  // ── Fixed assets ────────────────────────────────────────────────────────
  // Enums verified: fixedAssetStatus Draft/Active/Fully Depreciated/Disposed,
  // depreciationMethod Straight Line/Declining Balance/Units of Production
  // (20260524143827_fixed-assets.sql).
  "fixed-asset": {
    term: "Fixed asset",
    definition:
      "An accounting record for a capitalized item you depreciate rather than expense; Draft → Active → Fully Depreciated → Disposed.",
    href: "/docs/reference/fixed-assets",
  },
  "asset-class": {
    term: "Asset class",
    definition:
      "The category a fixed asset belongs to, carrying the GL accounts every asset of that kind posts to.",
    href: "/docs/reference/fixed-assets",
  },
  depreciation: {
    term: "Depreciation",
    definition:
      "Writing an asset's value down over its life — a monthly batch you create, review as a draft, then post.",
    href: "/docs/reference/fixed-assets#depreciating",
  },
  "net-book-value": {
    term: "Net book value",
    definition:
      "An asset's acquisition cost minus accumulated depreciation — what it's still worth on the books, and the figure it's disposed at.",
    href: "/docs/reference/fixed-assets#selling-vs-disposing",
  },
  "straight-line": {
    term: "Straight line",
    definition:
      "A depreciation method that charges an equal amount each period across the asset's useful life.",
    href: "/docs/reference/fixed-assets#depreciating",
  },
  "declining-balance": {
    term: "Declining balance",
    definition:
      "A depreciation method that charges a fixed percentage of remaining book value each period — heavier early, lighter later.",
    href: "/docs/reference/fixed-assets#depreciating",
  },
  "residual-value": {
    term: "Residual value",
    definition:
      "The floor an asset depreciates down to; when net book value reaches it, the asset flips to Fully Depreciated.",
    href: "/docs/reference/fixed-assets#depreciating",
  },
  macrs: {
    term: "MACRS",
    definition:
      "The US tax depreciation system with IRS property-class tables, run as a separate tax schedule alongside the book schedule.",
    href: "/docs/reference/fixed-assets#depreciating",
  },
  disposal: {
    term: "Disposal",
    definition:
      "Retiring an asset by write-off instead of sale, booking the remaining net book value as a loss — status becomes Disposed.",
    href: "/docs/reference/fixed-assets#selling-vs-disposing",
  },

  // ── Inventory ledger ────────────────────────────────────────────────────
  "item-ledger": {
    term: "Item ledger",
    definition:
      "The append-only record of every stock movement; on-hand is the sum of its signed entries and the source of truth.",
    href: "/docs/reference/inventory#on-hand-is-a-ledger",
  },

  // ── Shelf life ──────────────────────────────────────────────────────────
  // Grounded: shelf-life modes (Fixed Duration/Calculated/Set on Receipt), expired-entity
  // policy Warn/Block/BlockWithOverride (default Block), FEFO picking.
  "shelf-life": {
    term: "Shelf life",
    definition:
      "When a serial or batch expires, and what happens if used after — a company policy can Warn, Block, or BlockWithOverride.",
    href: "/docs/reference/shelf-life",
  },
  fefo: {
    term: "FEFO (first-expiry-first-out)",
    definition:
      "Picking offers tracked entities earliest-expiry-first, so the soonest-to-expire stock leaves first by default.",
    href: "/docs/reference/shelf-life",
  },
};
