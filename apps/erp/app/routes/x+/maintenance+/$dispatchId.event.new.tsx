import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  maintenanceDispatchEventValidator,
  upsertMaintenanceDispatchEvent
} from "~/modules/resources";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const { dispatchId } = params;
  if (!dispatchId) throw new Error("Could not find dispatchId");

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

  const result = await upsertMaintenanceDispatchEvent(client, {
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
