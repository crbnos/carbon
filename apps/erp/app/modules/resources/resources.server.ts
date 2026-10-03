// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "maintenance-labor");

// Reconcile the dispatches' labor postings with their time entries (the
// post-maintenance-event server function — idempotent, so call it after ANY
// change to a dispatch's entries or its completion). Returns an error message
// for the caller's flash, or null. System: the caller has already authorized
// the change, and a delete-only user must still reverse its cost.
export async function postMaintenanceLabor(args: {
  maintenanceDispatchIds: string[];
  companyId: string;
  userId: string;
}): Promise<string | null> {
  if (args.maintenanceDispatchIds.length === 0) return null;

  const { maintenanceDispatchIds, companyId, userId } = args;
  const posting = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-maintenance-event", { maintenanceDispatchIds });

  if (posting.error) {
    logger.error("Failed to post maintenance labor", {
      companyId,
      maintenanceDispatchIds,
      error: posting.error
    });
    return posting.error.message || "Failed to post maintenance labor";
  }
  return null;
}
