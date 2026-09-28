import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commandError } from "~/services/mcp-command-error";
import { requireToolPermission } from "~/services/mcp-guards.server";
import { removeMaintenanceDispatchItem } from "./resources.server";

// Resources route commands published under the tool names of the bare
// service primitives they replace (a same-named export here SHADOWS the
// `resources.service.ts` one; the registry spreads this module last). Each
// wrapper re-applies the route's request gates, adapts the payload and turns
// the command's result into `{ data, error }`; business logic lives in
// `resources.server.ts`.
//
// `client` MUST stay named `client` and first — the dispatcher injects it by
// name. Server-only: never re-export from the module barrel.

/**
 * Remove a spare part from a maintenance dispatch and return it to inventory, as the dispatch's item delete action does.
 *
 * `maintenanceDispatchItemId` is the dispatch item's row id (the `id` from
 * the dispatch's items), not the part's item id. Refused while the dispatch
 * is locked; an unknown id is an error.
 */
export async function deleteMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  maintenanceDispatchItemId: string,
  companyId: string,
  userId: string
) {
  await requireToolPermission(
    userId,
    companyId,
    "resources",
    "delete",
    "remove maintenance dispatch items"
  );
  const result = await removeMaintenanceDispatchItem({
    maintenanceDispatchItemId,
    companyId,
    userId
  });
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}
