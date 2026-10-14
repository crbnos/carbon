// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The two period runs on one engine (spec `.ai/specs/2026-10-11-lessee-leases.md`
// §6). A schedule row belongs to the lease run when it comes from a rental
// agreement (operating rent, sales-type interest) or a lessee lease; every
// other row (service-dated invoice lines, contracts) belongs to the revenue
// recognition run.
//
// Client-safe: Kysely is a type import only. Every place that asks "which rows
// does a run of this type claim", "what is it called" or "which sequence
// numbers it" reads this file — the proposal and recalculation server
// functions, and the ERP's post, reverse and delete.

import type { Expression, ExpressionBuilder, SqlBool } from "kysely";
import type { KyselyDatabase } from "./client.ts";
import type { Database } from "./types.ts";

export type RunType = Database["public"]["Enums"]["runType"];

/** The readable-id sequence of each run type. */
export const RUN_SEQUENCE: Record<RunType, string> = {
  "Revenue Recognition": "revenueRecognitionRun",
  Lease: "leaseRun"
};

/** The run type's name in a message: "revenue recognition run" / "lease run". */
export const RUN_LABEL: Record<RunType, string> = {
  "Revenue Recognition": "revenue recognition run",
  Lease: "lease run"
};

/** `RUN_LABEL` at the start of a sentence: "Lease run LR000001 is …". */
export function runLabelSentence(type: RunType): string {
  const label = RUN_LABEL[type];
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/** The rows of `revenueRecognitionSchedule` a run of `type` claims: a lease
 *  run takes the rows of rental agreements and lessee leases, a revenue
 *  recognition run the rest. */
export function runTypeFilter(type: RunType) {
  return (
    eb: ExpressionBuilder<KyselyDatabase, "revenueRecognitionSchedule">
  ): Expression<SqlBool> =>
    type === "Lease"
      ? eb.or([
          eb("rentalAgreementLineId", "is not", null),
          eb("leaseId", "is not", null)
        ])
      : eb.and([
          eb("rentalAgreementLineId", "is", null),
          eb("leaseId", "is", null)
        ]);
}

/** The run type that claims one schedule row, read off the row itself — the
 *  same test as `runTypeFilter`, for rows already in hand. */
export function runTypeOfScheduleRow(row: {
  rentalAgreementLineId: string | null;
  leaseId: string | null;
}): RunType {
  return row.rentalAgreementLineId !== null || row.leaseId !== null
    ? "Lease"
    : "Revenue Recognition";
}

/** The journal source type a run of `type` posts as: a lease run's journals
 *  are 'Lease Run', so an accounting integration can sync them on their own
 *  policy (`20261011192957_lease-run-sync-policy.sql`). */
export const RUN_SOURCE_TYPE = {
  "Revenue Recognition": "Revenue Recognition",
  Lease: "Lease Run"
} as const satisfies Record<
  RunType,
  Database["public"]["Enums"]["journalEntrySourceType"]
>;
