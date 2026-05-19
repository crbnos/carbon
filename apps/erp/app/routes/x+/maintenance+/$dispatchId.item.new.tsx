import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  getMaintenanceDispatch,
  isMaintenanceDispatchLocked,
  maintenanceDispatchItemValidator,
  upsertMaintenanceDispatchItem
} from "~/modules/resources";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const { dispatchId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");

  await requirePermissions(request, {
    view: "resources"
  });
  const dispatch = await getMaintenanceDispatch(dispatchId);
  await requireUnlocked({
    request,
    isLocked: isMaintenanceDispatchLocked(dispatch.data?.status),
    redirectTo: path.to.maintenanceDispatch(dispatchId),
    message: "Cannot modify a locked dispatch. Reopen it first."
  });

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

  const result = await upsertMaintenanceDispatchItem({
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
