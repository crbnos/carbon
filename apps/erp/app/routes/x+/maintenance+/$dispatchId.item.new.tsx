import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  maintenanceDispatchItemValidator,
  upsertMaintenanceDispatchItem
} from "~/modules/resources";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const { dispatchId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");

  const formData = await request.formData();
  const validation = await validator(maintenanceDispatchItemValidator).validate(
    formData
  );

  if (validation.error) {
    return {
      success: false,
      message: "Invalid form data"
    };
  }

  const { itemId, quantity, unitOfMeasureCode, unitCost } = validation.data;

  const result = await upsertMaintenanceDispatchItem(client, {
    maintenanceDispatchId: dispatchId,
    itemId,
    quantity,
    unitOfMeasureCode,
    unitCost: unitCost ?? 0,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return {
      success: false,
      message: "Failed to add item"
    };
  }

  return { success: true };
}
