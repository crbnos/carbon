import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  getSalesReturnOrder,
  getSalesReturnOrderLine,
  shortCloseSalesReturnOrderLine
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Intentionally does NOT use requireUnlocked — short close only makes sense
// on confirmed (in-flight) return orders.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id: orderId, lineId } = params;
  if (!orderId) throw notFound("Could not find orderId");
  if (!lineId) throw notFound("Could not find lineId");

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "close" && intent !== "reopen") {
    return data(
      {},
      await flash(request, error(null, "Invalid receiving intent"))
    );
  }

  const [salesReturnOrder, line] = await Promise.all([
    getSalesReturnOrder(client, orderId),
    getSalesReturnOrderLine(client, lineId)
  ]);

  if (salesReturnOrder.error || line.error) {
    throw redirect(
      path.to.salesReturnOrderDetails(orderId),
      await flash(
        request,
        error(
          salesReturnOrder.error ?? line.error,
          "Failed to load return order line"
        )
      )
    );
  }

  const status = salesReturnOrder.data?.status;

  const failWith = async (message: string) =>
    redirect(
      path.to.salesReturnOrderDetails(orderId),
      await flash(request, error(null, message))
    );

  if (!["Confirmed", "Partially Received", "Received"].includes(status ?? "")) {
    throw await failWith(
      "Receiving can only be closed or reopened on a confirmed return order"
    );
  }
  if (line.data?.salesReturnOrderId !== orderId) {
    throw await failWith("This line does not belong to this return order");
  }
  if (intent === "close" && line.data?.closedComplete) {
    throw await failWith("Receiving is already closed for this line");
  }
  if (intent === "reopen" && !line.data?.closedComplete) {
    throw await failWith("Receiving is not closed for this line");
  }

  try {
    await shortCloseSalesReturnOrderLine(getDatabaseClient(), {
      lineId,
      salesReturnOrderId: orderId,
      companyId,
      userId,
      intent
    });
  } catch (err) {
    throw redirect(
      path.to.salesReturnOrderDetails(orderId),
      await flash(request, error(err, "Failed to update line receiving"))
    );
  }

  throw redirect(
    path.to.salesReturnOrderLine(orderId, lineId),
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
