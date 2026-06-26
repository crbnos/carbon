/**
 * The Carbon glossary — one source of truth for term definitions, used by both
 * the docs site's inline <Term> popovers and the ERP/MES field-help affordance.
 *
 * Keys are slugs (lowercase, hyphenated). Author usage in docs MDX:
 *   <Term>purchase to order</Term>          — slugifies the text to find the entry
 *   <Term id="purchase-to-order">bought</Term> — explicit key when display text differs
 *
 * `term` and `definition` are Lingui `msg` descriptors so the extractor picks
 * them up and ERP/MES translate them at render via `i18n._()`. Consumers
 * without a Lingui runtime (docs Next.js) read the source English off
 * `descriptor.message` — see `getTermText` / `getDefinitionText` in `helpers.ts`.
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
import { msg } from "@lingui/core/macro";
import type { GlossaryEntry } from "./types";

export const terms = {
  oem: {
    term: msg`OEM (original equipment manufacturer)`,
    definition: msg`A company that designs and builds its own finished products end to end (here, the shop building humanoid robots) rather than making parts to another company's specification.`
  },
  "company-group": {
    term: msg`Company group`,
    definition: msg`A set of companies under one owner that share group-scoped configuration — the chart of accounts, currencies, and dimensions — so the same accounting setup spans every company in the group.`
  },
  "method-type": {
    term: msg`Method type`,
    definition: msg`How an item is sourced when added to a method or BOM line.`,
    href: "/docs/reference/methods#method-type"
  },
  "make-to-order": {
    term: msg`Make to Order`,
    definition: msg`The part is manufactured as its own job when the parent that needs it is built.`,
    href: "/docs/reference/methods#method-type"
  },
  "purchase-to-order": {
    term: msg`Purchase to Order`,
    definition: msg`The material is purchased from a supplier for that specific order, rather than made or pulled from stock.`,
    href: "/docs/reference/methods#method-type"
  },
  "pull-from-inventory": {
    term: msg`Pull from Inventory`,
    definition: msg`The part is taken from existing stock when its parent is built — no new job or purchase order.`,
    href: "/docs/reference/methods#method-type"
  },
  "replenishment-system": {
    term: msg`Replenishment system`,
    definition: msg`How an item is replenished overall (Buy, Make, or Buy and Make), set per item, unlike the per-line method type.`,
    href: "/docs/reference/methods#method-type-vs-replenishment-system"
  },
  method: {
    term: msg`Method`,
    definition: msg`Carbon's name for a bill of material and bill of process (routing): the components plus the operations that make a part.`,
    href: "/docs/reference/methods"
  },
  bom: {
    term: msg`Bill of materials`,
    definition: msg`Called a method in Carbon — the components plus operations that produce a part.`,
    href: "/docs/reference/methods"
  },
  wip: {
    term: msg`Work in process (WIP)`,
    definition: msg`Not a table but a general-ledger balance: cost accumulates as job materials are issued and clears when the job is received to stock.`,
    href: "/guides/job-costing#wip-isnt-a-table"
  },
  "outside-operation": {
    term: msg`Outside operation`,
    definition: msg`An operation done by an outside supplier rather than an in-house work center, covered by a subcontracting purchase order.`
  },
  subassembly: {
    term: msg`Subassembly`,
    definition: msg`A Make to Order component that gets its own job and routing inside the parent's build.`,
    href: "/docs/reference/methods#kit-or-subassembly"
  },
  kit: {
    term: msg`Kit`,
    definition: msg`A Make to Order component whose parts are issued together into the parent job — no separate build.`,
    href: "/docs/reference/methods#kit-or-subassembly"
  },
  "lead-time": {
    term: msg`Lead time`,
    definition: msg`Days from ordering a part to having it available; planning offsets demand backward by this much.`,
    href: "/docs/reference/reordering#fields"
  },
  "reorder-point": {
    term: msg`Reorder point`,
    definition: msg`The on-hand level that triggers a new replenishment order under the quantity-based policies.`,
    href: "/docs/reference/reordering#policies"
  },
  "reordering-policy": {
    term: msg`Reordering policy`,
    definition: msg`How an item is replenished: Manual Reorder, Demand-Based Reorder, Fixed Reorder Quantity, or Maximum Quantity.`,
    href: "/docs/reference/reordering#policies"
  },

  // ── Production & the floor ──────────────────────────────────────────────
  job: {
    term: msg`Job`,
    definition: msg`Carbon's production order — one job builds a quantity of one item from its own copied method and routing.`,
    href: "/docs/reference/jobs"
  },
  routing: {
    term: msg`Routing`,
    definition: msg`The ordered sequence of operations a job runs through, copied from the method's bill of process.`,
    href: "/docs/reference/routings"
  },
  operation: {
    term: msg`Operation`,
    definition: msg`One step in a job's routing, naming a process and a work center and carrying its own setup, labor, and machine times and rates.`,
    href: "/docs/reference/routings"
  },
  "work-center": {
    term: msg`Work center`,
    definition: msg`Where an operation runs; carries labor and quoting rates, with overhead the difference between them.`,
    href: "/docs/reference/work-centers"
  },
  backflush: {
    term: msg`Backflush`,
    definition: msg`Automatic, prorated consumption of a job's untracked materials when output is reported — tracked materials are issued manually.`,
    href: "/guides/job-costing#issued-or-backflushed"
  },
  "material-issue": {
    term: msg`Issue (material)`,
    definition: msg`Consuming material from inventory into a job, which writes a Consumption entry to the item ledger.`,
    href: "/docs/reference/jobs"
  },
  "get-method": {
    term: msg`Get Method`,
    definition: msg`The action that copies a saved method (its materials, operations, and work instructions) onto a job or quote line.`,
    href: "/docs/reference/methods#get-method"
  },
  scrap: {
    term: msg`Scrap`,
    definition: msg`Units reported as unrecoverable at an operation, with a reason — the alternative to rework.`
  },
  rework: {
    term: msg`Rework`,
    definition: msg`Sending defective units back to an earlier operation to be corrected instead of scrapping them.`
  },

  // ── Sales & purchasing ──────────────────────────────────────────────────
  "sales-order": {
    term: msg`Sales order`,
    definition: msg`A firm customer commitment to deliver; fulfillment status splits across ship and invoice before reaching Completed.`,
    href: "/docs/reference/sales-orders"
  },
  "purchase-order": {
    term: msg`Purchase order`,
    definition: msg`A firm order to a supplier; status moves through receive and invoice before Completed as goods and bills arrive.`,
    href: "/docs/reference/purchase-orders"
  },
  quote: {
    term: msg`Quote`,
    definition: msg`A priced sales quotation; Draft → Sent → Ordered, or ends Lost, Expired, or Cancelled.`,
    href: "/docs/reference/quotes"
  },
  rfq: {
    term: msg`RFQ (request for quote)`,
    definition: msg`A sales RFQ (a customer asks you to quote) or a purchasing RFQ (you ask suppliers); both feed the opportunity thread.`,
    href: "/guides/quote-to-cash#one-opportunity-many-documents"
  },
  opportunity: {
    term: msg`Opportunity`,
    definition: msg`The thread linking a sales RFQ, its quote, and the resulting sales order — a join, not a document with its own status.`,
    href: "/guides/quote-to-cash#one-opportunity-many-documents"
  },
  "quote-to-cash": {
    term: msg`Quote to cash`,
    definition: msg`The end-to-end commercial flow from quoting a customer to collecting payment: RFQ to quote to sales order, then shipment, invoice, and settled payment.`,
    href: "/guides/quote-to-cash"
  },
  "drop-ship": {
    term: msg`Drop-ship`,
    definition: msg`A shipment line sent straight from supplier to customer, bypassing your warehouse — set per line, not on the header.`,
    href: "/docs/reference/sales-orders#line-fields"
  },
  "three-way-match": {
    term: msg`Three-way match`,
    definition: msg`Reconciling a purchase order against what was received and invoiced — implicit in Carbon, via the line quantities and GR/IR balance.`,
    href: "/guides/receive-and-bill#match-and-post"
  },
  "gr-ir": {
    term: msg`GR/IR (goods received, not invoiced)`,
    definition: msg`A clearing account holding the value of goods received but not yet billed; the supplier invoice clears it.`,
    href: "/docs/reference/accounting"
  },

  // ── Inventory, tracking & costing ───────────────────────────────────────
  "tracked-entity": {
    term: msg`Tracked entity`,
    definition: msg`One serial unit or one batch that Carbon follows individually, carrying its own status and attributes such as an expiry date.`,
    href: "/docs/reference/traceability#tracked-entities"
  },
  serial: {
    term: msg`Serial tracking`,
    definition: msg`Each physical unit gets its own tracked entity and unique number — one entity, one unit.`,
    href: "/docs/reference/traceability#tracked-entities"
  },
  batch: {
    term: msg`Batch tracking`,
    definition: msg`A quantity of identical units shares one tracked entity and batch number — one entity, many units.`,
    href: "/docs/reference/traceability#tracked-entities"
  },
  traceability: {
    term: msg`Traceability`,
    definition: msg`The recorded genealogy of tracked entities — which inputs were consumed to produce which outputs, receipt through shipment.`,
    href: "/docs/reference/traceability"
  },
  genealogy: {
    term: msg`Genealogy`,
    definition: msg`The parent-child chain of tracked entities — what a unit was built from and what it became.`,
    href: "/docs/reference/traceability#genealogy"
  },
  "costing-method": {
    term: msg`Costing method`,
    definition: msg`How an item's unit cost is valued: Standard, Average, FIFO, or LIFO. Set per item.`,
    href: "/docs/reference/items#fields"
  },
  cogs: {
    term: msg`Cost of goods sold (COGS)`,
    definition: msg`The inventory cost recognized when a shipment posts, valued by the item's costing method.`,
    href: "/docs/reference/accounting",
    aliases: ["cost-of-goods-sold"]
  },
  "conversion-factor": {
    term: msg`Conversion factor`,
    definition: msg`Converts a supplier's purchase unit to your inventory unit on a PO, receipt, or bill line — buy in cartons of 12, stock in eaches.`,
    href: "/guides/receive-and-bill#buy-by-the-box-stock-by-the-each"
  },
  posting: {
    term: msg`Posting`,
    definition: msg`Committing a receipt, shipment, or invoice: quantities move, journal entries hit the ledger, and status becomes Posted.`,
    href: "/docs/reference/accounting"
  },
  receipt: {
    term: msg`Receipt`,
    definition: msg`The inbound posting document that takes goods into stock (from a PO, transfer, or job output) and creates any tracked entities.`,
    href: "/docs/reference/receipts"
  },
  shipment: {
    term: msg`Shipment`,
    definition: msg`The outbound posting document that takes goods out of stock to a customer, posting COGS as it goes.`,
    href: "/docs/reference/shipments"
  },

  // ── Planning, quality & accounting ──────────────────────────────────────
  "demand-forecast": {
    term: msg`Demand forecast`,
    definition: msg`Expected future demand for an item, bucketed by period, populated by the planning run alongside actual demand.`,
    href: "/docs/reference/planning#what-feeds-it"
  },
  mrp: {
    term: msg`MRP (planning)`,
    definition: msg`Carbon's planning run nets supply against demand and explodes methods, surfacing shortfalls — but it creates no orders itself.`,
    href: "/docs/reference/planning"
  },
  nonconformance: {
    term: msg`Non-conformance (issue)`,
    definition: msg`A quality issue — a logged deviation or defect with a configurable workflow of investigation and action tasks.`,
    href: "/docs/reference/quality#issues"
  },
  "8d": {
    term: msg`8D`,
    definition: msg`The eight-disciplines quality method, modeled with the nonconformance workflow's tasks rather than hard-coded.`,
    href: "/docs/reference/quality#workflows-and-actions"
  },
  "corrective-action": {
    term: msg`Corrective action`,
    definition: msg`A nonconformance task that fixes a confirmed root cause — as opposed to a preventive or immediate containment action.`,
    href: "/docs/reference/quality#workflows-and-actions"
  },
  "preventive-action": {
    term: msg`Preventive action`,
    definition: msg`A nonconformance task that stops the problem recurring elsewhere — distinct from the corrective fix and containment.`,
    href: "/docs/reference/quality#workflows-and-actions"
  },
  "containment-action": {
    term: msg`Containment action`,
    definition: msg`The immediate nonconformance task that quarantines affected stock or work before the root cause is known.`,
    href: "/docs/reference/quality#workflows-and-actions"
  },
  journal: {
    term: msg`Journal`,
    definition: msg`A posted accounting entry: a header plus balanced debit and credit lines against GL accounts.`,
    href: "/docs/reference/accounting#the-journal"
  },
  "general-ledger": {
    term: msg`General ledger`,
    definition: msg`The book of all posted journal lines, summed by account — written only when the company has accounting enabled.`,
    href: "/docs/reference/accounting"
  },
  "accounting-period": {
    term: msg`Accounting period`,
    definition: msg`A dated window postings fall into (Active or Inactive, not open or closed), opened automatically when needed.`,
    href: "/docs/reference/accounting#periods"
  },

  // ── Cost centers ────────────────────────────────────────────────────────
  "cost-center": {
    term: msg`Cost center`,
    definition: msg`An accounting bucket that groups expenses by department or function so the GL can report spend by group, not just by account.`,
    href: "/docs/reference/accounting"
  },
  "parent-cost-center": {
    term: msg`Parent cost center`,
    definition: msg`Another cost center this one rolls up into, letting you nest a sub-department under its parent for hierarchical cost reporting.`,
    href: "/docs/reference/accounting"
  },
  "cost-center-owner": {
    term: msg`Owner (cost center)`,
    definition: msg`The employee accountable for this cost center — when purchase order approvals are on, they're the approver for spend posted against it.`,
    href: "/docs/reference/accounting"
  },

  // ── Documents & variances ───────────────────────────────────────────────
  "supplier-quote": {
    term: msg`Supplier quote`,
    definition: msg`A supplier's priced response to a purchasing RFQ — one per supplier; Draft → Active when they submit, or Declined.`,
    href: "/guides/rfq-to-po#suppliers-quote-back"
  },
  invoice: {
    term: msg`Invoice`,
    definition: msg`A sales invoice (you bill a customer) or purchase invoice (a supplier bills you); payment is a field, not a separate record.`,
    href: "/docs/reference/invoices"
  },
  "finished-goods": {
    term: msg`Finished goods`,
    definition: msg`A completed job's output, received into inventory at the job's actual accumulated WIP cost.`,
    href: "/guides/job-finish-close#finish-into-inventory"
  },
  "production-variance": {
    term: msg`Production variance`,
    definition: msg`The residual WIP a job has left at close, swept to a Production Variance account — the only variance Carbon books for a job.`,
    href: "/guides/job-finish-close#close-the-job"
  },
  "purchase-price-variance": {
    term: msg`Purchase price variance`,
    definition: msg`The gap between a purchase order's price and the supplier's bill, posted to a variance account when the invoice posts.`,
    href: "/guides/receive-and-bill#match-and-post"
  },

  // ── Fixed assets ────────────────────────────────────────────────────────
  "fixed-asset": {
    term: msg`Fixed asset`,
    definition: msg`An accounting record for a capitalized item you depreciate rather than expense; Draft → Active → Fully Depreciated → Disposed.`,
    href: "/docs/reference/fixed-assets"
  },
  "asset-class": {
    term: msg`Asset class`,
    definition: msg`The category a fixed asset belongs to, carrying the GL accounts every asset of that kind posts to.`,
    href: "/docs/reference/fixed-assets"
  },
  depreciation: {
    term: msg`Depreciation`,
    definition: msg`Writing an asset's value down over its life — a monthly batch you create, review as a draft, then post.`,
    href: "/docs/reference/fixed-assets#depreciating"
  },
  "net-book-value": {
    term: msg`Net book value`,
    definition: msg`An asset's acquisition cost minus accumulated depreciation — what it's still worth on the books, and the figure it's disposed at.`,
    href: "/docs/reference/fixed-assets#selling-vs-disposing"
  },
  "straight-line": {
    term: msg`Straight line`,
    definition: msg`A depreciation method that charges an equal amount each period across the asset's useful life.`,
    href: "/docs/reference/fixed-assets#depreciating"
  },
  "declining-balance": {
    term: msg`Declining balance`,
    definition: msg`A depreciation method that charges a fixed percentage of remaining book value each period — heavier early, lighter later.`,
    href: "/docs/reference/fixed-assets#depreciating"
  },
  "residual-value": {
    term: msg`Residual value`,
    definition: msg`The floor an asset depreciates down to; when net book value reaches it, the asset flips to Fully Depreciated.`,
    href: "/docs/reference/fixed-assets#depreciating"
  },
  macrs: {
    term: msg`MACRS`,
    definition: msg`The US tax depreciation system with IRS property-class tables, run as a separate tax schedule alongside the book schedule.`,
    href: "/docs/reference/fixed-assets#depreciating"
  },
  disposal: {
    term: msg`Disposal`,
    definition: msg`Retiring an asset by write-off instead of sale, booking the remaining net book value as a loss — status becomes Disposed.`,
    href: "/docs/reference/fixed-assets#selling-vs-disposing"
  },

  // ── Inventory ledger ────────────────────────────────────────────────────
  "item-ledger": {
    term: msg`Item ledger`,
    definition: msg`The append-only record of every stock movement; on-hand is the sum of its signed entries and the source of truth.`,
    href: "/docs/reference/inventory#on-hand-is-a-ledger"
  },

  // ── Shelf life ──────────────────────────────────────────────────────────
  "shelf-life": {
    term: msg`Shelf life`,
    definition: msg`When a serial or batch expires, and what happens if used after — a company policy can Warn, Block, or BlockWithOverride.`,
    href: "/docs/reference/shelf-life"
  },
  fefo: {
    term: msg`FEFO (first-expiry-first-out)`,
    definition: msg`Picking offers tracked entities earliest-expiry-first, so the soonest-to-expire stock leaves first by default.`,
    href: "/docs/reference/shelf-life"
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Accounting sweep (plan 02): field-specific entries for the ERP accounting
  // module's input forms. Account-default entries describe the GL posting that
  // each default drives; per-asset / per-line entries describe the field's role
  // on its parent form. Umbrella terms (depreciation, macrs, disposal, posting)
  // remain above for docs <Term> use only — field labels now point at these
  // field-specific slugs instead.
  // ──────────────────────────────────────────────────────────────────────────

  // ── Account defaults (AccountDefaultsForm) ──────────────────────────────
  "account-default-bank-cash": {
    term: msg`Bank — Cash (default)`,
    definition: msg`Default GL account used for cash transactions when no specific bank account is selected.`
  },
  "account-default-bank-local-currency": {
    term: msg`Bank — Local Currency (default)`,
    definition: msg`Default cash account for transactions in your base currency.`
  },
  "account-default-bank-foreign-currency": {
    term: msg`Bank — Foreign Currency (default)`,
    definition: msg`Default cash account for transactions in non-base currencies.`
  },
  "account-default-receivables": {
    term: msg`Receivables (default)`,
    definition: msg`GL account debited when a customer invoice posts; cleared when the customer pays.`
  },
  "account-default-prepayments": {
    term: msg`Prepayments (default)`,
    definition: msg`GL account used when a customer pays before an invoice is issued; cleared when the invoice posts.`
  },
  "account-default-inventory": {
    term: msg`Inventory (default)`,
    definition: msg`Default GL account that holds inventory value; debited on receipt, credited on shipment/issue.`
  },
  "account-default-wip": {
    term: msg`Work in Progress (default)`,
    definition: msg`GL account that holds the value of jobs in production until they post to finished goods.`
  },
  "account-default-inventory-shipped-not-invoiced": {
    term: msg`Inventory Shipped Not Invoiced (default)`,
    definition: msg`Accrual account debited at shipment to recognize the receivable before the sales invoice posts; cleared when the invoice posts.`
  },
  "account-default-asset-acquisition-cost": {
    term: msg`Asset Acquisition Cost (default)`,
    definition: msg`GL account debited when a fixed asset is acquired (purchase or capitalized cost).`
  },
  "account-default-asset-cost-on-disposal": {
    term: msg`Asset Cost on Disposal (default)`,
    definition: msg`GL account credited to remove the asset's original cost when it is disposed.`
  },
  "account-default-accumulated-depreciation": {
    term: msg`Accumulated Depreciation (default)`,
    definition: msg`GL contra-asset account that accumulates depreciation booked against fixed assets.`
  },
  "account-default-accumulated-depreciation-on-disposal": {
    term: msg`Accumulated Depreciation on Disposal (default)`,
    definition: msg`GL account debited to clear accumulated depreciation when an asset is disposed.`
  },
  "account-default-payables": {
    term: msg`Payables (default)`,
    definition: msg`GL account credited when a supplier invoice is posted (AP balance).`
  },
  "account-default-gr-ir": {
    term: msg`GR/IR Clearing (default)`,
    definition: msg`Clearing account between goods receipt and supplier invoice; balances when both have posted.`
  },
  "account-default-sales-tax-payable": {
    term: msg`Sales Tax Payable (default)`,
    definition: msg`GL liability account credited for sales tax collected from customers.`
  },
  "account-default-purchase-tax-payable": {
    term: msg`Purchase Tax Payable (default)`,
    definition: msg`GL account for purchase tax paid to suppliers (or reclaimable).`
  },
  "account-default-reverse-charge-sales-tax": {
    term: msg`Reverse Charge Sales Tax (default)`,
    definition: msg`GL account for tax accrued under reverse-charge rules where the buyer self-assesses.`
  },
  "account-default-deferred-tax-liability": {
    term: msg`Deferred Tax Liability (default)`,
    definition: msg`GL account for tax timing differences (e.g. accelerated tax depreciation vs. book depreciation).`
  },
  "account-default-retained-earnings": {
    term: msg`Retained Earnings (default)`,
    definition: msg`GL equity account where net income closes at fiscal year-end.`
  },
  "account-default-currency-translation": {
    term: msg`Currency Translation (default)`,
    definition: msg`GL equity account (CTA reserve) that holds unrealized FX differences from re-translating foreign-currency balances at period-end; separate from realized FX gain/loss in P&L.`
  },
  "account-default-sales": {
    term: msg`Sales (default)`,
    definition: msg`Default revenue GL account credited when a sales invoice posts.`
  },
  "account-default-sales-discounts": {
    term: msg`Sales Discounts (default)`,
    definition: msg`Contra-revenue GL account for discounts given on customer invoices.`
  },
  "account-default-cogs": {
    term: msg`Cost of Goods Sold (default)`,
    definition: msg`Expense GL account debited when inventory is shipped/issued against a sale.`
  },
  "account-default-indirect-materials-services": {
    term: msg`Indirect Materials & Services (default)`,
    definition: msg`GL expense account for non-inventory purchases (supplies, services).`
  },
  "account-default-labor-machine-absorption": {
    term: msg`Labor & Machine Absorption (default)`,
    definition: msg`GL account credited when labor or machine cost is absorbed into a production job.`
  },
  "account-default-purchase-price-variance": {
    term: msg`Purchase Price Variance (default)`,
    definition: msg`GL account that captures the difference between standard cost and actual purchase cost.`
  },
  "account-default-inventory-adjustment": {
    term: msg`Inventory Adjustment (default)`,
    definition: msg`GL account hit when physical counts differ from system inventory.`
  },
  "account-default-material-usage-variance": {
    term: msg`Material Usage Variance (default)`,
    definition: msg`GL account capturing differences between BOM-expected and actual material consumed.`
  },
  "account-default-labor-machine-variance": {
    term: msg`Labor & Machine Variance (default)`,
    definition: msg`GL account capturing differences between routing-expected and actual labor/machine time.`
  },
  "account-default-overhead-variance": {
    term: msg`Overhead Variance (default)`,
    definition: msg`GL account capturing differences between applied and actual manufacturing overhead.`
  },
  "account-default-lot-size-variance": {
    term: msg`Lot Size Variance (default)`,
    definition: msg`GL account capturing fixed-cost differences when actual lot size differs from planned.`
  },
  "account-default-subcontracting-variance": {
    term: msg`Subcontracting Variance (default)`,
    definition: msg`GL account capturing cost differences on outside-processing operations.`
  },
  "account-default-maintenance-expense": {
    term: msg`Maintenance Expense (default)`,
    definition: msg`Default GL expense account for equipment and facility maintenance.`
  },
  "account-default-depreciation-expense": {
    term: msg`Depreciation Expense (default)`,
    definition: msg`Default GL expense account for periodic depreciation runs.`
  },
  "account-default-gains-and-losses": {
    term: msg`Gains and Losses (default)`,
    definition: msg`GL account where gain or loss is booked on fixed-asset disposal.`
  },
  "account-default-service-charges": {
    term: msg`Service Charges (default)`,
    definition: msg`GL account for bank service charges and similar fees.`
  },
  "account-default-interest": {
    term: msg`Interest (default)`,
    definition: msg`GL account for interest income or expense.`
  },
  "account-default-supplier-payment-discounts": {
    term: msg`Supplier Payment Discounts (default)`,
    definition: msg`GL account where early-payment discounts taken from suppliers are recorded.`
  },
  "account-default-customer-payment-discounts": {
    term: msg`Customer Payment Discounts (default)`,
    definition: msg`GL account where early-payment discounts given to customers are recorded.`
  },
  "account-default-rounding-account": {
    term: msg`Rounding Account (default)`,
    definition: msg`GL account that absorbs sub-cent rounding differences on posting.`
  },
  "account-default-deferred-tax-expense": {
    term: msg`Deferred Tax Expense (default)`,
    definition: msg`Expense side of deferred tax movements (paired with deferred tax liability).`
  },

  // ── Chart of Accounts / Group Accounts ──────────────────────────────────
  "chart-of-account-group": {
    term: msg`Group`,
    definition: msg`The group account this account rolls up to; determines its type, class, and statement placement.`
  },
  "chart-of-account-account-type-inherited": {
    term: msg`Account Type (inherited)`,
    definition: msg`Inherited from the group: where this account appears on financial statements.`
  },
  "chart-of-account-income-balance-inherited": {
    term: msg`Income / Balance (inherited)`,
    definition: msg`Inherited from the group: whether this account closes to retained earnings (income) or carries forward (balance).`
  },
  "chart-of-account-class-inherited": {
    term: msg`Class (inherited)`,
    definition: msg`Inherited from the group: top-level classification (asset, liability, equity, revenue, expense).`
  },
  "group-account-account-type": {
    term: msg`Account Type`,
    definition: msg`The statement bucket all accounts under this group will use.`
  },
  "group-account-class": {
    term: msg`Class`,
    definition: msg`Top-level classification (asset / liability / equity / revenue / expense); set only on root groups, inherited by children.`
  },
  "group-account-income-balance-inherited": {
    term: msg`Income / Balance (inherited)`,
    definition: msg`Inherited from the parent group.`
  },
  "group-account-class-inherited": {
    term: msg`Class (inherited)`,
    definition: msg`Inherited from the parent group.`
  },

  // ── Dimensions ──────────────────────────────────────────────────────────
  "dimension-entity-type": {
    term: msg`Entity Type`,
    definition: msg`What source this dimension pulls its allowed values from (custom list or an existing entity like customer, location, employee).`
  },
  "dimension-values": {
    term: msg`Values`,
    definition: msg`The allowed values users can pick when tagging postings with this dimension.`
  },

  // ── Exchange rates ──────────────────────────────────────────────────────
  "decimal-places-currency": {
    term: msg`Decimal Places`,
    definition: msg`How many fractional digits to keep when rounding amounts in this currency.`
  },
  "exchange-rate": {
    term: msg`Exchange Rate`,
    definition: msg`Units of base currency per one unit of this currency; used to translate amounts on posting.`
  },
  "historical-exchange-rate": {
    term: msg`Historical Rate (equity)`,
    definition: msg`Optional fixed rate used when translating equity balances per IAS 21 (instead of the period rate).`
  },

  // ── Fiscal year ─────────────────────────────────────────────────────────
  "fiscal-year-start": {
    term: msg`Start of Fiscal Year`,
    definition: msg`The month your financial year begins; periods are numbered from this month.`
  },
  "fiscal-year-tax-start": {
    term: msg`Start of Tax Year`,
    definition: msg`The month your tax year begins; may differ from the fiscal year in some jurisdictions.`
  },

  // ── Fixed assets (field-specific replacements for the depreciation / macrs umbrellas) ──
  "fixed-asset-depreciation-method": {
    term: msg`Depreciation Method`,
    definition: msg`The schedule used to spread this asset's cost over its useful life (straight-line, declining balance, units of production).`
  },
  "fixed-asset-useful-life": {
    term: msg`Useful Life (months)`,
    definition: msg`The number of months over which this asset will be depreciated.`
  },
  "fixed-asset-lifetime-usage": {
    term: msg`Lifetime Usage (units)`,
    definition: msg`Total expected production units for units-of-production depreciation; cost is spread per unit produced.`
  },
  "fixed-asset-tax-depreciation-method": {
    term: msg`Tax Depreciation Method`,
    definition: msg`A separate schedule for tax reporting when tax rules require a method different from book depreciation.`
  },
  "macrs-property-class": {
    term: msg`MACRS Property Class`,
    definition: msg`The IRS recovery-period class for this asset under MACRS (3, 5, 7, 10, 15, 20, 27.5, 39-year).`
  },
  "macrs-convention": {
    term: msg`MACRS Convention`,
    definition: msg`Mid-month / mid-quarter / half-year convention that determines the first-year deduction.`
  },
  "bonus-depreciation": {
    term: msg`Bonus Depreciation %`,
    definition: msg`First-year additional deduction taken before the regular MACRS schedule begins.`
  },
  "fixed-asset-tax-useful-life": {
    term: msg`Tax Useful Life (months)`,
    definition: msg`Months over which this asset depreciates for tax purposes (when not using MACRS).`
  },

  // ── Asset class defaults ────────────────────────────────────────────────
  "asset-class-default-depreciation-method": {
    term: msg`Depreciation Method (default)`,
    definition: msg`Default method that pre-fills on new assets in this class (still editable per asset).`
  },
  "asset-class-default-useful-life": {
    term: msg`Useful Life (default)`,
    definition: msg`Default useful life that pre-fills on new assets in this class.`
  },
  "asset-class-asset-account": {
    term: msg`Asset Account`,
    definition: msg`GL account debited when an asset in this class is acquired.`
  },
  "asset-class-accumulated-depreciation-account": {
    term: msg`Accumulated Depreciation Account`,
    definition: msg`GL contra-asset account credited when depreciation posts for assets in this class.`
  },
  "asset-class-depreciation-expense-account": {
    term: msg`Depreciation Expense Account`,
    definition: msg`GL expense account debited each period when depreciation posts.`
  },
  "asset-class-write-off-account": {
    term: msg`Write-Off Account`,
    definition: msg`GL account hit when an asset is written off (cost removed without disposal proceeds).`
  },
  "asset-class-write-down-account": {
    term: msg`Write-Down Account`,
    definition: msg`GL account hit when an asset's book value is reduced (impairment).`
  },
  "asset-class-disposal-account": {
    term: msg`Disposal Account`,
    definition: msg`GL account where gain or loss is booked when an asset in this class is disposed.`
  },
  "asset-class-default-tax-method": {
    term: msg`Tax Method (default)`,
    definition: msg`Default tax depreciation method for new assets in this class.`
  },
  "asset-class-default-tax-useful-life": {
    term: msg`Tax Useful Life (default)`,
    definition: msg`Default tax-book life for new assets in this class.`
  },

  // ── Fixed-asset register / disposal ─────────────────────────────────────
  "fixed-asset-acquisition-cost": {
    term: msg`Acquisition Cost`,
    definition: msg`Total capitalized cost of the asset (purchase price plus freight, install, and other costs that become part of book value).`
  },
  "fixed-asset-opening-accumulated-depreciation": {
    term: msg`Accumulated Depreciation (opening)`,
    definition: msg`Opening balance of depreciation already booked before this asset was added to Carbon (use 0 for new acquisitions).`
  },
  "fixed-asset-depreciation-start-date": {
    term: msg`Depreciation Start Date`,
    definition: msg`The date depreciation begins for this asset; usually the in-service date.`
  },
  "fixed-asset-disposal-date": {
    term: msg`Disposal Date`,
    definition: msg`The date this asset is retired from service; depreciation stops on this date and remaining net book value is booked to the disposal account.`
  },

  // ── Intercompany ────────────────────────────────────────────────────────
  "intercompany-debit-account": {
    term: msg`Debit Account`,
    definition: msg`GL account in the source company to debit for this intercompany transaction.`
  },
  "intercompany-credit-account": {
    term: msg`Credit Account`,
    definition: msg`GL account in the target company to credit for this intercompany transaction.`
  },
  "intercompany-posting-date": {
    term: msg`Posting Date`,
    definition: msg`The date this intercompany transaction hits both companies' ledgers.`
  },

  // ── Journal entries ─────────────────────────────────────────────────────
  "journal-entry-source": {
    term: msg`Source`,
    definition: msg`Where this entry originated (manual entry, posting from sales/purchasing, recurring template, etc.).`
  },
  "journal-entry-posting-date": {
    term: msg`Posting Date`,
    definition: msg`The date this entry hits the ledger; determines the accounting period it falls in.`
  },
  "journal-line-debit": {
    term: msg`Debit`,
    definition: msg`Amount that increases assets/expenses or decreases liabilities/equity/revenue on this line.`
  },
  "journal-line-credit": {
    term: msg`Credit`,
    definition: msg`Amount that increases liabilities/equity/revenue or decreases assets/expenses on this line.`
  },

  // ── Payment terms ───────────────────────────────────────────────────────
  "payment-term-calculation-method": {
    term: msg`After (calculation method)`,
    definition: msg`What the due-date countdown starts from (invoice date, end of month, etc.).`
  },
  "payment-term-due-days": {
    term: msg`Due Days`,
    definition: msg`How many days after the calculation date the full amount is due.`
  },
  "payment-term-discount-days": {
    term: msg`Discount Days`,
    definition: msg`How many days after the calculation date the early-payment discount is still available.`
  },
  "payment-term-discount-percent": {
    term: msg`Discount Percent`,
    definition: msg`The cash discount the customer can take if they pay within the discount window.`
  },

  // ── Documents (plan 03) ─────────────────────────────────────────────────
  "document-view-permissions": {
    term: msg`View permissions`,
    definition: msg`Users and groups allowed to open or download this document; the uploader is always included.`
  },
  "document-edit-permissions": {
    term: msg`Edit permissions`,
    definition: msg`Users and groups allowed to rename, replace, or re-label this document; the uploader is always included, and edit access implies view access.`
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Inventory sweep (plan 04): field-specific entries for the ERP inventory
  // module. Topic-of umbrellas (`shelf-life`) remain above for docs <Term> use;
  // field labels now point at these field-specific slugs instead. Broken
  // termIds (`receipt`/`serial`/`batch`) at field-label call sites are replaced
  // with the corresponding entity-prefixed slugs.
  // ──────────────────────────────────────────────────────────────────────────

  // ── Kanbans (KanbanForm) ────────────────────────────────────────────────
  // Note: `conversion-factor` already exists above (shared across PO/receipt/
  // bill lines too); the Kanban form reuses it. `purchase-unit-of-measure`
  // is new because no shared definition existed.
  "purchase-unit-of-measure": {
    term: msg`Purchase Unit of Measure`,
    definition: msg`The unit suppliers price and ship this item in, when different from the inventory unit (e.g. case vs each).`
  },
  "kanban-auto-release": {
    term: msg`Auto Release`,
    definition: msg`When the kanban card is scanned, the job is automatically moved out of draft and released to the floor.`
  },
  "kanban-auto-start-job": {
    term: msg`Auto Start Job`,
    definition: msg`Skip the released-but-not-started state — the job starts immediately on scan.`
  },
  "kanban-completion-barcode": {
    term: msg`Completion Barcode`,
    definition: msg`The code printed on the kanban card that operators scan to mark the job complete; auto-generated when left blank.`
  },

  // ── Shipping methods (ShippingMethodForm) ───────────────────────────────
  "shipping-method-carrier-account": {
    term: msg`Carrier Account`,
    definition: msg`The GL account charges for this carrier post to (freight expense, freight in/out).`
  },
  "shipping-method-tracking-url": {
    term: msg`Tracking URL`,
    definition: msg`The carrier's tracking-page URL with {trackingNumber} as a placeholder — Carbon substitutes the actual number when generating links on shipments.`
  },

  // ── Warehouse transfers (WarehouseTransferForm) ─────────────────────────
  "warehouse-transfer-expected-receipt-date": {
    term: msg`Expected Receipt Date`,
    definition: msg`When the receiving location expects the stock to arrive; drives MRP availability at the destination.`
  },

  // ── Storage units (StorageUnitForm) ─────────────────────────────────────
  "storage-unit-parent": {
    term: msg`Parent Storage Unit`,
    definition: msg`Another storage unit this one nests inside (e.g. a bin within a rack); must be in the same location.`
  },
  "storage-unit-storage-types": {
    term: msg`Storage Types`,
    definition: msg`The categories of stock allowed in this unit; used to enforce putaway rules (e.g. cold chain, hazardous).`
  },
  "storage-unit-work-center": {
    term: msg`Work Center`,
    definition: msg`Assigns this unit to a work center for lineside material, so operators see it on the production view; inherited from the parent unit when set there.`
  },

  // ── Receipts (ReceiptForm) ──────────────────────────────────────────────
  "receipt-source-document": {
    term: msg`Source Document`,
    definition: msg`What this receipt is fulfilling — a purchase order, a return, an inbound transfer, or a manual receipt with no parent.`
  },
  "receipt-source-document-id": {
    term: msg`Source Document ID`,
    definition: msg`The specific PO, return, or transfer this receipt posts against; available IDs depend on the source document type above.`
  },
  "receipt-external-reference": {
    term: msg`External Reference`,
    definition: msg`The supplier's packing-slip or shipment number, recorded for audit; not used by any posting logic.`
  },

  // ── Shipments (ShipmentForm) ────────────────────────────────────────────
  "shipment-source-document": {
    term: msg`Source Document`,
    definition: msg`What this shipment is fulfilling — a sales order, an outbound transfer, an RMA return, or a manual shipment.`
  },
  "shipment-source-document-id": {
    term: msg`Source Document ID`,
    definition: msg`The specific SO, transfer, or RMA this shipment posts against; available IDs depend on the source document type above.`
  },

  // ── Inventory adjustment modal (InventoryStorageUnits) ──────────────────
  "inventory-adjustment-type": {
    term: msg`Adjustment Type`,
    definition: msg`Why stock is changing — Positive (found), Negative (lost/scrap), or Set (replace count with a measured value).`
  },
  "inventory-adjustment-serial-number": {
    term: msg`Serial Number`,
    definition: msg`The unique identifier on this physical unit; one row per serial, quantity is always 1.`
  },
  "inventory-adjustment-batch-number": {
    term: msg`Batch Number`,
    definition: msg`The lot identifier for this stock; one row per batch, quantity is the on-hand for that lot.`
  },
  "inventory-adjustment-expiration-date": {
    term: msg`Expiration Date`,
    definition: msg`When this specific lot/serial expires; drives FEFO picking and the shelf-life policy on consumption.`
  },

  // ── Traceability (EditExpiryModal) ──────────────────────────────────────
  "traceability-expiration-edit-date": {
    term: msg`New expiration date`,
    definition: msg`The corrected expiration for this lot/serial; existing on-hand stock is re-evaluated against shelf-life policy after the change.`
  },

  // ── Items: core (Part/Tool/Material/Consumable/Item forms) ──────────────
  "item-tracking-type": {
    term: msg`Tracking Type`,
    definition: msg`Whether Carbon follows each unit (Serial), each lot (Batch), the quantity (Inventory), or no tracking (Non-Inventory).`
  },
  "item-default-method-type": {
    term: msg`Default Method Type`,
    definition: msg`How an item is sourced when added to a method or BOM line.`
  },
  "item-group": {
    term: msg`Item Group`,
    definition: msg`The accounting dimension that categorizes items for reporting and analysis.`
  },
  "part-batch-size": {
    term: msg`Batch Size`,
    definition: msg`The default run quantity when this part is made; planning rounds replenishment up to multiples of this.`
  },
  "material-sizes": {
    term: msg`Sizes`,
    definition: msg`The stock sizes this material is purchased and held in; each size becomes a separate selectable variant on jobs and POs.`
  },

  // ── Items: Customer/Supplier cross-references ───────────────────────────
  "customer-part-id": {
    term: msg`Customer Part ID`,
    definition: msg`The identifier the customer uses for this part on their POs; Carbon resolves it to our internal Part ID on order import.`
  },
  "customer-part-revision": {
    term: msg`Customer Part Revision`,
    definition: msg`The customer's revision tag for their Part ID, when it differs from ours; pinned at the cross-reference level, not on our revision.`
  },
  "supplier-part-id": {
    term: msg`Supplier Part ID`,
    definition: msg`The identifier the supplier uses for this part on their quotes and invoices; Carbon resolves it to our internal Part ID.`
  },
  "supplier-part-moq": {
    term: msg`Minimum Order Quantity`,
    definition: msg`The smallest quantity this supplier will accept on a PO line for this part; planning rounds up to it.`
  },
  "supplier-part-order-multiple": {
    term: msg`Order Multiple`,
    definition: msg`Order quantities must be whole multiples of this number (a multiple of 12 → 12, 24, 36 …).`
  },

  // ── Items: Manufacturing (ItemManufacturingForm) ────────────────────────
  "item-scrap-percent": {
    term: msg`Scrap Percent`,
    definition: msg`The expected percentage of this item's output lost during production; planning multiplies demand by 1 / (1 − scrap) to compensate.`
  },
  "item-manufacturing-lead-time": {
    term: msg`Lead Time (Days)`,
    definition: msg`The number of days to build one batch of this item, measured from job release to completion; planning offsets demand backward by this much.`
  },
  "item-configured": {
    term: msg`Configured`,
    definition: msg`This item is built via a configurator and resolves its components per-order; jobs created for it inherit the configurator's resolved BOM.`
  },

  // ── Items: Purchasing (ItemPurchasingForm) ──────────────────────────────
  "item-preferred-supplier": {
    term: msg`Preferred Supplier`,
    definition: msg`The supplier planning suggests first when this item needs to be bought; other suppliers stay available in the dropdown on each PO line.`
  },
  "item-purchasing-lead-time": {
    term: msg`Lead Time (Days)`,
    definition: msg`The number of days between placing a PO with the preferred supplier and the goods arriving on the dock; planning offsets demand backward by this much.`
  },
  "item-purchasing-uom": {
    term: msg`Purchasing Unit of Measure`,
    definition: msg`The unit suppliers price and ship this item in, when different from the inventory unit (e.g. case vs each); paired with Conversion Factor.`
  },

  // ── Items: Planning (ItemPlanningForm) ──────────────────────────────────
  "item-max-inventory-quantity": {
    term: msg`Maximum Inventory Quantity`,
    definition: msg`Under Maximum Quantity policy, planning orders up to this on-hand level when the reorder point trips.`
  },
  "item-accumulation-period-weeks": {
    term: msg`Accumulation Period (Weeks)`,
    definition: msg`Under Demand-Based Reorder, planning sums demand inside this rolling window when computing a replenishment quantity.`
  },
  "item-safety-stock": {
    term: msg`Safety Stock`,
    definition: msg`Buffer stock the demand-based policy holds back to absorb consumption spikes within the accumulation period.`
  },
  "item-reorder-quantity": {
    term: msg`Reorder Quantity`,
    definition: msg`Under Fixed Reorder Quantity, the exact quantity planning orders each time the reorder point trips.`
  },
  "item-planning-order-multiple": {
    term: msg`Order Multiple`,
    definition: msg`Planning rounds suggested replenishment up to a whole multiple of this number.`
  },
  "item-planning-moq": {
    term: msg`Minimum Order Quantity`,
    definition: msg`Planning's lower bound on a suggested replenishment quantity; distinct from a supplier's MOQ, which lives on the supplier-part record.`
  },
  "item-planning-max-order-quantity": {
    term: msg`Maximum Order Quantity`,
    definition: msg`Planning's upper bound on a single suggested replenishment; quantities above this are split into multiple orders.`
  },

  // ── Items: Supersession (ItemSupersessionForm) ──────────────────────────
  supersession: {
    term: msg`Supersession`,
    definition: msg`Phasing out an item in favor of a successor part, so planning redirects the old item's demand — times a conversion factor — to the new one.`
  },
  "supersession-mode": {
    term: msg`Supersession Mode`,
    definition: msg`Controls how planning handles a discontinued item: Consume First exhausts on-hand before switching to the successor, Prefer New redirects new demand to the successor immediately, Stock Only keeps only a minimum service reserve, and No Stock drops the item from planning entirely.`,
    aliases: ["phase-out", "spares-only", "obsolete"]
  },

  // ── Items: Pick method / shelf life (PickMethodForm) ────────────────────
  "item-default-storage-unit": {
    term: msg`Default Storage Unit`,
    definition: msg`Where new stock of this item lands by default on receipt; per-line storage selections on a receipt override it.`
  },
  "item-pick-order": {
    term: msg`Pick Order`,
    definition: msg`The default order picking uses to offer tracked entities: FEFO (earliest-expiry first), FIFO (oldest first), or LIFO (newest first).`
  },
  "item-shelf-life-days": {
    term: msg`Shelf Life (Days)`,
    definition: msg`How many days a serial or batch of this item stays usable after its start event; the shelf-life policy decides what happens past this date.`
  },
  "item-shelf-life-start-process": {
    term: msg`Shelf Life Start Process`,
    definition: msg`Which manufacturing event starts the shelf-life clock — for example, fill, seal, or final QC.`
  },
  "item-shelf-life-start-timing": {
    term: msg`Start Expiration`,
    definition: msg`Whether the clock starts when the chosen process begins or when it completes.`
  },
  "item-calculate-from-bom": {
    term: msg`Calculate from BOM`,
    definition: msg`Derive this item's shelf life from the shortest shelf life of its components, ignoring the Days field above.`
  },

  // ── People (Departments / Attributes) ───────────────────────────────────
  "department-parent": {
    term: msg`Parent Department`,
    definition: msg`The department this one rolls up under for reporting and headcount hierarchies; leave empty for a top-level department.`
  },
  "attribute-category-public": {
    term: msg`Public`,
    definition: msg`When on, attributes in this category show up on a person's public profile; otherwise they're visible to admins only.`
  },
  "attribute-data-type": {
    term: msg`Data Type`,
    definition: msg`The kind of value this attribute accepts (text, number, date, boolean, list); locked after the attribute has any recorded values.`
  },
  "attribute-list-options": {
    term: msg`List Options`,
    definition: msg`The allowed values for a list-type attribute; users pick from these rather than free-typing.`
  },
  "attribute-self-managed": {
    term: msg`Self Managed`,
    definition: msg`When on, employees can edit this attribute's value on their own profile; otherwise only admins can.`
  },

  // ── Quality: Calibration (GaugeCalibrationRecordForm) ───────────────────
  "calibration-requires-action": {
    term: msg`Requires Action`,
    definition: msg`Recorded that follow-up is needed after this calibration; surfaces this gauge on the open-actions queue.`
  },
  "calibration-requires-adjustment": {
    term: msg`Requires Adjustment`,
    definition: msg`Recorded that the gauge was adjusted during this calibration; affects how the calibration interval recalculates.`
  },
  "calibration-requires-repair": {
    term: msg`Requires Repair`,
    definition: msg`Recorded that the gauge needs repair; the gauge stays unavailable for inspections until the repair is closed out.`
  },
  "calibration-measurement-standard": {
    term: msg`Measurement Standard`,
    definition: msg`The traceable reference (e.g. NIST standard, master gauge serial) the calibration values were compared against.`
  },

  // ── Quality: Documents (QualityDocumentForm) ────────────────────────────
  "quality-document-version": {
    term: msg`Version`,
    definition: msg`The version stamp for this document; new versions create a copy that supersedes the previous one without deleting it.`
  },

  // ── Quality: Gauge (GaugeForm) ──────────────────────────────────────────
  "gauge-role": {
    term: msg`Role`,
    definition: msg`How this gauge is used — Standard (regular checks), Master (calibrates other gauges), or Reference (audit-only).`
  },
  "gauge-last-calibration-date": {
    term: msg`Last Calibration Date`,
    definition: msg`When this gauge was last successfully calibrated; the next-calibration date recomputes from this value plus the interval.`
  },
  "gauge-next-calibration-date": {
    term: msg`Next Calibration Date`,
    definition: msg`When this gauge becomes due for calibration; once past due, it's blocked from inspections until calibrated.`
  },
  "gauge-calibration-interval-months": {
    term: msg`Calibration Interval (Months)`,
    definition: msg`How often this gauge must be recalibrated; combined with Last Calibration Date to recompute Next Calibration Date automatically.`
  },

  // ── Quality: Inbound inspection (InboundInspectionForm) ─────────────────
  "inbound-inspection-disposition": {
    term: msg`Disposition`,
    definition: msg`Whether this lot/serial passes inspection (Pass) or fails (Fail); a Fail blocks the stock from being received into available inventory.`
  },

  // ── Quality: Inspection document (InspectionDocumentForm) ───────────────
  "inspection-document-drawing-number": {
    term: msg`Drawing Number`,
    definition: msg`The engineering drawing this inspection document is tied to; inspections recorded against this part reference back to this drawing.`
  },

  // ── Quality: Issue (IssueForm + IssueProperties) ────────────────────────
  "issue-issue-type": {
    term: msg`Issue Type`,
    definition: msg`The category of this issue (e.g. Customer Complaint, Audit Finding, Production Defect); drives which workflow template applies.`
  },
  "issue-workflow": {
    term: msg`Workflow`,
    definition: msg`The preset bundle of tasks and approval requirements applied to this issue; overrides the issue type's default workflow when set.`
  },
  "issue-required-actions": {
    term: msg`Required Actions`,
    definition: msg`Tasks that must be completed before this issue can be closed; selecting actions here adds them on top of whatever the workflow specifies.`
  },
  "issue-approval-requirements": {
    term: msg`Approval Requirements`,
    definition: msg`Sign-offs that must be recorded before this issue can be closed; in addition to any required by the workflow.`
  },
  "issue-source": {
    term: msg`Source`,
    definition: msg`Where this issue was raised from — internal QA, customer complaint, supplier audit, etc.; used for reporting, doesn't gate workflow.`
  },

  // ── Quality: Issue workflow (IssueWorkflowForm) ─────────────────────────
  "issue-workflow-issue-template": {
    term: msg`Issue Template`,
    definition: msg`A pre-written description inserted into every issue that uses this workflow; placeholders like {itemId} and {location} are substituted at creation.`
  },
  "issue-workflow-required-actions": {
    term: msg`Required Actions`,
    definition: msg`The ordered list of tasks issues using this workflow must complete; the order here is the order they appear on the issue.`
  },
  "issue-workflow-approval-requirements": {
    term: msg`Approval Requirements`,
    definition: msg`The sign-offs every issue using this workflow needs before it can be closed.`
  },

  // ── Quality: Risk register (RiskRegisterForm) ───────────────────────────
  "risk-register-type": {
    term: msg`Type`,
    definition: msg`The category of risk (operational, strategic, financial, compliance, etc.); drives which reports the risk rolls into.`
  },
  "risk-register-severity": {
    term: msg`Severity`,
    definition: msg`The impact rating if the risk is realized (1 = negligible to 5 = catastrophic); paired with Likelihood to compute the risk score.`
  },
  "risk-register-likelihood": {
    term: msg`Likelihood`,
    definition: msg`The probability rating that the risk occurs (1 = rare to 5 = almost certain); paired with Severity to compute the risk score.`
  },

  // ── Quality: Sampling plan (SamplingPlanForm) ───────────────────────────
  "sampling-plan-type": {
    term: msg`Plan Type`,
    definition: msg`How the sample size is decided — Inspect All, Inspect First N, Percentage of Lot, or AQL (Z1.4 / ISO 2859-1). Each mode reveals its own parameter fields below.`
  },
  "sampling-plan-sample-size": {
    term: msg`Sample Size`,
    definition: msg`The fixed number of units to inspect from the front of each lot, regardless of lot size.`
  },
  "sampling-plan-percentage": {
    term: msg`Percentage of Lot`,
    definition: msg`The fraction of each lot to inspect; the actual count is computed from lot size at the time of inspection.`
  },
  "sampling-plan-aql": {
    term: msg`AQL`,
    definition: msg`Acceptable Quality Level — the highest defect rate that's still considered passable under the Z1.4 / ISO 2859-1 tables.`
  },
  "sampling-plan-inspection-level": {
    term: msg`Inspection Level`,
    definition: msg`Z1.4 inspection level (I / II / III); higher levels mean larger sample sizes for the same lot.`
  },
  "sampling-plan-severity": {
    term: msg`Severity`,
    definition: msg`Z1.4 severity (Normal / Tightened / Reduced); switches by rule based on recent lot-acceptance history.`
  },

  // ── Production: Jobs (JobForm, JobMaterialForm) ─────────────────────────
  "job-estimated-scrap-quantity": {
    term: msg`Estimated Scrap Quantity`,
    definition: msg`The number of extra units to build to compensate for expected scrap; planning sums this with the order quantity when reserving materials.`
  },
  "job-deadline-type": {
    term: msg`Deadline Type`,
    definition: msg`How strict the Due Date is — Hard Deadline blocks scheduling past it, Soft Deadline lets planning push out with a warning, No Deadline ignores it entirely.`
  },
  "job-bulk-total-quantity": {
    term: msg`Total Quantity`,
    definition: msg`The total to make across all jobs created in this bulk batch; combined with Quantity Per Job to decide how many jobs to create.`
  },
  "job-bulk-quantity-per-job": {
    term: msg`Quantity Per Job`,
    definition: msg`How many units each individual job in the bulk batch builds; the last job's quantity may be smaller if Total Quantity doesn't divide evenly.`
  },
  "job-bulk-scrap-quantity-per-job": {
    term: msg`Scrap Quantity Per Job`,
    definition: msg`Estimated scrap quantity applied to every job in the bulk batch.`
  },
  "job-bulk-due-date-first": {
    term: msg`Due Date of First Job`,
    definition: msg`Due date of the earliest job in the bulk batch; later jobs space evenly between this date and Due Date of Last Job.`
  },
  "job-bulk-due-date-last": {
    term: msg`Due Date of Last Job`,
    definition: msg`Due date of the final job in the bulk batch; combined with Due Date of First Job to space the jobs evenly.`
  },
  "job-material-quantity-per-parent": {
    term: msg`Quantity per Parent`,
    definition: msg`How many of this material it takes to build one of the job's parent item; multiplied by job quantity to size the consumption.`
  },

  // ── Production: Events / Quantities (ProductionEventForm, ProductionQuantityForm) ──
  "production-event-type": {
    term: msg`Event Type`,
    definition: msg`What this time entry counts as — Labor (operator time), Machine (run time), or Setup (changeover time); each rolls up under a different rate.`
  },
  "production-quantity-type": {
    term: msg`Quantity Type`,
    definition: msg`What kind of output this entry records — Production (good units), Scrap (unrecoverable), or Rework (sent back for correction); reveals Scrap Reason when Scrap.`
  },
  "production-quantity-scrap-reason": {
    term: msg`Scrap Reason`,
    definition: msg`The catalog reason that explains this scrap; rolls up into scrap reports keyed by reason rather than by quantity.`
  },

  // ── Production: Procedures (ProcedureForm) ──────────────────────────────
  "procedure-version": {
    term: msg`Version`,
    definition: msg`The version stamp for this procedure; new versions create a copy that supersedes the previous one without deleting it.`
  },

  // ── Purchasing: Supplier (SupplierForm, SupplierPaymentForm, SupplierShippingForm) ──
  "supplier-status": {
    term: msg`Supplier Status`,
    definition: msg`The lifecycle state of this supplier — Active, Inactive, Pending Approval, etc.; only Active suppliers appear in PO / quote selectors.`
  },
  "supplier-type-field": {
    term: msg`Supplier Type`,
    definition: msg`The category this supplier belongs to (raw-material, services, contract-manufacturer); drives default GL accounts and reporting groupings.`
  },
  "supplier-account-manager": {
    term: msg`Account Manager`,
    definition: msg`The Carbon user responsible for this supplier relationship; emails and reminders about this supplier route to them.`
  },
  "invoice-supplier": {
    term: msg`Invoice Supplier`,
    definition: msg`The legal entity to bill, when different from the supplier who delivers the goods — for parent / subsidiary or factoring arrangements.`
  },
  "supplier-payment-term": {
    term: msg`Payment Term`,
    definition: msg`How many days from invoice date this supplier expects payment; drives the default due date on bills.`
  },
  "shipping-supplier": {
    term: msg`Shipping Supplier`,
    definition: msg`The carrier that delivers goods from this supplier, when different from the supplier itself (e.g. supplier sells, FedEx ships).`
  },
  "supplier-incoterm": {
    term: msg`Incoterm`,
    definition: msg`The Incoterm rule (FOB, DAP, EXW, CIF, …) that governs who pays freight, who bears risk, and where the transfer of title occurs on shipments from this supplier.`
  },

  // ── Shared: Tax fields (Supplier/CustomerTaxForm) ───────────────────────
  "vat-number": {
    term: msg`VAT Number`,
    definition: msg`Value-added-tax registration number; required on EU invoices for reverse-charge or zero-rated supplies.`
  },
  eori: {
    term: msg`EORI`,
    definition: msg`Economic Operators Registration and Identification number; required for goods crossing customs borders in the EU / UK.`
  },
  "tax-exempt": {
    term: msg`Tax Exempt`,
    definition: msg`When on, this party's invoices skip tax calculation; the party is responsible for keeping the exemption certificate current.`
  },

  // ── Shared: ArrayNumeric quantity-break inputs ──────────────────────────
  "quantity-breaks": {
    term: msg`Quantity Breaks`,
    definition: msg`The quantity breakpoints this line is priced at; each column carries its own per-unit price for buyer–supplier negotiation and for converting to downstream documents.`
  },

  // ── Purchasing: Supplier process (SupplierProcessForm) ──────────────────
  "supplier-process-minimum-cost": {
    term: msg`Minimum Cost`,
    definition: msg`The lowest amount this supplier will charge for this process, regardless of quantity; jobs below the breakeven volume still cost at least this much.`
  },
  "supplier-process-lead-time": {
    term: msg`Standard Lead Time`,
    definition: msg`The typical number of days between sending work to this supplier for this process and getting it back; planning offsets demand by this much when picking a supplier.`
  },

  // ── Purchasing: Purchasing RFQ (PurchasingRFQForm) ──────────────────────
  "purchasing-rfq-suppliers": {
    term: msg`Suppliers`,
    definition: msg`The suppliers receiving this RFQ; each gets its own line on the RFQ that they respond to with their own pricing.`
  },
  "purchasing-rfq-due-date": {
    term: msg`Due Date`,
    definition: msg`When supplier responses are expected back; suppliers see this date on the RFQ portal and Carbon stops accepting late responses after it (configurable).`
  },
  "purchasing-rfq-buyer": {
    term: msg`Buyer`,
    definition: msg`The Carbon user who owns this RFQ; supplier responses and reminders route to them.`
  },

  // ── Purchasing: Supplier quote (SupplierQuoteForm) ──────────────────────
  "supplier-quote-ref-number": {
    term: msg`Supplier Ref. Number`,
    definition: msg`The supplier's own quote / proposal number; recorded for traceability on the PO that converts from this quote.`
  },
  "supplier-quote-expiration-date": {
    term: msg`Expiration Date`,
    definition: msg`When the supplier's pricing stops being honored; converting this quote to a PO after this date may need re-quoting.`
  },
  "supplier-quote-type": {
    term: msg`Quote Type`,
    definition: msg`What kind of quote this is — standard supplier quote, blanket-agreement priced quote, or contract-manufacturing quote; drives the PO line layout when converted.`
  },

  // ── Purchasing: Purchase order header (PurchaseOrderForm) ───────────────
  "purchase-order-supplier-order-number": {
    term: msg`Supplier Order Number`,
    definition: msg`The supplier's own reference for this order (their SO number on their system); recorded for audit and surfaced on the receipt.`
  },
  "purchase-order-delivery-location": {
    term: msg`Delivery Location`,
    definition: msg`Where goods on this PO are shipped to by default; per-line delivery locations on the PO override this for drop-ship and split-delivery scenarios.`
  },
  "purchase-order-type": {
    term: msg`Purchase Order Type`,
    definition: msg`What kind of PO this is — standard goods, services, outside-processing, or blanket agreement; drives the line layout and the GL posting rules.`
  },

  // ── Purchasing: Purchase order line (PurchaseOrderLineForm) ─────────────
  "purchase-order-line-outside-processing-job": {
    term: msg`Job`,
    definition: msg`The job whose operation this outside-processing line covers; the line's receipt closes the operation against this job.`
  },
  "purchase-order-line-outside-processing-operation": {
    term: msg`Operation`,
    definition: msg`The specific operation on the job above that this PO line is purchasing; only operations marked outside-processing are selectable.`
  },
  "purchase-order-line-required-date": {
    term: msg`Required Date`,
    definition: msg`When the buyer needs this line's goods on the dock; planning uses this date for stock-availability and outside-processing scheduling.`
  },
  "purchase-order-line-delivery-location": {
    term: msg`Delivery Location`,
    definition: msg`Per-line override of the PO header's Delivery Location; used for split deliveries to multiple warehouses or drop-shipments.`
  },
  "purchase-order-line-storage-unit": {
    term: msg`Storage Unit`,
    definition: msg`Where this line's goods land in stock on receipt; if blank, receipts use the item's Default Storage Unit.`
  },
  "purchase-order-line-shipping": {
    term: msg`Shipping`,
    definition: msg`Freight charged by this supplier for this line, when it itemizes shipping rather than rolling it into unit price.`
  },
  "purchase-order-line-fixed-asset": {
    term: msg`Fixed Asset`,
    definition: msg`The fixed-asset record this purchase capitalizes against; the line's receipt creates the asset entry rather than an inventory entry.`
  },
  "purchase-indirect-gl-account": {
    term: msg`GL Account`,
    definition: msg`The expense account this indirect-spend line posts to; required because indirect lines don't have an item ledger entry to derive the account from.`
  },

  // ── Purchasing: PO delivery (PurchaseOrderDeliveryForm) ─────────────────
  "purchase-order-delivery-requested-date": {
    term: msg`Requested Date`,
    definition: msg`When the buyer asked for the goods; the supplier may promise something else on Promised Date and post something else again on Delivery Date.`
  },
  "purchase-order-delivery-promised-date": {
    term: msg`Promised Date`,
    definition: msg`When the supplier committed to deliver; planning uses this date for the inbound-stock arrival projection.`
  },
  "purchase-order-delivery-actual-date": {
    term: msg`Delivery Date`,
    definition: msg`When the goods actually arrived; recorded on the receipt and used for supplier on-time-delivery scoring.`
  },

  // ── Sales: Customer (CustomerForm, CustomerPaymentForm, CustomerShippingForm, CustomerPortalForm) ──
  "customer-portal-customer": {
    term: msg`Customer`,
    definition: msg`The customer this portal link is provisioned for; only contacts on this customer can sign in through the link.`
  },
  "customer-status": {
    term: msg`Customer Status`,
    definition: msg`The lifecycle state of this customer — Active, Prospect, Inactive, etc.; only Active customers appear in sales-order selectors.`
  },
  "customer-type-field": {
    term: msg`Customer Type`,
    definition: msg`The category this customer belongs to (OEM, distributor, end-user, internal); drives default pricing rules and GL accounts.`
  },
  "customer-account-manager": {
    term: msg`Account Manager`,
    definition: msg`The Carbon user responsible for this customer relationship; emails and reminders about this customer route to them.`
  },
  "customer-default-tax-percent": {
    term: msg`Tax Percent`,
    definition: msg`The default tax rate applied to this customer's quote and sales-order lines, before per-line overrides; jurisdiction-specific tax math runs on top.`
  },
  "invoice-customer": {
    term: msg`Invoice Customer`,
    definition: msg`The legal entity to bill, when different from the customer who receives the goods — for parent / subsidiary or third-party billing arrangements.`
  },
  "customer-payment-term": {
    term: msg`Payment Term`,
    definition: msg`How many days from invoice date this customer is given to pay; drives the default due date on customer invoices.`
  },
  "shipping-customer": {
    term: msg`Shipping Customer`,
    definition: msg`The customer that goods are delivered to, when different from the customer being invoiced (e.g. invoice to HQ, ship to branch).`
  },
  "customer-incoterm": {
    term: msg`Incoterm`,
    definition: msg`The Incoterm rule (FOB, DAP, EXW, CIF, …) that governs who pays freight, who bears risk, and where the transfer of title occurs on shipments to this customer.`
  },

  // ── Sales: Shared document reference (RFQ / Quote / Order) ──────────────
  "customer-document-reference": {
    term: msg`Customer Reference`,
    definition: msg`The customer's own reference for this document — typically their RFQ or PO number on their system; surfaced on the printable output and carried forward into any document this one converts into.`
  },

  // ── Sales: Pricing (PriceOverrideForm, PricingRuleForm) ─────────────────
  "price-override-price-breaks": {
    term: msg`Price Breaks`,
    definition: msg`Quantity-based pricing tiers for this override; the unit price applied is the row with the largest minimum quantity that the order line satisfies.`
  },
  "price-override-active": {
    term: msg`Active`,
    definition: msg`When on, this price override applies to matching orders; turning off without deleting preserves the history for audit.`
  },
  "price-override-apply-rules-on-top": {
    term: msg`Apply Rules On Top`,
    definition: msg`When on, pricing rules (volume discounts, promotions) still apply on top of this override; when off, this override is the final price.`
  },
  "pricing-rule-type": {
    term: msg`Rule Type`,
    definition: msg`The kind of adjustment this rule applies — discount, surcharge, or fixed override; combined with Amount Type to compute the actual delta on each line.`
  },
  "pricing-rule-amount-type": {
    term: msg`Amount Type`,
    definition: msg`Whether Amount is interpreted as a percentage of the line price or as a fixed currency amount.`
  },
  "pricing-rule-quantity-range": {
    term: msg`Quantity Range`,
    definition: msg`The quantity range over which this rule applies; orders outside the range fall through to the next rule.`
  },

  // ── Sales: Quote header & shipment (QuoteForm, QuoteShipmentForm) ───────
  "quote-fulfillment-location": {
    term: msg`Fulfillment Location`,
    definition: msg`The location this quote will fulfill from if it converts to an order; used by planning to project supply at the right warehouse.`
  },
  "quote-expiration-date": {
    term: msg`Expiration Date`,
    definition: msg`The date past which this quote's pricing is no longer honored; converting to an order after this date may require re-quoting.`
  },
  "quote-shipment-from-location": {
    term: msg`Ship-From Location`,
    definition: msg`The warehouse goods on this quote will ship from; the customer's Shipping Location is where they'll arrive.`
  },
  "quote-shipment-receipt-requested-date": {
    term: msg`Receipt Requested Date`,
    definition: msg`When the customer asked to receive the goods; the quote commits to this date if the customer accepts.`
  },

  // ── Sales: Quote line (QuoteLineForm) ───────────────────────────────────
  "quote-line-status": {
    term: msg`Status`,
    definition: msg`The state of this quote line — Draft, No Quote, Complete; No Quote reveals the Reason field and excludes the line from the quote total.`
  },
  "quote-line-no-quote-reason": {
    term: msg`No Quote Reason`,
    definition: msg`Why this line is being declined; surfaced on the printable quote and recorded for win-loss reporting.`
  },

  // ── Sales: Sales order header (SalesOrderForm) ──────────────────────────
  "sales-order-requested-date": {
    term: msg`Requested Date`,
    definition: msg`When the customer asked for delivery; the order commits to Promised Date, which may differ.`
  },
  "sales-order-promised-date": {
    term: msg`Promised Date`,
    definition: msg`When you committed to deliver; planning treats this as the demand-due-date for fulfillment.`
  },
  "sales-order-fulfillment-location": {
    term: msg`Fulfillment Location`,
    definition: msg`The location this order will fulfill from; per-line locations override this when set.`
  },

  // ── Sales: Sales order line (SalesOrderLineForm) ────────────────────────
  "sales-order-line-unit-price": {
    term: msg`Unit Price`,
    definition: msg`The negotiated price per unit on this line; the inline trace icon shows which pricing rule or override produced it.`
  },
  "sales-order-line-promised-date": {
    term: msg`Promised Date`,
    definition: msg`When this specific line is promised to ship; per-line override of the order header's Promised Date for split shipments.`
  },
  "sales-order-line-fulfillment-location": {
    term: msg`Fulfillment Location`,
    definition: msg`Per-line override of the order header's fulfillment Location; used for split shipments and drop-ships.`
  },
  "sales-order-line-storage-unit": {
    term: msg`Storage Unit`,
    definition: msg`The storage bin this line picks from; if blank, picking uses the item's Default Storage Unit.`
  },
  "sales-order-line-shipping": {
    term: msg`Shipping Cost`,
    definition: msg`Freight billed to the customer for this line, separate from the line's unit price.`
  },
  "sales-order-line-add-on-cost": {
    term: msg`Add-On Cost`,
    definition: msg`A taxable surcharge (handling, setup, fuel) added to the line; rolls into the tax base.`
  },
  "sales-order-line-non-taxable-add-on-cost": {
    term: msg`Non-Taxable Add-On Cost`,
    definition: msg`A non-taxable surcharge (e.g. recoverable expenses like permit fees) added to the line; excluded from the tax base.`
  },
  "sales-order-line-asset": {
    term: msg`Asset`,
    definition: msg`The fixed-asset record this sale disposes; the line's shipment posts the asset's net-book-value disposal entry rather than COGS.`
  },

  // ── Sales: Sales order shipment (SalesOrderShipmentForm) ────────────────
  "sales-order-shipment-from-location": {
    term: msg`Ship-From Location`,
    definition: msg`The warehouse goods on this order will ship from; the customer's Shipping Location is where they'll arrive.`
  },
  "sales-order-shipment-receipt-requested-date": {
    term: msg`Receipt Requested Date`,
    definition: msg`When the customer asked to receive the goods.`
  },
  "sales-order-shipment-receipt-promised-date": {
    term: msg`Receipt Promised Date`,
    definition: msg`When Carbon committed to having the goods arrive; combined with the shipping method's transit days, this drives Ship Date back-calc.`
  },
  "sales-order-shipment-date": {
    term: msg`Shipment Date`,
    definition: msg`The date the goods actually leave the warehouse; recorded on the shipment posting and used for on-time-shipping scoring.`
  },

  // ── Sales: Sales RFQ (SalesRFQForm) ─────────────────────────────────────
  "rfq-date": {
    term: msg`RFQ Date`,
    definition: msg`When the customer submitted this RFQ; the response clock starts from this date.`
  },
  "rfq-receiving-location": {
    term: msg`Receiving Location`,
    definition: msg`The location this RFQ would fulfill from if it converts to a quote and then an order.`
  },
  "sales-rfq-expiration-date": {
    term: msg`Expiration Date`,
    definition: msg`When the customer's request stops being current; past this date the RFQ is auto-closed and won't accept quote responses unless re-opened.`
  },

  // ── Resources: Failure modes (FailureModeForm) ──────────────────────────
  "failure-mode-type": {
    term: msg`Type`,
    definition: msg`What category of failure this is — Mechanical, Electrical, Software, Operator, Material, etc.; rolls up into the failure-mode pareto report so the category breakdown is meaningful.`
  },

  // ── Resources: Locations (LocationForm) ─────────────────────────────────
  "location-timezone": {
    term: msg`Timezone`,
    definition: msg`The local timezone this location reports time in; schedules, timecards, and shift hours at this location are interpreted in this zone regardless of the user's browser locale.`
  },

  // ── Resources: Contractors (ContractorForm) ─────────────────────────────
  "contractor-hours-per-week": {
    term: msg`Hours per Week`,
    definition: msg`The contractor's expected weekly availability; scheduling uses this as the upper bound when assigning this contractor to operations across the week.`
  },

  // ── Resources: Processes (ProcessForm) ──────────────────────────────────
  "process-type": {
    term: msg`Process Type`,
    definition: msg`Whether this process runs on internal work centers (Inside), outside suppliers (Outside), or both (Both); reveals different downstream fields and changes how planning routes work for this process.`
  },
  "process-default-unit": {
    term: msg`Default Unit`,
    definition: msg`The standard factor used to measure this process — hours, minutes, pieces, square feet — when its operations are estimated and costed.`
  },
  "process-suppliers": {
    term: msg`Suppliers`,
    definition: msg`The outside suppliers that perform this process; each gets a row of pricing and lead-time inputs on the supplier process form.`
  },
  "process-complete-all-on-scan": {
    term: msg`Complete all quantities on barcode scan`,
    definition: msg`When on, scanning this process's operation barcode reports all remaining open quantity as complete in one action; turn off when operators routinely report partials.`
  },

  // ── Resources: Work centers (WorkCenterForm) ────────────────────────────
  "work-center-processes": {
    term: msg`Processes`,
    definition: msg`The processes this work center can run; appears in process-pickers when scheduling operations, and limits which jobs can route through this work center.`
  },
  "work-center-labor-rate": {
    term: msg`Labor Rate (Hourly)`,
    definition: msg`The hourly cost of operator labor on this work center; combined with logged labor hours to charge labor cost into a job's WIP.`
  },
  "work-center-machine-rate": {
    term: msg`Machine Rate (Hourly)`,
    definition: msg`The hourly cost of running the machinery on this work center; combined with logged machine hours to charge machine cost into a job's WIP.`
  },
  "work-center-overhead-rate": {
    term: msg`Overhead Rate (Hourly)`,
    definition: msg`The hourly indirect-cost burden applied to this work center; the difference between labor + machine and the full quoting rate is what overhead absorbs.`
  },
  "work-center-default-unit": {
    term: msg`Default Unit`,
    definition: msg`The standard factor (hours, minutes, pieces) operations on this work center are measured in by default; per-operation overrides win when set.`
  },

  // ── Resources: Maintenance dispatch (MaintenanceDispatchForm) ───────────
  "maintenance-dispatch-source": {
    term: msg`Source`,
    definition: msg`Where this maintenance request originated — operator-reported, scheduled, condition-monitoring trigger, post-job inspection; drives the source breakdown in maintenance reports.`
  },
  "maintenance-dispatch-severity": {
    term: msg`Severity`,
    definition: msg`How urgent this dispatch is — Low / Medium / High / Critical; combined with Priority and OEE Impact to decide schedule slot.`
  },
  "maintenance-dispatch-oee-impact": {
    term: msg`OEE Impact`,
    definition: msg`Whether this work blocks production (Down), degrades it (Impact), is on a planned downtime window (Planned), or has no production impact (No Impact); informs scheduling and customer-facing downtime communication.`
  },
  "maintenance-dispatch-suspected-failure-mode": {
    term: msg`Suspected Failure Mode`,
    definition: msg`The most likely failure mode the requester suspects; the technician confirms or replaces this on close-out, and the difference between suspected and actual feeds reliability reports.`
  },

  // ── Resources: Maintenance schedule (MaintenanceScheduleForm) ───────────
  "maintenance-schedule-frequency": {
    term: msg`Frequency`,
    definition: msg`How often this maintenance recurs — Daily, Weekly, Monthly, On Cycle Count; Daily reveals the day-of-week selector, the others use simpler interval math.`
  },
  "maintenance-schedule-estimated-duration": {
    term: msg`Estimated Duration (minutes)`,
    definition: msg`How long one execution of this schedule typically takes; scheduling blocks the work center for this many minutes on each scheduled instance.`
  },
  "maintenance-schedule-procedure": {
    term: msg`Procedure`,
    definition: msg`The procedure technicians follow when this maintenance is performed; replacing it after schedules have already been generated only affects future instances.`
  },

  // ── Users: Groups (GroupsForm) ──────────────────────────────────────────
  "group-members": {
    term: msg`Group Members`,
    definition: msg`The users in this group; group-scoped permissions and notifications apply to each member, and users may belong to multiple groups (effective permissions are the union).`
  },

  // ── Users: Employee types (EmployeeTypeForm) ────────────────────────────
  "employee-type-default-permissions": {
    term: msg`Default Permissions`,
    definition: msg`The permission set new employees of this type receive automatically; editing here changes the template for future hires only — existing employees keep what they have unless explicitly bulk-updated.`
  },

  // ── Users: Employee permissions (EmployeePermissionsForm) ───────────────
  "employee-permissions-employee-type-override": {
    term: msg`Employee Type`,
    definition: msg`Switching the employee's type here doesn't change their existing permissions; the modal that follows asks whether to overwrite the current set with the new type's defaults.`
  },

  // ── Users: Bulk permissions (BulkEditPermissionsForm) ───────────────────
  "bulk-permissions-update-type": {
    term: msg`Type of Permission Update`,
    definition: msg`Whether to Add the selected permissions on top of what each user already has, or Update by replacing each user's permission set wholesale with the selection below.`
  },

  // ── Users: Customer account (CreateCustomerModal) ───────────────────────
  "create-customer-account-customer": {
    term: msg`Customer`,
    definition: msg`The customer record this portal account links to; only contacts already on that customer can be selected as the account holder below.`
  },
  "create-customer-account-contact": {
    term: msg`Customer Contact`,
    definition: msg`The specific contact on the selected customer who will own this portal account; their email becomes the sign-in identifier.`
  },

  // ── Users: Supplier account (CreateSupplierModal) ───────────────────────
  "create-supplier-account-supplier": {
    term: msg`Supplier`,
    definition: msg`The supplier record this portal account links to; only contacts already on that supplier can be selected as the account holder below.`
  },
  "create-supplier-account-contact": {
    term: msg`Supplier Contact`,
    definition: msg`The specific contact on the selected supplier who will own this portal account; their email becomes the sign-in identifier.`
  },

  // ── Users: Create employee (CreateEmployeeModal) ────────────────────────
  "create-employee-employee-type": {
    term: msg`Employee Type`,
    definition: msg`The type controls which default permissions the new employee receives; selecting it here pre-fills the permission matrix from the type's template.`
  },
  "create-employee-location": {
    term: msg`Location`,
    definition: msg`The location this employee defaults to; drives timezone interpretation on their timecards and the default shift selectors on their job record.`
  }
} as const satisfies Record<string, GlossaryEntry>;
