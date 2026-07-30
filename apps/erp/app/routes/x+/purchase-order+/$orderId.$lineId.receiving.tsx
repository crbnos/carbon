import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  getPurchaseOrder,
  getPurchaseOrderLine,
  shortClosePurchaseOrderLine
} from "~/modules/purchasing";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Intentionally does NOT use requireUnlocked — short close only makes sense
// on released (locked) orders.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { lineId, orderId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!orderId) throw notFound("Could not find orderId");

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "close" && intent !== "reopen") {
    return data(
      {},
      await flash(request, error(null, "Invalid receiving intent"))
    );
  }

  const [purchaseOrder, purchaseOrderLine] = await Promise.all([
    getPurchaseOrder(client, orderId),
    getPurchaseOrderLine(client, lineId)
  ]);

  if (purchaseOrder.error || purchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(
          purchaseOrder.error ?? purchaseOrderLine.error,
          "Failed to load purchase order line"
        )
      )
    );
  }

  const line = purchaseOrderLine.data;
  const status = purchaseOrder.data?.status;

  const failWith = async (message: string) =>
    redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(request, error(null, message))
    );

  if (
    ![
      "To Receive",
      "To Receive and Invoice",
      "To Invoice",
      "Completed"
    ].includes(status ?? "")
  ) {
    throw await failWith(
      "Receiving can only be closed or reopened on a released purchase order"
    );
  }
  if (
    line?.purchaseOrderId !== orderId ||
    line?.purchaseOrderLineType === "Comment" ||
    line?.purchaseOrderLineType === "G/L Account"
  ) {
    throw await failWith("This line cannot be received");
  }
  if ((line?.quantityToReceive ?? 0) <= 0) {
    throw await failWith("This line has no outstanding quantity to receive");
  }
  if (intent === "close" && line?.receivedComplete) {
    throw await failWith("Receiving is already closed for this line");
  }
  if (intent === "reopen" && !line?.receivedComplete) {
    throw await failWith("Receiving is not closed for this line");
  }

  try {
    await shortClosePurchaseOrderLine(getDatabaseClient(), {
      lineId,
      purchaseOrderId: orderId,
      companyId,
      userId,
      intent
    });
  } catch (err) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(request, error(err, "Failed to update line receiving"))
    );
  }

  throw redirect(
    path.to.purchaseOrderDetails(orderId),
    await flash(
      request,
      success(
        intent === "close"
          ? "Stopped receiving for line"
          : "Resumed receiving for line"
      )
    )
  );
}
