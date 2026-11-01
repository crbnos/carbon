// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The invoice lines of a Completed Billable service job, pure.
// `createServiceInvoice` (`service.service.ts`) reads the job and writes what
// this returns.
// - Time and Materials: one Labor line at Σ billable hours × the job's bill
//   rate, then one line per billable Part, then one line per billable Charge.
// - Fixed Price: one line, the job's service item at its fixed price.
// Spec: `.ai/specs/2026-10-22-service-jobs-and-returns.md` → Postings, rule 4;
// `.ai/specs/2026-10-31-service-labor-rates-and-time-posting.md` → 4.

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
  /** The job's bill rate per hour at invoicing; null when it has none. */
  laborBillRate: number | null;
};

/** The job's service item, read for a Fixed Price job. */
export type ServiceInvoiceServiceItem = {
  name: string;
  unitOfMeasureCode: string | null;
};

export type ServiceInvoiceTime = {
  hours: number;
  billable: boolean;
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

/**
 * A Labor line has no item: its quantity is hours. It carries the default
 * unit, since an invoice line needs one.
 */
export type PlannedServiceJobInvoiceLine =
  | {
      invoiceLineType: "Service";
      itemId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      unitOfMeasureCode: string;
    }
  | {
      invoiceLineType: "Labor";
      itemId: null;
      description: string;
      quantity: number;
      unitPrice: number;
      unitOfMeasureCode: string;
    };

const DEFAULT_UNIT_OF_MEASURE = "EA";

/** Refused when billable hours need the job's bill rate and it has none. */
export const SERVICE_JOB_BILL_RATE_MISSING = "Set the job's bill rate first.";

/** Refused when a Fixed Price job has no price to bill. */
export const SERVICE_JOB_FIXED_PRICE_MISSING =
  "Set the job's fixed price first.";

/**
 * The lines of a service job's invoice, in order. Refuses a Fixed Price job
 * with no service item or no fixed price, billable hours on a job with no
 * bill rate, and a job with nothing to bill.
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
      throw new InvalidInputError(SERVICE_JOB_FIXED_PRICE_MISSING);
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

  // One Labor line: every billable hour at the job's bill rate.
  const hours = args.time.reduce(
    (sum, entry) => (entry.billable ? sum + entry.hours : sum),
    0
  );

  const lines: PlannedServiceJobInvoiceLine[] = [];
  if (hours > EPSILON) {
    if (job.laborBillRate === null) {
      throw new InvalidInputError(SERVICE_JOB_BILL_RATE_MISSING);
    }
    lines.push({
      invoiceLineType: "Labor",
      itemId: null,
      description: "Labor",
      quantity: round(hours),
      unitPrice: round(job.laborBillRate),
      unitOfMeasureCode: DEFAULT_UNIT_OF_MEASURE
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
