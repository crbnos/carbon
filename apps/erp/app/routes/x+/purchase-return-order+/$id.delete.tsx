import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  deletePurchaseReturnOrder,
  getPurchaseReturnOrder,
  getPurchaseReturnOrderLines
} from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [purchaseReturnOrder, lines] = await Promise.all([
    getPurchaseReturnOrder(client, id),
    getPurchaseReturnOrderLines(client, id, companyId)
  ]);

  if (purchaseReturnOrder.error) {
    return data(
      {},
      await flash(
        request,
        error(purchaseReturnOrder.error, "Failed to load purchase return order")
      )
    );
  }

  if (
    !["Draft", "Cancelled"].includes(purchaseReturnOrder.data?.status ?? "")
  ) {
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

  if ((lines.data ?? []).some((line) => Number(line.quantityShipped) > 0)) {
    return data(
      {},
      await flash(
        request,
        error(null, "Cannot delete a return order with shipped quantity")
      )
    );
  }

  const purchaseReturnOrderDelete = await deletePurchaseReturnOrder(client, id);

  if (purchaseReturnOrderDelete.error) {
    return data(
      {},
      await flash(
        request,
        error(
          purchaseReturnOrderDelete.error,
          purchaseReturnOrderDelete.error.message
        )
      )
    );
  }

  throw redirect(path.to.purchaseReturnOrders);
}
