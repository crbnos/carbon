// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The invoice lines of a Completed Billable service job, pure.
// `createServiceInvoice` (`service.service.ts`) reads the job and writes what
// this returns.
// - Time and Materials: one line per labor item at Σ billable hours × the
//   labor item's sale price, then one line per billable Part, then one line
//   per billable Charge.
// - Fixed Price: one line, the job's service item at its fixed price.
// Spec: `.ai/specs/2026-10-22-service-jobs-and-returns.md` → Postings, rule 4.

import { InvalidInputError } from "@carbon/api/errors";
import type { Database } from "@carbon/database";
import { EPSILON, round } from "@carbon/utils";

type ServiceBillingMethod = Database["public"]["Enums"]["serviceBillingMethod"];

export type ServiceInvoiceJob = {
  /** The readable job id, for the refusals. */
  serviceJobId: string;
  billingMethod: ServiceBillingMethod;
  serviceItemId: string | null;
  fixedPrice: number | null;
};

/** The job's service item, read for a Fixed Price job. */
export type ServiceInvoiceServiceItem = {
  name: string;
  unitOfMeasureCode: string | null;
};

export type ServiceInvoiceTime = {
  laborItemId: string;
  laborItemName: string;
  hours: number;
  billable: boolean;
  /** The labor item's sale price per hour; null when it has none. */
  unitSalePrice: number | null;
  unitOfMeasureCode: string | null;
};

export type ServiceInvoiceItem = {
  lineType: Database["public"]["Enums"]["serviceJobItemLineType"];
  itemId: string;
  /** The line's own description, else the item's name. */
  description: string;
  quantity: number;
  unitPrice: number;
  billable: boolean;
  unitOfMeasureCode: string | null;
};

export type PlannedServiceJobInvoiceLine = {
  invoiceLineType: "Service";
  itemId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitOfMeasureCode: string;
};

const DEFAULT_UNIT_OF_MEASURE = "EA";

/**
 * The lines of a service job's invoice, in order. Refuses a Fixed Price job
 * with no service item or no fixed price, a labor item with billable hours
 * and no sale price, and a job with nothing to bill.
 */
export function planServiceJobInvoiceLines(args: {
  job: ServiceInvoiceJob;
  serviceItem: ServiceInvoiceServiceItem | null;
  time: ServiceInvoiceTime[];
  items: ServiceInvoiceItem[];
}): PlannedServiceJobInvoiceLine[] {
  const { job } = args;

  if (job.billingMethod === "Fixed Price") {
    if (!job.serviceItemId) {
      throw new InvalidInputError(
        `Service job ${job.serviceJobId} is Fixed Price and has no service item. Set the service item to bill first.`
      );
    }
    if (job.fixedPrice === null) {
      throw new InvalidInputError(
        `Service job ${job.serviceJobId} is Fixed Price and has no fixed price. Accept an estimate or set the price first.`
      );
    }
    return [
      {
        invoiceLineType: "Service",
        itemId: job.serviceItemId,
        description: args.serviceItem?.name ?? `Service ${job.serviceJobId}`,
        quantity: 1,
        unitPrice: round(job.fixedPrice),
        unitOfMeasureCode:
          args.serviceItem?.unitOfMeasureCode ?? DEFAULT_UNIT_OF_MEASURE
      }
    ];
  }

  // One line per labor item, in the order the time first names it.
  const labor = new Map<string, { entry: ServiceInvoiceTime; hours: number }>();
  for (const entry of args.time) {
    if (!entry.billable) continue;
    const current = labor.get(entry.laborItemId);
    if (current) current.hours += entry.hours;
    else labor.set(entry.laborItemId, { entry, hours: entry.hours });
  }

  const lines: PlannedServiceJobInvoiceLine[] = [];
  for (const { entry, hours } of labor.values()) {
    if (hours <= EPSILON) continue;
    if (!(Number(entry.unitSalePrice ?? 0) > 0)) {
      throw new InvalidInputError(
        `The labor item ${entry.laborItemName} has no sale price per hour. Set its unit sale price first.`
      );
    }
    lines.push({
      invoiceLineType: "Service",
      itemId: entry.laborItemId,
      description: entry.laborItemName,
      quantity: round(hours),
      unitPrice: round(Number(entry.unitSalePrice)),
      unitOfMeasureCode: entry.unitOfMeasureCode ?? DEFAULT_UNIT_OF_MEASURE
    });
  }

  for (const lineType of ["Part", "Charge"] as const) {
    for (const item of args.items) {
      if (item.lineType !== lineType || !item.billable) continue;
      if (item.quantity <= EPSILON) continue;
      lines.push({
        invoiceLineType: "Service",
        itemId: item.itemId,
        description: item.description,
        quantity: round(item.quantity),
        unitPrice: round(item.unitPrice),
        unitOfMeasureCode: item.unitOfMeasureCode ?? DEFAULT_UNIT_OF_MEASURE
      });
    }
  }

  if (lines.length === 0) {
    throw new InvalidInputError(
      `Service job ${job.serviceJobId} has no billable time, part or charge to invoice.`
    );
  }
  return lines;
}
