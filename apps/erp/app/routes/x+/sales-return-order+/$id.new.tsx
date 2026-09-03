import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getSalesReturnOrder,
  isSalesReturnOrderLocked,
  salesReturnOrderLineValidator,
  upsertSalesReturnOrderLine
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id: orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });

  const salesReturnOrder = await getSalesReturnOrder(viewClient, orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesReturnOrderLocked(salesReturnOrder.data?.status),
    redirectTo: path.to.salesReturnOrderDetails(orderId),
    message: "Cannot add lines to a completed or cancelled return order."
  });

  // Line quantities are validated against source caps at Confirm; adding
  // lines afterwards would bypass that validation entirely.
  if (salesReturnOrder.data?.status !== "Draft") {
    throw redirect(
      path.to.salesReturnOrderDetails(orderId),
      await flash(
        request,
        error(null, "Lines can only be added while the return order is Draft")
      )
    );
  }

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesReturnOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  // The locked-order guard above checked the URL's order — write to that same
  // order, never the form's copy of the id.
  d.salesReturnOrderId = orderId;

  const createLine = await upsertSalesReturnOrderLine(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createLine.error || !createLine.data) {
    throw redirect(
      path.to.salesReturnOrderDetails(orderId),
      await flash(
        request,
        error(createLine.error, "Failed to create return order line")
      )
    );
  }

  // A line added from a document knows its sales order — link the header
  // automatically when it isn't linked yet. The first line's order wins and a
  // manually-linked header is never overwritten, so multi-order returns still
  // work. Best-effort: a failure here leaves the manual link available.
  if (!salesReturnOrder.data?.salesOrderId && d.salesOrderLineId) {
    const salesOrderLine = await client
      .from("salesOrderLine")
      .select("salesOrderId")
      .eq("id", d.salesOrderLineId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (salesOrderLine.data?.salesOrderId) {
      await client
        .from("salesReturnOrder")
        .update({
          salesOrderId: salesOrderLine.data.salesOrderId,
          updatedBy: userId
        })
        .eq("id", orderId)
        .eq("companyId", companyId);
    }
  }

  throw redirect(path.to.salesReturnOrderLine(orderId, createLine.data.id));
}
