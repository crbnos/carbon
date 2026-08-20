import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  getDueDateForColumn,
  JOB_LOCKED_STATUSES,
  scheduleJobUpdateValidator
} from "~/modules/production/production.models";
import { triggerJobSchedule } from "~/modules/production/production.service";

const logger = getLogger("erp", "dates-update");

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "production"
  });

  const validation = await validator(scheduleJobUpdateValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return {
      success: false,
      message: "Invalid form data"
    };
  }

  const dueDate = getDueDateForColumn(validation.data.columnId);
  if (dueDate === undefined) {
    return { success: false, message: "Invalid form data" };
  }

  const updateData = {
    dueDate,
    priority: validation.data.priority,
    updatedBy: userId,
    updatedAt: new Date().toISOString()
  };

  const { data, error } = await client
    .from("job")
    .update(updateData)
    .eq("id", validation.data.id)
    .eq("companyId", companyId)
    .eq("locationId", validation.data.locationId)
    .not("status", "in", `(${JOB_LOCKED_STATUSES.join(",")})`)
    .select("id")
    .maybeSingle();

  if (error) {
    return { success: false, message: error.message };
  }

  if (data === null) {
    return { success: false, message: "Job unavailable or locked" };
  }

  // Trigger background job rescheduling
  try {
    await triggerJobSchedule(validation.data.id, companyId, userId);
  } catch (rescheduleError) {
    // Log error but don't fail the request - reschedule can retry
    logger.error("Failed to trigger job reschedule", {
      error: rescheduleError
    });
  }

  return { success: true };
}
