import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commandError } from "~/services/mcp-command-error";
import { requireToolPermission } from "~/services/mcp-guards.server";
import { commitPurchaseOrderFinalize } from "./purchasing.server";

// Purchasing route commands published under the tool names of the bare
// service primitives they replace (a same-named export here SHADOWS the
// `purchasing.service.ts` one; the registry spreads this module last). Each
// wrapper re-applies the route's request gates and turns the command's result
// into `{ data, error }`; the command lives in `purchasing.server.ts`, shared
// with the route.
//
// `client` MUST stay named `client` and first — the dispatcher injects it by
// name. Server-only: never re-export from the module barrel.

/**
 * Finalize a purchase order as the Finalize button does, without the PDF or supplier email: approval rules may route it to Needs Approval instead.
 *
 * Refused when supplier approval is required and the supplier is not Active.
 * The status is derived from the lines and the order date is set if empty.
 * When the order total requires approval, an approval request is created, the
 * approvers are notified and the order moves to Needs Approval
 * (`approvalRequired: true`). Otherwise purchased prices are updated when the
 * company updates them on finalize. `purchaseOrderId` is the order's uuid.
 */
export async function finalizePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  userId: string,
  companyId: string
) {
  await requireToolPermission(
    userId,
    companyId,
    "purchasing",
    "create",
    "finalize purchase orders",
    { employee: true }
  );
  const result = await commitPurchaseOrderFinalize(client, {
    purchaseOrderId,
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
