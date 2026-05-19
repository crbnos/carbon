import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getSalesOrder,
  isSalesOrderLocked,
  salesOrderPaymentValidator,
  upsertSalesOrderPayment
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  await requirePermissions(request, {
    view: "sales"
  });

  const salesOrder = await getSalesOrder(orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesOrderLocked(salesOrder.data?.status),
    redirectTo: path.to.salesOrderDetails(orderId),
    message: "Cannot modify a locked sales order. Reopen it first."
  });

  const { userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesOrderPaymentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateSalesOrderPayment = await upsertSalesOrderPayment({
    ...validation.data,
    id: orderId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateSalesOrderPayment.error) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(
        request,
        error(
          updateSalesOrderPayment.error,
          "Failed to update sales order payment"
        )
      )
    );
  }

  throw redirect(
    path.to.salesOrderDetails(orderId),
    await flash(request, success("Updated sales order payment"))
  );
}
