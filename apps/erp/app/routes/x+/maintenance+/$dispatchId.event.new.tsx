import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  getMaintenanceDispatch,
  isMaintenanceDispatchLocked,
  maintenanceDispatchEventValidator,
  upsertMaintenanceDispatchEvent
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

  const { client: viewClient } = await requirePermissions(request, {
    view: "resources"
  });
  const dispatch = await getMaintenanceDispatch(viewClient, dispatchId);
  await requireUnlocked({
    request,
    isLocked: isMaintenanceDispatchLocked(dispatch.data?.status),
    redirectTo: path.to.maintenanceDispatch(dispatchId),
    message: "Cannot modify a locked dispatch. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(
    maintenanceDispatchEventValidator
  ).validate(formData);

  if (validation.error) {
    return {
      success: false,
      message: "Invalid form data"
    };
  }

  const { employeeId, workCenterId, startTime, endTime, notes } =
    validation.data;

  const result = await upsertMaintenanceDispatchEvent({
    maintenanceDispatchId: dispatchId,
    employeeId,
    workCenterId,
    startTime,
    endTime: endTime ?? undefined,
    notes: notes ?? undefined,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return {
      success: false,
      message: "Failed to add timecard"
    };
  }

  return { success: true };
}
