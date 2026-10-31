// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which catalogue cards set up, load or exercise each priority set feature
// (content/priority-set.ts), in the order a person works through them. The
// page-drafting prompt (logic/page-prompt.ts) suggests them for the features
// a company places before go-live and in its first months. A feature with no
// card of its own (purchase returns, workflows) is absent. Keys on both sides
// are stored, so logic/page-prompt.test.ts checks every one exists.
export const FEATURE_CARDS: Partial<Record<string, readonly string[]>> = {
  "items.parts": [
    "setup:units",
    "setup:item-groups",
    "setup:parts",
    "data:uom",
    "data:parts",
    "training:itm-1"
  ],
  "items.materials": [
    "setup:materials",
    "setup:material-substances",
    "setup:material-shapes",
    "setup:material-grades",
    "setup:material-finishes",
    "setup:material-dimensions",
    "setup:material-types"
  ],
  "items.methods": [
    "step:configure-bom",
    "data:boms",
    "data:routings",
    "training:itm-1"
  ],
  "items.consumables": ["setup:consumables"],
  "items.tools": ["setup:tools"],
  "items.change-control": ["training:itm-2"],
  "items.configurator": ["training:sal-2"],
  "resources.locations": ["setup:locations", "data:sites"],
  "resources.processes": ["setup:processes"],
  "resources.work-centers": ["setup:work-centers", "data:workcenters"],
  "resources.maintenance": [
    "setup:failure-modes",
    "setup:maintenance-schedules"
  ],
  "purchasing.suppliers": [
    "setup:supplier-types",
    "setup:suppliers",
    "data:suppliers"
  ],
  "purchasing.orders": [
    "data:open-po",
    "task:first-purchase-order",
    "training:pur-1"
  ],
  "inventory.receipts": ["task:first-receipt"],
  "inventory.shipments": ["setup:shipping-methods"],
  "inventory.stock": ["data:inventory", "training:inv-1"],
  "inventory.storage-units": [
    "setup:storage-types",
    "setup:storage-units",
    "setup:storage-rules"
  ],
  "inventory.traceability": ["step:serialize-sell"],
  "inventory.counts": ["training:inv-1"],
  "production.jobs": [
    "setup:scrap-reasons",
    "data:open-jobs",
    "task:first-job",
    "task:first-job-completed"
  ],
  "production.mrp": ["step:purchase-make", "training:pur-1"],
  "production.scheduling": ["training:prd-1"],
  "mes.operations": ["task:first-job-completed", "training:prd-1"],
  "sales.customers": [
    "setup:customer-types",
    "setup:customer-statuses",
    "setup:customers",
    "data:customers"
  ],
  "sales.orders": ["data:open-so", "task:first-sales-order", "training:sal-1"],
  "sales.quotes": [
    "setup:price-lists",
    "setup:pricing-rules",
    "setup:no-quote-reasons",
    "data:pricelists",
    "task:first-quote",
    "training:sal-1"
  ],
  "quality.inspections": ["training:qms-1"],
  "quality.issues": ["training:qms-1"],
  "quality.training": ["setup:training"],
  "people.employees": [
    "setup:departments",
    "setup:employee-types",
    "setup:attributes",
    "setup:employees"
  ],
  "people.shifts": ["setup:shifts", "setup:holidays"],
  "users.accounts": ["setup:groups", "data:roles"],
  "invoicing.sales": ["data:ar", "training:acc-2"],
  "invoicing.purchase": ["data:ap", "training:acc-3"],
  "invoicing.payments": [
    "setup:payment-terms",
    "training:acc-2",
    "training:acc-3"
  ],
  "accounting.ledger": [
    "setup:fiscal-year",
    "setup:accounting-periods",
    "setup:chart-of-accounts",
    "setup:default-accounts",
    "setup:cost-centers",
    "setup:accounting-dimensions",
    "data:coa",
    "training:acc-1"
  ],
  "accounting.currencies": ["setup:exchange-rates", "data:tax"],
  "accounting.fixed-assets": ["setup:asset-classes", "setup:fixed-assets"],
  "platform.document-templates": ["setup:logos", "setup:document-templates"],
  "platform.approvals": ["setup:approval-rules"],
  "integrations.cad": ["setup:integrations", "training:itm-2"],
  "integrations.accounting": ["setup:integrations"]
};
