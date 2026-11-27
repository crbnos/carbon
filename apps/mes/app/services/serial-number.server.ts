// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { numberUnitOnFirstTouch } from "@carbon/lib/production/serial-numbering";
import { getDatabaseClient } from "~/services/database.server";

/**
 * Number a unit from its item's serial sequence when work first starts on it
 * (`numberUnitOnFirstTouch`, shared with the ERP's timer Start). Best-effort:
 * a failure is logged and never stops the timer.
 */
export async function assignSerialNumberOnFirstTouch(args: {
  trackedEntityId: string;
  jobOperationId: string;
  companyId: string;
}) {
  await numberUnitOnFirstTouch(getDatabaseClient(), args);
}
