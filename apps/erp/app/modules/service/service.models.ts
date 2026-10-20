// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Field service: customer assets, service orders and visits.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md

import type { Database } from "@carbon/database";
import { equals, round } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { projectElementPriorities } from "../projects/projects.models";
import { optionalTiptapDoc } from "../shared/shared.models";

type Enums = Database["public"]["Enums"];

export type CustomerAssetStatus = Enums["customerAssetStatus"];
export type ServiceOrderStatus = Enums["serviceOrderStatus"];
export type ServiceOrderType = Enums["serviceOrderType"];
export type ServiceVisitStatus = Enums["serviceVisitStatus"];
export type ServiceCoverage = Enums["serviceCoverage"];
export type ServiceInvoiceDetail = Enums["serviceInvoiceDetail"];
export type ProjectBillableItemStatus = Enums["projectBillableItemStatus"];

export const customerAssetStatuses = [
  "In Service",
  "At Depot",
  "Returned"
] as const satisfies readonly CustomerAssetStatus[];

export const serviceOrderStatuses = [
  "Draft",
  "Planned",
  "Scheduled",
  "In Progress",
  "On Hold",
  "Completed",
  "Closed",
  "Cancelled"
] as const satisfies readonly ServiceOrderStatus[];

/** The statuses a user sets; the roll-up never changes them. */
export const userSetServiceOrderStatuses = [
  "On Hold",
  "Completed",
  "Closed",
  "Cancelled"
] as const satisfies readonly ServiceOrderStatus[];

/** An order in one of these statuses is not open. */
export const closedServiceOrderStatuses = [
  "Closed",
  "Cancelled"
] as const satisfies readonly ServiceOrderStatus[];

export const serviceVisitStatuses = [
  "Scheduled",
  "Traveling",
  "On Site",
  "Completed",
  "Cancelled"
] as const satisfies readonly ServiceVisitStatus[];

export const serviceCoverages = [
  "Warranty",
  "Contract",
  "Billable",
  "Capitalized"
] as const satisfies readonly ServiceCoverage[];

export const serviceInvoiceDetails = [
  "Itemized",
  "By Node"
] as const satisfies readonly ServiceInvoiceDetail[];

/**
 * The types the New form creates: a field visit to a unit at a customer, or
 * the refurbishment of a serial the company holds in stock.
 */
export const serviceOrderTypes = [
  "Field Visit",
  "Refurbishment"
] as const satisfies readonly ServiceOrderType[];

/**
 * The types the order list filters by. A Depot Repair order is created by
 * the receipt of an RMA's Repair line, never by the New form.
 */
export const listedServiceOrderTypes = [
  "Field Visit",
  "Depot Repair",
  "Refurbishment"
] as const satisfies readonly ServiceOrderType[];

/**
 * The statuses that need attention first, in order. The worst status of
 * several orders is the first one of this list any of them has.
 */
const serviceOrderStatusUrgency = [
  "On Hold",
  "Draft",
  "Planned",
  "Scheduled",
  "In Progress",
  "Completed",
  "Closed",
  "Cancelled"
] as const satisfies readonly ServiceOrderStatus[];

/**
 * The status of several orders that needs attention first: On Hold, then the
 * least advanced open status, then Completed, Closed and Cancelled. Null for
 * no orders.
 */
export function worstServiceOrderStatus(
  statuses: readonly ServiceOrderStatus[]
): ServiceOrderStatus | null {
  return (
    serviceOrderStatusUrgency.find((status) => statuses.includes(status)) ??
    null
  );
}

/**
 * Where a new order's work tree comes from: nothing, a service template, the
 * unit's build history (its serial) or the item's bill of materials.
 */
export const serviceOrderStartFrom = [
  "Empty",
  "Template",
  "Serial",
  "Item"
] as const;
export type ServiceOrderStartFrom = (typeof serviceOrderStartFrom)[number];

export const warrantyStatuses = [
  "In warranty",
  "Labor ended",
  "Expired"
] as const;
export type WarrantyStatus = (typeof warrantyStatuses)[number];

/**
 * The warranty of a customer asset on a day (`YYYY-MM-DD`; date strings
 * compare in calendar order). In warranty while the labor warranty runs,
 * Labor ended while only the parts warranty runs, else Expired.
 */
export function warrantyStatus(
  asset: {
    laborWarrantyEndDate: string | null;
    partsWarrantyEndDate: string | null;
  },
  today: string
): WarrantyStatus {
  if (asset.laborWarrantyEndDate && asset.laborWarrantyEndDate >= today) {
    return "In warranty";
  }
  if (asset.partsWarrantyEndDate && asset.partsWarrantyEndDate >= today) {
    return "Labor ended";
  }
  return "Expired";
}

type SiteAddress = {
  addressLine1: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
} | null;

/** One line of a site's address, or null when it has none. */
export function formatSiteAddress(address: SiteAddress | undefined) {
  if (!address) return null;
  const region = [address.stateProvince, address.postalCode]
    .filter(Boolean)
    .join(" ");
  const line = [address.addressLine1, address.city, region]
    .filter(Boolean)
    .join(", ");
  return line || null;
}

/** A link that opens the address in the phone's maps app. */
export function mapUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * The status an order rolls up to from its visits (spec, *Lifecycle*). A
 * status the user set (On Hold, Completed, Closed, Cancelled) stays. Work
 * marked complete gives Completed. A visit on its way or on site, or a
 * completed visit with the work not complete, gives In Progress. A
 * scheduled visit with none started gives Scheduled. With no live visit, a
 * Draft order stays Draft and any other order is Planned: once released, an
 * order never returns to Draft. Cancelled visits do not count.
 */
export function rollUpOrderStatus(
  order: { status: ServiceOrderStatus; workComplete?: boolean },
  visits: { status: ServiceVisitStatus }[]
): ServiceOrderStatus {
  if ((userSetServiceOrderStatuses as readonly string[]).includes(order.status))
    return order.status;
  if (order.workComplete) return "Completed";

  const live = visits.filter((visit) => visit.status !== "Cancelled");
  if (
    live.some(
      (visit) =>
        visit.status === "Traveling" ||
        visit.status === "On Site" ||
        visit.status === "Completed"
    )
  ) {
    return "In Progress";
  }
  if (live.some((visit) => visit.status === "Scheduled")) return "Scheduled";
  return order.status === "Draft" ? "Draft" : "Planned";
}

/** The statuses a user moves an order to from the order page. */
export const serviceOrderStatusActions = [
  "Planned",
  "On Hold",
  "Completed",
  "Closed",
  "Cancelled"
] as const satisfies readonly ServiceOrderStatus[];
export type ServiceOrderStatusAction =
  (typeof serviceOrderStatusActions)[number];

/**
 * Whether a user may move an order from `from` to `to` (spec, *Lifecycle*).
 * A Draft order is planned: its Service project is released, so its parts
 * become MRP demand and it takes charges. An open order (Draft, Planned,
 * Scheduled, In Progress) can be put on hold, completed or cancelled. An
 * order on hold resumes (Planned, so its visits decide again) or is
 * cancelled. A completed order closes or reopens (Planned). Closed and
 * Cancelled are final.
 */
export function canMoveServiceOrder(
  from: ServiceOrderStatus,
  to: ServiceOrderStatusAction
): boolean {
  switch (from) {
    case "Draft":
      return (
        to === "Planned" ||
        to === "On Hold" ||
        to === "Completed" ||
        to === "Cancelled"
      );
    case "Planned":
    case "Scheduled":
    case "In Progress":
      return to === "On Hold" || to === "Completed" || to === "Cancelled";
    case "On Hold":
      return to === "Planned" || to === "Cancelled";
    case "Completed":
      return to === "Closed" || to === "Planned";
    default:
      return false;
  }
}

/**
 * Whether a visit may move from `from` to `to`: a scheduled visit starts
 * travel or arrives, a traveling visit arrives, a visit on site completes,
 * and any visit not yet done can be cancelled.
 */
export function canMoveVisit(
  from: ServiceVisitStatus,
  to: ServiceVisitStatus
): boolean {
  switch (from) {
    case "Scheduled":
      return to === "Traveling" || to === "On Site" || to === "Cancelled";
    case "Traveling":
      return to === "On Site" || to === "Cancelled";
    case "On Site":
      return to === "Completed" || to === "Cancelled";
    default:
      return false;
  }
}

const optionalDate = zfd.text(
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Enter a date" })
    .optional()
);

/** Registers a unit sold before Carbon: the item, its serial and owner. */
export const customerAssetValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item is required" }),
    serialNumber: z.string().trim().min(1, { message: "Serial is required" }),
    customerId: z.string().min(1, { message: "Customer is required" }),
    customerLocationId: zfd.text(z.string().optional()),
    shippedDate: optionalDate,
    laborWarrantyEndDate: optionalDate,
    partsWarrantyEndDate: optionalDate,
    notes: optionalTiptapDoc
  })
  .refine(
    (data) =>
      !data.laborWarrantyEndDate ||
      !data.shippedDate ||
      data.laborWarrantyEndDate >= data.shippedDate,
    {
      message: "The labor warranty cannot end before the ship date",
      path: ["laborWarrantyEndDate"]
    }
  )
  .refine(
    (data) =>
      !data.partsWarrantyEndDate ||
      !data.shippedDate ||
      data.partsWarrantyEndDate >= data.shippedDate,
    {
      message: "The parts warranty cannot end before the ship date",
      path: ["partsWarrantyEndDate"]
    }
  );

/** The fields of an asset a service manager edits: site, warranty, notes. */
export const customerAssetUpdateValidator = z.object({
  id: z.string().min(1, { message: "Asset is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  laborWarrantyEndDate: optionalDate,
  partsWarrantyEndDate: optionalDate,
  notes: optionalTiptapDoc
});

export const serviceOrderValidator = z
  .object({
    type: z.enum(serviceOrderTypes, { error: "Type is required" }),
    // A field visit's subject is a customer asset; a refurbishment's is a
    // stock serial of the chosen item.
    customerAssetId: zfd.text(z.string().optional()),
    itemId: zfd.text(z.string().optional()),
    trackedEntityId: zfd.text(z.string().optional()),
    customerContactId: zfd.text(z.string().optional()),
    locationId: z.string().min(1, { message: "Location is required" }),
    customerContractId: zfd.text(z.string().optional()),
    priority: zfd.text(z.enum(projectElementPriorities).optional()),
    problem: optionalTiptapDoc,
    startFrom: z.enum(serviceOrderStartFrom).default("Empty"),
    serviceTemplateId: zfd.text(z.string().optional())
  })
  .refine((data) => data.startFrom !== "Template" || !!data.serviceTemplateId, {
    message: "Template is required",
    path: ["serviceTemplateId"]
  })
  .refine((data) => data.type !== "Field Visit" || !!data.customerAssetId, {
    message: "Unit is required",
    path: ["customerAssetId"]
  })
  .refine((data) => data.type !== "Refurbishment" || !!data.trackedEntityId, {
    message: "Serial is required",
    path: ["trackedEntityId"]
  });

/** The Draft fields of an order and its texts, saved from the order page. */
export const serviceOrderUpdateValidator = z.object({
  id: z.string().min(1, { message: "Service order is required" }),
  customerContactId: zfd.text(z.string().optional()),
  customerLocationId: zfd.text(z.string().optional()),
  customerContractId: zfd.text(z.string().optional()),
  priority: zfd.text(z.enum(projectElementPriorities).optional()),
  assignee: zfd.text(z.string().optional()),
  invoiceDetail: zfd.text(z.enum(serviceInvoiceDetails).optional()),
  // Refurbishment only: the cap on the serial's cost, and whether the work
  // is abnormal rework (material variance, never the unit's cost).
  expectedSellingPrice: zfd.numeric(z.number().min(0).optional()),
  abnormalRework: zfd.text(z.enum(["true", "false"]).optional()),
  problem: optionalTiptapDoc,
  resolution: optionalTiptapDoc
});

export const serviceVisitValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    serviceOrderId: z.string().min(1, { message: "Service order is required" }),
    technicianId: z.string().min(1, { message: "Technician is required" }),
    plannedStart: zfd.text(z.string().optional()),
    plannedEnd: zfd.text(z.string().optional())
  })
  .refine(
    (data) =>
      !data.plannedStart ||
      !data.plannedEnd ||
      data.plannedEnd >= data.plannedStart,
    {
      message: "The end cannot be before the start",
      path: ["plannedEnd"]
    }
  );

export const serviceVisitStatusValidator = z.object({
  status: z.enum(serviceVisitStatuses, { error: "Status is required" }),
  /** Asked when a visit completes: is the order's work done? */
  workComplete: zfd.checkbox()
});

/** A user's coverage for a charge, which always needs a reason. */
export const coverageOverrideValidator = z.object({
  coverage: z.enum(serviceCoverages, { error: "Coverage is required" }),
  reason: z.string().trim().min(1, { message: "A reason is required" })
});

/** A reversal of one posted time or expense charge. The reason is required. */
export const serviceChargeReversalValidator = z.object({
  projectLedgerId: z.string().min(1, { message: "Charge is required" }),
  reason: z.string().trim().min(1, { message: "A reason is required" })
});

/** A review of one unbilled item: its price, a hold, or a write-off. */
export const serviceBillableItemValidator = z
  .object({
    id: z.string().min(1, { message: "Item is required" }),
    unitPrice: zfd.numeric(
      z.number().min(0, { message: "The price cannot be negative" }).optional()
    ),
    status: zfd.text(
      z.enum(["Unbilled", "On Hold", "Written Off"] as const).optional()
    ),
    statusReason: zfd.text(z.string().trim().optional())
  })
  .refine((data) => data.status !== "Written Off" || !!data.statusReason, {
    message: "A reason is required to write off an item",
    path: ["statusReason"]
  });

/** A node's fixed price; an empty value removes it. */
export const serviceNodeFixedPriceValidator = z.object({
  fixedPrice: zfd.numeric(
    z.number().min(0, { message: "The price cannot be negative" }).optional()
  )
});

/** A service template: a named work tree with plan lines to start from. */
export const serviceTemplateValidator = z.object({
  name: z.string().trim().min(1, { message: "Name is required" })
});

/**
 * A template's identifier: `TPL-` and the first 6 characters of its id after
 * the prefix, in capitals, so its nodes read `TPL-4F9A2C-3`.
 */
export function serviceTemplateIdentifier(projectId: string): string {
  const body = projectId.includes("_")
    ? projectId.slice(projectId.indexOf("_") + 1)
    : projectId;
  return `TPL-${body.slice(0, 6).toUpperCase()}`;
}

// --- Work --------------------------------------------------------------------

/** The node types a service order's work tree offers (no engineering types). */
export const serviceNodeTypes = ["System", "Task"] as const;
export type ServiceNodeType = (typeof serviceNodeTypes)[number];

/** An expense charged to a node: mileage, a meal, a part bought on a card. */
export const serviceExpenseValidator = z.object({
  projectElementId: zfd.text(z.string().optional()),
  serviceVisitId: zfd.text(z.string().optional()),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Date is required" }),
  description: z.string().trim().min(1, { message: "Description is required" }),
  amount: zfd.numeric(
    z.number().gt(0, { message: "The amount must be greater than 0" })
  )
});

/**
 * The nodes of a work tree in tree order (children by sort order), each with
 * its depth. A node whose parent is not in the list is a root; a cycle stops
 * the walk.
 */
export function inTreeOrder<
  T extends { id: string; parentId: string | null; sortOrder: number | null }
>(nodes: T[]): { node: T; depth: number }[] {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const parent =
      node.parentId && ids.has(node.parentId) ? node.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
  }
  const rows: { node: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    const children = [...(byParent.get(parent) ?? [])].sort(
      (a, b) => Number(a.sortOrder) - Number(b.sortOrder)
    );
    for (const node of children) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      rows.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export type EstimateLine = {
  description: string;
  /** Null on a fixed-price line, which has no quantity. */
  quantity: number | null;
  unitOfMeasure: string | null;
  unitPrice: number | null;
  amount: number;
};

export type EstimateNode = {
  id: string;
  depth: number;
  readableId: string;
  name: string;
  isFixedPrice: boolean;
  lines: EstimateLine[];
  /** The node's own lines, not its subtree. */
  total: number;
};

/**
 * The estimate of a work tree at sale prices, node by node in tree order.
 * Labor plan lines are priced at the service labor item's price, materials
 * at their item's sale price and other costs at their amount; a line with
 * no price shows none and adds 0. A fixed-price node gives one line at its
 * price, and its subtree is not listed: the invoice bills it the same way.
 */
export function buildServiceEstimate(input: {
  nodes: {
    id: string;
    parentId: string | null;
    sortOrder: number | null;
    readableId: string;
    name: string;
    fixedPrice: number | null;
  }[];
  materials: {
    projectElementId: string;
    description: string;
    quantity: number;
    unitOfMeasure: string | null;
    unitPrice: number | null;
  }[];
  labor: { projectElementId: string; description: string; hours: number }[];
  costs: { projectElementId: string; description: string; amount: number }[];
  laborPrice: number | null;
  laborUnit: string;
}): { nodes: EstimateNode[]; total: number } {
  const linesOf = new Map<string, EstimateLine[]>();
  const add = (nodeId: string, line: EstimateLine) =>
    linesOf.set(nodeId, [...(linesOf.get(nodeId) ?? []), line]);

  for (const row of input.labor) {
    const hours = Number(row.hours);
    add(row.projectElementId, {
      description: row.description,
      quantity: hours,
      unitOfMeasure: input.laborUnit,
      unitPrice: input.laborPrice,
      amount: input.laborPrice === null ? 0 : round(hours * input.laborPrice)
    });
  }
  for (const row of input.materials) {
    const quantity = Number(row.quantity);
    add(row.projectElementId, {
      description: row.description,
      quantity,
      unitOfMeasure: row.unitOfMeasure,
      unitPrice: row.unitPrice,
      amount: row.unitPrice === null ? 0 : round(quantity * row.unitPrice)
    });
  }
  for (const row of input.costs) {
    const amount = Number(row.amount);
    add(row.projectElementId, {
      description: row.description,
      quantity: null,
      unitOfMeasure: null,
      unitPrice: null,
      amount
    });
  }

  const result: EstimateNode[] = [];
  let total = 0;
  let skipBelow: number | null = null;
  for (const { node, depth } of inTreeOrder(input.nodes)) {
    if (skipBelow !== null) {
      if (depth > skipBelow) continue;
      skipBelow = null;
    }
    const isFixedPrice = node.fixedPrice !== null;
    const lines: EstimateLine[] = isFixedPrice
      ? [
          {
            description: node.name,
            quantity: null,
            unitOfMeasure: null,
            unitPrice: null,
            amount: Number(node.fixedPrice)
          }
        ]
      : (linesOf.get(node.id) ?? []);
    if (isFixedPrice) skipBelow = depth;
    const nodeTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    total += nodeTotal;
    result.push({
      id: node.id,
      depth,
      readableId: node.readableId,
      name: node.name,
      isFixedPrice,
      lines,
      total: round(nodeTotal)
    });
  }
  return { nodes: result, total: round(total) };
}

export type WorkTotals = {
  hours: number;
  partCost: number;
  cost: number;
  /** What the node's billable items will bill (written-off items excluded). */
  billable: number;
  /** The coverages with a net amount on the node, in coverage order. */
  coverages: ServiceCoverage[];
};

/**
 * The totals of each node of a work tree, its subtree included. Hours are
 * the Labor quantities, part cost the Material amounts, cost every amount.
 * A coverage counts when its net amount is not zero, so a charge reclassed
 * to another coverage leaves only the new one. A charge or billable item on
 * no node, or on a node outside the tree, counts nowhere.
 */
export function summarizeWork(
  elements: { id: string; parentId: string | null }[],
  ledger: {
    projectElementId: string | null;
    costType: string;
    quantity: number | null;
    amount: number;
    coverage: ServiceCoverage | null;
  }[],
  billable: {
    projectElementId: string | null;
    amount: number;
    status: ProjectBillableItemStatus;
  }[]
): Map<string, WorkTotals> {
  const parentOf = new Map(elements.map((e) => [e.id, e.parentId]));
  const raw = new Map<
    string,
    Omit<WorkTotals, "coverages"> & { net: Map<ServiceCoverage, number> }
  >(
    elements.map((e) => [
      e.id,
      { hours: 0, partCost: 0, cost: 0, billable: 0, net: new Map() }
    ])
  );

  /** The node and each ancestor, once each (a cycle stops the walk). */
  const lineage = (id: string | null) => {
    const ids: string[] = [];
    const seen = new Set<string>();
    let current = id;
    while (current && raw.has(current) && !seen.has(current)) {
      seen.add(current);
      ids.push(current);
      current = parentOf.get(current) ?? null;
    }
    return ids;
  };

  for (const row of ledger) {
    const amount = Number(row.amount);
    for (const id of lineage(row.projectElementId)) {
      const totals = raw.get(id)!;
      if (row.costType === "Labor") totals.hours += Number(row.quantity ?? 0);
      if (row.costType === "Material") totals.partCost += amount;
      totals.cost += amount;
      if (row.coverage) {
        totals.net.set(
          row.coverage,
          (totals.net.get(row.coverage) ?? 0) + amount
        );
      }
    }
  }
  for (const item of billable) {
    if (item.status === "Written Off") continue;
    for (const id of lineage(item.projectElementId)) {
      raw.get(id)!.billable += Number(item.amount);
    }
  }

  const result = new Map<string, WorkTotals>();
  for (const [id, totals] of raw) {
    result.set(id, {
      hours: round(totals.hours),
      partCost: round(totals.partCost),
      cost: round(totals.cost),
      billable: round(totals.billable),
      coverages: serviceCoverages.filter((coverage) => {
        const net = totals.net.get(coverage);
        return net !== undefined && !equals(net, 0);
      })
    });
  }
  return result;
}

/**
 * Whether a charge's coverage can still change: an original charge (not a
 * reversal), not reversed or reclassed since, whose billable item is not
 * billed.
 */
export function canOverrideCoverage(
  charge: { id: string; reversalOfId: string | null },
  reversedIds: Set<string>,
  billableStatus: ProjectBillableItemStatus | null
): boolean {
  if (charge.reversalOfId) return false;
  if (reversedIds.has(charge.id)) return false;
  return billableStatus !== "Billed";
}

/** The charges the node drawer reverses: time (a timesheet correction) and expenses. */
export const reversibleChargeDocuments = [
  "Timesheet",
  "Project Expense"
] as const;

/** Whether a ledger row's document is one the node drawer reverses. */
export function isReversibleDocument(documentType: string | null): boolean {
  return (reversibleChargeDocuments as readonly (string | null)[]).includes(
    documentType
  );
}

/**
 * Whether the node drawer can reverse a charge: a time or expense charge
 * that is not a reversal and that no later row reverses. A part is returned
 * with Issue Part instead. A billed charge can be reversed too: its billable
 * item gets a negative copy, which the next invoice credits.
 */
export function canReverseCharge(
  charge: {
    id: string;
    reversalOfId: string | null;
    documentType: string | null;
  },
  reversedIds: Set<string>
): boolean {
  if (!isReversibleDocument(charge.documentType)) return false;
  if (charge.reversalOfId) return false;
  return !reversedIds.has(charge.id);
}

/**
 * The expense entry that reverses `original`: the same node, visit, employee
 * and date, the negative amount, and the reason. `post-project-expense` posts
 * it at the original's coverage.
 */
export function buildExpenseReversal(
  original: {
    id: string;
    companyId: string;
    projectId: string;
    projectElementId: string | null;
    serviceVisitId: string | null;
    employeeId: string;
    entryDate: string;
    description: string;
    amount: number | string;
  },
  args: { reason: string; userId: string }
) {
  return {
    companyId: original.companyId,
    projectId: original.projectId,
    projectElementId: original.projectElementId,
    serviceVisitId: original.serviceVisitId,
    employeeId: original.employeeId,
    entryDate: original.entryDate,
    description: original.description,
    amount: round(-Number(original.amount)),
    reversalOfId: original.id,
    reversalReason: args.reason,
    createdBy: args.userId
  };
}

/**
 * A Depot Repair order whose unit can ship back: the work is done (Completed,
 * or Closed after its invoice) and the unit is still at the depot.
 */
export function isReadyToShipBack(order: {
  status: ServiceOrderStatus;
  customerAsset: { status: string } | null;
}): boolean {
  return (
    (order.status === "Completed" || order.status === "Closed") &&
    order.customerAsset?.status === "At Depot"
  );
}
