import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { batchPropertyOrderValidator } from "~/modules/inventory";
import { updateBatchPropertyOrder } from "~/modules/inventory/inventory.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(batchPropertyOrderValidator).validate(
    formData
  );

  if (validation.error) {
    console.error(validation.error);
    return {
      success: false,
      error: "Invalid form data"
    };
  }

  const upsert = await updateBatchPropertyOrder({
    ...validation.data,
    updatedBy: userId
  });

  if (upsert.error) {
    console.error(upsert.error);
    return {
      success: false,
      error: upsert.error.message
    };
  }

  return {
    success: true
  };
}
