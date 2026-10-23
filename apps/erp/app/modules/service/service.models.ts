// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Service: customer assets and their warranty, and the service job.

import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { optionalTiptapDoc } from "../shared/shared.models";

type Enums = Database["public"]["Enums"];

export type CustomerAssetStatus = Enums["customerAssetStatus"];
export type ProjectBillableItemStatus = Enums["projectBillableItemStatus"];
export type ServiceJobStatus = Enums["serviceJobStatus"];
export type ServiceCoverage = Enums["serviceCoverage"];
export type ServiceWorkSite = Enums["serviceWorkSite"];
export type ServiceBillingMethod = Enums["serviceBillingMethod"];
export type ServiceJobPriority = Enums["serviceJobPriority"];
export type ServiceEstimateStatus = Enums["serviceEstimateStatus"];
export type ServiceJobItemLineType = Enums["serviceJobItemLineType"];
export type SalesReturnType = Enums["returnType"];

export const customerAssetStatuses = [
  "In Service",
  "At Depot",
  "Returned"
] as const satisfies readonly CustomerAssetStatus[];

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

// --- Service jobs ------------------------------------------------------------

const requiredDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Date is required" });

export const serviceJobStatuses = [
  "Open",
  "Awaiting Approval",
  "In Progress",
  "On Hold",
  "Completed",
  "Invoiced",
  "Cancelled"
] as const satisfies readonly ServiceJobStatus[];

export const serviceCoverages = [
  "Billable",
  "Warranty",
  "Contract"
] as const satisfies readonly ServiceCoverage[];

export const serviceWorkSites = [
  "Depot",
  "Customer Site"
] as const satisfies readonly ServiceWorkSite[];

export const serviceBillingMethods = [
  "Time and Materials",
  "Fixed Price"
] as const satisfies readonly ServiceBillingMethod[];

export const serviceJobPriorities = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const satisfies readonly ServiceJobPriority[];

export const serviceEstimateStatuses = [
  "Draft",
  "Sent",
  "Accepted",
  "Declined"
] as const satisfies readonly ServiceEstimateStatus[];

export const serviceJobItemLineTypes = [
  "Part",
  "Charge"
] as const satisfies readonly ServiceJobItemLineType[];

export const returnTypes = [
  "Return to Stock",
  "Return for Service",
  "Return for Warranty"
] as const satisfies readonly SalesReturnType[];

/** A new job: the customer, the unit, where the work is done and how it bills. */
export const serviceJobValidator = z.object({
  id: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerAssetId: zfd.text(z.string().optional()),
  locationId: z.string().min(1, { message: "Location is required" }),
  workSite: z.enum(serviceWorkSites, { message: "Work site is required" }),
  /** Left out, an asset's warranty suggests it; with no asset, Billable. */
  coverage: zfd.text(z.enum(serviceCoverages).optional()),
  billingMethod: z.enum(serviceBillingMethods, {
    message: "Billing method is required"
  }),
  priority: z.enum(serviceJobPriorities, { message: "Priority is required" }),
  serviceItemId: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional()),
  dueDate: optionalDate,
  problem: zfd.text(z.string().optional())
});

/**
 * The header fields `updateServiceJob` sets one at a time. Not the status,
 * the coverage or the posting columns: those have their own operations.
 */
export const serviceJobUpdateFields = [
  "customerId",
  "customerLocationId",
  "customerContactId",
  "customerAssetId",
  "locationId",
  "workSite",
  "billingMethod",
  "priority",
  "serviceItemId",
  "assignee",
  "dueDate",
  "problem",
  "findings",
  "resolution",
  "repairable"
] as const;

export const serviceJobUpdateValidator = z.object({
  ids: zfd.repeatableOfType(z.string().min(1)),
  field: z.enum(serviceJobUpdateFields),
  value: z.string().nullish()
});

/** A priced line of a job's estimate: a labor item (hours), a part or a charge. */
export const serviceJobEstimateLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  serviceJobId: z.string().min(1, { message: "Job is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  description: zfd.text(z.string().optional()),
  quantity: zfd.numeric(
    z.number().positive({ message: "Quantity must be more than 0" })
  ),
  unitPrice: zfd.numeric(
    z.number().min(0, { message: "Unit price cannot be negative" })
  )
});

/** Hours one employee worked on a job on one day, at a labor item's rates. */
export const serviceJobTimeValidator = z.object({
  id: zfd.text(z.string().optional()),
  serviceJobId: z.string().min(1, { message: "Job is required" }),
  employeeId: z.string().min(1, { message: "Employee is required" }),
  laborItemId: z.string().min(1, { message: "Labor item is required" }),
  entryDate: requiredDate,
  hours: zfd.numeric(
    z
      .number()
      .positive({ message: "Hours must be more than 0" })
      .max(24, { message: "Hours cannot be more than 24" })
  ),
  billable: zfd.checkbox(),
  note: zfd.text(z.string().optional())
});

/** A Charge line: a Service item with a price (a trip fee, a call-out fee). */
export const serviceJobItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  serviceJobId: z.string().min(1, { message: "Job is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  description: zfd.text(z.string().optional()),
  quantity: zfd.numeric(
    z.number().positive({ message: "Quantity must be more than 0" })
  ),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  unitPrice: zfd.numeric(
    z.number().min(0, { message: "Unit price cannot be negative" })
  ),
  billable: zfd.checkbox()
});

/** A technician scheduled on a job for a day. */
export const serviceJobAssignmentValidator = z.object({
  id: zfd.text(z.string().optional()),
  serviceJobId: z.string().min(1, { message: "Job is required" }),
  employeeId: z.string().min(1, { message: "Employee is required" }),
  scheduledDate: requiredDate,
  plannedHours: zfd.numeric(
    z
      .number()
      .positive({ message: "Planned hours must be more than 0" })
      .optional()
  ),
  note: zfd.text(z.string().optional())
});

/** Drag an assignment to another technician or day. */
export const serviceJobAssignmentMoveValidator = z.object({
  id: z.string().min(1, { message: "Assignment is required" }),
  employeeId: z.string().min(1, { message: "Employee is required" }),
  scheduledDate: requiredDate
});

/**
 * The status changes a user makes by hand. Complete, Reopen and the coverage
 * change post, so they are not here.
 */
export const serviceJobStatusActions = [
  "Start",
  "Hold",
  "Resume",
  "Cancel"
] as const;
export type ServiceJobStatusAction = (typeof serviceJobStatusActions)[number];

/** Each action: the statuses it starts from and the status it sets. */
export const SERVICE_JOB_STATUS_TRANSITIONS: Record<
  ServiceJobStatusAction,
  { from: readonly ServiceJobStatus[]; to: ServiceJobStatus }
> = {
  Start: { from: ["Open"], to: "In Progress" },
  Hold: { from: ["Open", "In Progress"], to: "On Hold" },
  Resume: { from: ["On Hold"], to: "In Progress" },
  Cancel: {
    from: ["Open", "Awaiting Approval", "In Progress", "On Hold"],
    to: "Cancelled"
  }
};

export const serviceJobStatusValidator = z.object({
  jobId: z.string().min(1, { message: "Job is required" }),
  action: z.enum(serviceJobStatusActions, { message: "Action is required" })
});

export const serviceJobEstimateSendValidator = z.object({
  jobId: z.string().min(1, { message: "Job is required" })
});

/** The customer's answer to a sent estimate, and who gave it. */
export const serviceJobEstimateResponseValidator = z.object({
  jobId: z.string().min(1, { message: "Job is required" }),
  response: z.enum(["Accepted", "Declined"] as const, {
    message: "Response is required"
  }),
  estimateRespondedBy: z
    .string()
    .trim()
    .min(1, { message: "Customer name is required" })
});
