// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assignSerialNumberIfMissing } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import { getDatabaseClient } from "~/services/database.server";

const log = getLogger("mes", "serial-number");

/**
 * Number a unit from its item's serial sequence when work first starts on it.
 * Under the `production` serial number timing (the item's own, else the
 * company's) that is how the unit gets its number. Under `jobCreation` and
 * `jobRelease` every unit is already numbered, so it does nothing, unless the
 * job was created under `production` before the timing changed. Safe on every
 * start.
 *
 * Only a unit of the operation's own make method that is already on its own is
 * numbered. The job's first unit is still the unsplit seed holding every unit,
 * and a start leaves it whole, so its number comes from its first completion or
 * scrap, which cut it to one unit.
 *
 * Best-effort: a failure never stops a timer from starting, and the ERP's
 * completion and scrap postings number the unit later if this was lost. It
 * writes as the system: the caller has already admitted the operator to start
 * the operation, and an operator need not hold `update: production`. The unit
 * id comes from the request, so it must belong to the operation's make method.
 */
export async function assignSerialNumberOnFirstTouch(args: {
  trackedEntityId: string;
  jobOperationId: string;
  companyId: string;
}) {
  try {
    await getDatabaseClient()
      .transaction()
      .execute(async (trx) => {
        const operation = await trx
          .selectFrom("jobOperation")
          .select(["jobMakeMethodId"])
          .where("id", "=", args.jobOperationId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst();
        if (!operation?.jobMakeMethodId) return null;
        return assignSerialNumberIfMissing(trx, {
          trackedEntityId: args.trackedEntityId,
          companyId: args.companyId,
          onlyIfSingleUnit: true,
          jobMakeMethodId: operation.jobMakeMethodId
        });
      });
  } catch (error) {
    log.error("Failed to assign a serial number on first touch", {
      error,
      trackedEntityId: args.trackedEntityId,
      jobOperationId: args.jobOperationId,
      companyId: args.companyId
    });
  }
}
