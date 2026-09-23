// Pure, DB-free validation of a Dataset's internal consistency: every string
// reference must resolve against the dataset's own definitions, so a typo or an
// unbalanced journal fails even when no database is running. The drift check
// (`pnpm db:check:datasets`) covers the live schema.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  accounts,
  changeOrderRequiredActions,
  changeOrderTypes,
  dimensions,
  failureModes,
  gaugeTypes,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  periodCloseTaskDefinitions,
  returnReasons,
  scrapReasons,
  unitOfMeasures
} from "../../supabase/functions/lib/seed.data.ts";
import { NOT_CLOSED_MIN_OFFSET, OPEN_PERIOD_MIN_OFFSET } from "./dates.ts";
import {
  deriveSampleStatus,
  resolveInspectionPlan
} from "./helpers/inspection.ts";
import type {
  Dataset,
  InstantSpec,
  JournalEntrySpec,
  JournalLineSpec,
  SalesOpportunitySpec
} from "./types.ts";

const PAYMENT_TERM_NAMES = new Set<string>(paymentTerms.map((pt) => pt.name));
const RETURN_REASON_NAMES = new Set<string>(returnReasons);
const SCRAP_REASON_NAMES = new Set<string>(scrapReasons);
const NCR_TYPE_NAMES = new Set<string>(nonConformanceTypes.map((t) => t.name));
const NCR_ACTION_NAMES = new Set<string>(
  nonConformanceRequiredActions.map((a) => a.name)
);
const GAUGE_TYPE_NAMES = new Set<string>(gaugeTypes);
const CO_TYPE_NAMES = new Set<string>(changeOrderTypes.map((t) => t.name));
const CO_ACTION_NAMES = new Set<string>(
  changeOrderRequiredActions.map((a) => a.name)
);
const UOM_CODES = new Set<string>(unitOfMeasures.map((u) => u.code));

// ── Required sales status coverage ───────────────────────────────────────────
// Each dataset must exhibit these, so an edit can't silently drop a state the
// docs screenshot. Transient "Pending" and return "Cancelled" are not modeled.
export const REQUIRED_SALES_RFQ_STATUSES = [
  "Draft",
  "Ready for Quote",
  "Quoted",
  "Closed"
] as const;
export const REQUIRED_QUOTE_STATUSES = [
  "Draft",
  "Sent",
  "Ordered",
  "Partial",
  "Lost",
  "Cancelled",
  "Expired"
] as const;
export const REQUIRED_QUOTE_LINE_STATUSES = [
  "Not Started",
  "In Progress",
  "Complete",
  "No Quote"
] as const;
export const REQUIRED_SALES_ORDER_STATUSES = [
  "Draft",
  "Needs Approval",
  "Confirmed",
  "In Progress",
  "Completed",
  "Invoiced",
  "Cancelled",
  "Closed",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice"
] as const;
export const REQUIRED_SHIPMENT_STATUSES = [
  "Draft",
  "Posted",
  "Voided"
] as const;
export const REQUIRED_SALES_INVOICE_STATUSES = [
  "Draft",
  "Submitted",
  "Overdue",
  "Paid",
  "Partially Paid",
  "Voided",
  "Credit Note Issued"
] as const;
export const REQUIRED_SALES_RETURN_STATUSES = [
  "Draft",
  "To Receive",
  "Completed"
] as const;

// ── Required purchasing status coverage ──────────────────────────────────────
// Not modeled: transient "Pending", invoice "Return" (return-invoice flow only),
// and "Cancelled" returns/supplier quotes.
export const REQUIRED_PURCHASE_ORDER_STATUSES = [
  "Draft",
  "Planned",
  "To Review",
  "Rejected",
  "Needs Approval",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Closed"
] as const;
export const REQUIRED_RECEIPT_STATUSES = ["Draft", "Posted", "Voided"] as const;
export const REQUIRED_PURCHASE_INVOICE_STATUSES = [
  "Draft",
  "Open",
  "Overdue",
  "Paid",
  "Partially Paid",
  "Voided",
  "Debit Note Issued"
] as const;
export const REQUIRED_PURCHASE_RETURN_STATUSES = [
  "Draft",
  "To Ship",
  "Completed"
] as const;
export const REQUIRED_PURCHASING_RFQ_STATUSES = [
  "Draft",
  "Requested",
  "Closed"
] as const;
export const REQUIRED_SUPPLIER_QUOTE_STATUSES = [
  "Draft",
  "Active",
  "Expired",
  "Declined"
] as const;

// ── Required production coverage ─────────────────────────────────────────────
// Jobs without an explicit deadlineType count as "Hard Deadline" (the tier's
// default). Todo/Ready/Done/Canceled/Paused arrive via operationStatusFor; the
// two mixed-floor states only exist through operationOverrides.
export const REQUIRED_JOB_DEADLINE_TYPES = [
  "No Deadline",
  "ASAP",
  "Soft Deadline",
  "Hard Deadline"
] as const;
export const REQUIRED_JOB_OPERATION_STATUSES = [
  "In Progress",
  "Waiting"
] as const;
export const REQUIRED_PRODUCTION_QUANTITY_TYPES = [
  "Production",
  "Scrap",
  "Rework"
] as const;
export const REQUIRED_PICKING_LIST_STATUSES = [
  "In Progress",
  "Completed"
] as const;

// ── Required inventory coverage ──────────────────────────────────────────────
// Available / Reserved / Consumed come from the story itself (opening lots,
// job reservations, genealogy); these are the quality states it must add.
export const REQUIRED_TRACKED_ENTITY_STATUSES = [
  "On Hold",
  "Rejected",
  "Scrapped"
] as const;

// ── Required quality coverage ────────────────────────────────────────────────
// Gauge calibration statuses are the derived ones. "Skipped" NCR tasks are
// optional — nothing in the issue flow requires skipping a task.
export const REQUIRED_NCR_STATUSES = [
  "Registered",
  "In Progress",
  "Closed"
] as const;
export const REQUIRED_NCR_PRIORITIES = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;
export const REQUIRED_NCR_SOURCES = ["Internal", "External"] as const;
export const REQUIRED_NCR_TASK_STATUSES = [
  "Pending",
  "In Progress",
  "Completed"
] as const;
export const REQUIRED_QUALITY_DOCUMENT_STATUSES = [
  "Draft",
  "Active",
  "Archived"
] as const;
export const REQUIRED_GAUGE_STATUSES = ["Active", "Inactive"] as const;
export const REQUIRED_GAUGE_CALIBRATION_STATUSES = [
  "Pending",
  "In-Calibration",
  "Out-of-Calibration"
] as const;
export const REQUIRED_RISK_STATUSES = [
  "Open",
  "In Review",
  "Mitigating",
  "Closed",
  "Accepted"
] as const;
export const REQUIRED_RISK_SOURCES = [
  "Customer",
  "Supplier",
  "Item",
  "Job",
  "General"
] as const;
export const REQUIRED_RISK_TYPES = ["Risk", "Opportunity"] as const;

// ── Required change-order coverage ───────────────────────────────────────────
export const REQUIRED_CHANGE_ORDER_STATUSES = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation",
  "Done",
  "Cancelled"
] as const;
export const REQUIRED_CHANGE_ORDER_TASK_STATUSES = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped"
] as const;

const HORIZON_DAYS = 48 * 7; // tier 12 seeds a 48-week planning horizon

// ── Required accounting coverage ─────────────────────────────────────────────
export const REQUIRED_JOURNAL_STATUSES = [
  "Draft",
  "Posted",
  "Reversed"
] as const;
export const REQUIRED_FIXED_ASSET_STATUSES = [
  "Draft",
  "Active",
  "Fully Depreciated",
  "Disposed"
] as const;
export const REQUIRED_PAYMENT_TYPES = ["Receipt", "Disbursement"] as const;
export const REQUIRED_MEMO_DIRECTIONS = ["Credit", "Debit"] as const;
export const REQUIRED_PERIOD_CLOSE_TASK_STATUSES = [
  "Open",
  "Done",
  "Skipped"
] as const;

// ── Required ops coverage ────────────────────────────────────────────────────
export const REQUIRED_DISPATCH_STATUSES = [
  "Open",
  "Assigned",
  "In Progress",
  "Completed",
  "Cancelled"
] as const;
export const REQUIRED_DISPATCH_SEVERITIES = [
  "Preventive",
  "Operator Performed",
  "Support Required",
  "OEM Required"
] as const;
export const REQUIRED_DISPATCH_SOURCES = [
  "Scheduled",
  "Reactive",
  "Non-Conformance"
] as const;
export const REQUIRED_OEE_IMPACTS = [
  "Down",
  "Planned",
  "Impact",
  "No Impact"
] as const;
export const REQUIRED_TRAINING_QUESTION_TYPES = [
  "MultipleChoice",
  "MultipleAnswers",
  "TrueFalse",
  "MatchingPairs",
  "Numerical"
] as const;
export const REQUIRED_TRAINING_STATUSES = ["Active", "Draft"] as const;
export const REQUIRED_WORKFLOW_RUN_STATUSES = [
  "Succeeded",
  "Failed",
  "Skipped"
] as const;
const FAILURE_MODE_NAMES = new Set<string>(failureModes);
const MIN_MAINTENANCE_SCHEDULES = 3;
const MIN_TIMECARDS = 5;

// Debit classes carry positive amounts as debits; credit classes (Liability,
// Equity, Revenue) carry positive amounts as credits (the journalEntries view
// derives debit/credit from account class AND sign — see data/*/accounting.ts).
const DEBIT_CLASSES = new Set(["Asset", "Expense"]);

// Bootstrap chart of accounts: posting-account number → class.
const ACCOUNT_CLASS_BY_NUMBER = new Map<string, string>(
  accounts.flatMap((a) =>
    !a.isGroup && a.number && a.class ? [[a.number, a.class] as const] : []
  )
);
const BOOTSTRAP_DIMENSION_NAMES = new Set<string>(
  dimensions.map((d) => d.name)
);
const CLOSE_TASK_DEFINITION_NAMES = new Set<string>(
  periodCloseTaskDefinitions.map((d) => d.name)
);

/** Class of a journal line's account, or undefined for an unknown number. */
function lineClass(line: JournalLineSpec): string | undefined {
  return line.accountClass ?? ACCOUNT_CLASS_BY_NUMBER.get(line.account ?? "");
}

type GraphNode = { nodeId?: string; children?: GraphNode[] };

function collectNodeIds(node: GraphNode, into: Set<string>): void {
  if (node.nodeId) into.add(node.nodeId);
  for (const child of node.children ?? []) collectNodeIds(child, into);
}

function loadAssemblyGraph(
  industryId: string,
  model: string
): { nodeIds: Set<string>; componentCount: number } | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const graphPath = path.join(
    here,
    "assets",
    industryId,
    "models",
    `${model}.graph.json`
  );
  if (!existsSync(graphPath)) return null;
  const graph = JSON.parse(readFileSync(graphPath, "utf8")) as {
    componentCount: number;
    root: GraphNode;
  };
  const nodeIds = new Set<string>();
  collectNodeIds(graph.root, nodeIds);
  return { nodeIds, componentCount: graph.componentCount };
}

function journalImbalance(entry: JournalEntrySpec): number {
  let net = 0;
  for (const line of entry.lines) {
    const cls = lineClass(line);
    if (cls === undefined) continue; // reported separately as an unknown account
    net += DEBIT_CLASSES.has(cls) ? line.amount : -line.amount;
  }
  return net;
}

const cents = (value: number) => Math.round(value * 100);

export function validateDataset(dataset: Dataset): string[] {
  const violations: string[] = [];
  const fail = (message: string) => violations.push(message);

  const f = dataset.foundation;

  // ── Reference indexes, built from the dataset alone ────────────────────────
  const itemIds = new Set<string>();
  const itemBuckets = [
    ["items.buyParts", dataset.items.buyParts],
    ["items.materials", dataset.items.materials],
    ["items.consumables", dataset.items.consumables],
    ["items.tools", dataset.items.tools],
    ["items.services", dataset.items.services],
    ["items.makeParts", dataset.items.makeParts]
  ] as const;
  for (const [bucket, specs] of itemBuckets) {
    for (const spec of specs) {
      if (itemIds.has(spec.readableId)) {
        fail(`${bucket}: duplicate item readableId "${spec.readableId}"`);
      }
      itemIds.add(spec.readableId);
    }
  }
  const makePartIds = new Set(
    dataset.items.makeParts.map((spec) => spec.readableId)
  );

  const customers = new Set(f.customers.map((c) => c.name));
  const suppliers = new Set(f.suppliers.map((s) => s.name));
  if (f.contractorAgency) suppliers.add(f.contractorAgency.name);
  const processes = new Set(f.processes.map((p) => p.name));
  for (const ability of f.abilities) processes.add(ability); // tier 01 mints a process per ability
  const abilities = new Set(f.abilities);
  const workCenters = new Set(f.workCenters.map((w) => w.name));
  const warehouses = new Set(f.warehouses.map((w) => w.key));
  const shelves = new Set(f.shelves.map((s) => s.name));
  const departments = new Set(f.departments);
  const shippingMethods = new Set(f.shippingMethods);
  const storageTypes = new Set(f.storageTypes);
  const customerTypes = new Set(f.customerTypes);
  const supplierTypes = new Set(f.supplierTypes);
  const procedures = new Set(f.procedures.map((p) => p.name));
  const supplierProcessKeys = new Set(
    f.supplierProcesses.map((sp) => `sp:${sp.supplier}:${sp.process}`)
  );
  const customersWithContacts = new Set(
    f.customerContacts.map((cc) => cc.customer)
  );

  const needItem = (where: string, id: string) => {
    if (!itemIds.has(id)) fail(`${where}: unknown item "${id}"`);
  };
  const needCustomer = (where: string, name: string) => {
    if (!customers.has(name)) fail(`${where}: unknown customer "${name}"`);
    else if (!customersWithContacts.has(name)) {
      fail(
        `${where}: customer "${name}" has no customerContact, so no customer location is seeded for it`
      );
    }
  };
  const needSupplier = (where: string, name: string) => {
    if (!suppliers.has(name)) fail(`${where}: unknown supplier "${name}"`);
  };

  // ── Foundation internal consistency ────────────────────────────────────────
  const nonEmpty: Array<[string, ReadonlyArray<unknown>]> = [
    ["foundation.departments", f.departments],
    ["foundation.abilities", f.abilities],
    ["foundation.processes", f.processes],
    ["foundation.workCenters", f.workCenters],
    ["foundation.customers", f.customers],
    ["foundation.customerContacts", f.customerContacts],
    ["foundation.suppliers", f.suppliers],
    ["foundation.supplierContacts", f.supplierContacts],
    ["foundation.procedures", f.procedures],
    ["foundation.shippingMethods", f.shippingMethods],
    ["foundation.warehouses", f.warehouses],
    ["foundation.shelves", f.shelves],
    ["foundation.shifts", f.shifts],
    ["foundation.holidays", f.holidays],
    ["foundation.tags", f.tags],
    ["foundation.materialTaxonomy.substances", f.materialTaxonomy.substances],
    ["foundation.materialTaxonomy.forms", f.materialTaxonomy.forms],
    ["foundation.materialTaxonomy.types", f.materialTaxonomy.types],
    ["foundation.materialTaxonomy.grades", f.materialTaxonomy.grades],
    ["foundation.materialTaxonomy.finishes", f.materialTaxonomy.finishes],
    ["foundation.materialTaxonomy.dimensions", f.materialTaxonomy.dimensions],
    ["items.buyParts", dataset.items.buyParts],
    ["items.materials", dataset.items.materials],
    ["items.consumables", dataset.items.consumables],
    ["items.tools", dataset.items.tools],
    ["items.services", dataset.items.services],
    ["items.makeParts", dataset.items.makeParts],
    ["items.methods", dataset.items.methods],
    ["items.supplierLinks", dataset.items.supplierLinks],
    ["items.supersessions", dataset.items.supersessions],
    ["items.customerParts", dataset.items.customerParts],
    ["items.priceOverrides", dataset.items.priceOverrides],
    ["items.pricingRules", dataset.items.pricingRules],
    ["items.revisionLadder", dataset.items.revisionLadder],
    ["inventory.openingStock", dataset.inventory.openingStock],
    ["inventory.onHandTracked", dataset.inventory.onHandTracked],
    ["inventory.kanbanItems", dataset.inventory.kanbanItems],
    ["inventory.inventoryCounts", dataset.inventory.inventoryCounts],
    ["inventory.shelfLives", dataset.inventory.shelfLives],
    ["inventory.stockTransfers", dataset.inventory.stockTransfers],
    ["inventory.warehouseTransfers", dataset.inventory.warehouseTransfers],
    ["sales.opportunities", dataset.sales.opportunities],
    ["sales.statusOrders", dataset.sales.statusOrders],
    ["sales.releasedOrders", dataset.sales.releasedOrders],
    ["sales.salesReturns", dataset.sales.salesReturns],
    ["purchasing.rfqLines", dataset.purchasing.rfqLines],
    ["purchasing.rfqQuotes", dataset.purchasing.rfqQuotes],
    ["purchasing.lifecycleRfqs", dataset.purchasing.lifecycleRfqs],
    ["purchasing.purchaseOrders", dataset.purchasing.purchaseOrders],
    ["production.jobs", dataset.production.jobs],
    ["production.genealogyInputs", dataset.production.genealogyInputs],
    ["production.pickingLists", dataset.production.pickingLists],
    ["quality.nonConformances", dataset.quality.nonConformances],
    ["quality.qualityDocuments", dataset.quality.qualityDocuments],
    ["quality.gauges", dataset.quality.gauges],
    ["quality.risks", dataset.quality.risks],
    ["changeOrders.changeOrders", dataset.changeOrders.changeOrders],
    ["accounting.fixedAssets", dataset.accounting.fixedAssets],
    ["accounting.journalEntries", dataset.accounting.journalEntries],
    ["ops.maintenanceSchedules", dataset.ops.maintenanceSchedules],
    ["ops.maintenanceDispatches", dataset.ops.maintenanceDispatches],
    ["ops.trainings", dataset.ops.trainings],
    ["ops.timecards", dataset.ops.timecards],
    ["ops.suggestions", dataset.ops.suggestions],
    ["ops.notes", dataset.ops.notes],
    ["workflows.runs", dataset.workflows.runs],
    ["planning.buyItemIds", dataset.planning.buyItemIds],
    ["planning.makeItemIds", dataset.planning.makeItemIds],
    ["planning.demandProjections", dataset.planning.demandProjections]
  ];
  for (const [where, arr] of nonEmpty) {
    if (arr.length === 0) fail(`${where}: must not be empty`);
  }

  if (!shippingMethods.has(f.defaultShippingMethod)) {
    fail(
      `foundation.defaultShippingMethod "${f.defaultShippingMethod}" is not in shippingMethods`
    );
  }
  for (const wc of f.workCenters) {
    if (!departments.has(wc.dept)) {
      fail(
        `foundation.workCenters "${wc.name}": unknown department "${wc.dept}"`
      );
    }
    if (!abilities.has(wc.ability)) {
      fail(
        `foundation.workCenters "${wc.name}": unknown ability "${wc.ability}"`
      );
    }
  }
  for (const [wcName, processName] of f.workCenterProcessLinks) {
    if (!workCenters.has(wcName)) {
      fail(
        `foundation.workCenterProcessLinks: unknown work center "${wcName}"`
      );
    }
    if (!processes.has(processName)) {
      fail(
        `foundation.workCenterProcessLinks: unknown process "${processName}"`
      );
    }
  }
  for (const c of f.customers) {
    if (!customerTypes.has(c.type)) {
      fail(
        `foundation.customers "${c.name}": unknown customer type "${c.type}"`
      );
    }
  }
  for (const s of f.suppliers) {
    if (!supplierTypes.has(s.type)) {
      fail(
        `foundation.suppliers "${s.name}": unknown supplier type "${s.type}"`
      );
    }
  }

  // ── Party currency + payment terms ─────────────────────────────────────────
  for (const party of [...f.customers, ...f.suppliers]) {
    if (party.currencyCode && !/^[A-Z]{3}$/.test(party.currencyCode)) {
      fail(
        `foundation parties "${party.name}": currencyCode "${party.currencyCode}" is not a 3-letter ISO code`
      );
    }
    if (party.paymentTerm && !PAYMENT_TERM_NAMES.has(party.paymentTerm)) {
      fail(
        `foundation parties "${party.name}": paymentTerm "${party.paymentTerm}" is not a bootstrap payment term`
      );
    }
  }
  // Convention: every dataset showcases at least one EUR supplier so the FX
  // and multi-currency purchasing screens have a party to render.
  if (!f.suppliers.some((s) => s.currencyCode === "EUR")) {
    fail(`foundation.suppliers: no supplier with currencyCode "EUR"`);
  }

  // ── Holidays ───────────────────────────────────────────────────────────────
  const holidayOffsets = new Set<number>();
  for (const holiday of f.holidays) {
    if (!Number.isFinite(holiday.dateOffset)) {
      fail(
        `foundation.holidays "${holiday.name}": dateOffset is not a finite number`
      );
    } else if (holidayOffsets.has(holiday.dateOffset)) {
      // holiday has UNIQUE (date, companyId), so a repeated offset would be
      // silently dropped by insertMaybe.
      fail(
        `foundation.holidays "${holiday.name}": duplicate dateOffset ${holiday.dateOffset}`
      );
    }
    holidayOffsets.add(holiday.dateOffset);
  }

  // ── Tags ───────────────────────────────────────────────────────────────────
  for (const tag of f.tags) {
    if (!tag.name.trim()) fail(`foundation.tags: empty tag name`);
    if (!tag.table.trim()) {
      fail(`foundation.tags "${tag.name}": empty table scope`);
    }
  }

  // ── Material taxonomy internal refs ────────────────────────────────────────
  const taxonomy = f.materialTaxonomy;
  const substanceNames = new Set(taxonomy.substances.map((s) => s.name));
  const formNames = new Set(taxonomy.forms.map((s) => s.name));
  const needSubstance = (where: string, name: string) => {
    if (!substanceNames.has(name)) {
      fail(`${where}: unknown material substance "${name}"`);
    }
  };
  const needForm = (where: string, name: string) => {
    if (!formNames.has(name)) {
      fail(`${where}: unknown material form "${name}"`);
    }
  };
  for (const type of taxonomy.types) {
    needSubstance(
      `foundation.materialTaxonomy.types "${type.name}"`,
      type.substance
    );
    needForm(`foundation.materialTaxonomy.types "${type.name}"`, type.form);
  }
  for (const grade of taxonomy.grades) {
    needSubstance(
      `foundation.materialTaxonomy.grades "${grade.name}"`,
      grade.substance
    );
  }
  for (const finish of taxonomy.finishes) {
    needSubstance(
      `foundation.materialTaxonomy.finishes "${finish.name}"`,
      finish.substance
    );
  }
  for (const dimension of taxonomy.dimensions) {
    needForm(
      `foundation.materialTaxonomy.dimensions "${dimension.name}"`,
      dimension.form
    );
  }
  for (const cc of f.customerContacts) {
    if (!customers.has(cc.customer)) {
      fail(`foundation.customerContacts: unknown customer "${cc.customer}"`);
    }
  }
  for (const sc of f.supplierContacts) {
    needSupplier("foundation.supplierContacts", sc.supplier);
  }
  for (const sp of f.supplierProcesses) {
    needSupplier("foundation.supplierProcesses", sp.supplier);
    if (!processes.has(sp.process)) {
      fail(`foundation.supplierProcesses: unknown process "${sp.process}"`);
    }
  }
  for (const contractor of f.contractors) {
    if (!abilities.has(contractor.ability)) {
      fail(
        `foundation.contractors "${contractor.lastName}": unknown ability "${contractor.ability}"`
      );
    }
  }
  if (f.contractorAgency && !supplierTypes.has(f.contractorAgency.type)) {
    fail(
      `foundation.contractorAgency: unknown supplier type "${f.contractorAgency.type}"`
    );
  }
  const seenShelves = new Set<string>();
  for (const shelf of f.shelves) {
    if (!warehouses.has(shelf.warehouse)) {
      fail(
        `foundation.shelves "${shelf.name}": unknown warehouse "${shelf.warehouse}"`
      );
    }
    if (!storageTypes.has(shelf.storageType)) {
      fail(
        `foundation.shelves "${shelf.name}": unknown storageType "${shelf.storageType}"`
      );
    }
    if (shelf.parent !== undefined && !seenShelves.has(shelf.parent)) {
      fail(
        `foundation.shelves "${shelf.name}": parent "${shelf.parent}" is not defined before it (insertion order matters)`
      );
    }
    seenShelves.add(shelf.name);
  }
  for (const proc of f.procedures) {
    if (!processes.has(proc.process)) {
      fail(
        `foundation.procedures "${proc.name}": unknown process "${proc.process}"`
      );
    }
  }

  // ── Items slice ────────────────────────────────────────────────────────────
  for (const method of dataset.items.methods) {
    const where = `items.methods "${method.readableId}"`;
    if (!makePartIds.has(method.readableId)) {
      fail(`${where}: not a makePart readableId`);
    }
    for (const line of method.bom) {
      needItem(`${where} bom`, line.component);
    }
    for (const op of method.bop) {
      if (!processes.has(op.process)) {
        fail(`${where} bop order ${op.order}: unknown process "${op.process}"`);
      }
      if (op.workCenter !== undefined && !workCenters.has(op.workCenter)) {
        fail(
          `${where} bop order ${op.order}: unknown work center "${op.workCenter}"`
        );
      }
      if (
        op.supplierProcess !== undefined &&
        !supplierProcessKeys.has(op.supplierProcess)
      ) {
        fail(
          `${where} bop order ${op.order}: unknown supplier process key "${op.supplierProcess}" (expected "sp:<supplier>:<process>" from foundation.supplierProcesses)`
        );
      }
      if (op.procedure !== undefined) {
        const name = op.procedure.replace(/^procedure:/, "");
        if (!op.procedure.startsWith("procedure:") || !procedures.has(name)) {
          fail(
            `${where} bop order ${op.order}: unknown procedure key "${op.procedure}" (expected "procedure:<name>" from foundation.procedures)`
          );
        }
      }
    }
  }
  for (const link of dataset.items.supplierLinks) {
    needSupplier("items.supplierLinks", link.supplier);
    needItem("items.supplierLinks", link.item);
  }

  // ── Items depth ────────────────────────────────────────────────────────────
  const toolIds = new Set(dataset.items.tools.map((spec) => spec.readableId));
  const typeNames = new Set(taxonomy.types.map((t) => t.name));
  const gradeNames = new Set(taxonomy.grades.map((g) => g.name));
  const finishNames = new Set(taxonomy.finishes.map((fi) => fi.name));
  const dimensionNames = new Set(taxonomy.dimensions.map((d) => d.name));
  const stockedItems = new Set(
    dataset.inventory.openingStock
      .filter((stock) => stock.qty > 0)
      .map((stock) => stock.item)
  );

  // BOP tools must resolve to Tool-bucket items.
  for (const method of dataset.items.methods) {
    for (const op of method.bop) {
      for (const tool of op.tools ?? []) {
        if (!toolIds.has(tool.tool)) {
          fail(
            `items.methods "${method.readableId}" bop order ${op.order}: tool "${tool.tool}" is not an items.tools readableId`
          );
        }
      }
    }
  }

  // Material taxonomy classification resolves against THIS dataset's taxonomy.
  for (const [bucket, specs] of itemBuckets) {
    for (const spec of specs) {
      const classification = spec.material;
      if (!classification) continue;
      const where = `${bucket} "${spec.readableId}" material`;
      if (spec.type !== "Material") {
        fail(`${where}: taxonomy classification on a non-Material item`);
      }
      if (classification.substance !== undefined) {
        needSubstance(where, classification.substance);
      }
      if (classification.form !== undefined)
        needForm(where, classification.form);
      if (
        classification.materialType !== undefined &&
        !typeNames.has(classification.materialType)
      ) {
        fail(
          `${where}: unknown material type "${classification.materialType}"`
        );
      }
      if (
        classification.grade !== undefined &&
        !gradeNames.has(classification.grade)
      ) {
        fail(`${where}: unknown material grade "${classification.grade}"`);
      }
      if (
        classification.finish !== undefined &&
        !finishNames.has(classification.finish)
      ) {
        fail(`${where}: unknown material finish "${classification.finish}"`);
      }
      if (
        classification.dimension !== undefined &&
        !dimensionNames.has(classification.dimension)
      ) {
        fail(
          `${where}: unknown material dimension "${classification.dimension}"`
        );
      }
    }
  }

  for (const [index, spec] of dataset.items.supersessions.entries()) {
    const where = `items.supersessions[${index}]`;
    needItem(where, spec.predecessor);
    needItem(where, spec.successor);
    if (spec.predecessor === spec.successor) {
      fail(`${where}: predecessor and successor are the same item`);
    }
    if (itemIds.has(spec.predecessor) && !stockedItems.has(spec.predecessor)) {
      fail(
        `${where}: predecessor "${spec.predecessor}" has no opening stock, so "Consume First" has nothing to consume`
      );
    }
    for (const method of dataset.items.methods) {
      if (method.bom.some((line) => line.component === spec.successor)) {
        fail(
          `${where}: successor "${spec.successor}" is on the BOM of "${method.readableId}" — the successor must only be reached through the live redirect`
        );
      }
    }
  }

  for (const [index, spec] of dataset.items.customerParts.entries()) {
    const where = `items.customerParts[${index}]`;
    needItem(where, spec.item);
    needCustomer(where, spec.customer);
  }

  for (const [index, spec] of dataset.items.priceOverrides.entries()) {
    const where = `items.priceOverrides[${index}]`;
    needItem(where, spec.item);
    needCustomer(where, spec.customer);
    if (spec.breaks.length === 0) fail(`${where}: no price breaks`);
  }

  for (const spec of dataset.items.pricingRules) {
    const where = `items.pricingRules "${spec.name}"`;
    needCustomer(where, spec.customer);
    if (spec.percent <= 0 || spec.percent > 100) {
      fail(`${where}: percent ${spec.percent} is not a discount in (0, 100]`);
    }
  }

  // Convention: every dataset showcases one configurable make part.
  if (!dataset.items.configuration) {
    fail(`items.configuration: missing — every dataset showcases one`);
  } else {
    const cfg = dataset.items.configuration;
    const where = `items.configuration "${cfg.item}"`;
    if (!makePartIds.has(cfg.item)) {
      fail(`${where}: not a makePart readableId`);
    }
    for (const parameter of cfg.parameters) {
      if (
        parameter.dataType === "list" &&
        (parameter.listOptions === undefined ||
          parameter.listOptions.length === 0)
      ) {
        fail(`${where}: list parameter "${parameter.key}" has no listOptions`);
      }
    }
  }

  const revisionByItem = new Map(
    itemBuckets.flatMap(([, specs]) =>
      specs.map((spec) => [spec.readableId, spec.revision ?? "0"] as const)
    )
  );
  for (const [index, spec] of dataset.items.revisionLadder.entries()) {
    const where = `items.revisionLadder[${index}]`;
    needItem(where, spec.item);
    const activeRevision = revisionByItem.get(spec.item);
    const rungs = [spec.obsoleteRevision, spec.nextRevision];
    if (new Set(rungs).size !== rungs.length) {
      fail(`${where}: obsolete and next revisions must be distinct`);
    }
    for (const rung of rungs) {
      if (rung === activeRevision) {
        fail(
          `${where}: revision "${rung}" collides with the active revision of "${spec.item}"`
        );
      }
    }
  }
  // Tier 02 promotes each ladder's active revision to Production and every
  // other item keeps the Design default, so Prototype is the one status only
  // a ladder rung can supply.
  if (
    !dataset.items.revisionLadder.some(
      (spec) => spec.nextStatus === "Prototype"
    )
  ) {
    fail(
      `items.revisionLadder: no rung with nextStatus "Prototype" — every itemRevisionStatus must be on screen`
    );
  }

  // ── Inventory slice ────────────────────────────────────────────────────────
  // Net on-hand accounting per (item, shelf): opening stock, plus posted count
  // variances, minus completed transfers out, plus completed stock transfers
  // in. Every key must stay ≥ 0 — a seed that hand-ledgers more out of a bin
  // than it put in renders negative stock on the quantities screens.
  const onHand = new Map<string, number>();
  const onHandKey = (item: string, shelf: string) => `${item} @ ${shelf}`;
  const addOnHand = (item: string, shelf: string, delta: number) => {
    const key = onHandKey(item, shelf);
    onHand.set(key, (onHand.get(key) ?? 0) + delta);
  };

  const trackingByItem = new Map<string, string>();
  for (const [, specs] of itemBuckets) {
    for (const spec of specs) {
      trackingByItem.set(spec.readableId, spec.trackingType ?? "Inventory");
    }
  }
  const isTracked = (item: string) => {
    const tracking = trackingByItem.get(item);
    return tracking === "Serial" || tracking === "Batch";
  };

  for (const stock of dataset.inventory.openingStock) {
    needItem("inventory.openingStock", stock.item);
    if (!shelves.has(stock.shelf)) {
      fail(
        `inventory.openingStock "${stock.item}": unknown shelf "${stock.shelf}"`
      );
    }
    addOnHand(stock.item, stock.shelf, stock.qty);
  }

  const shelfLifeItems = new Set(
    dataset.inventory.shelfLives.map((sl) => sl.item)
  );
  for (const shelfLife of dataset.inventory.shelfLives) {
    const where = `inventory.shelfLives "${shelfLife.item}"`;
    needItem(where, shelfLife.item);
    if (trackingByItem.get(shelfLife.item) !== "Batch") {
      fail(`${where}: shelf life on a non-Batch-tracked item`);
    }
    if (shelfLife.days <= 0) fail(`${where}: days must be positive`);
  }

  const trackedEntityQty = new Map<string, number>();
  const trackedStatuses = new Set<string>();
  for (const tracked of dataset.inventory.onHandTracked) {
    needItem("inventory.onHandTracked", tracked.item);
    for (const entity of tracked.entities) {
      if (trackedEntityQty.has(entity.readableId)) {
        fail(
          `inventory.onHandTracked: duplicate tracked entity readableId "${entity.readableId}"`
        );
      }
      trackedEntityQty.set(entity.readableId, entity.quantity);
      trackedStatuses.add(entity.status ?? "Available");
      if (
        entity.status !== undefined &&
        !["Available", "On Hold", "Rejected", "Scrapped"].includes(
          entity.status
        )
      ) {
        fail(
          `inventory.onHandTracked "${entity.readableId}": unsupported status "${entity.status}"`
        );
      }
      // A Scrapped lot carries the scrap posting (tier 03 scrapLot): its
      // quantity leaves the shelf, so it draws on the net on-hand balance.
      if ((entity.status === "Scrapped") !== (entity.scrap !== undefined)) {
        fail(
          `inventory.onHandTracked "${entity.readableId}": a scrap spec is required on, and only on, a Scrapped lot`
        );
      }
      if (entity.scrap) {
        const where = `inventory.onHandTracked "${entity.readableId}" scrap`;
        if (!shelves.has(entity.scrap.shelf)) {
          fail(`${where}: unknown shelf "${entity.scrap.shelf}"`);
        }
        if (!SCRAP_REASON_NAMES.has(entity.scrap.reason)) {
          fail(
            `${where}: reason "${entity.scrap.reason}" is not a bootstrap scrap reason`
          );
        }
        if (entity.scrap.dateOffset >= 0) {
          fail(`${where}: dateOffset must be in the past`);
        }
        addOnHand(tracked.item, entity.scrap.shelf, -entity.quantity);
      }
      if (
        entity.expiresOffset !== undefined &&
        !shelfLifeItems.has(tracked.item)
      ) {
        fail(
          `inventory.onHandTracked "${entity.readableId}": expiresOffset on "${tracked.item}", which has no inventory.shelfLives spec`
        );
      }
    }
  }

  for (const status of REQUIRED_TRACKED_ENTITY_STATUSES) {
    if (!trackedStatuses.has(status)) {
      fail(
        `inventory status matrix: no tracked entity with status "${status}" — every dataset must exhibit it`
      );
    }
  }

  for (const kanban of dataset.inventory.kanbanItems) {
    const where = `inventory.kanbanItems "${kanban.item}"`;
    needItem(where, kanban.item);
    const system = kanban.replenishmentSystem ?? "Buy";
    if (system === "Buy") {
      if (kanban.supplier === undefined) {
        fail(`${where}: Buy kanban has no supplier`);
      } else {
        needSupplier(where, kanban.supplier);
      }
    }
    if (system === "Make" && !makePartIds.has(kanban.item)) {
      fail(`${where}: Make kanban on an item that is not a makePart`);
    }
    if (system === "Transfer") {
      if (!kanban.fromShelf || !kanban.toShelf) {
        fail(`${where}: Transfer kanban needs fromShelf and toShelf`);
      } else {
        if (!shelves.has(kanban.fromShelf)) {
          fail(`${where}: unknown shelf "${kanban.fromShelf}"`);
        }
        if (!shelves.has(kanban.toShelf)) {
          fail(`${where}: unknown shelf "${kanban.toShelf}"`);
        }
        if (kanban.fromShelf === kanban.toShelf) {
          fail(`${where}: Transfer kanban's shelves must differ`);
        }
      }
    }
  }

  // ── Inventory counts ───────────────────────────────────────────────────────
  const inventoryKeys = new Set<string>();
  const uniqueKey = (where: string, key: string) => {
    if (inventoryKeys.has(key)) fail(`${where}: duplicate key "${key}"`);
    inventoryKeys.add(key);
  };
  const openingQty = new Map<string, number>();
  for (const stock of dataset.inventory.openingStock) {
    openingQty.set(onHandKey(stock.item, stock.shelf), stock.qty);
  }
  for (const count of dataset.inventory.inventoryCounts) {
    const where = `inventory.inventoryCounts "${count.key}"`;
    uniqueKey(where, count.key);
    if (count.status === "Posted" && count.postedOffset === undefined) {
      fail(`${where}: Posted count has no postedOffset`);
    }
    let variances = 0;
    for (const line of count.lines) {
      needItem(where, line.item);
      if (!shelves.has(line.shelf)) {
        fail(`${where}: unknown shelf "${line.shelf}"`);
      }
      if (count.status !== "Posted") continue;
      // A posted count's snapshot IS the opening balance — the seed has no
      // other movement dated before it (completed transfers are authored
      // later on the timeline), so any other snapshot is variance dishonesty.
      const opening = openingQty.get(onHandKey(line.item, line.shelf)) ?? 0;
      if (line.snapshotQuantity !== opening) {
        fail(
          `${where} line "${line.item}": snapshotQuantity ${line.snapshotQuantity} != opening stock ${opening} at "${line.shelf}"`
        );
      }
      const delta = line.countedQuantity - line.snapshotQuantity;
      if (delta !== 0) {
        variances += 1;
        addOnHand(line.item, line.shelf, delta);
      }
    }
    if (count.status === "Posted" && variances === 0) {
      fail(`${where}: Posted count has no non-zero variance line`);
    }
  }

  // ── Stock transfers ────────────────────────────────────────────────────────
  for (const transfer of dataset.inventory.stockTransfers) {
    const where = `inventory.stockTransfers "${transfer.key}"`;
    uniqueKey(where, transfer.key);
    for (const shelf of [transfer.fromShelf, transfer.toShelf]) {
      if (!shelves.has(shelf)) fail(`${where}: unknown shelf "${shelf}"`);
    }
    if (transfer.fromShelf === transfer.toShelf) {
      fail(`${where}: fromShelf and toShelf must differ`);
    }
    for (const line of transfer.lines) {
      needItem(where, line.item);
      if (line.quantity <= 0) {
        fail(`${where} line "${line.item}": quantity must be positive`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity moves the seed does not model`
        );
      }
      if (transfer.status === "Completed") {
        addOnHand(line.item, transfer.fromShelf, -line.quantity);
        addOnHand(line.item, transfer.toShelf, line.quantity);
      }
    }
  }

  // ── Warehouse transfers ────────────────────────────────────────────────────
  for (const transfer of dataset.inventory.warehouseTransfers) {
    const where = `inventory.warehouseTransfers "${transfer.key}"`;
    uniqueKey(where, transfer.key);
    if (transfer.fromLocation === transfer.toLocation) {
      fail(`${where}: fromLocation and toLocation must differ`);
    }
    if (transfer.status === "Completed" && transfer.fromLocation !== "Plant") {
      fail(
        `${where}: Completed transfer must ship from Plant — the datasets stock no other location`
      );
    }
    for (const line of transfer.lines) {
      needItem(where, line.item);
      if (line.quantity <= 0) {
        fail(`${where} line "${line.item}": quantity must be positive`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity moves the seed does not model`
        );
      }
      if (line.fromShelf !== undefined && !shelves.has(line.fromShelf)) {
        fail(`${where}: unknown shelf "${line.fromShelf}"`);
      }
      if (transfer.status === "Completed") {
        if (line.fromShelf === undefined) {
          fail(
            `${where} line "${line.item}": Completed transfer line needs a fromShelf`
          );
        } else {
          addOnHand(line.item, line.fromShelf, -line.quantity);
        }
      }
    }
  }

  // (The net-on-hand ≥ 0 assertion runs AFTER the purchasing slice — posted
  // shipments drain bins, completed sales returns refill them, posted
  // receipts add stock and completed purchase returns ship it back out.)

  // ── Sales slice (also builds the document-ref index jobs/quality use) ─────
  const documentRefs = new Set<string>();
  const registerRef = (where: string, ref: string) => {
    if (documentRefs.has(ref))
      fail(`${where}: duplicate document ref "${ref}"`);
    documentRefs.add(ref);
  };

  // Statuses actually exhibited by this dataset's sales slice, checked against
  // the REQUIRED_* coverage sets after every spec has been walked.
  const seenStatuses = {
    salesRfq: new Set<string>(),
    quote: new Set<string>(),
    quoteLine: new Set<string>(),
    salesOrder: new Set<string>(),
    shipment: new Set<string>(),
    salesInvoice: new Set<string>(),
    salesReturn: new Set<string>()
  };
  const noQuoteReasons = new Set(f.noQuoteReasons);

  const checkOpportunity = (
    where: string,
    spec: SalesOpportunitySpec
  ): void => {
    registerRef(where, spec.ref);
    needCustomer(where, spec.customer);
    if (spec.rfq) {
      registerRef(where, spec.rfq.ref);
      seenStatuses.salesRfq.add(spec.rfq.status);
      if (
        spec.rfq.noQuoteReason !== undefined &&
        !noQuoteReasons.has(spec.rfq.noQuoteReason)
      ) {
        fail(
          `${where} rfq: noQuoteReason "${spec.rfq.noQuoteReason}" is not in foundation.noQuoteReasons`
        );
      }
      for (const line of spec.rfq.lines) needItem(`${where} rfq`, line.item);
    }
    if (spec.quote) {
      registerRef(where, spec.quote.ref);
      seenStatuses.quote.add(spec.quote.status);
      for (const line of spec.quote.lines) {
        registerRef(where, line.ref);
        needItem(`${where} quote`, line.item);
        seenStatuses.quoteLine.add(line.status);
        // A "No Quote" line was declined — it never got priced, so it is the
        // one line status allowed to carry no breaks.
        if (line.priceBreaks.length === 0 && line.status !== "No Quote") {
          fail(`${where} quote line "${line.ref}": no price breaks`);
        }
      }
      if (spec.quote.externalLink)
        registerRef(where, spec.quote.externalLink.ref);
    }
    if (spec.order) {
      registerRef(where, spec.order.ref);
      seenStatuses.salesOrder.add(spec.order.status);
      for (const line of spec.order.lines) {
        registerRef(where, line.ref);
        needItem(`${where} order`, line.item);
        if (
          line.promisedDateOffset !== undefined &&
          (line.promisedDateOffset < 0 ||
            line.promisedDateOffset >= HORIZON_DAYS)
        ) {
          fail(
            `${where} order line "${line.ref}": promisedDateOffset ${line.promisedDateOffset} outside the ${HORIZON_DAYS}-day planning horizon`
          );
        }
      }
    }
    if (spec.shipment) {
      if (!spec.order) fail(`${where}: shipment without an order`);
      registerRef(where, spec.shipment.ref);
      seenStatuses.shipment.add(spec.shipment.status);
      const posted = spec.shipment.status === "Posted";
      if (posted && spec.shipment.postedOffset === undefined) {
        fail(`${where} shipment: Posted shipment has no postedOffset`);
      }
      if (
        posted &&
        spec.order &&
        spec.shipment.postedOffset !== undefined &&
        spec.shipment.postedOffset < spec.order.orderDateOffset
      ) {
        fail(
          `${where} shipment: postedOffset ${spec.shipment.postedOffset} is before the order's orderDateOffset ${spec.order.orderDateOffset}`
        );
      }
      const orderItems = new Set(spec.order?.lines.map((l) => l.item) ?? []);
      for (const line of spec.shipment.lines) {
        needItem(`${where} shipment`, line.item);
        if (spec.order && !orderItems.has(line.item)) {
          fail(
            `${where} shipment: item "${line.item}" is not a line on the opportunity's order`
          );
        }
        if (line.shippedQuantity > line.orderQuantity) {
          fail(
            `${where} shipment: shippedQuantity ${line.shippedQuantity} exceeds orderQuantity ${line.orderQuantity} for "${line.item}"`
          );
        }
        if (line.fromShelf !== undefined && !shelves.has(line.fromShelf)) {
          fail(`${where} shipment: unknown shelf "${line.fromShelf}"`);
        }
        if (posted && line.shippedQuantity > 0) {
          if (line.fromShelf === undefined) {
            fail(
              `${where} shipment: Posted line "${line.item}" needs a fromShelf`
            );
          } else if (isTracked(line.item)) {
            fail(
              `${where} shipment: tracked item "${line.item}" needs per-entity shipping the seed does not model`
            );
          } else if (shelves.has(line.fromShelf)) {
            addOnHand(line.item, line.fromShelf, -line.shippedQuantity);
          }
        }
      }
    }
    if (spec.invoice) {
      if (!spec.order) fail(`${where}: invoice without an order`);
      registerRef(where, spec.invoice.ref);
      seenStatuses.salesInvoice.add(spec.invoice.status);
      if (spec.invoice.key !== undefined) {
        registerRef(where, `sinv:${spec.invoice.key}`);
      }
      if (
        spec.order &&
        spec.invoice.dateIssuedOffset < spec.order.orderDateOffset
      ) {
        fail(
          `${where} invoice "${spec.invoice.ref}": dateIssuedOffset ${spec.invoice.dateIssuedOffset} is before the order's orderDateOffset ${spec.order.orderDateOffset}`
        );
      }
      const orderItems = new Set(spec.order?.lines.map((l) => l.item) ?? []);
      for (const line of spec.invoice.lines) {
        needItem(`${where} invoice`, line.item);
        if (spec.order && !orderItems.has(line.item)) {
          fail(
            `${where} invoice: item "${line.item}" is not a line on the opportunity's order`
          );
        }
      }
      const lineTotal = spec.invoice.lines.reduce(
        (sum, line) => sum + line.quantity * line.unitPrice,
        0
      );
      if (Math.abs(lineTotal - spec.invoice.subtotal) > 0.01) {
        fail(
          `${where} invoice "${spec.invoice.ref}": subtotal ${spec.invoice.subtotal} does not equal its lines' total ${lineTotal}`
        );
      }
    }
  };

  for (const [index, spec] of dataset.sales.opportunities.entries()) {
    checkOpportunity(`sales.opportunities[${index}]`, spec);
  }
  for (const spec of dataset.sales.statusOrders) {
    const where = `sales.statusOrders "${spec.key}"`;
    needCustomer(where, spec.customer);
    needItem(where, spec.item);
    seenStatuses.salesOrder.add(spec.status);
    registerRef(where, `so:${spec.key}`);
    registerRef(where, `soline:${spec.key}`);
    registerRef(where, `opp:${spec.key}`);
  }
  for (const [index, spec] of dataset.sales.releasedOrders.entries()) {
    checkOpportunity(`sales.releasedOrders[${index}]`, spec);
  }

  // ── Sales returns (RMAs) ───────────────────────────────────────────────────
  for (const rma of dataset.sales.salesReturns) {
    const where = `sales.salesReturns "${rma.key}"`;
    registerRef(where, `rma:${rma.key}`);
    needCustomer(where, rma.customer);
    seenStatuses.salesReturn.add(rma.status);
    if (!RETURN_REASON_NAMES.has(rma.returnReason)) {
      fail(
        `${where}: returnReason "${rma.returnReason}" is not a bootstrap return reason`
      );
    }
    if (rma.salesOrder !== undefined && !documentRefs.has(rma.salesOrder)) {
      fail(`${where}: unknown sales order ref "${rma.salesOrder}"`);
    }
    if (rma.lines.length === 0) fail(`${where}: no lines`);
    for (const line of rma.lines) {
      needItem(where, line.item);
      if (line.quantity <= 0) {
        fail(`${where} line "${line.item}": quantity must be positive`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity returns the seed does not model`
        );
      }
      if (line.toShelf !== undefined && !shelves.has(line.toShelf)) {
        fail(`${where}: unknown shelf "${line.toShelf}"`);
      }
      if (rma.status === "Completed") {
        if (line.toShelf === undefined) {
          fail(
            `${where} line "${line.item}": Completed return line needs a toShelf`
          );
        } else if (shelves.has(line.toShelf)) {
          addOnHand(line.item, line.toShelf, line.quantity);
        }
      }
    }
  }

  // ── Status matrix — every required sales status must be exhibited ─────────
  const requiredStatusSets: Array<[string, readonly string[], Set<string>]> = [
    ["salesRfq", REQUIRED_SALES_RFQ_STATUSES, seenStatuses.salesRfq],
    ["quote", REQUIRED_QUOTE_STATUSES, seenStatuses.quote],
    ["quoteLine", REQUIRED_QUOTE_LINE_STATUSES, seenStatuses.quoteLine],
    ["salesOrder", REQUIRED_SALES_ORDER_STATUSES, seenStatuses.salesOrder],
    ["shipment", REQUIRED_SHIPMENT_STATUSES, seenStatuses.shipment],
    [
      "salesInvoice",
      REQUIRED_SALES_INVOICE_STATUSES,
      seenStatuses.salesInvoice
    ],
    ["salesReturn", REQUIRED_SALES_RETURN_STATUSES, seenStatuses.salesReturn]
  ];
  for (const [docType, required, seen] of requiredStatusSets) {
    for (const status of required) {
      if (!seen.has(status)) {
        fail(
          `sales status matrix: no ${docType} with status "${status}" — every dataset must exhibit the full required set`
        );
      }
    }
  }

  // ── Purchasing slice ───────────────────────────────────────────────────────
  const p = dataset.purchasing;
  const breakCount = p.rfqQuantityBreaks.length;
  const rfqItems = new Set(p.rfqLines.map((line) => line.item));
  for (const line of p.rfqLines) needItem("purchasing.rfqLines", line.item);

  // Statuses exhibited by the purchasing slice, checked against the
  // REQUIRED_PURCHASE_* sets once every spec has been walked.
  const seenPurchasing = {
    purchaseOrder: new Set<string>(),
    receipt: new Set<string>(),
    purchaseInvoice: new Set<string>(),
    purchaseReturn: new Set<string>(),
    supplierQuote: new Set<string>(),
    purchasingRfq: new Set<string>([p.rfqHeader.status])
  };
  // Pending / Rejected / Inactive suppliers exist for the supplier list only,
  // never for order flow.
  const activeSuppliers = new Set(
    f.suppliers
      .filter((s) => (s.status ?? "Active") === "Active")
      .map((s) => s.name)
  );
  if (f.contractorAgency) activeSuppliers.add(f.contractorAgency.name);
  const suppliersWithContacts = new Set(
    f.supplierContacts.map((sc) => sc.supplier)
  );
  const needActiveSupplier = (where: string, name: string) => {
    needSupplier(where, name);
    if (suppliers.has(name) && !activeSuppliers.has(name)) {
      fail(`${where}: supplier "${name}" is not Active`);
    }
  };
  const supplierProcessSuppliers = new Set(
    f.supplierProcesses.map((sp) => sp.supplier)
  );
  const eurSuppliers = new Set(
    f.suppliers.filter((s) => s.currencyCode === "EUR").map((s) => s.name)
  );
  // Lot readableIds minted by posted batch receipt lines — one registry with
  // the on-hand tracked entities and (later) the production genealogy ids.
  const receiptLotIds = new Set<string>();

  const quoteKeys = new Set<string>();
  for (const quote of p.rfqQuotes) {
    const where = `purchasing.rfqQuotes "${quote.key}"`;
    quoteKeys.add(quote.key);
    needActiveSupplier(where, quote.supplier);
    if (
      suppliers.has(quote.supplier) &&
      !suppliersWithContacts.has(quote.supplier)
    ) {
      fail(
        `${where}: supplier "${quote.supplier}" has no supplierContact, which the quote row requires`
      );
    }
    registerRef(where, `sq:${quote.key}`);
    seenPurchasing.supplierQuote.add(quote.status ?? "Active");
    for (const line of quote.lines) {
      needItem(where, line.item);
      if (!rfqItems.has(line.item)) {
        fail(`${where}: item "${line.item}" is not an rfqLine item`);
      }
      if (line.breaks.length !== breakCount) {
        fail(
          `${where} item "${line.item}": ${line.breaks.length} price breaks but rfqQuantityBreaks has ${breakCount}`
        );
      }
    }
  }
  if (!quoteKeys.has(p.rfqWinningQuote)) {
    fail(
      `purchasing.rfqWinningQuote "${p.rfqWinningQuote}" is not an rfqQuotes key`
    );
  }
  if (!p.rfqQuantityBreaks.includes(p.rfqOrderQuantity)) {
    fail(
      `purchasing.rfqOrderQuantity ${p.rfqOrderQuantity} is not one of rfqQuantityBreaks [${p.rfqQuantityBreaks.join(", ")}]`
    );
  }
  const winningQuote = p.rfqQuotes.find((q) => q.key === p.rfqWinningQuote);
  if (winningQuote && (winningQuote.status ?? "Active") !== "Active") {
    fail(
      `purchasing.rfqWinningQuote "${p.rfqWinningQuote}": the winning quote must stay Active`
    );
  }
  registerRef("purchasing.rfqHeader", p.rfqHeader.ref);
  registerRef("purchasing", `po:sq-${p.rfqWinningQuote}`);

  // ── Draft / Closed RFQs ────────────────────────────────────────────────────
  for (const rfq of p.lifecycleRfqs) {
    const where = `purchasing.lifecycleRfqs "${rfq.ref}"`;
    registerRef(where, rfq.ref);
    seenPurchasing.purchasingRfq.add(rfq.status);
    if (rfq.lines.length === 0) fail(`${where}: has no lines`);
    for (const line of rfq.lines) needItem(where, line.item);
    if (new Set(rfq.lines.map((line) => line.item)).size !== rfq.lines.length) {
      fail(`${where}: an item appears on two lines`);
    }
    if (
      rfq.quantities.length === 0 ||
      rfq.quantities.some(
        (qty, index) =>
          qty <= 0 || (index > 0 && qty <= rfq.quantities[index - 1]!)
      )
    ) {
      fail(`${where}: quantities must be positive and strictly ascending`);
    }
    if (rfq.suppliers.length === 0) fail(`${where}: has no suppliers`);
    if (new Set(rfq.suppliers).size !== rfq.suppliers.length) {
      fail(`${where}: a supplier is listed twice`);
    }
    for (const supplier of rfq.suppliers) needActiveSupplier(where, supplier);
    if (rfq.rfqDateOffset > 0) fail(`${where}: rfqDateOffset is in the future`);
    if (rfq.expirationOffset <= rfq.rfqDateOffset) {
      fail(`${where}: expires on or before its RFQ date`);
    }
  }

  // ── Standalone supplier quotes ─────────────────────────────────────────────
  for (const quote of p.standaloneSupplierQuotes) {
    const where = `purchasing.standaloneSupplierQuotes "${quote.key}"`;
    needActiveSupplier(where, quote.supplier);
    if (
      suppliers.has(quote.supplier) &&
      !suppliersWithContacts.has(quote.supplier)
    ) {
      fail(
        `${where}: supplier "${quote.supplier}" has no supplierContact, which the quote row requires`
      );
    }
    registerRef(where, `sq:${quote.key}`);
    seenPurchasing.supplierQuote.add(quote.status);
    if (quote.status === "Expired" && quote.expirationOffset >= 0) {
      fail(
        `${where}: Expired quote's expirationOffset ${quote.expirationOffset} is not in the past`
      );
    }
    if (quote.lines.length === 0) fail(`${where}: no lines`);
    for (const line of quote.lines) {
      needItem(where, line.item);
      if (line.prices.length === 0) {
        fail(`${where} line "${line.item}": no prices`);
      }
    }
  }

  // ── Purchase orders ────────────────────────────────────────────────────────
  let eurPoCount = 0;
  let ospPoCount = 0;
  for (const [index, po] of p.purchaseOrders.entries()) {
    const where = `purchasing.purchaseOrders[${index}]`;
    seenPurchasing.purchaseOrder.add(po.status);
    if (po.source !== "direct") continue;

    needActiveSupplier(where, po.supplier);
    if (po.ref !== undefined) registerRef(where, po.ref);
    const poItems = new Set(po.lines.map((line) => line.item));
    for (const line of po.lines) needItem(where, line.item);

    if (po.purchaseOrderType === "Outside Processing") {
      ospPoCount += 1;
      if (!supplierProcessSuppliers.has(po.supplier)) {
        fail(
          `${where}: Outside Processing order on "${po.supplier}", which has no foundation.supplierProcesses entry`
        );
      }
    }

    // FX discipline: EUR belongs to exactly one childless, unpaid order on
    // the EUR supplier; everything else stays in base currency.
    if (po.currencyCode !== undefined && po.currencyCode !== "USD") {
      if (po.currencyCode !== "EUR") {
        fail(`${where}: unsupported currencyCode "${po.currencyCode}"`);
      } else {
        eurPoCount += 1;
        if (!eurSuppliers.has(po.supplier)) {
          fail(
            `${where}: EUR order on "${po.supplier}", which is not the EUR supplier`
          );
        }
        if (po.exchangeRate === undefined) {
          fail(`${where}: EUR order has no exchangeRate`);
        }
        if (po.receipt || po.invoice) {
          fail(
            `${where}: the EUR order must stay childless — receipts and invoices are settled in base currency by design`
          );
        }
        if (po.status !== "To Invoice" && po.status !== "Draft") {
          fail(
            `${where}: the EUR order must be unpaid ("To Invoice" or "Draft"), got "${po.status}"`
          );
        }
      }
    }

    if (po.receipt) {
      registerRef(where, po.receipt.ref);
      seenPurchasing.receipt.add(po.receipt.status);
      const posted = po.receipt.status === "Posted";
      if (posted && po.receipt.postedOffset === undefined) {
        fail(`${where} receipt: Posted receipt has no postedOffset`);
      }
      if (
        posted &&
        po.receipt.postedOffset !== undefined &&
        po.receipt.postedOffset < po.orderDateOffset
      ) {
        fail(
          `${where} receipt: postedOffset ${po.receipt.postedOffset} is before the order's orderDateOffset ${po.orderDateOffset}`
        );
      }
      for (const line of po.receipt.lines) {
        needItem(`${where} receipt`, line.item);
        if (!poItems.has(line.item)) {
          fail(`${where} receipt: item "${line.item}" is not a PO line`);
        }
        if (line.receivedQuantity > line.orderQuantity) {
          fail(
            `${where} receipt: receivedQuantity ${line.receivedQuantity} exceeds orderQuantity ${line.orderQuantity} for "${line.item}"`
          );
        }
        if (line.toShelf !== undefined && !shelves.has(line.toShelf)) {
          fail(`${where} receipt: unknown shelf "${line.toShelf}"`);
        }
        const tracking = trackingByItem.get(line.item);
        if (line.lotNumber !== undefined && tracking !== "Batch") {
          fail(
            `${where} receipt: lotNumber on "${line.item}", which is not Batch-tracked`
          );
        }
        if (posted && line.receivedQuantity > 0) {
          if (line.toShelf === undefined) {
            fail(
              `${where} receipt: Posted line "${line.item}" needs a toShelf`
            );
          }
          if (tracking === "Serial") {
            fail(
              `${where} receipt: serial item "${line.item}" needs per-unit receiving the seed does not model`
            );
          } else if (tracking === "Batch") {
            if (!line.requiresBatchTracking || line.lotNumber === undefined) {
              fail(
                `${where} receipt: Posted batch line "${line.item}" needs requiresBatchTracking and a lotNumber`
              );
            } else if (
              trackedEntityQty.has(line.lotNumber) ||
              receiptLotIds.has(line.lotNumber)
            ) {
              fail(
                `${where} receipt: lotNumber "${line.lotNumber}" collides with another tracked entity readableId`
              );
            } else {
              receiptLotIds.add(line.lotNumber);
            }
          }
          if (line.toShelf !== undefined && shelves.has(line.toShelf)) {
            addOnHand(line.item, line.toShelf, line.receivedQuantity);
          }
        }
      }
    }

    if (po.invoice) {
      registerRef(where, po.invoice.ref);
      seenPurchasing.purchaseInvoice.add(po.invoice.status);
      if (po.invoice.key !== undefined) {
        registerRef(where, `pinv:${po.invoice.key}`);
      }
      if (po.invoice.dateIssuedOffset < po.orderDateOffset) {
        fail(
          `${where} invoice "${po.invoice.ref}": dateIssuedOffset ${po.invoice.dateIssuedOffset} is before the order's orderDateOffset ${po.orderDateOffset}`
        );
      }
      if (
        po.receipt?.postedOffset !== undefined &&
        po.invoice.dateIssuedOffset < po.receipt.postedOffset
      ) {
        fail(
          `${where} invoice "${po.invoice.ref}": dateIssuedOffset ${po.invoice.dateIssuedOffset} is before the receipt's postedOffset ${po.receipt.postedOffset}`
        );
      }
      for (const line of po.invoice.lines) {
        needItem(`${where} invoice`, line.item);
        if (!poItems.has(line.item)) {
          fail(`${where} invoice: item "${line.item}" is not a PO line`);
        }
      }
      const lineTotal = po.invoice.lines.reduce(
        (sum, line) => sum + line.quantity * line.supplierUnitPrice,
        0
      );
      if (Math.abs(lineTotal - po.invoice.subtotal) > 0.01) {
        fail(
          `${where} invoice "${po.invoice.ref}": subtotal ${po.invoice.subtotal} does not equal its lines' total ${lineTotal}`
        );
      }
    }
  }
  if (ospPoCount === 0) {
    fail(
      `purchasing.purchaseOrders: no "Outside Processing" order — every dataset showcases one`
    );
  }
  if (eurPoCount !== 1) {
    fail(
      `purchasing.purchaseOrders: expected exactly 1 EUR order (the FX showcase), found ${eurPoCount}`
    );
  }

  // ── Purchase returns ───────────────────────────────────────────────────────
  for (const ret of p.purchaseReturns) {
    const where = `purchasing.purchaseReturns "${ret.key}"`;
    registerRef(where, `pret:${ret.key}`);
    needActiveSupplier(where, ret.supplier);
    seenPurchasing.purchaseReturn.add(ret.status);
    if (ret.lines.length === 0) fail(`${where}: no lines`);
    for (const line of ret.lines) {
      needItem(where, line.item);
      if (line.quantity <= 0) {
        fail(`${where} line "${line.item}": quantity must be positive`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity returns the seed does not model`
        );
      }
      if (line.fromShelf !== undefined && !shelves.has(line.fromShelf)) {
        fail(`${where}: unknown shelf "${line.fromShelf}"`);
      }
      if (ret.status === "Completed") {
        if (line.fromShelf === undefined) {
          fail(
            `${where} line "${line.item}": Completed return line needs a fromShelf`
          );
        } else if (shelves.has(line.fromShelf)) {
          addOnHand(line.item, line.fromShelf, -line.quantity);
        }
      }
    }
  }

  // (The net-on-hand ≥ 0 assertion runs AFTER the production slice —
  // completed picking lists also consume from their fromShelf bins.)

  // ── Status matrix — every required purchasing status must be exhibited ────
  const requiredPurchasingSets: Array<
    [string, readonly string[], Set<string>]
  > = [
    [
      "purchaseOrder",
      REQUIRED_PURCHASE_ORDER_STATUSES,
      seenPurchasing.purchaseOrder
    ],
    ["receipt", REQUIRED_RECEIPT_STATUSES, seenPurchasing.receipt],
    [
      "purchaseInvoice",
      REQUIRED_PURCHASE_INVOICE_STATUSES,
      seenPurchasing.purchaseInvoice
    ],
    [
      "purchaseReturnOrder",
      REQUIRED_PURCHASE_RETURN_STATUSES,
      seenPurchasing.purchaseReturn
    ],
    [
      "supplierQuote",
      REQUIRED_SUPPLIER_QUOTE_STATUSES,
      seenPurchasing.supplierQuote
    ],
    [
      "purchasingRfq",
      REQUIRED_PURCHASING_RFQ_STATUSES,
      seenPurchasing.purchasingRfq
    ]
  ];
  for (const [docType, required, seen] of requiredPurchasingSets) {
    for (const status of required) {
      if (!seen.has(status)) {
        fail(
          `purchasing status matrix: no ${docType} with status "${status}" — every dataset must exhibit the full required set`
        );
      }
    }
  }

  // ── Production slice ───────────────────────────────────────────────────────
  const methodByItem = new Map(
    dataset.items.methods.map((method) => [method.readableId, method])
  );
  // All components reachable from an item's method tree — the universe a
  // job's jobMaterial rows are copied from, so the universe a picking line
  // may name.
  const bomComponentsOf = (rootItem: string): Set<string> => {
    const components = new Set<string>();
    const visited = new Set<string>();
    const stack = [rootItem];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const method = methodByItem.get(current);
      if (!method) continue;
      for (const line of method.bom) {
        components.add(line.component);
        stack.push(line.component);
      }
    }
    return components;
  };
  const rootOpCountOf = (item: string): number =>
    methodByItem.get(item)?.bop.length ?? 0;

  const jobKeys = new Set<string>();
  const jobByKey = new Map<string, (typeof dataset.production.jobs)[number]>();
  const seenDeadlineTypes = new Set<string>();
  const seenOperationStatuses = new Set<string>();
  const seenQuantityTypes = new Set<string>();
  for (const job of dataset.production.jobs) {
    const where = `production.jobs "${job.key}"`;
    if (jobKeys.has(job.key)) fail(`${where}: duplicate job key`);
    jobKeys.add(job.key);
    jobByKey.set(job.key, job);
    registerRef(where, `job:${job.key}`);
    needItem(where, job.item);
    needCustomer(where, job.customer);
    if (!documentRefs.has(job.salesOrder)) {
      fail(`${where}: unknown sales order ref "${job.salesOrder}"`);
    }
    if (!documentRefs.has(job.salesOrderLine)) {
      fail(`${where}: unknown sales order line ref "${job.salesOrderLine}"`);
    }
    if (
      job.quantityComplete !== undefined &&
      job.quantityComplete > job.quantity
    ) {
      fail(
        `${where}: quantityComplete ${job.quantityComplete} exceeds quantity ${job.quantity}`
      );
    }

    // Deadline discipline: "No Deadline" means exactly that — no due date;
    // every other deadline type needs one.
    const deadlineType = job.deadlineType ?? "Hard Deadline";
    seenDeadlineTypes.add(deadlineType);
    if (deadlineType === "No Deadline" && job.dueDateOffset !== undefined) {
      fail(`${where}: a "No Deadline" job must not carry a dueDateOffset`);
    }
    if (deadlineType !== "No Deadline" && job.dueDateOffset === undefined) {
      fail(`${where}: "${deadlineType}" job has no dueDateOffset`);
    }

    const opCount = rootOpCountOf(job.item);
    const checkOrder = (label: string, order: number) => {
      if (!Number.isInteger(order) || order < 1) {
        fail(`${where} ${label}: order ${order} is not a positive integer`);
      } else if (order > opCount) {
        fail(
          `${where} ${label}: order ${order} exceeds the ${opCount} root operations of "${job.item}"`
        );
      }
    };

    const overrideOrders = new Set<number>();
    for (const override of job.operationOverrides ?? []) {
      checkOrder("operationOverrides", override.order);
      if (overrideOrders.has(override.order)) {
        fail(`${where} operationOverrides: duplicate order ${override.order}`);
      }
      overrideOrders.add(override.order);
      seenOperationStatuses.add(override.status);
    }

    for (const quantity of job.quantities ?? []) {
      checkOrder("quantities", quantity.order);
      seenQuantityTypes.add(quantity.type);
      if (quantity.quantity <= 0) {
        fail(`${where} quantities: quantity must be positive`);
      }
      if (quantity.type === "Scrap") {
        if (quantity.scrapReason === undefined) {
          fail(`${where} quantities: Scrap row has no scrapReason`);
        } else if (!SCRAP_REASON_NAMES.has(quantity.scrapReason)) {
          fail(
            `${where} quantities: scrapReason "${quantity.scrapReason}" is not a bootstrap scrap reason`
          );
        }
      } else if (quantity.scrapReason !== undefined) {
        fail(
          `${where} quantities: scrapReason on a ${quantity.type} row — only Scrap rows carry one`
        );
      }
    }

    for (const note of job.operationNotes ?? []) {
      checkOrder("operationNotes", note.order);
      if (!note.note.trim()) fail(`${where} operationNotes: empty note`);
    }
  }
  for (const status of REQUIRED_JOB_DEADLINE_TYPES) {
    if (!seenDeadlineTypes.has(status)) {
      fail(
        `production status matrix: no job with deadlineType "${status}" — every dataset must exhibit all four`
      );
    }
  }
  for (const status of REQUIRED_JOB_OPERATION_STATUSES) {
    if (!seenOperationStatuses.has(status)) {
      fail(
        `production status matrix: no operationOverride with status "${status}" — every dataset must exhibit the mixed-floor states`
      );
    }
  }
  for (const type of REQUIRED_PRODUCTION_QUANTITY_TYPES) {
    if (!seenQuantityTypes.has(type)) {
      fail(
        `production status matrix: no productionQuantity spec of type "${type}" — every dataset must exhibit all three`
      );
    }
  }
  if (!jobKeys.has(dataset.production.eventsJobKey)) {
    fail(
      `production.eventsJobKey "${dataset.production.eventsJobKey}" is not a job key`
    );
  }
  if (!jobKeys.has(dataset.production.genealogyJobKey)) {
    fail(
      `production.genealogyJobKey "${dataset.production.genealogyJobKey}" is not a job key`
    );
  }

  // ── Events-job depth: open event, batch, rework ────────────────────────────
  const eventsJob = jobByKey.get(dataset.production.eventsJobKey);
  if (eventsJob) {
    const eventsOpCount = rootOpCountOf(eventsJob.item);
    const checkEventsOrder = (label: string, order: number) => {
      if (!Number.isInteger(order) || order < 1 || order > eventsOpCount) {
        fail(
          `production.${label}: operation order ${order} is not within the ${eventsOpCount} root operations of "${eventsJob.item}"`
        );
      }
    };
    checkEventsOrder("openEvent", dataset.production.openEvent.operationOrder);
    // The open timer belongs on the operation the floor is actually running.
    const openEventOverride = (eventsJob.operationOverrides ?? []).find(
      (override) =>
        override.order === dataset.production.openEvent.operationOrder
    );
    if (openEventOverride?.status !== "In Progress") {
      fail(
        `production.openEvent: operation ${dataset.production.openEvent.operationOrder} is not overridden to "In Progress" on job "${eventsJob.key}"`
      );
    }
    checkEventsOrder("batch", dataset.production.batch.operationOrder);
    const rework = dataset.production.rework;
    checkEventsOrder("rework target", rework.targetOperationOrder);
    checkEventsOrder("rework triggeredAt", rework.triggeredAtOperationOrder);
    if (rework.targetOperationOrder > rework.triggeredAtOperationOrder) {
      fail(
        `production.rework: target operation ${rework.targetOperationOrder} is downstream of the triggering operation ${rework.triggeredAtOperationOrder} — rework sends units BACK`
      );
    }
    if (rework.quantity <= 0) {
      fail(`production.rework: quantity must be positive`);
    }
    if (!rework.reason.trim()) fail(`production.rework: empty reason`);
  }

  // ── Picking lists ──────────────────────────────────────────────────────────
  const seenPickingStatuses = new Set<string>();
  const pickingKeys = new Set<string>();
  for (const list of dataset.production.pickingLists) {
    const where = `production.pickingLists "${list.key}"`;
    if (pickingKeys.has(list.key)) fail(`${where}: duplicate key`);
    pickingKeys.add(list.key);
    seenPickingStatuses.add(list.status);
    const job = jobByKey.get(list.job);
    if (!job) {
      fail(`${where}: unknown job key "${list.job}"`);
      continue;
    }
    // Material is staged for a job the floor has — picking before release is
    // a timeline lie.
    if (job.releasedDateOffset === undefined) {
      fail(`${where}: job "${list.job}" was never released`);
    } else if (list.dateOffset < job.releasedDateOffset) {
      fail(
        `${where}: dateOffset ${list.dateOffset} is before the job's releasedDateOffset ${job.releasedDateOffset}`
      );
    }
    if (list.lines.length === 0) fail(`${where}: no lines`);
    const jobComponents = bomComponentsOf(job.item);
    for (const line of list.lines) {
      needItem(where, line.item);
      if (!jobComponents.has(line.item)) {
        fail(
          `${where} line "${line.item}": not a component of "${job.item}"'s BOM tree, so the job has no jobMaterial row to pick against`
        );
      }
      if (!shelves.has(line.fromShelf)) {
        fail(`${where} line "${line.item}": unknown shelf "${line.fromShelf}"`);
      }
      if (isTracked(line.item)) {
        fail(
          `${where} line "${line.item}": tracked items need per-entity picks the seed does not model`
        );
      }
      if (line.quantityRequired <= 0) {
        fail(`${where} line "${line.item}": quantityRequired must be positive`);
      }
      if (list.status === "Completed") {
        if (line.status !== "Picked") {
          fail(
            `${where} line "${line.item}": a Completed list's lines must all be Picked`
          );
        }
        if (line.quantityPicked !== line.quantityRequired) {
          fail(
            `${where} line "${line.item}": Picked line must have quantityPicked ${line.quantityRequired}, got ${line.quantityPicked}`
          );
        }
        if (shelves.has(line.fromShelf)) {
          addOnHand(line.item, line.fromShelf, -line.quantityPicked);
        }
      } else {
        if (line.status === "Picked") {
          fail(
            `${where} line "${line.item}": an In Progress list holds only Pending or Short lines`
          );
        }
        if (line.quantityPicked !== 0) {
          fail(
            `${where} line "${line.item}": an unpicked line must have quantityPicked 0 — partial picks would need ledger rows the seed does not model here`
          );
        }
      }
    }
  }
  for (const status of REQUIRED_PICKING_LIST_STATUSES) {
    if (!seenPickingStatuses.has(status)) {
      fail(
        `production status matrix: no picking list with status "${status}" — every dataset must exhibit both`
      );
    }
  }

  // ── Ops spare-part drains ──────────────────────────────────────────────────
  // A Completed dispatch issues its spare parts from a shelf, draining the same
  // per-(item, shelf) balance.
  for (const dispatch of dataset.ops.maintenanceDispatches) {
    for (const part of dispatch.spareParts ?? []) {
      const where = `ops.maintenanceDispatches "${dispatch.key}" spare part "${part.item}"`;
      needItem(where, part.item);
      if (!shelves.has(part.shelf)) {
        fail(`${where}: unknown shelf "${part.shelf}"`);
      }
      if (isTracked(part.item)) {
        fail(
          `${where}: tracked items need per-entity consumption the seed does not model`
        );
      }
      if (part.quantity <= 0) fail(`${where}: quantity must be positive`);
      if (dispatch.status === "Completed" && shelves.has(part.shelf)) {
        addOnHand(part.item, part.shelf, -part.quantity);
      }
    }
  }

  // ── Net on-hand ≥ 0 per (item, shelf), across every slice ──────────────────
  for (const [key, net] of onHand) {
    if (net < 0) {
      fail(
        `inventory: net on-hand for ${key} is ${net} — count variances, completed transfers, posted shipments, completed purchase returns, completed picking lists and completed maintenance dispatches drain more than the opening stock and posted receipts provide`
      );
    }
  }
  // Genealogy inputs are historical lots/serials that tier 06 CREATES as
  // consumed entities — they must not collide with an on-hand entity's
  // readableId, or the UI shows two entities under one id.
  const genealogyIds = new Set<string>();
  for (const input of dataset.production.genealogyInputs) {
    const where = `production.genealogyInputs "${input.readableId}"`;
    needItem(where, input.item);
    if (trackedEntityQty.has(input.readableId)) {
      fail(
        `${where}: readableId collides with an inventory.onHandTracked entity`
      );
    }
    if (receiptLotIds.has(input.readableId)) {
      fail(`${where}: readableId collides with a purchasing receipt lotNumber`);
    }
    if (genealogyIds.has(input.readableId)) {
      fail(`${where}: duplicate genealogy input readableId`);
    }
    genealogyIds.add(input.readableId);
  }
  needItem(
    "production.genealogyAssembly",
    dataset.production.genealogyAssembly.item
  );
  const assemblySerialId =
    dataset.production.genealogyAssembly.serial.readableId;
  if (
    trackedEntityQty.has(assemblySerialId) ||
    receiptLotIds.has(assemblySerialId) ||
    genealogyIds.has(assemblySerialId)
  ) {
    fail(
      `production.genealogyAssembly: serial readableId "${assemblySerialId}" collides with another tracked entity readableId`
    );
  }
  registerRef(
    "production.genealogyAssembly",
    dataset.production.genealogyAssembly.ref
  );

  const assembly = dataset.production.assembly;
  if (assembly && dataset.industryId) {
    const graph = loadAssemblyGraph(dataset.industryId, assembly.model);
    if (!graph) {
      fail(
        `production.assembly: no bundled graph at assets/${dataset.industryId}/models/${assembly.model}.graph.json`
      );
    } else {
      if (assembly.componentCount !== graph.componentCount) {
        fail(
          `production.assembly "${assembly.model}": componentCount ${assembly.componentCount} != graph's ${graph.componentCount}`
        );
      }
      if (assembly.item !== undefined)
        needItem("production.assembly", assembly.item);
      for (const step of assembly.steps) {
        for (const nodeId of step.componentNodeIds) {
          if (!graph.nodeIds.has(nodeId)) {
            fail(
              `production.assembly step "${step.title}": node id "${nodeId}" is not in the bundled graph`
            );
          }
        }
      }
    }
  }

  // ── Quality slice ──────────────────────────────────────────────────────────
  const q = dataset.quality;
  const seenQuality = {
    ncrStatus: new Set<string>(),
    ncrPriority: new Set<string>(),
    ncrSource: new Set<string>(),
    ncrTaskStatus: new Set<string>(),
    documentStatus: new Set<string>(),
    gaugeStatus: new Set<string>(),
    gaugeCalibration: new Set<string>(),
    riskStatus: new Set<string>(),
    riskSource: new Set<string>(),
    riskType: new Set<string>()
  };

  // Direct POs by ref (supplier + line items) and sales order LINE refs by
  // customer — what an NCR's PO-line / SO-line associations resolve against.
  const directPoByRef = new Map<
    string,
    { supplier: string; items: Set<string> }
  >();
  for (const po of p.purchaseOrders) {
    if (po.source !== "direct" || po.ref === undefined) continue;
    directPoByRef.set(po.ref, {
      supplier: po.supplier,
      items: new Set(po.lines.map((line) => line.item))
    });
  }
  const salesOrderLineCustomer = new Map<string, string>();
  for (const spec of [
    ...dataset.sales.opportunities,
    ...dataset.sales.releasedOrders
  ]) {
    for (const line of spec.order?.lines ?? []) {
      salesOrderLineCustomer.set(line.ref, spec.customer);
    }
  }
  for (const spec of dataset.sales.statusOrders) {
    salesOrderLineCustomer.set(`soline:${spec.key}`, spec.customer);
  }

  // A completed task/approval carries its completion day, on/after the NCR
  // opened and never in the future.
  const checkCompletion = (
    where: string,
    status: string,
    openDateOffset: number,
    completedOffset: number | undefined
  ) => {
    if (status === "Completed" && completedOffset === undefined) {
      fail(`${where}: Completed but has no completedOffset`);
    }
    if (status !== "Completed" && completedOffset !== undefined) {
      fail(`${where}: completedOffset on a task that is "${status}"`);
    }
    if (
      completedOffset !== undefined &&
      (completedOffset < openDateOffset || completedOffset > 0)
    ) {
      fail(
        `${where}: completedOffset ${completedOffset} outside [${openDateOffset}, 0]`
      );
    }
  };

  // The inspection lot — mirrors post-receipt, so it must sit on a real posted,
  // untracked receipt line, and its samples must be exactly what the engine
  // would have derived from the authored readings.
  const insp = q.inspection;
  {
    const where = `quality.inspection "${insp.ref}"`;
    registerRef(where, insp.ref);
    needItem(where, insp.item);
    const receipt = p.purchaseOrders
      .map((po) => (po.source === "direct" ? po.receipt : undefined))
      .find((r) => r?.ref === insp.receipt);
    const line = receipt?.lines.find((l) => l.item === insp.item);
    if (!receipt) {
      fail(`${where}: unknown purchasing receipt ref "${insp.receipt}"`);
    } else if (receipt.status !== "Posted") {
      fail(
        `${where}: receipt "${insp.receipt}" is ${receipt.status}, not Posted`
      );
    } else if (!line || line.receivedQuantity <= 0) {
      fail(`${where}: receipt "${insp.receipt}" received no "${insp.item}"`);
    } else {
      if (line.requiresBatchTracking || isTracked(insp.item)) {
        fail(
          `${where}: "${insp.item}" is tracked — the seeded lot has no per-entity samples`
        );
      }
      const plan = resolveInspectionPlan(insp, line.receivedQuantity);
      if (plan.sampleSize > 5) {
        fail(
          `${where}: lot of ${line.receivedQuantity} resolves to n=${plan.sampleSize} — pick a line whose sample size is ≤ 5`
        );
      }
      if (insp.samples.length !== plan.sampleSize) {
        fail(
          `${where}: ${insp.samples.length} samples authored but the plan resolves to n=${plan.sampleSize}`
        );
      }
      const postedOffset = receipt.postedOffset ?? 0;
      for (const [index, sample] of insp.samples.entries()) {
        if (
          sample.inspectedOffset < postedOffset ||
          sample.inspectedOffset > insp.dispositionOffset
        ) {
          fail(
            `${where} sample ${index + 1}: inspectedOffset ${sample.inspectedOffset} outside [receipt posted ${postedOffset}, disposition ${insp.dispositionOffset}]`
          );
        }
      }
    }
    if (insp.dispositionOffset > 0) {
      fail(`${where}: dispositionOffset is in the future`);
    }
    const labels = new Set<string>();
    for (const feature of insp.features) {
      if (labels.has(feature.label)) {
        fail(`${where}: duplicate feature label "${feature.label}"`);
      }
      labels.add(feature.label);
    }
    if (insp.features.length < 2) {
      fail(`${where}: needs at least 2 features`);
    }
    for (const [index, sample] of insp.samples.entries()) {
      const read = new Set<string>();
      for (const reading of sample.measurements) {
        if (!labels.has(reading.feature)) {
          fail(
            `${where} sample ${index + 1}: unknown feature "${reading.feature}"`
          );
        }
        if (read.has(reading.feature)) {
          fail(
            `${where} sample ${index + 1}: feature "${reading.feature}" read twice`
          );
        }
        read.add(reading.feature);
      }
      const derived = deriveSampleStatus(insp, sample);
      if (derived !== sample.status) {
        fail(
          `${where} sample ${index + 1}: status "${sample.status}" but its readings derive "${derived}"`
        );
      }
    }
    const passed = insp.samples.filter((s) => s.status === "Passed").length;
    const failed = insp.samples.filter((s) => s.status === "Failed").length;
    if (insp.status === "Failed") {
      fail(
        `${where}: a Failed (rejected) lot posts an inspection write-off the seed does not author — use Partial`
      );
    }
    if (insp.status === "Partial" && (passed === 0 || failed === 0)) {
      fail(`${where}: Partial needs at least one Passed and one Failed sample`);
    }
    if (insp.status === "Passed" && failed > 0) {
      fail(`${where}: Passed lot has a Failed sample`);
    }
  }

  const ncrRefs = new Set<string>();
  for (const ncr of q.nonConformances) {
    const where = `quality.nonConformances "${ncr.ref}"`;
    registerRef(where, ncr.ref);
    ncrRefs.add(ncr.ref);
    seenQuality.ncrStatus.add(ncr.status);
    seenQuality.ncrPriority.add(ncr.priority);
    seenQuality.ncrSource.add(ncr.source);
    if (ncr.jobOperation && !documentRefs.has(ncr.jobOperation.job)) {
      fail(`${where}: unknown job ref "${ncr.jobOperation.job}"`);
    }
    for (const line of ncr.items ?? []) needItem(where, line.item);

    if (ncr.type !== undefined && !NCR_TYPE_NAMES.has(ncr.type)) {
      fail(
        `${where}: type "${ncr.type}" is not a bootstrap nonConformanceType`
      );
    }
    if (ncr.openDateOffset > 0)
      fail(`${where}: openDateOffset is in the future`);
    if (ncr.status === "Closed") {
      if (ncr.closeDateOffset === undefined) {
        fail(`${where}: Closed but has no closeDateOffset`);
      } else if (
        ncr.closeDateOffset < ncr.openDateOffset ||
        ncr.closeDateOffset > 0
      ) {
        fail(
          `${where}: closeDateOffset ${ncr.closeDateOffset} outside [${ncr.openDateOffset}, 0]`
        );
      }
    } else if (ncr.closeDateOffset !== undefined) {
      fail(`${where}: closeDateOffset on a ${ncr.status} NCR`);
    }

    if (ncr.supplier !== undefined) needSupplier(where, ncr.supplier);
    if (ncr.purchaseOrderLine !== undefined) {
      const { po, item } = ncr.purchaseOrderLine;
      const order = directPoByRef.get(po);
      if (!order) {
        fail(`${where}: unknown direct purchase order ref "${po}"`);
      } else {
        if (!order.items.has(item)) {
          fail(`${where}: purchase order "${po}" has no line for "${item}"`);
        }
        if (order.supplier !== ncr.supplier) {
          fail(
            `${where}: purchase order "${po}" is on "${order.supplier}", not the NCR's supplier "${ncr.supplier ?? "(none)"}"`
          );
        }
      }
    }
    if (ncr.customer !== undefined && !customers.has(ncr.customer)) {
      fail(`${where}: unknown customer "${ncr.customer}"`);
    }
    if (ncr.salesOrderLine !== undefined) {
      const owner = salesOrderLineCustomer.get(ncr.salesOrderLine);
      if (owner === undefined) {
        fail(`${where}: unknown sales order line ref "${ncr.salesOrderLine}"`);
      } else if (owner !== ncr.customer) {
        fail(
          `${where}: sales order line "${ncr.salesOrderLine}" belongs to "${owner}", not the NCR's customer "${ncr.customer ?? "(none)"}"`
        );
      }
    }
    if (
      ncr.trackedEntity !== undefined &&
      !trackedEntityQty.has(ncr.trackedEntity) &&
      !receiptLotIds.has(ncr.trackedEntity)
    ) {
      fail(
        `${where}: tracked entity "${ncr.trackedEntity}" is not an on-hand lot/serial or a receipt lotNumber`
      );
    }
    if (ncr.inspection !== undefined && ncr.inspection !== insp.ref) {
      fail(`${where}: unknown inspection ref "${ncr.inspection}"`);
    }

    const actions = new Set<string>();
    for (const task of ncr.actionTasks ?? []) {
      const taskWhere = `${where} action "${task.action}"`;
      if (!NCR_ACTION_NAMES.has(task.action)) {
        fail(`${taskWhere}: not a bootstrap nonConformanceRequiredAction`);
      }
      if (actions.has(task.action))
        fail(`${taskWhere}: duplicate required action`);
      actions.add(task.action);
      seenQuality.ncrTaskStatus.add(task.status);
      checkCompletion(
        taskWhere,
        task.status,
        ncr.openDateOffset,
        task.completedOffset
      );
    }
    const allTasks = [
      ...(ncr.actionTasks ?? []).map((t) => t.status),
      ...(ncr.mrb
        ? [ncr.mrb.status, ...ncr.mrb.reviewers.map((r) => r.status)]
        : [])
    ];
    // Tasks start Pending and working one moves the issue to In Progress; a
    // Closed issue has nothing left open.
    if (ncr.status === "Registered" && allTasks.some((s) => s !== "Pending")) {
      fail(`${where}: a Registered NCR can only have Pending tasks`);
    }
    if (
      ncr.status === "Closed" &&
      allTasks.some((s) => s !== "Completed" && s !== "Skipped")
    ) {
      fail(`${where}: a Closed NCR has open tasks`);
    }
    if (ncr.mrb) {
      checkCompletion(
        `${where} MRB approval`,
        ncr.mrb.status,
        ncr.openDateOffset,
        ncr.mrb.completedOffset
      );
      const titles = new Set<string>();
      for (const reviewer of ncr.mrb.reviewers) {
        if (titles.has(reviewer.title)) {
          fail(`${where}: duplicate MRB reviewer "${reviewer.title}"`);
        }
        titles.add(reviewer.title);
        checkCompletion(
          `${where} reviewer "${reviewer.title}"`,
          reviewer.status,
          ncr.openDateOffset,
          reviewer.completedOffset
        );
      }
    }
  }

  const documentVersions = new Set<string>();
  for (const doc of q.qualityDocuments) {
    const where = `quality.qualityDocuments "${doc.name}" v${doc.version}`;
    seenQuality.documentStatus.add(doc.status);
    const key = `${doc.name}@${doc.version}`;
    if (documentVersions.has(key)) fail(`${where}: duplicate (name, version)`);
    documentVersions.add(key);
    if (doc.version < 0) fail(`${where}: version must be ≥ 0`);
    if (doc.status === "Active" && doc.steps.length < 2) {
      fail(`${where}: the Active document needs at least 2 steps`);
    }
    for (const step of doc.steps) {
      const stepWhere = `${where} step "${step.name}"`;
      if (step.type === "Measurement") {
        if (step.unitOfMeasureCode === undefined) {
          fail(`${stepWhere}: Measurement step needs a unitOfMeasureCode`);
        } else if (!UOM_CODES.has(step.unitOfMeasureCode)) {
          fail(
            `${stepWhere}: unitOfMeasureCode "${step.unitOfMeasureCode}" is not a bootstrap unit of measure`
          );
        }
      } else if (step.unitOfMeasureCode !== undefined) {
        fail(`${stepWhere}: only Measurement steps take a unitOfMeasureCode`);
      }
      if (step.type === "List" && (step.listValues ?? []).length === 0) {
        fail(`${stepWhere}: List step needs listValues`);
      }
      if (
        step.minValue !== undefined &&
        step.maxValue !== undefined &&
        step.minValue > step.maxValue
      ) {
        fail(`${stepWhere}: minValue > maxValue`);
      }
    }
  }

  const gaugeKeys = new Set<string>();
  let activeMaster = false;
  for (const gauge of q.gauges) {
    const where = `quality.gauges "${gauge.key}"`;
    if (gaugeKeys.has(gauge.key)) fail(`${where}: duplicate gauge key`);
    gaugeKeys.add(gauge.key);
    if (!GAUGE_TYPE_NAMES.has(gauge.gaugeType)) {
      fail(
        `${where}: gaugeType "${gauge.gaugeType}" is not a bootstrap gauge type`
      );
    }
    if (gauge.supplier !== undefined) needSupplier(where, gauge.supplier);
    if (gauge.shelf !== undefined && !shelves.has(gauge.shelf)) {
      fail(`${where}: unknown shelf "${gauge.shelf}"`);
    }
    if (gauge.calibrationIntervalInMonths <= 0) {
      fail(`${where}: calibrationIntervalInMonths must be positive`);
    }
    if (gauge.acquiredOffset > 0)
      fail(`${where}: acquiredOffset is in the future`);
    let previous = gauge.acquiredOffset;
    for (const record of gauge.calibrations) {
      if (record.dateOffset < previous || record.dateOffset > 0) {
        fail(
          `${where}: calibration on ${record.dateOffset} is out of order (after acquisition, oldest first, not in the future)`
        );
      }
      previous = record.dateOffset;
    }
    const latest = gauge.calibrations.at(-1);
    const calibration =
      latest === undefined
        ? "Pending"
        : latest.result === "Pass"
          ? "In-Calibration"
          : "Out-of-Calibration";
    // The gauges view flips an overdue gauge to Out-of-Calibration; an
    // In-Calibration gauge must still be inside its interval (28-day months,
    // conservatively).
    if (
      calibration === "In-Calibration" &&
      latest !== undefined &&
      latest.dateOffset + 28 * gauge.calibrationIntervalInMonths <= 0
    ) {
      fail(`${where}: last Pass calibration is already past its interval`);
    }
    seenQuality.gaugeStatus.add(gauge.status);
    seenQuality.gaugeCalibration.add(calibration);
    if (gauge.role === "Master" && gauge.status === "Active")
      activeMaster = true;
  }
  if (!activeMaster) fail("quality.gauges: needs an Active Master gauge");

  for (const risk of q.risks) {
    const where = `quality.risks "${risk.title}"`;
    seenQuality.riskStatus.add(risk.status);
    seenQuality.riskSource.add(risk.source);
    seenQuality.riskType.add(risk.type);
    for (const [field, value] of [
      ["severity", risk.severity],
      ["likelihood", risk.likelihood]
    ] as const) {
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        fail(`${where}: ${field} ${value} must be an integer 1–5`);
      }
    }
    switch (risk.source) {
      case "Customer":
        if (!customers.has(risk.customer)) {
          fail(`${where}: unknown customer "${risk.customer}"`);
        }
        break;
      case "Supplier":
        needSupplier(where, risk.supplier);
        break;
      case "Item":
        needItem(where, risk.item);
        break;
      case "Job":
        if (!risk.job.startsWith("job:") || !documentRefs.has(risk.job)) {
          fail(`${where}: unknown job ref "${risk.job}"`);
        }
        break;
      case "Work Center":
        if (!workCenters.has(risk.workCenter)) {
          fail(`${where}: unknown work center "${risk.workCenter}"`);
        }
        break;
      case "General":
        break;
    }
  }

  const requiredQualitySets: Array<[string, readonly string[], Set<string>]> = [
    ["nonConformance status", REQUIRED_NCR_STATUSES, seenQuality.ncrStatus],
    [
      "nonConformance priority",
      REQUIRED_NCR_PRIORITIES,
      seenQuality.ncrPriority
    ],
    ["nonConformance source", REQUIRED_NCR_SOURCES, seenQuality.ncrSource],
    [
      "nonConformanceActionTask status",
      REQUIRED_NCR_TASK_STATUSES,
      seenQuality.ncrTaskStatus
    ],
    [
      "qualityDocument status",
      REQUIRED_QUALITY_DOCUMENT_STATUSES,
      seenQuality.documentStatus
    ],
    ["gauge status", REQUIRED_GAUGE_STATUSES, seenQuality.gaugeStatus],
    [
      "gauge calibration status",
      REQUIRED_GAUGE_CALIBRATION_STATUSES,
      seenQuality.gaugeCalibration
    ],
    ["riskRegister status", REQUIRED_RISK_STATUSES, seenQuality.riskStatus],
    ["riskRegister source", REQUIRED_RISK_SOURCES, seenQuality.riskSource],
    ["riskRegister type", REQUIRED_RISK_TYPES, seenQuality.riskType]
  ];
  for (const [label, required, seen] of requiredQualitySets) {
    for (const value of required) {
      if (!seen.has(value)) {
        fail(
          `quality matrix: no ${label} "${value}" — every dataset must exhibit the full required set`
        );
      }
    }
  }

  // ── Change orders slice ────────────────────────────────────────────────────
  const seenChangeOrderStatus = new Set<string>();
  const seenChangeOrderTaskStatus = new Set<string>();
  for (const co of dataset.changeOrders.changeOrders) {
    const where = `changeOrders "${co.ref}"`;
    registerRef(where, co.ref);
    seenChangeOrderStatus.add(co.status);
    for (const affected of co.affectedItems) {
      needItem(where, affected.item);
      if (affected.changeType === "Revision" && !affected.revision) {
        fail(`${where}: Revision on "${affected.item}" has no revision spec`);
      }
      for (const edit of affected.revision?.bomEdits ?? []) {
        needItem(`${where} bomEdits`, edit.component);
      }
    }
    if (
      co.changeOrderType !== undefined &&
      !CO_TYPE_NAMES.has(co.changeOrderType)
    ) {
      fail(
        `${where}: changeOrderType "${co.changeOrderType}" is not a bootstrap changeOrderType`
      );
    }
    if (co.nonConformance !== undefined && !ncrRefs.has(co.nonConformance)) {
      fail(`${where}: unknown NCR ref "${co.nonConformance}"`);
    }
    if (
      co.dueDateOffset !== undefined &&
      co.dueDateOffset < co.openDateOffset
    ) {
      fail(`${where}: dueDateOffset before openDateOffset`);
    }
    const actions = new Set<string>();
    for (const task of co.actionTasks ?? []) {
      const taskWhere = `${where} action "${task.action}"`;
      if (!CO_ACTION_NAMES.has(task.action)) {
        fail(`${taskWhere}: not a bootstrap changeOrderRequiredAction`);
      }
      if (actions.has(task.action))
        fail(`${taskWhere}: duplicate required action`);
      actions.add(task.action);
      seenChangeOrderTaskStatus.add(task.status);
      checkCompletion(
        taskWhere,
        task.status,
        co.openDateOffset,
        task.completedOffset
      );
    }
  }
  for (const [label, required, seen] of [
    [
      "changeOrder status",
      REQUIRED_CHANGE_ORDER_STATUSES,
      seenChangeOrderStatus
    ],
    [
      "changeOrderActionTask status",
      REQUIRED_CHANGE_ORDER_TASK_STATUSES,
      seenChangeOrderTaskStatus
    ]
  ] as const) {
    for (const value of required) {
      if (!seen.has(value)) {
        fail(
          `change order matrix: no ${label} "${value}" — every dataset must exhibit the full required set`
        );
      }
    }
  }

  // ── Accounting slice ───────────────────────────────────────────────────────
  validateAccounting(dataset, fail, registerRef, customers, suppliers);

  // ── Ops slice + workflow run history ───────────────────────────────────────
  validateOps(dataset, fail, { needItem, workCenters, ncrRefs, documentRefs });

  // ── Planning slice ─────────────────────────────────────────────────────────
  for (const id of dataset.planning.buyItemIds) {
    needItem("planning.buyItemIds", id);
  }
  for (const id of dataset.planning.makeItemIds) {
    needItem("planning.makeItemIds", id);
  }
  for (const projection of dataset.planning.demandProjections) {
    needItem("planning.demandProjections", projection.readableId);
  }
  const order = dataset.planning.demandOrder;
  registerRef("planning.demandOrder", order.ref);
  needCustomer("planning.demandOrder", order.customer);
  if (!shippingMethods.has(order.shippingMethod)) {
    fail(
      `planning.demandOrder: unknown shipping method "${order.shippingMethod}"`
    );
  }
  if (
    order.promisedDateOffset < 0 ||
    order.promisedDateOffset >= HORIZON_DAYS
  ) {
    fail(
      `planning.demandOrder: promisedDateOffset ${order.promisedDateOffset} outside the ${HORIZON_DAYS}-day planning horizon`
    );
  }
  for (const line of order.lines) needItem("planning.demandOrder", line.item);

  return violations;
}

type InvoiceFacts = {
  party: string;
  /** Σ line quantity × price — what the salesInvoices/purchaseInvoices views total. */
  total: number;
  issued: number;
  status: string;
  currencyCode: string;
};

function validateAccounting(
  dataset: Dataset,
  fail: (message: string) => void,
  registerRef: (where: string, ref: string) => void,
  customers: Set<string>,
  suppliers: Set<string>
): void {
  const a = dataset.accounting;

  // ── Keyed invoice registry (sinv:/pinv: refs the payments settle) ─────────
  const salesInvoices = new Map<string, InvoiceFacts>();
  for (const opp of [
    ...dataset.sales.opportunities,
    ...dataset.sales.releasedOrders
  ]) {
    const inv = opp.invoice;
    if (inv?.key === undefined) continue;
    salesInvoices.set(inv.key, {
      party: opp.customer,
      total: inv.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
      issued: inv.dateIssuedOffset,
      status: inv.status,
      currencyCode: "USD"
    });
  }
  const purchaseInvoices = new Map<string, InvoiceFacts>();
  for (const po of dataset.purchasing.purchaseOrders) {
    if (po.source !== "direct" || po.invoice?.key === undefined) continue;
    purchaseInvoices.set(po.invoice.key, {
      party: po.supplier,
      total: po.invoice.lines.reduce(
        (s, l) => s + l.quantity * l.supplierUnitPrice,
        0
      ),
      issued: po.invoice.dateIssuedOffset,
      status: po.invoice.status,
      currencyCode: po.invoice.currencyCode
    });
  }
  const invoiceIn = (sales: boolean) =>
    sales ? salesInvoices : purchaseInvoices;
  const invoiceLabel = (sales: boolean, key: string) =>
    `${sales ? "sinv" : "pinv"}:${key}`;
  // Settled principal per invoice label, and who settled it.
  const settled = new Map<string, number>();
  const partialDates = new Map<string, number[]>();
  const settle = (label: string, amount: number, dateOffset: number) => {
    settled.set(label, (settled.get(label) ?? 0) + amount);
    partialDates.set(label, [...(partialDates.get(label) ?? []), dateOffset]);
  };

  // ── Projects ───────────────────────────────────────────────────────────────
  const projectKeys = new Set<string>();
  const projectNames = new Set<string>();
  for (const project of a.projects) {
    const where = `accounting.projects "${project.key}"`;
    if (projectKeys.has(project.key)) fail(`${where}: duplicate key`);
    if (projectNames.has(project.name))
      fail(`${where}: duplicate name "${project.name}" (unique per company)`);
    projectKeys.add(project.key);
    projectNames.add(project.name);
    const link = project.purchaseInvoiceLine;
    if (link) {
      const po = dataset.purchasing.purchaseOrders.find(
        (p) => p.source === "direct" && p.invoice?.key === link.invoiceKey
      );
      if (!po || po.source !== "direct" || !po.invoice) {
        fail(`${where}: unknown purchase invoice key "${link.invoiceKey}"`);
      } else if (
        po.invoice.lines.filter((l) => l.item === link.item).length !== 1
      ) {
        fail(
          `${where}: purchase invoice "${link.invoiceKey}" has no single line for "${link.item}"`
        );
      }
    }
  }
  if (a.projects.length < 2) fail("accounting.projects: expected at least 2");
  if (!a.projects.some((p) => p.purchaseInvoiceLine)) {
    fail("accounting.projects: no project codes a purchase invoice line");
  }

  // ── Custom dimension ───────────────────────────────────────────────────────
  const custom = a.customDimension;
  if (BOOTSTRAP_DIMENSION_NAMES.has(custom.name)) {
    fail(
      `accounting.customDimension: "${custom.name}" collides with a bootstrap dimension`
    );
  }
  if (new Set(custom.values).size !== custom.values.length) {
    fail("accounting.customDimension: duplicate value");
  }
  if (custom.values.length < 2) {
    fail("accounting.customDimension: expected at least 2 values");
  }

  // ── Journal entries ────────────────────────────────────────────────────────
  const journalEntryIds = new Set<string>();
  const seenJournalStatus = new Set<string>();
  let postedDimensionTags = 0;
  const needEntryId = (where: string, id: string) => {
    if (journalEntryIds.has(id))
      fail(`${where}: duplicate journalEntryId "${id}"`);
    journalEntryIds.add(id);
  };
  for (const entry of a.journalEntries) {
    const where = `accounting.journalEntries "${entry.ref}"`;
    registerRef("accounting.journalEntries", entry.ref);
    needEntryId(where, entry.journalEntryId);
    seenJournalStatus.add(entry.status);
    const net = journalImbalance(entry);
    if (Math.abs(net) > 0.01) {
      fail(`${where}: entry does not balance (net ${net})`);
    }
    if (entry.lines.length < 2) fail(`${where}: needs at least two lines`);
    // The period-open trigger rejects ANY journal dated in a Closed period;
    // posted work belongs in an Open one.
    const minOffset =
      entry.status === "Draft" ? NOT_CLOSED_MIN_OFFSET : OPEN_PERIOD_MIN_OFFSET;
    if (entry.postingOffset > 0 || entry.postingOffset < minOffset) {
      fail(
        `${where}: postingOffset ${entry.postingOffset} outside [${minOffset}, 0] (seeded period close state)`
      );
    }
    const references = entry.lines.map((l) => l.journalLineReference);
    for (const line of entry.lines) {
      if ((line.accountClass === undefined) === (line.account === undefined)) {
        fail(
          `${where}: a line must name exactly one of accountClass / account`
        );
      } else if (lineClass(line) === undefined) {
        fail(`${where}: unknown GL account "${line.account}"`);
      }
      if (!line.dimensions?.length) continue;
      if (
        references.filter((r) => r === line.journalLineReference).length !== 1
      ) {
        fail(
          `${where}: a dimension-tagged line needs a unique journalLineReference ("${line.journalLineReference}")`
        );
      }
      const dims = new Set<string>();
      for (const tag of line.dimensions) {
        if (dims.has(tag.dimension))
          fail(
            `${where}: dimension "${tag.dimension}" tagged twice on one line`
          );
        dims.add(tag.dimension);
        if (tag.dimension === "Project") {
          if (!projectKeys.has(tag.value))
            fail(`${where}: unknown project "${tag.value}"`);
        } else if (tag.dimension !== custom.name) {
          fail(`${where}: unknown dimension "${tag.dimension}"`);
        } else if (!custom.values.includes(tag.value)) {
          fail(`${where}: "${tag.value}" is not a ${custom.name} value`);
        }
        if (entry.status === "Posted") postedDimensionTags++;
      }
    }
    if ((entry.status === "Reversed") !== (entry.reversal !== undefined)) {
      fail(
        `${where}: a reversal entry is required exactly when status is Reversed`
      );
    }
    if (entry.reversal) {
      registerRef("accounting.journalEntries", entry.reversal.ref);
      needEntryId(where, entry.reversal.journalEntryId);
      if (
        entry.reversal.postingOffset < entry.postingOffset ||
        entry.reversal.postingOffset > 0
      ) {
        fail(
          `${where}: reversal postingOffset ${entry.reversal.postingOffset} must fall between the original's and today`
        );
      }
    }
  }
  for (const status of REQUIRED_JOURNAL_STATUSES) {
    if (!seenJournalStatus.has(status))
      fail(`accounting.journalEntries: no "${status}" entry`);
  }
  if (postedDimensionTags === 0) {
    fail("accounting.journalEntries: no Posted line carries a dimension tag");
  }

  // ── Memos ──────────────────────────────────────────────────────────────────
  const memos = new Map<
    string,
    { party: string; direction: string; amount: number; dateOffset: number }
  >();
  const seenDirections = new Set<string>();
  for (const memo of a.memos) {
    const where = `accounting.memos "${memo.key}"`;
    registerRef(where, `memo:${memo.key}`);
    seenDirections.add(memo.direction);
    const sales = memo.direction === "Credit";
    const party = sales ? memo.customer : memo.supplier;
    if (!party || (sales ? memo.supplier : memo.customer) !== undefined) {
      fail(
        `${where}: a ${memo.direction} memo names exactly one ${sales ? "customer" : "supplier"}`
      );
      continue;
    }
    if (!(sales ? customers : suppliers).has(party))
      fail(`${where}: unknown ${sales ? "customer" : "supplier"} "${party}"`);
    const invoice = invoiceIn(sales).get(memo.invoiceKey);
    if (!invoice) {
      fail(
        `${where}: unknown invoice key "${invoiceLabel(sales, memo.invoiceKey)}"`
      );
      continue;
    }
    if (invoice.party !== party)
      fail(
        `${where}: party "${party}" does not match the invoice's "${invoice.party}"`
      );
    if (invoice.currencyCode !== "USD")
      fail(`${where}: memos settle base-currency (USD) invoices only`);
    if (memo.amount <= 0 || cents(memo.amount) > cents(invoice.total))
      fail(
        `${where}: amount ${memo.amount} outside (0, invoice total ${invoice.total}]`
      );
    if (
      memo.dateOffset < invoice.issued ||
      memo.dateOffset > 0 ||
      memo.dateOffset < OPEN_PERIOD_MIN_OFFSET
    ) {
      fail(
        `${where}: dateOffset ${memo.dateOffset} must fall between the invoice's issue date and today`
      );
    }
    memos.set(memo.key, {
      party,
      direction: memo.direction,
      amount: memo.amount,
      dateOffset: memo.dateOffset
    });
  }
  for (const direction of REQUIRED_MEMO_DIRECTIONS) {
    if (!seenDirections.has(direction))
      fail(`accounting.memos: no "${direction}" memo`);
  }

  // ── Payments + settlements ─────────────────────────────────────────────────
  const seenTypes = new Set<string>();
  const memoConsumed = new Map<string, number>();
  for (const payment of a.payments) {
    const where = `accounting.payments "${payment.key}"`;
    registerRef(where, `payment:${payment.key}`);
    seenTypes.add(payment.type);
    const sales = payment.type === "Receipt";
    const party = sales ? payment.customer : payment.supplier;
    if (!party || (sales ? payment.supplier : payment.customer) !== undefined) {
      fail(
        `${where}: a ${payment.type} names exactly one ${sales ? "customer" : "supplier"}`
      );
      continue;
    }
    if (!(sales ? customers : suppliers).has(party))
      fail(`${where}: unknown ${sales ? "customer" : "supplier"} "${party}"`);
    if (payment.amount < 0) fail(`${where}: negative amount`);
    const applied = payment.applies.reduce((s, x) => s + x.amount, 0);
    if (cents(applied) !== cents(payment.amount)) {
      fail(
        `${where}: applications total ${applied} but the payment is ${payment.amount}`
      );
    }
    if (payment.amount === 0 && !payment.credits?.length) {
      fail(`${where}: a zero-cash payment must carry credit applications`);
    }
    if (payment.dateOffset > 0 || payment.dateOffset < OPEN_PERIOD_MIN_OFFSET) {
      fail(
        `${where}: dateOffset ${payment.dateOffset} outside [${OPEN_PERIOD_MIN_OFFSET}, 0]`
      );
    }
    const checkTarget = (invoiceKey: string, amount: number) => {
      const invoice = invoiceIn(sales).get(invoiceKey);
      const label = invoiceLabel(sales, invoiceKey);
      if (!invoice) {
        fail(`${where}: unknown invoice key "${label}"`);
        return;
      }
      if (invoice.party !== party)
        fail(
          `${where}: party "${party}" does not match ${label}'s "${invoice.party}"`
        );
      if (invoice.currencyCode !== "USD")
        fail(
          `${where}: ${label} is not base currency — seeded settlements are USD only`
        );
      if (amount <= 0) fail(`${where}: non-positive application to ${label}`);
      if (payment.dateOffset < invoice.issued) {
        fail(
          `${where}: dateOffset ${payment.dateOffset} precedes ${label}'s issue date ${invoice.issued}`
        );
      }
      settle(label, amount, payment.dateOffset);
    };
    for (const apply of payment.applies)
      checkTarget(apply.invoiceKey, apply.amount);
    for (const credit of payment.credits ?? []) {
      const memo = memos.get(credit.memoKey);
      if (!memo) {
        fail(`${where}: unknown memo "${credit.memoKey}"`);
        continue;
      }
      if (
        memo.direction !== (sales ? "Credit" : "Debit") ||
        memo.party !== party
      ) {
        fail(
          `${where}: memo "${credit.memoKey}" must be a ${sales ? "Credit" : "Debit"} memo of "${party}"`
        );
      }
      if (payment.dateOffset < memo.dateOffset) {
        fail(`${where}: applies memo "${credit.memoKey}" before it was posted`);
      }
      memoConsumed.set(
        credit.memoKey,
        (memoConsumed.get(credit.memoKey) ?? 0) + credit.amount
      );
      checkTarget(credit.invoiceKey, credit.amount);
    }
  }
  for (const type of REQUIRED_PAYMENT_TYPES) {
    if (!seenTypes.has(type)) fail(`accounting.payments: no "${type}" payment`);
  }
  for (const [key, consumed] of memoConsumed) {
    const memo = memos.get(key);
    if (memo && cents(consumed) > cents(memo.amount)) {
      fail(
        `accounting.memos "${key}": applied ${consumed} exceeds its amount ${memo.amount}`
      );
    }
  }
  // The invoice views derive status from settlements, so the authored status
  // and the settled total must agree.
  for (const sales of [true, false]) {
    for (const [key, invoice] of invoiceIn(sales)) {
      const label = invoiceLabel(sales, key);
      const paid = cents(settled.get(label) ?? 0);
      const total = cents(invoice.total);
      if (paid > total) {
        fail(
          `accounting: ${label} is over-settled (${paid / 100} of ${invoice.total})`
        );
      }
      const fullyCredited =
        invoice.status === "Credit Note Issued" ||
        invoice.status === "Debit Note Issued";
      if ((invoice.status === "Paid" || fullyCredited) && paid !== total) {
        fail(
          `accounting: ${label} is ${invoice.status} but settled ${paid / 100} of ${invoice.total}`
        );
      } else if (invoice.status === "Partially Paid") {
        if (paid <= 0 || paid >= total) {
          fail(
            `accounting: ${label} is Partially Paid but settled ${paid / 100} of ${invoice.total}`
          );
        }
        if ((partialDates.get(label) ?? []).some((d) => d >= 0)) {
          fail(`accounting: ${label}'s partial payment must predate today`);
        }
      } else if (invoice.status !== "Paid" && !fullyCredited && paid !== 0) {
        fail(
          `accounting: ${label} is ${invoice.status} yet carries settlements (the view would re-derive its status)`
        );
      }
    }
  }

  // ── Period close checklist ─────────────────────────────────────────────────
  const seenTaskStatus = new Set<string>();
  const taskDefinitions = new Set<string>();
  for (const task of a.closeTasks) {
    const where = `accounting.closeTasks "${task.definition}"`;
    if (!CLOSE_TASK_DEFINITION_NAMES.has(task.definition))
      fail(`${where}: not a bootstrap periodCloseTaskDefinition`);
    if (taskDefinitions.has(task.definition))
      fail(`${where}: duplicate (unique per period + definition)`);
    taskDefinitions.add(task.definition);
    seenTaskStatus.add(task.status);
    if ((task.status === "Skipped") !== Boolean(task.skippedReason)) {
      fail(`${where}: skippedReason is required exactly when Skipped`);
    }
  }
  for (const status of REQUIRED_PERIOD_CLOSE_TASK_STATUSES) {
    if (!seenTaskStatus.has(status))
      fail(`accounting.closeTasks: no "${status}" task`);
  }

  // ── Exchange-rate overrides ────────────────────────────────────────────────
  const eurPo = dataset.purchasing.purchaseOrders.find(
    (p) => p.source === "direct" && p.currencyCode === "EUR"
  );
  const overrideCodes = new Set<string>();
  for (const override of a.exchangeRateOverrides) {
    const where = `accounting.exchangeRateOverrides "${override.currencyCode}"`;
    if (overrideCodes.has(override.currencyCode))
      fail(`${where}: duplicate (unique per company + currency)`);
    overrideCodes.add(override.currencyCode);
    if (override.currencyCode === "USD")
      fail(`${where}: the base currency needs no rate`);
    if (!(override.rate > 0)) fail(`${where}: rate must be positive`);
    const poRate =
      eurPo?.source === "direct" && override.currencyCode === "EUR"
        ? eurPo.exchangeRate
        : undefined;
    // Same direction as the document snapshot (foreign units per base unit):
    // an inverted rate would be ~1/rate, far outside this band.
    if (poRate !== undefined && Math.abs(override.rate / poRate - 1) > 0.05) {
      fail(
        `${where}: rate ${override.rate} disagrees with the EUR order's ${poRate}`
      );
    }
    // Rates are units of the foreign currency per 1 USD, and a euro is worth
    // more than a dollar — so a EUR rate at or above 1 is the inverted
    // (USD-per-EUR) quote, which halves-and-doubles every converted amount.
    if (
      override.currencyCode === "EUR" &&
      !(override.rate > 0.5 && override.rate < 1)
    ) {
      fail(
        `${where}: rate ${override.rate} is not EUR per 1 USD (expected ~0.9 — is it inverted?)`
      );
    }
  }
  if (
    eurPo?.source === "direct" &&
    eurPo.exchangeRate !== undefined &&
    !(eurPo.exchangeRate > 0.5 && eurPo.exchangeRate < 1)
  ) {
    fail(
      `purchasing EUR order: exchangeRate ${eurPo.exchangeRate} is not EUR per 1 USD (expected ~0.9 — is it inverted?)`
    );
  }
  if (!overrideCodes.has("EUR")) {
    fail("accounting.exchangeRateOverrides: no EUR rate for the FX showcase");
  }

  // ── Fixed assets ───────────────────────────────────────────────────────────
  const seenAssetStatus = new Set<string>();
  for (const asset of a.fixedAssets) {
    const where = `accounting.fixedAssets "${asset.key}"`;
    registerRef("accounting.fixedAssets", `fixedAsset:${asset.key}`);
    seenAssetStatus.add(asset.status);
    const base = asset.acquisitionCost * (1 - asset.residualValuePercent / 100);
    if (asset.accumulatedDepreciation > base + 0.005) {
      fail(
        `${where}: accumulatedDepreciation exceeds the depreciable base ${base}`
      );
    }
    if (asset.depreciationCharge !== undefined && asset.status !== "Active") {
      fail(`${where}: only Active assets are in the depreciation run`);
    }
    if ((asset.status === "Disposed") !== (asset.disposal !== undefined)) {
      fail(`${where}: a disposal is required exactly when status is Disposed`);
    }
    if (asset.disposal) {
      const d = asset.disposal;
      if (
        asset.acquisitionOffset === null ||
        d.dateOffset < asset.acquisitionOffset ||
        d.dateOffset > 0 ||
        d.dateOffset < OPEN_PERIOD_MIN_OFFSET
      ) {
        fail(
          `${where}: disposal dateOffset ${d.dateOffset} must fall between acquisition and today`
        );
      }
      if (d.saleProceeds < 0) fail(`${where}: negative sale proceeds`);
    }
    const uop = asset.depreciationMethod === "Units of Production";
    if (uop !== (asset.assetLifetimeUsage !== undefined)) {
      fail(
        `${where}: assetLifetimeUsage is required exactly for Units of Production`
      );
    }
    if (asset.usageLogs && !uop) {
      fail(`${where}: usage logs belong to Units of Production assets`);
    }
    const months = new Set<number>();
    for (const log of asset.usageLogs ?? []) {
      if (log.monthsBack < 1 || months.has(log.monthsBack)) {
        fail(
          `${where}: usage log monthsBack ${log.monthsBack} must be ≥ 1 and unique`
        );
      }
      months.add(log.monthsBack);
      // Month anchor−m starts no earlier than −(30 + 31m).
      if (
        asset.depreciationStartOffset === null ||
        asset.depreciationStartOffset > -(30 + 31 * log.monthsBack)
      ) {
        fail(
          `${where}: usage log ${log.monthsBack} month(s) back predates depreciation start`
        );
      }
      if (log.unitsProduced <= 0) fail(`${where}: non-positive unitsProduced`);
    }
    if (uop && asset.assetLifetimeUsage) {
      // buildDepreciationLines: min(round(base / lifetime × units), remaining),
      // from the log whose periodEnd is the run's (monthsBack 1).
      const runLog = asset.usageLogs?.find((l) => l.monthsBack === 1);
      const expected = runLog
        ? Math.min(
            cents((base / asset.assetLifetimeUsage) * runLog.unitsProduced),
            cents(base - asset.accumulatedDepreciation)
          )
        : 0;
      const charge = cents(asset.depreciationCharge ?? 0);
      if (charge !== expected) {
        fail(
          `${where}: depreciationCharge ${asset.depreciationCharge ?? 0} but the app computes ${expected / 100}`
        );
      }
    }
  }
  for (const status of REQUIRED_FIXED_ASSET_STATUSES) {
    if (!seenAssetStatus.has(status))
      fail(`accounting.fixedAssets: no "${status}" asset`);
  }
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

/** Seconds since midnight for a UTC "HH:MM:SS", or null when malformed. */
function secondsOfDay(time: string): number | null {
  if (!TIME_OF_DAY.test(time)) return null;
  const [h, m, sec] = time.split(":").map(Number);
  return h! * 3600 + m! * 60 + sec!;
}

/** A comparable ordinal for an InstantSpec (malformed times sort as midnight). */
function instantOrdinal(instant: InstantSpec): number {
  return instant.offset * 86_400 + (secondsOfDay(instant.time) ?? 0);
}

/** Spare-part drains are checked in validateDataset's net on-hand pass. */
function validateOps(
  dataset: Dataset,
  fail: (message: string) => void,
  refs: {
    needItem: (where: string, id: string) => void;
    workCenters: Set<string>;
    ncrRefs: Set<string>;
    documentRefs: Set<string>;
  }
): void {
  const ops = dataset.ops;
  const { needItem, workCenters, ncrRefs, documentRefs } = refs;

  const checkInstant = (where: string, instant: InstantSpec) => {
    if (secondsOfDay(instant.time) === null) {
      fail(`${where}: time "${instant.time}" is not a UTC "HH:MM:SS"`);
    }
  };

  // ── Maintenance schedules ──────────────────────────────────────────────────
  if (ops.maintenanceSchedules.length < MIN_MAINTENANCE_SCHEDULES) {
    fail(
      `ops.maintenanceSchedules: ${ops.maintenanceSchedules.length} schedules — every dataset needs at least ${MIN_MAINTENANCE_SCHEDULES}`
    );
  }
  const scheduleWorkCenter = new Map<string, string>();
  const frequencies = new Set<string>();
  for (const schedule of ops.maintenanceSchedules) {
    const where = `ops.maintenanceSchedules "${schedule.key}"`;
    if (scheduleWorkCenter.has(schedule.key)) {
      fail(`${where}: duplicate schedule key`);
    }
    scheduleWorkCenter.set(schedule.key, schedule.workCenter);
    frequencies.add(schedule.frequency);
    if (!workCenters.has(schedule.workCenter)) {
      fail(`${where}: unknown work center "${schedule.workCenter}"`);
    }
    if (schedule.estimatedDuration <= 0) {
      fail(`${where}: estimatedDuration must be positive`);
    }
    if (schedule.nextDueOffset < 0) {
      fail(`${where}: nextDueOffset ${schedule.nextDueOffset} is in the past`);
    }
    if (schedule.weekends !== undefined && schedule.frequency !== "Daily") {
      fail(`${where}: weekends applies to Daily schedules only`);
    }
    for (const part of schedule.spareParts ?? []) {
      needItem(`${where} spare part`, part.item);
      if (part.quantity <= 0) {
        fail(`${where} spare part "${part.item}": quantity must be positive`);
      }
    }
  }
  if (ops.maintenanceSchedules.length > 0 && frequencies.size < 3) {
    fail(
      `ops.maintenanceSchedules: only ${frequencies.size} distinct frequencies — spread them over at least 3`
    );
  }

  // ── Maintenance dispatches ─────────────────────────────────────────────────
  const seenDispatch = {
    status: new Set<string>(),
    severity: new Set<string>(),
    source: new Set<string>(),
    oeeImpact: new Set<string>()
  };
  const dispatchKeys = new Set<string>();
  for (const dispatch of ops.maintenanceDispatches) {
    const where = `ops.maintenanceDispatches "${dispatch.key}"`;
    if (dispatchKeys.has(dispatch.key))
      fail(`${where}: duplicate dispatch key`);
    dispatchKeys.add(dispatch.key);
    seenDispatch.status.add(dispatch.status);
    seenDispatch.severity.add(dispatch.severity);
    seenDispatch.source.add(dispatch.source);
    seenDispatch.oeeImpact.add(dispatch.oeeImpact);

    if (!workCenters.has(dispatch.workCenter)) {
      fail(`${where}: unknown work center "${dispatch.workCenter}"`);
    }
    if (
      (dispatch.source === "Scheduled") !==
      (dispatch.schedule !== undefined)
    ) {
      fail(`${where}: a schedule is required exactly when source is Scheduled`);
    }
    if (dispatch.schedule !== undefined) {
      const scheduleWc = scheduleWorkCenter.get(dispatch.schedule);
      if (scheduleWc === undefined) {
        fail(`${where}: unknown maintenance schedule "${dispatch.schedule}"`);
      } else if (scheduleWc !== dispatch.workCenter) {
        fail(
          `${where}: schedule "${dispatch.schedule}" is on "${scheduleWc}", not "${dispatch.workCenter}"`
        );
      }
    }
    if (
      (dispatch.source === "Non-Conformance") !==
      (dispatch.nonConformance !== undefined)
    ) {
      fail(
        `${where}: a nonConformance is required exactly when source is Non-Conformance`
      );
    }
    if (
      dispatch.nonConformance !== undefined &&
      !ncrRefs.has(dispatch.nonConformance)
    ) {
      fail(`${where}: unknown NCR ref "${dispatch.nonConformance}"`);
    }
    for (const mode of [
      dispatch.suspectedFailureMode,
      dispatch.actualFailureMode
    ]) {
      if (mode !== undefined && !FAILURE_MODE_NAMES.has(mode)) {
        fail(`${where}: "${mode}" is not a bootstrap maintenanceFailureMode`);
      }
    }
    const started =
      dispatch.status === "In Progress" || dispatch.status === "Completed";
    const completed = dispatch.status === "Completed";
    if (started !== (dispatch.actualStart !== undefined)) {
      fail(
        `${where}: actualStart is required exactly when status is In Progress or Completed`
      );
    }
    if (completed !== (dispatch.actualEnd !== undefined)) {
      fail(`${where}: actualEnd is required exactly when status is Completed`);
    }
    if (!completed && dispatch.actualFailureMode !== undefined) {
      fail(
        `${where}: actualFailureMode is recorded on Completed dispatches only`
      );
    }
    if (!completed && (dispatch.spareParts ?? []).length > 0) {
      fail(`${where}: spare parts are issued on Completed dispatches only`);
    }

    for (const [label, instant] of [
      ["created", dispatch.created],
      ["plannedStart", dispatch.plannedStart],
      ["plannedEnd", dispatch.plannedEnd],
      ["actualStart", dispatch.actualStart],
      ["actualEnd", dispatch.actualEnd]
    ] as const) {
      if (instant) checkInstant(`${where} ${label}`, instant);
    }
    if (dispatch.created.offset >= 0) {
      fail(`${where}: created must be in the past`);
    }
    if (
      instantOrdinal(dispatch.plannedEnd) <=
      instantOrdinal(dispatch.plannedStart)
    ) {
      fail(`${where}: plannedEnd must be after plannedStart`);
    }
    if (dispatch.actualStart) {
      if (dispatch.actualStart.offset >= 0) {
        fail(`${where}: actualStart must be in the past`);
      }
      if (
        instantOrdinal(dispatch.actualStart) < instantOrdinal(dispatch.created)
      ) {
        fail(`${where}: actualStart before the request was created`);
      }
      if (
        dispatch.actualEnd &&
        instantOrdinal(dispatch.actualEnd) <=
          instantOrdinal(dispatch.actualStart)
      ) {
        fail(`${where}: actualEnd must be after actualStart`);
      }
    }
  }
  for (const [label, required, seen] of [
    ["status", REQUIRED_DISPATCH_STATUSES, seenDispatch.status],
    ["severity", REQUIRED_DISPATCH_SEVERITIES, seenDispatch.severity],
    ["source", REQUIRED_DISPATCH_SOURCES, seenDispatch.source],
    ["oeeImpact", REQUIRED_OEE_IMPACTS, seenDispatch.oeeImpact]
  ] as const) {
    for (const value of required) {
      if (!seen.has(value)) {
        fail(
          `ops matrix: no maintenance dispatch with ${label} "${value}" — every dataset must exhibit the full required set`
        );
      }
    }
  }

  // ── Trainings ──────────────────────────────────────────────────────────────
  const trainingNames = new Set<string>();
  const trainingStatuses = new Set<string>();
  let fullyCovered = false;
  let completedAssignments = 0;
  let pendingAssignments = 0;
  for (const training of ops.trainings) {
    const where = `ops.trainings "${training.name}"`;
    if (trainingNames.has(training.name)) fail(`${where}: duplicate name`);
    trainingNames.add(training.name);
    trainingStatuses.add(training.status);
    if (training.questions.length === 0) fail(`${where}: no questions`);

    const types = new Set<string>();
    training.questions.forEach((q, index) => {
      const qWhere = `${where} question ${index + 1}`;
      types.add(q.type);
      switch (q.type) {
        case "MultipleChoice":
          if (!q.options.includes(q.correct)) {
            fail(`${qWhere}: correct answer "${q.correct}" is not an option`);
          }
          break;
        case "MultipleAnswers":
          if (q.correct.length === 0) fail(`${qWhere}: no correct answers`);
          for (const answer of q.correct) {
            if (!q.options.includes(answer)) {
              fail(`${qWhere}: correct answer "${answer}" is not an option`);
            }
          }
          break;
        case "MatchingPairs":
          if (q.pairs.length < 2) fail(`${qWhere}: needs at least 2 pairs`);
          break;
        case "Numerical":
          if (q.tolerance !== undefined && q.tolerance < 0) {
            fail(`${qWhere}: tolerance must not be negative`);
          }
          break;
        case "TrueFalse":
          break;
      }
      if (
        (q.type === "MultipleChoice" || q.type === "MultipleAnswers") &&
        new Set(q.options).size !== q.options.length
      ) {
        fail(`${qWhere}: duplicate options`);
      }
    });
    if (
      training.status === "Active" &&
      REQUIRED_TRAINING_QUESTION_TYPES.every((t) => types.has(t))
    ) {
      fullyCovered = true;
    }

    if (training.assignment) {
      if (training.status !== "Active") {
        fail(
          `${where}: only Active trainings are assigned (the status RPC ignores the rest)`
        );
      }
      const { completedOffset } = training.assignment;
      if (completedOffset === undefined) {
        pendingAssignments++;
      } else {
        completedAssignments++;
        if (training.frequency !== "Once") {
          fail(
            `${where}: a completion needs a "Once" training — a recurring one only counts in the current period`
          );
        }
        if (completedOffset >= 0) {
          fail(`${where}: completedOffset must be in the past`);
        }
      }
    }
  }
  for (const status of REQUIRED_TRAINING_STATUSES) {
    if (!trainingStatuses.has(status)) {
      fail(
        `ops matrix: no training with status "${status}" — every dataset must exhibit the full required set`
      );
    }
  }
  if (!fullyCovered) {
    fail(
      `ops matrix: no Active training covers every trainingQuestionType (${REQUIRED_TRAINING_QUESTION_TYPES.join(", ")})`
    );
  }
  if (completedAssignments === 0 || pendingAssignments === 0) {
    fail(
      "ops matrix: training assignments must include at least one Completed and one Pending"
    );
  }

  // ── Time clock: closed entries over the past week, never overlapping ──────
  if (ops.timecards.length < MIN_TIMECARDS) {
    fail(
      `ops.timecards: ${ops.timecards.length} entries — every dataset needs at least ${MIN_TIMECARDS}`
    );
  }
  const spans: { where: string; start: number; end: number }[] = [];
  ops.timecards.forEach((card, index) => {
    const where = `ops.timecards[${index}]`;
    if (card.dayOffset > -1 || card.dayOffset < -7) {
      fail(
        `${where}: dayOffset ${card.dayOffset} is outside the past week (-7…-1)`
      );
    }
    const clockIn = secondsOfDay(card.clockIn);
    const clockOut = secondsOfDay(card.clockOut);
    if (clockIn === null || clockOut === null) {
      fail(`${where}: clockIn/clockOut must be UTC "HH:MM:SS"`);
      return;
    }
    if (clockOut <= clockIn) fail(`${where}: clockOut must be after clockIn`);
    const day = card.dayOffset * 86_400;
    spans.push({ where, start: day + clockIn, end: day + clockOut });
  });
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.start < spans[i - 1]!.end) {
      fail(`${spans[i]!.where}: overlaps ${spans[i - 1]!.where}`);
    }
  }

  // ── Suggestions and person notes ───────────────────────────────────────────
  if (ops.suggestions.length < 2) {
    fail("ops.suggestions: every dataset needs at least 2");
  }
  ops.suggestions.forEach((suggestion, index) => {
    const where = `ops.suggestions[${index}]`;
    if (suggestion.suggestion.trim() === "") fail(`${where}: empty text`);
    if (!suggestion.path.startsWith("/x/")) {
      fail(`${where}: path "${suggestion.path}" is not an ERP page (/x/…)`);
    }
  });
  if (ops.notes.length < 2) fail("ops.notes: every dataset needs at least 2");
  ops.notes.forEach((note, index) => {
    if (note.text.trim() === "") fail(`ops.notes[${index}]: empty text`);
  });

  // ── Workflow run history ───────────────────────────────────────────────────
  // The definitions are a factory over ids the seed mints; placeholders are
  // enough to read their names, node ids and trigger events.
  const published = new Map(
    dataset.workflows
      .build({ ownerId: "validate:owner", issueTypeId: "validate:issueType" })
      .filter((workflow) => workflow.published)
      .map((workflow) => [workflow.name, workflow] as const)
  );
  const orderDates = new Map<string, number>();
  for (const spec of [
    ...dataset.sales.opportunities,
    ...dataset.sales.releasedOrders
  ]) {
    if (spec.order) orderDates.set(spec.order.ref, spec.order.orderDateOffset);
  }
  for (const spec of dataset.sales.statusOrders) {
    orderDates.set(`so:${spec.key}`, spec.orderDateOffset);
  }

  const runStatuses = new Set<string>();
  dataset.workflows.runs.forEach((run, index) => {
    const where = `workflows.runs[${index}] (${run.status})`;
    runStatuses.add(run.status);
    checkInstant(where, run.at);
    if (run.at.offset >= 0) fail(`${where}: at must be in the past`);

    const workflow = published.get(run.workflow);
    if (!workflow) {
      fail(`${where}: "${run.workflow}" is not a published seed workflow`);
      return;
    }
    const trigger = workflow.nodes.find((node) => node.type === "trigger");
    const event = (trigger?.data.events as string[] | undefined)?.[0];
    if (!trigger || !event) {
      fail(`${where}: workflow "${run.workflow}" has no trigger event`);
    }
    if (event?.startsWith("salesOrder.")) {
      const orderDate = orderDates.get(run.triggerRef);
      if (orderDate === undefined) {
        fail(`${where}: triggerRef "${run.triggerRef}" is not a sales order`);
      } else if (run.at.offset < orderDate) {
        fail(
          `${where}: fired at offset ${run.at.offset}, before its order was placed (${orderDate})`
        );
      }
    } else if (!documentRefs.has(run.triggerRef)) {
      fail(`${where}: unknown triggerRef "${run.triggerRef}"`);
    }

    const actionNodeIds = new Set(
      workflow.nodes
        .filter((node) => node.type !== "trigger")
        .map((node) => node.id)
    );
    for (const step of run.steps) {
      if (!actionNodeIds.has(step.nodeId)) {
        fail(
          `${where}: step nodeId "${step.nodeId}" is not an action node of "${run.workflow}"`
        );
      }
      if ((step.status === "Failed") !== (step.error !== undefined)) {
        fail(
          `${where} step "${step.nodeId}": an error is required exactly when the step Failed`
        );
      }
    }
    const skipped = run.status === "Skipped";
    if (skipped !== (run.steps.length === 0)) {
      fail(
        `${where}: a Skipped run settles at load with no steps; every other run walks at least one`
      );
    }
    if (skipped !== (run.statusReason !== undefined)) {
      fail(
        `${where}: statusReason is required exactly when the run is Skipped`
      );
    }
    const anyFailed = run.steps.some((step) => step.status === "Failed");
    if (run.status === "Failed" && !anyFailed) {
      fail(`${where}: a Failed run needs a Failed step`);
    }
    if (run.status === "Succeeded" && anyFailed) {
      fail(`${where}: a Succeeded run cannot contain a Failed step`);
    }
  });
  for (const status of REQUIRED_WORKFLOW_RUN_STATUSES) {
    if (!runStatuses.has(status)) {
      fail(
        `workflow run matrix: no run with status "${status}" — every dataset must exhibit the full required set`
      );
    }
  }
}
