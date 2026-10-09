// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Field service: customer assets, service orders and visits.
// Spec: .ai/specs/2026-10-08-field-service.md

import type { Database } from "@carbon/database";
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

/** Phase A creates Field Visit orders only. */
export const serviceOrderTypes = [
  "Field Visit"
] as const satisfies readonly ServiceOrderType[];

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

/**
 * The status an order rolls up to from its visits (spec, *Lifecycle*). A
 * status the user set (On Hold, Completed, Closed, Cancelled) stays. Work
 * marked complete gives Completed. A visit on its way or on site, or a
 * completed visit with the work not complete, gives In Progress. A
 * scheduled visit with none started gives Scheduled. No live visit gives
 * Draft. Cancelled visits do not count.
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
  return "Draft";
}

/** The statuses a user moves an order to from the order page. */
export const serviceOrderStatusActions = [
  "On Hold",
  "Completed",
  "Closed",
  "Cancelled",
  "Draft"
] as const satisfies readonly ServiceOrderStatus[];
export type ServiceOrderStatusAction =
  (typeof serviceOrderStatusActions)[number];

/**
 * Whether a user may move an order from `from` to `to` (spec, *Lifecycle*).
 * An open order (Draft, Scheduled, In Progress) can be put on hold,
 * completed or cancelled. An order on hold resumes (Draft, so its visits
 * decide again) or is cancelled. A completed order closes or reopens
 * (Draft). Closed and Cancelled are final.
 */
export function canMoveServiceOrder(
  from: ServiceOrderStatus,
  to: ServiceOrderStatusAction
): boolean {
  switch (from) {
    case "Draft":
    case "Scheduled":
    case "In Progress":
      return to === "On Hold" || to === "Completed" || to === "Cancelled";
    case "On Hold":
      return to === "Draft" || to === "Cancelled";
    case "Completed":
      return to === "Closed" || to === "Draft";
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
    customerAssetId: z.string().min(1, { message: "Asset is required" }),
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
