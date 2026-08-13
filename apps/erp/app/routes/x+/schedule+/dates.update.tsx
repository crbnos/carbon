import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { scheduleJobUpdateValidator } from "~/modules/production/production.models";
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

  // Parse the columnId to determine the due date
  // For date columns: columnId will be a date string like "2025-11-22"
  // For special columns: "next-week", "next-month", or "unscheduled"
  // we'll set dueDate to null
  let dueDate: string | null = null;

  if (
    validation.data.columnId !== "unscheduled" &&
    validation.data.columnId !== "next-week" &&
    validation.data.columnId !== "next-month"
  ) {
    // It's a date string, use it as the due date
    dueDate = validation.data.columnId;
  }

  const updateData = {
    dueDate,
    priority: validation.data.priority,
    updatedBy: userId,
    updatedAt: datetime.timestamp()
  };

  const { error } = await client
    .from("job")
    .update(updateData)
    .eq("id", validation.data.id);

  if (error) {
    return { success: false, message: error.message };
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
