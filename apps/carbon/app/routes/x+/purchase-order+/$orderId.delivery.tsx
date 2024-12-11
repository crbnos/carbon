import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  purchaseOrderDeliveryValidator,
  upsertPurchaseOrderDelivery,
} from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const formData = await request.formData();
  const validation = await validator(purchaseOrderDeliveryValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePurchaseOrderDelivery = await upsertPurchaseOrderDelivery(
    client,
    {
      ...validation.data,
      id: orderId,
      updatedBy: userId,
      customFields: setCustomFields(formData),
    }
  );
  if (updatePurchaseOrderDelivery.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(
          updatePurchaseOrderDelivery.error,
          "Failed to update purchase order delivery"
        )
      )
    );
  }

  throw redirect(
    path.to.purchaseOrderDetails(orderId),
    await flash(request, success("Updated purchase order delivery"))
  );
}
