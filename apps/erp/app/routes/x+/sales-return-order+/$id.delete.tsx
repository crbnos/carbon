import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  deleteSalesReturnOrder,
  getSalesReturnOrder,
  getSalesReturnOrderLines
} from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [salesReturnOrder, lines] = await Promise.all([
    getSalesReturnOrder(client, id),
    getSalesReturnOrderLines(client, id, companyId)
  ]);

  if (salesReturnOrder.error) {
    return data(
      {},
      await flash(
        request,
        error(salesReturnOrder.error, "Failed to load sales return order")
      )
    );
  }

  if (!["Draft", "Cancelled"].includes(salesReturnOrder.data?.status ?? "")) {
    return data(
      {},
      await flash(
        request,
        error(
          null,
          "Only draft or cancelled return orders can be deleted. Cancel the order first."
        )
      )
    );
  }

  if ((lines.data ?? []).some((line) => Number(line.quantityReceived) > 0)) {
    return data(
      {},
      await flash(
        request,
        error(null, "Cannot delete a return order with received quantity")
      )
    );
  }

  const salesReturnOrderDelete = await deleteSalesReturnOrder(client, id);

  if (salesReturnOrderDelete.error) {
    return data(
      {},
      await flash(
        request,
        error(
          salesReturnOrderDelete.error,
          salesReturnOrderDelete.error.message
        )
      )
    );
  }

  throw redirect(path.to.salesReturnOrders);
}
