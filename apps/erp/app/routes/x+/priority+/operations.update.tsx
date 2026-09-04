import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  isJobLocked,
  scheduleOperationUpdateValidator
} from "~/modules/production/production.models";
import { notifyScheduleInputsChanged } from "~/modules/production/production.service";

const invalidSchedulingRequest = () => ({
  success: false,
  message: "Invalid scheduling request"
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });
  const validation = await validator(scheduleOperationUpdateValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return {
      success: false,
      message: "Invalid form data"
    };
  }

  const sourceOperation = await client
    .from("jobOperation")
    .select("id, jobId, processId, status, companyId, workCenterId")
    .eq("id", validation.data.id)
    .eq("companyId", companyId)
    .maybeSingle();

  if (
    sourceOperation.error ||
    sourceOperation.data === null ||
    sourceOperation.data.id !== validation.data.id ||
    sourceOperation.data.companyId !== companyId ||
    sourceOperation.data.status === "Done" ||
    sourceOperation.data.status === "Canceled"
  ) {
    return invalidSchedulingRequest();
  }

  const parentJob = await client
    .from("job")
    .select("id, companyId, locationId, status")
    .eq("id", sourceOperation.data.jobId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (
    parentJob.error ||
    parentJob.data === null ||
    parentJob.data.id !== sourceOperation.data.jobId ||
    parentJob.data.companyId !== companyId ||
    isJobLocked(parentJob.data.status)
  ) {
    return invalidSchedulingRequest();
  }

  const destinationWorkCenter = await client
    .from("workCenter")
    .select("id, companyId, active, locationId")
    .eq("id", validation.data.columnId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (
    destinationWorkCenter.error ||
    destinationWorkCenter.data === null ||
    destinationWorkCenter.data.id !== validation.data.columnId ||
    destinationWorkCenter.data.companyId !== companyId ||
    !destinationWorkCenter.data.active ||
    destinationWorkCenter.data.locationId !== parentJob.data.locationId
  ) {
    return invalidSchedulingRequest();
  }

  const compatibleProcess = await client
    .from("workCenterProcess")
    .select("workCenterId")
    .eq("workCenterId", destinationWorkCenter.data.id)
    .eq("processId", sourceOperation.data.processId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (
    compatibleProcess.error ||
    compatibleProcess.data === null ||
    compatibleProcess.data.workCenterId !== destinationWorkCenter.data.id
  ) {
    return invalidSchedulingRequest();
  }

  const { data, error } = await client
    .from("jobOperation")
    .update({
      workCenterId: destinationWorkCenter.data.id,
      priority: validation.data.priority,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", sourceOperation.data.id)
    .eq("companyId", companyId)
    .eq("jobId", sourceOperation.data.jobId)
    .eq("processId", sourceOperation.data.processId)
    .not("status", "in", "(Done,Canceled)")
    .select("id")
    .maybeSingle();

  if (error) {
    return { success: false, message: error.message };
  }

  if (data === null) {
    return { success: false, message: "Operation unavailable" };
  }

  // A work-center change (not a pure priority reorder) moves the op to a
  // different machine, so the forecast must be regenerated — otherwise the
  // reservation stays on the old center and the board and forecast disagree.
  // Reschedule the op's location; a same-center reorder deliberately does not
  // reschedule (it only reorders the manual dispatch sequence).
  if (destinationWorkCenter.data.id !== sourceOperation.data.workCenterId) {
    await notifyScheduleInputsChanged(
      companyId,
      "work-center",
      "Operation reassigned to a different work center",
      destinationWorkCenter.data.id
    );
  }

  return { success: true };
}
