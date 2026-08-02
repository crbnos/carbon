import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  isJobLocked,
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

  // Completed, Closed, and Cancelled jobs are locked — reject the reschedule
  // before persisting the new due date/priority so a drag on a locked card
  // cannot rewrite its dates or trigger the scheduling engine.
  const { data: job, error: jobError } = await client
    .from("job")
    .select("status")
    .eq("id", validation.data.id)
    .single();

  if (jobError || !job) {
    return { success: false, message: "Job not found" };
  }

  if (isJobLocked(job.status)) {
    return {
      success: false,
      message: "This job is locked and cannot be rescheduled"
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
    updatedAt: new Date().toISOString()
  };

  const { error } = await client
    .from("job")
    .update(updateData)
    .eq("id", validation.data.id);

  if (error) {
    return { success: false, message: error.message };
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
