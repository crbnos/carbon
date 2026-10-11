// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The two period runs on one engine (spec `.ai/specs/2026-10-11-lessee-leases.md`
// §6). A schedule row belongs to the lease run when it comes from a rental
// agreement (operating rent, sales-type interest) or a lessee lease; every
// other row (service-dated invoice lines, contracts) belongs to the revenue
// recognition run.

import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { Expression, ExpressionBuilder, SqlBool } from "kysely";

export type RunType = Database["public"]["Enums"]["runType"];

export const RUN_TYPES = [
  "Revenue Recognition",
  "Lease"
] as const satisfies readonly RunType[];

/** The readable-id sequence of each run type. */
export const RUN_SEQUENCE: Record<RunType, string> = {
  "Revenue Recognition": "revenueRecognitionRun",
  Lease: "leaseRun"
};

/** The run type's label in a message: "revenue recognition run" / "lease run". */
export const RUN_LABEL: Record<RunType, string> = {
  "Revenue Recognition": "revenue recognition run",
  Lease: "lease run"
};

/** The rows of `revenueRecognitionSchedule` a run of `type` claims. */
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
