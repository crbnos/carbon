import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";

const logger = getLogger("erp", "maintenance-labor");

// Reconcile the dispatches' labor postings with their time entries (the
// post-maintenance-event edge function — idempotent, so call it after ANY
// change to a dispatch's entries or its completion). Returns an error message
// for the caller's flash, or null. Service role: the caller has already
// authorized the change, and a delete-only user must still reverse its cost.
export async function postMaintenanceLabor(args: {
  maintenanceDispatchIds: string[];
  companyId: string;
  userId: string;
}): Promise<string | null> {
  if (args.maintenanceDispatchIds.length === 0) return null;

  const serviceRole = getCarbonServiceRole();
  const posting = await serviceRole.functions.invoke<{
    success: boolean;
    error?: string;
  }>("post-maintenance-event", { body: args });

  if (posting.error) {
    logger.error("Failed to post maintenance labor", {
      companyId: args.companyId,
      maintenanceDispatchIds: args.maintenanceDispatchIds,
      error: posting.error
    });
    return posting.error.message;
  }
  return null;
}
