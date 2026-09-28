import { hasPermission } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ruleError } from "~/utils/supabase";
import { cancelPendingPurchaseOrderApprovals } from "./purchasing.server";
import { updatePurchaseOrderStatus } from "./purchasing.service";

// MCP-exposed purchasing commands that need server-only modules (the service
// role, the caller's claims). They cannot live in `purchasing.service.ts`,
// which the `~/modules/purchasing` barrel re-exports into the client bundle.
// `scripts/generate-mcp.ts` and the Carbon API registry
// (`api+/v1+/lib/registry.server.ts`) pull this file in server-side only.

/** Statuses the purchase order header disables "Cancel Order" for. */
const NOT_CLOSABLE_STATUSES = ["Closed", "Completed"] as const;

/**
 * Close a purchase order (the UI's "Cancel Order"): status Closed, assignee
 * cleared, pending approvals cancelled. Needs purchasing delete permission.
 *
 * An order that is already `Closed` or `Completed` is refused, as the button
 * is disabled for them. Reopen a closed order with
 * `purchasing_updatePurchaseOrderStatus` (status `Draft`).
 */
export async function closePurchaseOrder(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    purchaseOrderId: string;
  }
) {
  // The status route gates closing on delete, not update.
  const claims = await getUserClaims(userId, companyId);
  if (!hasPermission(claims?.permissions, "purchasing", "delete", companyId)) {
    throw new Error(
      "You do not have permission to close purchase orders (purchasing delete)."
    );
  }

  // Read through the caller's client, scoped to the company: this is the
  // tenancy proof for the service-role approval write below.
  const current = await client
    .from("purchaseOrder")
    .select("id, status")
    .eq("id", args.purchaseOrderId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (current.error) return { data: null, error: current.error };
  if (!current.data) {
    return {
      data: null,
      error: ruleError(`Purchase order ${args.purchaseOrderId} was not found.`)
    };
  }
  const status = current.data.status;
  if ((NOT_CLOSABLE_STATUSES as readonly string[]).includes(status)) {
    return {
      data: null,
      error: ruleError(
        `Purchase order ${args.purchaseOrderId} is ${status} and cannot be closed.`
      )
    };
  }

  // Same order as the route: approvals first, then the status.
  await cancelPendingPurchaseOrderApprovals(getCarbonServiceRole(), {
    purchaseOrderId: args.purchaseOrderId,
    companyId,
    userId
  });

  return updatePurchaseOrderStatus(client, {
    id: args.purchaseOrderId,
    status: "Closed",
    assignee: null,
    updatedBy: userId
  });
}
