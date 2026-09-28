import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  type CommandResult,
  commandFailed,
  commandOk
} from "~/services/command-result";
import { isMaintenanceDispatchLocked } from "./resources.models";

// Server-only resources route commands, shared by the route and the
// `{module}.mcp.server.ts` wrappers that publish them under a tool name.

export const LOCKED_DISPATCH_MESSAGE =
  "Cannot modify a locked dispatch. Reopen it first.";

/**
 * Remove a spare part from a maintenance dispatch as the dispatch's item
 * delete action does (`x+/maintenance+/$dispatchId.item.$itemId.delete.tsx`):
 * refused while the dispatch is locked, then the `issue` edge function
 * (`maintenanceDispatchUnissue`) returns the issued quantity to inventory with
 * a positive Maintenance Consumption ledger entry and deletes the row.
 *
 * `maintenanceDispatchItemId` is the dispatch item's row id, not the part's
 * item id. The row must belong to the company (and to `dispatchId` when
 * given); an unknown id is an error.
 */
export async function removeMaintenanceDispatchItem(args: {
  maintenanceDispatchItemId: string;
  dispatchId?: string;
  companyId: string;
  userId: string;
}): Promise<CommandResult<{ id: string }>> {
  const { maintenanceDispatchItemId, companyId, userId } = args;
  const serviceRole = getCarbonServiceRole();

  const item = await serviceRole
    .from("maintenanceDispatchItem")
    .select("id, maintenanceDispatchId, maintenanceDispatch(status)")
    .eq("id", maintenanceDispatchItemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (item.error) {
    return commandFailed(
      "Failed to read maintenance dispatch item",
      item.error
    );
  }
  if (
    !item.data ||
    (args.dispatchId && item.data.maintenanceDispatchId !== args.dispatchId)
  ) {
    return commandFailed("Maintenance dispatch item not found");
  }

  const dispatch = item.data.maintenanceDispatch as {
    status: string | null;
  } | null;
  if (isMaintenanceDispatchLocked(dispatch?.status)) {
    return commandFailed(LOCKED_DISPATCH_MESSAGE);
  }

  const result = await serviceRole.functions.invoke("issue", {
    body: {
      type: "maintenanceDispatchUnissue",
      maintenanceDispatchItemId,
      companyId,
      userId
    }
  });
  if (result.error) return commandFailed("Failed to remove item", result.error);
  return commandOk({ id: maintenanceDispatchItemId });
}
