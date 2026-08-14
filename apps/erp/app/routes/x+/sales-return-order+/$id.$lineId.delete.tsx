import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deleteSalesReturnOrderLine,
  getSalesReturnOrder,
  getSalesReturnOrderLine,
  isSalesReturnOrderLocked
} from "~/modules/sales";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id: orderId, lineId } = params;
  if (!orderId) throw notFound("Could not find orderId");
  if (!lineId) throw notFound("Could not find lineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });

  const [salesReturnOrder, line] = await Promise.all([
    getSalesReturnOrder(viewClient, orderId),
    getSalesReturnOrderLine(viewClient, lineId)
  ]);

  await requireUnlocked({
    request,
    isLocked: isSalesReturnOrderLocked(salesReturnOrder.data?.status),
    redirectTo: path.to.salesReturnOrder(orderId),
    message: "Cannot delete lines on a completed or cancelled return order."
  });

  if (Number(line.data?.quantityReceived) > 0) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesReturnOrder(orderId),
      await flash(
        request,
        error(null, "Cannot delete a line with received quantity")
      )
    );
  }

  const { client } = await requirePermissions(request, {
    delete: "sales"
  });

  const { error: deleteLineError } = await deleteSalesReturnOrderLine(
    client,
    lineId
  );
  if (deleteLineError) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesReturnOrder(orderId),
      await flash(
        request,
        error(deleteLineError, "Failed to delete return order line")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.salesReturnOrder(orderId),
    await flash(request, success("Successfully deleted return order line"))
  );
}
