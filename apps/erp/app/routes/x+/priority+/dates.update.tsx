import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  getDueDateForColumn,
  JOB_LOCKED_STATUSES,
  scheduleJobUpdateValidator
} from "~/modules/production/production.models";
import { notifyScheduleInputsChanged } from "~/modules/production/production.service";

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
    updatedAt: datetime.timestamp()
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

  // Stamp the affected jobs schedule-outdated; the debounced wave then
  // regenerates the whole location coherently in dueDate -> priority order so
  // the board's card order IS the queue order. No immediate single-job path —
  // the wave is the single source of truth for placement.
  try {
    await notifyScheduleInputsChanged(
      companyId,
      "reorder",
      "Schedule reordered"
    );
  } catch (rescheduleError) {
    // Log error but don't fail the request - the wave can retry
    logger.error("Failed to notify schedule inputs changed", {
      error: rescheduleError
    });
  }

  return { success: true };
}
