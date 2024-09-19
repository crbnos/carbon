import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  salesOrderShipmentValidator,
  upsertSalesOrderShipment,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const formData = await request.formData();
  const validation = await validator(salesOrderShipmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateSalesOrderShipment = await upsertSalesOrderShipment(client, {
    ...validation.data,
    id: orderId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateSalesOrderShipment.error) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(
        request,
        error(
          updateSalesOrderShipment.error,
          "Failed to update sales order shipment"
        )
      )
    );
  }

  throw redirect(
    path.to.salesOrderDetails(orderId),
    await flash(request, success("Updated sales order shipment"))
  );
}
