import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  getPurchaseReturnOrder,
  getPurchaseReturnOrderLine,
  shortClosePurchaseReturnOrderLine
} from "~/modules/purchasing";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Intentionally does NOT use requireUnlocked — short close only makes sense
// on confirmed (in-flight) return orders.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id: orderId, lineId } = params;
  if (!orderId) throw notFound("Could not find orderId");
  if (!lineId) throw notFound("Could not find lineId");

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "close" && intent !== "reopen") {
    return data(
      {},
      await flash(request, error(null, "Invalid shipping intent"))
    );
  }

  const [purchaseReturnOrder, line] = await Promise.all([
    getPurchaseReturnOrder(client, orderId),
    getPurchaseReturnOrderLine(client, lineId)
  ]);

  if (purchaseReturnOrder.error || line.error) {
    throw redirect(
      path.to.purchaseReturnOrderDetails(orderId),
      await flash(
        request,
        error(
          purchaseReturnOrder.error ?? line.error,
          "Failed to load return order line"
        )
      )
    );
  }

  const status = purchaseReturnOrder.data?.status;

  const failWith = async (message: string) =>
    redirect(
      path.to.purchaseReturnOrderDetails(orderId),
      await flash(request, error(null, message))
    );

  if (!["Confirmed", "Partially Shipped", "Shipped"].includes(status ?? "")) {
    throw await failWith(
      "Shipping can only be closed or reopened on a confirmed return order"
    );
  }
  if (line.data?.purchaseReturnOrderId !== orderId) {
    throw await failWith("This line does not belong to this return order");
  }
  if (intent === "close" && line.data?.closedComplete) {
    throw await failWith("Shipping is already closed for this line");
  }
  if (intent === "reopen" && !line.data?.closedComplete) {
    throw await failWith("Shipping is not closed for this line");
  }

  try {
    await shortClosePurchaseReturnOrderLine(getDatabaseClient(), {
      lineId,
      purchaseReturnOrderId: orderId,
      companyId,
      userId,
      intent
    });
  } catch (err) {
    throw redirect(
      path.to.purchaseReturnOrderDetails(orderId),
      await flash(request, error(err, "Failed to update line shipping"))
    );
  }

  throw redirect(
    path.to.purchaseReturnOrderLine(orderId, lineId),
    await flash(
      request,
      success(
        intent === "close"
          ? "Stopped shipping for line"
          : "Resumed shipping for line"
      )
    )
  );
}
