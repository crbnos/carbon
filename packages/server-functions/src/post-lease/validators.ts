// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";

/**
 * Payload contract and pure blockers for `post-lease` (a lessee lease, spec
 * `.ai/specs/2026-10-11-lessee-leases.md`). No I/O, so the server function's
 * decisions can be pinned without a database.
 */

// Calendar dates travel as `YYYY-MM-DD` text end to end: a JavaScript Date
// would shift the day by the runtime timezone.
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

// companyId and userId come from the server function's context, not the input.
const scope = { leaseId: z.string().min(1) };
// Terminate and Purchase act on one leased asset (one lease component).
const asset = { leaseLineId: z.string().min(1) };

/** Draft → Active: classify, measure, post the commencement journal and
 *  write the monthly schedule. */
export const activateValidator = z.object({
  type: z.literal("activate"),
  ...scope
});

/** Draft (delete), or Active with nothing invoiced or posted (void the
 *  commencement journal) → Cancelled. */
export const cancelValidator = z.object({
  type: z.literal("cancel"),
  ...scope
});

/** Remeasure every active asset from an effective date: the remaining
 *  payments are cut again from these terms. An active asset the payload does
 *  not name keeps its payment amount. */
export const modifyValidator = z
  .object({
    type: z.literal("modify"),
    ...scope,
    effectiveDate: calendarDate,
    endDate: calendarDate,
    discountRate: z.number().min(0),
    paymentFrequency: z.enum(["Monthly", "Quarterly", "Annual"]),
    annualEscalationPercent: z.number().min(0).default(0),
    lines: z
      .array(
        z.object({
          leaseLineId: z.string().min(1),
          paymentAmount: z.number().min(0)
        })
      )
      .default([]),
    notes: z.string().optional().nullable()
  })
  .refine((value) => value.endDate >= value.effectiveDate, {
    message: "The end date cannot be before the effective date",
    path: ["endDate"]
  });

/** End one asset early: derecognize its ROU asset and its liability. */
export const terminateValidator = z.object({
  type: z.literal("terminate"),
  ...scope,
  ...asset,
  terminationDate: calendarDate,
  penaltyAmount: z.number().min(0).default(0),
  notes: z.string().optional().nullable()
});

/** Exercise one asset's purchase option: its ROU asset becomes a fixed
 *  asset. */
export const purchaseValidator = z.object({
  type: z.literal("purchase"),
  ...scope,
  ...asset,
  exerciseDate: calendarDate,
  purchasePrice: z.number().min(0),
  fixedAssetClassId: z.string().min(1),
  name: z.string().trim().min(1),
  notes: z.string().optional().nullable()
});

export const payloadValidator = z.discriminatedUnion("type", [
  activateValidator,
  cancelValidator,
  modifyValidator,
  terminateValidator,
  purchaseValidator
]);

export type LeasePayload = z.infer<typeof payloadValidator>;

/** Why a Draft lease cannot activate, or null. */
export function activateBlocker(args: {
  status: string;
  assetCount: number;
  /** The descriptions of the assets that have no payment row. */
  assetsWithoutPayments: string[];
  currencyCode: string;
  baseCurrencyCode: string | null;
}): string | null {
  if (args.status !== "Draft") {
    return `The lease is ${args.status}; only a Draft lease can be activated`;
  }
  if (args.assetCount === 0) {
    return "A lease needs at least one asset to activate";
  }
  if (args.assetsWithoutPayments.length > 0) {
    return `Every asset needs a payment row to activate: ${args.assetsWithoutPayments.join(", ")}`;
  }
  if (args.baseCurrencyCode && args.currencyCode !== args.baseCurrencyCode) {
    return "Leases in a foreign currency are not supported yet";
  }
  return null;
}

/** Whole lease months the schedule covers: the whole months of the term,
 *  plus the last part month when the term does not end on a month boundary.
 *  Never less than one. */
export function scheduleMonths(
  wholeMonths: number,
  hasPartMonth: boolean
): number {
  return Math.max(1, wholeMonths + (hasPartMonth ? 1 : 0));
}
