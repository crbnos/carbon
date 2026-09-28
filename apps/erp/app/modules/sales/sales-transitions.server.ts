import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import {
  type salesOrderStatusType,
  salesReturnDispositionType
} from "./sales.models";
import {
  cancelSalesOrder,
  setSalesReturnOrderLineDisposition,
  updateSalesOrderStatus
} from "./sales.service";

// Server-only sales status transitions, called by their routes and published
// by `sales.mcp.server.ts` under the tool name of the bare primitive they
// replace.

/**
 * Move a sales order to a new status as its status menu does
 * (`x+/sales-order+/$orderId.status.tsx`). Cancelled runs the cancel flow
 * (`cancelSalesOrder`): the order and the jobs made for it are cancelled —
 * all of them, or only `cancelJobIds` when given. Closed clears the assignee.
 * Returns the message the route flashes.
 */
export async function transitionSalesOrderStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    userId: string;
    status: (typeof salesOrderStatusType)[number];
    cancelJobIds?: string[];
  }
): Promise<{
  data: { id: string; message: string; cancelledJobIds?: string[] } | null;
  error: { message: string } | null;
  cause?: unknown;
}> {
  const { id, userId, status } = args;
  if (status === "Cancelled") {
    const result = await cancelSalesOrder(client, {
      id,
      userId,
      jobs: args.cancelJobIds
    });
    if (!result.success)
      return { data: null, error: { message: result.message } };
    return {
      data: {
        id,
        message: result.message,
        cancelledJobIds: result.cancelledJobIds
      },
      error: null
    };
  }

  const update = await updateSalesOrderStatus(client, {
    id,
    status,
    assignee: status === "Closed" ? null : undefined,
    updatedBy: userId
  });
  if (update.error) {
    return {
      data: null,
      error: { message: "Failed to update sales order status" },
      cause: update.error
    };
  }
  return { data: { id, message: "Updated sales order status" }, error: null };
}

export const ESCALATE_TO_ISSUE_MESSAGE =
  "Scrap and Rework are set by escalating the line to an Issue";

/**
 * Set a return order line's disposition from the line's disposition picker
 * (`x+/sales-return-order+/$id.$lineId.disposition.tsx`). Only the picker's
 * values are accepted, and Scrap and Rework are refused: they are quality
 * decisions made by escalating the line to an Issue, which sets the
 * disposition itself once the NCR exists. The service then refuses a
 * Cancelled return order and any disposition but Pending before a quantity is
 * received.
 */
export async function setReturnLineDispositionFromPicker(
  client: SupabaseClient<Database>,
  args: {
    lineId: string;
    companyId: string;
    userId: string;
    disposition: Database["public"]["Enums"]["disposition"];
  }
): Promise<{
  data: { id: string } | null;
  error: { message: string } | null;
}> {
  const { disposition } = args;
  if (
    !(salesReturnDispositionType as readonly string[]).includes(disposition)
  ) {
    return {
      data: null,
      error: {
        message: `${disposition} is not a disposition for a customer return. Use one of: ${salesReturnDispositionType.join(", ")}.`
      }
    };
  }
  if (disposition === "Scrap" || disposition === "Rework") {
    return { data: null, error: { message: ESCALATE_TO_ISSUE_MESSAGE } };
  }
  return setSalesReturnOrderLineDisposition(client, getDatabaseClient(), args);
}
