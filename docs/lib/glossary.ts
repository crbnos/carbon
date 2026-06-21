/**
 * The docs glossary — one source of truth for the inline <Term> popovers.
 *
 * Keys are slugs (lowercase, hyphenated). Author usage in MDX:
 *   <Term>purchase to order</Term>          — slugifies the text to find the entry
 *   <Term id="purchase-to-order">bought</Term> — explicit key when display text differs
 *
 * Every definition is grounded in real Carbon source/migrations, not ERP-generic
 * prose. `href` (optional) points the "Learn more" link at the page that tells the
 * fuller story; omit it for terms with no dedicated page yet (popover still shows the
 * definition). Enum values verified:
 *   methodType            → "Make to Order" | "Purchase to Order" | "Pull from Inventory"
 *                           (packages/database/.../20260321143847_method-type-migration.sql)
 *   itemReplenishmentSystem → "Buy" | "Make" | "Buy and Make"
 *                           (packages/database/.../20230330024716_parts.sql)
 */
export type GlossaryEntry = {
  /** Canonical name shown as the popover heading. */
  term: string;
  /** One or two grounded sentences. */
  definition: string;
  /** Optional internal route for the "Learn more" link. */
  href?: string;
};

export const glossary: Record<string, GlossaryEntry> = {
  "method-type": {
    term: "Method type",
    definition:
      "How a part gets into its parent — set per line on a method. One of Make to Order, Purchase to Order, or Pull from Inventory. Separate from the item's replenishment system.",
    href: "/docs/reference/methods",
  },
  "make-to-order": {
    term: "Make to Order",
    definition:
      "The part is manufactured as its own job, with its own routing, when the parent that needs it is built.",
    href: "/docs/reference/methods",
  },
  "purchase-to-order": {
    term: "Purchase to Order",
    definition:
      "The material for that specific customer order is purchased from a supplier instead of being made or pulled from inventory.",
    href: "/docs/reference/methods",
  },
  "pull-from-inventory": {
    term: "Pull from Inventory",
    definition:
      "The part is taken from existing stock when its parent is built — no new job or purchase order is created for it.",
    href: "/docs/reference/methods",
  },
  "replenishment-system": {
    term: "Replenishment system",
    definition:
      "How an item is replenished overall, and which planning queue its shortfalls land in: Buy, Make, or Buy and Make. Set per item — unlike the per-line method type.",
    href: "/docs/reference/items",
  },
  method: {
    term: "Method",
    definition:
      "Carbon's name for a bill of materials: the materials (the components) plus the operations (the routing) that make a part.",
    href: "/docs/reference/methods",
  },
  bom: {
    term: "Bill of materials",
    definition:
      "In Carbon a bill of materials is called a method — the components plus the operations that produce a part.",
    href: "/docs/reference/methods",
  },
  wip: {
    term: "Work in process (WIP)",
    definition:
      "Not a table — a general-ledger balance. Costs accumulate in the WIP account as job materials are issued, and clear out when the job is received to stock.",
  },
  "outside-operation": {
    term: "Outside operation",
    definition:
      "An operation performed by an outside supplier rather than an in-house work center. Carbon raises a subcontracting purchase order to cover it.",
  },
  subassembly: {
    term: "Subassembly",
    definition:
      "A Make to Order component that gets its own job and routing inside the parent's build.",
    href: "/docs/reference/methods",
  },
  kit: {
    term: "Kit",
    definition:
      "A Make to Order component whose parts are issued together into the parent job — no separate build of its own.",
    href: "/docs/reference/methods",
  },
  "lead-time": {
    term: "Lead time",
    definition:
      "Days from ordering a part to having it available. Planning offsets demand backward by this much so supply arrives in time.",
    href: "/docs/reference/reordering",
  },
  "reorder-point": {
    term: "Reorder point",
    definition:
      "The on-hand level that triggers a new replenishment order under the Fixed Reorder Quantity and Maximum Quantity policies.",
    href: "/docs/reference/reordering",
  },
  "reordering-policy": {
    term: "Reordering policy",
    definition:
      "How an item is replenished: Manual Reorder, Demand-Based Reorder, Fixed Reorder Quantity, or Maximum Quantity.",
    href: "/docs/reference/reordering",
  },

  // ── Production & the floor ──────────────────────────────────────────────
  // Enums verified: jobStatus (20240909194622_jobs.sql + 20260504000002_job-closed-status.sql),
  // productionQuantity.type (20241002012019_production-quantities.sql), rework (20260527142837_rework.sql),
  // backflush (20260511120000_backflush-job-materials.sql), getMethodValidator (sales.models.ts).
  job: {
    term: "Job",
    definition:
      "Carbon's production order — one job builds a quantity of one item from its own copied method and routing. Status runs Draft → Ready → In Progress → Completed → Closed.",
    href: "/docs/reference/jobs",
  },
  routing: {
    term: "Routing",
    definition:
      "The ordered sequence of operations a job runs through. Not a separate record: it's the job's operations sorted by order, copied from the method's bill of process.",
    href: "/docs/reference/routings",
  },
  operation: {
    term: "Operation",
    definition:
      "One step in a job's routing. Each operation names a process and a work center and carries its own setup, labor, and machine times and rates — so cost accumulates per operation, not just per job.",
    href: "/docs/reference/routings",
  },
  "work-center": {
    term: "Work center",
    definition:
      "Where an operation runs. It carries labor and quoting rates — overhead is the difference between them — and links to the processes it can perform.",
    href: "/docs/reference/work-centers",
  },
  backflush: {
    term: "Backflush",
    definition:
      "Automatic, prorated consumption of a job's untracked materials when output is reported — no manual issue needed. Batch- or serial-tracked materials are skipped and must be issued explicitly.",
    href: "/guides/job-costing",
  },
  "material-issue": {
    term: "Issue (material)",
    definition:
      "Consuming material from inventory into a job, which writes a Consumption entry to the item ledger. Distinct from a quality issue, which is a nonconformance.",
    href: "/docs/reference/jobs",
  },
  "get-method": {
    term: "Get Method",
    definition:
      "The action that copies a saved method — its materials, operations, and work instructions — onto a job or quote line. You pick which parts to pull.",
    href: "/docs/reference/methods",
  },
  scrap: {
    term: "Scrap",
    definition:
      "Units reported as unrecoverable at an operation, with a reason — recorded as a production quantity of type Scrap. The alternative to routing them for rework.",
  },
  rework: {
    term: "Rework",
    definition:
      "Sending defective units back to an earlier operation to be corrected instead of scrapping them. Carbon creates a rework path of operations targeting that step.",
  },

  // ── Sales & purchasing ──────────────────────────────────────────────────
  // Enums verified: salesOrderStatus (20250209170952_shipment.sql), purchaseOrderStatus
  // (20230510035345_purchasing.sql + later), quoteStatus (20240715024405_quotes.sql),
  // opportunity (20240815020752_opportunity.sql), dropShipment flag, GR/IR account 2125.
  "sales-order": {
    term: "Sales order",
    definition:
      'A firm customer commitment to deliver. Fulfillment status splits across "To Ship and Invoice", "To Ship", and "To Invoice" before reaching "Completed".',
    href: "/docs/reference/sales-orders",
  },
  "purchase-order": {
    term: "Purchase order",
    definition:
      'A firm order to a supplier. As goods and bills arrive, status moves through "To Receive and Invoice", "To Receive", and "To Invoice" before "Completed".',
    href: "/docs/reference/purchase-orders",
  },
  quote: {
    term: "Quote",
    definition:
      "A priced sales quotation, often with quantity breaks. Status runs Draft → Sent → Ordered, or ends Lost, Expired, or Cancelled; an accepted quote converts to a sales order.",
    href: "/docs/reference/quotes",
  },
  rfq: {
    term: "RFQ (request for quote)",
    definition:
      "Carbon has two kinds: a sales RFQ, where a customer asks you to quote, and a purchasing RFQ, where you ask suppliers to quote. Both feed the opportunity thread.",
    href: "/guides/quote-to-cash",
  },
  opportunity: {
    term: "Opportunity",
    definition:
      "The thread linking a sales RFQ, its quote, and the resulting sales order. Not a document with its own status — a join that lets the three be read as one deal.",
    href: "/guides/quote-to-cash",
  },
  "drop-ship": {
    term: "Drop-ship",
    definition:
      "A shipment line sent straight from supplier to customer, bypassing your warehouse — so no inventory receipt posts. Set per shipment line, not on the order header.",
    href: "/docs/reference/sales-orders",
  },
  "three-way-match": {
    term: "Three-way match",
    definition:
      "Reconciling a purchase order against what was received and what was invoiced. In Carbon it's implicit — the PO line's received-vs-invoiced quantities and the GR/IR balance are the match, with no separate matching step.",
    href: "/guides/receive-and-bill",
  },
  "gr-ir": {
    term: "GR/IR (goods received, not invoiced)",
    definition:
      "A clearing account holding the value of goods received but not yet billed. A receipt credits it; the supplier invoice clears it.",
    href: "/docs/reference/accounting",
  },

  // ── Inventory, tracking & costing ───────────────────────────────────────
  // Enums verified: trackedEntity status (20250225145619_tracked-entities.sql),
  // costingMethod (20230330024716_parts.sql), receipt/shipment status
  // (20230728025201_receipts.sql, 20250209170952_shipment.sql), conversionFactor.
  "tracked-entity": {
    term: "Tracked entity",
    definition:
      'One serial unit or one batch of inventory that Carbon follows individually. It carries a status — "Available", "Reserved", "On Hold", or "Consumed" — and its own attributes, such as an expiry date.',
    href: "/docs/reference/traceability",
  },
  serial: {
    term: "Serial tracking",
    definition:
      "Each physical unit gets its own tracked entity and unique number — one entity, one unit. Used where you need 1:1 history.",
    href: "/docs/reference/traceability",
  },
  batch: {
    term: "Batch tracking",
    definition:
      "A quantity of identical units shares one tracked entity and batch number — one entity, many units. Used for lots with shared attributes like an expiry date.",
    href: "/docs/reference/traceability",
  },
  traceability: {
    term: "Traceability",
    definition:
      "The recorded genealogy of tracked entities: which inputs were consumed to produce which outputs, activity by activity, from receipt through build to shipment.",
    href: "/docs/reference/traceability",
  },
  genealogy: {
    term: "Genealogy",
    definition:
      "The parent-child chain of tracked entities — what a unit was built from and what it became. Carbon assembles it from tracked-activity inputs and outputs.",
    href: "/docs/reference/traceability",
  },
  "costing-method": {
    term: "Costing method",
    definition:
      "How an item's unit cost is valued: Standard, Average, FIFO, or LIFO. Set per item, it drives the cost that posts when stock moves.",
    href: "/docs/reference/items",
  },
  cogs: {
    term: "Cost of goods sold (COGS)",
    definition:
      "The inventory cost recognized when a shipment posts: Carbon debits the COGS account and credits inventory, valued by the item's costing method.",
    href: "/docs/reference/accounting",
  },
  // Alias of "cogs" so the spelled-out term also resolves — keep the definition in sync with it.
  "cost-of-goods-sold": {
    term: "Cost of goods sold (COGS)",
    definition:
      "The inventory cost recognized when a shipment posts: Carbon debits the COGS account and credits inventory, valued by the item's costing method.",
    href: "/docs/reference/accounting",
  },
  "conversion-factor": {
    term: "Conversion factor",
    definition:
      "Converts a supplier's purchase unit to your inventory unit on a PO, receipt, or bill line. Buy in cartons of 12, stock in eaches: a factor of 12 turns 5 cartons into 60.",
    href: "/guides/receive-and-bill",
  },
  posting: {
    term: "Posting",
    definition:
      'Committing a receipt, shipment, or invoice: inventory quantities move, journal entries hit the ledger, and the document\'s status becomes "Posted". The irreversible step.',
    href: "/docs/reference/accounting",
  },
  receipt: {
    term: "Receipt",
    definition:
      'The inbound posting document that takes goods into stock — from a purchase order, transfer, or job output — and creates any tracked entities. Status Draft → Pending → "Posted".',
    href: "/docs/reference/receipts",
  },
  shipment: {
    term: "Shipment",
    definition:
      'The outbound posting document that takes goods out of stock to a customer, posting COGS as it goes. Status Draft → Pending → "Posted".',
    href: "/docs/reference/shipments",
  },

  // ── Planning, quality & accounting ──────────────────────────────────────
  // Enums verified: nonConformance status + action/task types (20250327140050_ncr.sql),
  // accountingPeriod status Inactive/Active (20230705033432_ledgers.sql), journal model,
  // accountingEnabled gate (20260508000000_accounting-enabled.sql), MRP edge function.
  "demand-forecast": {
    term: "Demand forecast",
    definition:
      "Expected future demand for an item, bucketed by period. The planning run populates it alongside actual demand from orders and jobs.",
    href: "/docs/reference/planning",
  },
  mrp: {
    term: "MRP (planning)",
    definition:
      "Carbon's planning run nets supply against demand and explodes methods — but it does not create orders. It surfaces shortfalls for you to turn into planned jobs and purchase orders.",
    href: "/docs/reference/planning",
  },
  nonconformance: {
    term: "Nonconformance (issue)",
    definition:
      'Carbon\'s quality issue — a logged deviation or defect. Status runs "Registered" → "In Progress" → "Closed", with a configurable workflow of investigation and action tasks.',
    href: "/docs/reference/quality",
  },
  "8d": {
    term: "8D",
    definition:
      "The eight-disciplines quality method. Carbon doesn't hard-code its steps — you model it with the nonconformance workflow's investigation, action, and approval tasks.",
    href: "/docs/reference/quality",
  },
  "corrective-action": {
    term: "Corrective action",
    definition:
      "A nonconformance task that fixes a confirmed root cause — as opposed to a preventive action or an immediate containment action. Tracked Pending → In Progress → Completed.",
    href: "/docs/reference/quality",
  },
  "preventive-action": {
    term: "Preventive action",
    definition:
      "A nonconformance task that stops the problem recurring elsewhere — distinct from the corrective fix and the immediate containment.",
    href: "/docs/reference/quality",
  },
  "containment-action": {
    term: "Containment action",
    definition:
      "The immediate nonconformance task that quarantines affected stock or work before the root cause is known.",
    href: "/docs/reference/quality",
  },
  journal: {
    term: "Journal",
    definition:
      "A posted accounting entry: a header plus balanced debit and credit journal lines against GL accounts. Every posting writes one.",
    href: "/docs/reference/accounting",
  },
  "general-ledger": {
    term: "General ledger",
    definition:
      "The book of all posted journal lines, summed by account. Carbon only posts when the company has accounting enabled.",
    href: "/docs/reference/accounting",
  },
  "accounting-period": {
    term: "Accounting period",
    definition:
      'A dated window that postings fall into. A period is "Inactive" or "Active" — not open or closed — and a posting needs an active one, which Carbon opens automatically when needed.',
    href: "/docs/reference/accounting",
  },

  // ── Documents & variances (batch 2) ─────────────────────────────────────
  // Grounded: supplierQuote status (20260202000000_supplier_quote_document_type.sql),
  // invoice posting + field-based payment, finished-goods at actual WIP
  // (20260508120000_complete-job-to-inventory.sql), production & PPV variance accounts.
  "supplier-quote": {
    term: "Supplier quote",
    definition:
      "A supplier's priced response to a purchasing RFQ — one per supplier, created when you finalize the request. Status runs Draft → Active when they submit, or Declined.",
    href: "/guides/rfq-to-po",
  },
  invoice: {
    term: "Invoice",
    definition:
      "A sales invoice (you bill a customer) or a purchase invoice (a supplier bills you). Posting writes the ledger but never marks it Paid — payment is a field on the invoice, not a separate record.",
    href: "/docs/reference/invoices",
  },
  "finished-goods": {
    term: "Finished goods",
    definition:
      "A completed job's output, received into inventory at the job's actual accumulated WIP cost. A make-to-order job stocks here first, then the sales order ships from stock.",
    href: "/docs/reference/jobs",
  },
  "production-variance": {
    term: "Production variance",
    definition:
      "The residual WIP a job has left at close — rounding, late material, a late event — swept to a Production Variance account. The only variance Carbon books for a job; finish is at actual cost, not standard.",
    href: "/guides/job-finish-close",
  },
  "purchase-price-variance": {
    term: "Purchase price variance",
    definition:
      "The gap between a purchase order's price and the supplier's bill, posted to a variance account when the invoice posts and reconciled against the receipt cost.",
    href: "/guides/receive-and-bill",
  },

  // ── Fixed assets ────────────────────────────────────────────────────────
  // Enums verified: fixedAssetStatus Draft/Active/Fully Depreciated/Disposed,
  // depreciationMethod Straight Line/Declining Balance/Units of Production
  // (20260524143827_fixed-assets.sql).
  "fixed-asset": {
    term: "Fixed asset",
    definition:
      "An accounting record for a capitalized item — a machine, vehicle, or tool you depreciate rather than expense. Independent of the work center you schedule production on. Status runs Draft → Active → Fully Depreciated → Disposed.",
    href: "/docs/reference/fixed-assets",
  },
  "asset-class": {
    term: "Asset class",
    definition:
      "The category a fixed asset belongs to. It carries the GL accounts every asset of that kind posts to: the asset account, accumulated depreciation, depreciation expense, and the write-off account.",
    href: "/docs/reference/fixed-assets",
  },
  depreciation: {
    term: "Depreciation",
    definition:
      "Writing an asset's value down over its life. Carbon runs it as a monthly batch you create, review as a draft, then post — debit depreciation expense, credit accumulated depreciation. Methods: Straight Line, Declining Balance, Units of Production.",
    href: "/docs/reference/fixed-assets",
  },
  "net-book-value": {
    term: "Net book value",
    definition:
      "What an asset is still worth on the books: its acquisition cost minus accumulated depreciation. The figure an asset is sold or disposed at.",
    href: "/docs/reference/fixed-assets",
  },
  "straight-line": {
    term: "Straight line",
    definition:
      "A depreciation method that charges an equal amount each period across the asset's useful life.",
    href: "/docs/reference/fixed-assets",
  },
  "declining-balance": {
    term: "Declining balance",
    definition:
      "A depreciation method that charges a fixed percentage of the remaining book value each period — heavier early, lighter later.",
    href: "/docs/reference/fixed-assets",
  },
  "residual-value": {
    term: "Residual value",
    definition:
      'The floor an asset depreciates down to. When net book value reaches it, posting flips the asset to "Fully Depreciated" and it stops accruing.',
    href: "/docs/reference/fixed-assets",
  },
  macrs: {
    term: "MACRS",
    definition:
      "The US tax depreciation system, with the IRS property-class tables. Carbon can run a separate tax schedule on MACRS alongside the book schedule.",
    href: "/docs/reference/fixed-assets",
  },
  disposal: {
    term: "Disposal",
    definition:
      'Retiring an asset by write-off instead of sale: clear accumulated depreciation, remove the asset at cost, and book the remaining net book value as a loss. Status becomes "Disposed".',
    href: "/docs/reference/fixed-assets",
  },

  // ── Inventory ledger ────────────────────────────────────────────────────
  "item-ledger": {
    term: "Item ledger",
    definition:
      "The append-only record of every stock movement. On-hand is the sum of its signed entries — receipts and outputs add, sales and consumption subtract — and it's status-aware, so it, not the cached quantity, is the source of truth.",
    href: "/docs/reference/inventory",
  },

  // ── Shelf life ──────────────────────────────────────────────────────────
  // Grounded: shelf-life modes (Fixed Duration/Calculated/Set on Receipt), expired-entity
  // policy Warn/Block/BlockWithOverride (default Block), FEFO picking.
  "shelf-life": {
    term: "Shelf life",
    definition:
      'When a serial or batch expires, and what happens if you use it after. The date lives on the tracked entity; a company policy can Warn, Block, or BlockWithOverride on consuming expired stock — Block is the default, rejecting it outright.',
    href: "/docs/reference/shelf-life",
  },
  fefo: {
    term: "FEFO (first-expiry-first-out)",
    definition:
      "Picking offers available tracked entities earliest-expiry-first, so the soonest-to-expire stock leaves first by default.",
    href: "/docs/reference/shelf-life",
  },
};
