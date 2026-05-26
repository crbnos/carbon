import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { warehouseTransferStatusType } from "~/modules/inventory/inventory.models";
import { updateWarehouseTransferStatus } from "~/modules/inventory/inventory.service.server";

const updateStatusValidator = z.object({
  status: z.enum(warehouseTransferStatusType)
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { transferId } = params;
  if (!transferId) throw new Error("transferId not found");

  const formData = await request.formData();
  const validation = await validator(updateStatusValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await updateWarehouseTransferStatus(
    transferId,
    validation.data.status,
    userId
  );

  if (result.error) {
    return data(
      { error: result.error },
      await flash(
        request,
        error(result.error, "Failed to update warehouse transfer status")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Updated warehouse transfer status"))
  );
}
