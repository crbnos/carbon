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

/** Remeasure from an effective date: the remaining payments are cut again
 *  from these terms. */
export const modifyValidator = z.object({
  type: z.literal("modify"),
  ...scope,
  effectiveDate: calendarDate,
  endDate: calendarDate,
  discountRate: z.number().min(0),
  paymentAmount: z.number().min(0),
  paymentFrequency: z.enum(["Monthly", "Quarterly", "Annual"]),
  annualEscalationPercent: z.number().min(0).default(0),
  notes: z.string().optional().nullable()
});

/** End the lease early: derecognize the ROU asset and the liability. */
export const terminateValidator = z.object({
  type: z.literal("terminate"),
  ...scope,
  terminationDate: calendarDate,
  penaltyAmount: z.number().min(0).default(0),
  notes: z.string().optional().nullable()
});

/** Exercise the purchase option: the ROU asset becomes a fixed asset. */
export const purchaseValidator = z.object({
  type: z.literal("purchase"),
  ...scope,
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
  paymentCount: number;
  currencyCode: string;
  baseCurrencyCode: string | null;
}): string | null {
  if (args.status !== "Draft") {
    return `The lease is ${args.status}; only a Draft lease can be activated`;
  }
  if (args.paymentCount === 0) {
    return "A lease needs at least one payment row to activate";
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
