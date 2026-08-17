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
  setSalesReturnOrderLineTrackedEntities,
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

  const { id: _id, trackedEntityIds, ...d } = validation.data;

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

  if (trackedEntityIds && trackedEntityIds.length > 0) {
    const setEntities = await setSalesReturnOrderLineTrackedEntities(
      client,
      createLine.data.id,
      companyId,
      trackedEntityIds,
      userId
    );
    if (setEntities.error) {
      throw redirect(
        path.to.salesReturnOrderLine(orderId, createLine.data.id),
        await flash(
          request,
          error(setEntities.error, "Failed to set tracked entities")
        )
      );
    }
  }

  throw redirect(path.to.salesReturnOrderLine(orderId, createLine.data.id));
}
