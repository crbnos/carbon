// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assignSerialNumberIfMissing } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import { getDatabaseClient } from "~/services/database.server";

const log = getLogger("mes", "serial-number");

/**
 * Number a unit from its item's serial sequence when work first starts on it
 * (the `production` serial number timing, the item's own or else the
 * company's). A no-op for a unit that already has a number, which is every unit
 * under the `jobCreation` and `jobRelease` timings, so it is safe on every start.
 *
 * Best-effort: a failure never stops a timer from starting, and the ERP's
 * completion and scrap postings number the unit later if this was lost. It
 * writes as the system: the caller has already admitted the operator to start
 * the operation, and an operator need not hold `update: production`.
 */
export async function assignSerialNumberOnFirstTouch(args: {
  trackedEntityId: string;
  companyId: string;
}) {
  try {
    await getDatabaseClient()
      .transaction()
      .execute((trx) => assignSerialNumberIfMissing(trx, args));
  } catch (error) {
    log.error("Failed to assign a serial number on first touch", {
      error,
      trackedEntityId: args.trackedEntityId,
      companyId: args.companyId
    });
  }
}
