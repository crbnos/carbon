import { getCarbonServiceRole } from "@carbon/auth";
import { NotificationEvent } from "@carbon/notifications";
import { schedules } from "@trigger.dev/sdk";
import { now, getLocalTimeZone } from "@internationalized/date";
import { notifyTask } from "./notify.ts";

const serviceRole = getCarbonServiceRole();

// Day of week mapping (0 = Sunday, 1 = Monday, etc.)
const dayOfWeekFields = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

interface MaintenanceSchedule {
  id: string;
  name: string;
  frequency: string;
  priority: string;
  workCenterId: string;
  nextDueAt: string | null;
  skipHolidays: boolean;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

// Check if a date is enabled for the schedule based on day-of-week settings
function isDayEnabledForSchedule(
  schedule: MaintenanceSchedule,
  targetDate: Date
): boolean {
  // Only check day-of-week for Daily frequency
  if (schedule.frequency !== "Daily") {
    return true;
  }

  const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const dayField = dayOfWeekFields[dayOfWeek];
  return schedule[dayField] === true;
}

// Check if a date is a holiday for the company
async function isHoliday(companyId: string, date: Date): Promise<boolean> {
  const dateString = date.toISOString().split("T")[0]; // YYYY-MM-DD format

  const { data: holiday, error } = await serviceRole
    .from("holiday")
    .select("id")
    .eq("companyId", companyId)
    .eq("date", dateString)
    .maybeSingle();

  if (error) {
    console.error(`Error checking holiday for ${dateString}: ${error.message}`);
    return false;
  }

  return holiday !== null;
}

export const generateMaintenanceDispatches = schedules.task({
  id: "dispatch",
  // Run daily at 6 AM UTC
  cron: "0 6 * * *",
  run: async () => {
    const currentDateTime = now(getLocalTimeZone());
    console.log(
      `🔧 Starting maintenance dispatch generation: ${currentDateTime.toString()}`
    );

    try {
      // Get all companies with maintenanceGenerateInAdvance enabled
      const { data: companiesWithSettings, error: settingsError } =
        await serviceRole
          .from("companySettings")
          .select("id, maintenanceGenerateInAdvance, maintenanceAdvanceDays")
          .eq("maintenanceGenerateInAdvance", true);

      if (settingsError) {
        console.error(
          `Failed to fetch company settings: ${settingsError.message}`
        );
        return;
      }

      console.log(
        `Found ${companiesWithSettings?.length || 0} companies with auto-generation enabled`
      );

      let totalDispatchesCreated = 0;

      for (const settings of companiesWithSettings ?? []) {
        const advanceDays = settings.maintenanceAdvanceDays ?? 7;
        const futureDate = currentDateTime.add({ days: advanceDays });

        // Get active schedules that are due
        const { data: dueSchedules, error: schedulesError } = await serviceRole
          .from("maintenanceSchedule")
          .select("*")
          .eq("companyId", settings.id)
          .eq("active", true)
          .or(`nextDueAt.is.null,nextDueAt.lte.${futureDate.toAbsoluteString()}`);

        if (schedulesError) {
          console.error(
            `Failed to fetch schedules for company ${settings.id}: ${schedulesError.message}`
          );
          continue;
        }

        console.log(
          `Company ${settings.id}: ${dueSchedules?.length || 0} schedules due`
        );

        for (const schedule of dueSchedules ?? []) {
          try {
            const typedSchedule = schedule as MaintenanceSchedule;

            // Track current nextDueAt for this schedule (will be updated as we create dispatches)
            let currentNextDueAt = typedSchedule.nextDueAt
              ? new Date(typedSchedule.nextDueAt)
              : new Date();

            // Loop to create dispatches for all dates within the advance window
            while (currentNextDueAt <= new Date(futureDate.toAbsoluteString())) {
              const targetDate = currentNextDueAt;

              // For Daily schedules, check if this day of week is enabled
              if (!isDayEnabledForSchedule(typedSchedule, targetDate)) {
                console.log(
                  `Skipping schedule "${typedSchedule.name}" for ${targetDate.toISOString().split("T")[0]} - day of week not enabled`
                );
                // Advance to next day for daily schedules
                if (typedSchedule.frequency === "Daily") {
                  currentNextDueAt = new Date(currentNextDueAt);
                  currentNextDueAt.setDate(currentNextDueAt.getDate() + 1);
                  continue;
                }
                break;
              }

              // Check if this date is a holiday and skipHolidays is enabled
              if (typedSchedule.skipHolidays) {
                const isHolidayDate = await isHoliday(settings.id, targetDate);
                if (isHolidayDate) {
                  console.log(
                    `Skipping schedule "${typedSchedule.name}" - ${targetDate.toISOString().split("T")[0]} is a holiday`
                  );
                  // Advance to next occurrence based on frequency
                  currentNextDueAt = new Date(currentNextDueAt);
                  switch (typedSchedule.frequency) {
                    case "Daily":
                      currentNextDueAt.setDate(currentNextDueAt.getDate() + 1);
                      break;
                    case "Weekly":
                      currentNextDueAt.setDate(currentNextDueAt.getDate() + 7);
                      break;
                    case "Monthly":
                      currentNextDueAt.setMonth(currentNextDueAt.getMonth() + 1);
                      break;
                    case "Quarterly":
                      currentNextDueAt.setMonth(currentNextDueAt.getMonth() + 3);
                      break;
                    case "Annual":
                      currentNextDueAt.setFullYear(currentNextDueAt.getFullYear() + 1);
                      break;
                  }
                  continue;
                }
              }

              // Get next sequence number
              const { data: sequenceData, error: sequenceError } =
                await serviceRole.rpc("get_next_sequence", {
                  sequence_name: "maintenanceDispatch",
                  company_id: settings.id
                });

              if (sequenceError) {
                console.error(
                  `Failed to get sequence for schedule ${schedule.id}: ${sequenceError.message}`
                );
                break;
              }

              // Create the dispatch
              const { data: newDispatch, error: dispatchError } = await serviceRole
                .from("maintenanceDispatch")
                .insert({
                  maintenanceDispatchId: sequenceData,
                  status: "Open",
                  priority: schedule.priority,
                  source: "Scheduled",
                  severity: "Preventive",
                  oeeImpact: "Planned",
                  workCenterId: schedule.workCenterId,
                  maintenanceScheduleId: schedule.id,
                  plannedStartTime: targetDate.toISOString(),
                  companyId: settings.id,
                  createdBy: "system"
                })
                .select("id")
                .single();

              if (dispatchError) {
                console.error(
                  `Failed to create dispatch for schedule ${schedule.id}: ${dispatchError.message}`
                );
                break;
              }

              // Copy items from schedule to dispatch
              const { data: scheduleItems } = await serviceRole
                .from("maintenanceScheduleItem")
                .select("itemId, quantity, unitOfMeasureCode")
                .eq("maintenanceScheduleId", schedule.id);

              if (scheduleItems && scheduleItems.length > 0) {
                await serviceRole.from("maintenanceDispatchItem").insert(
                  scheduleItems.map((item) => ({
                    maintenanceDispatchId: newDispatch.id,
                    itemId: item.itemId,
                    quantity: item.quantity,
                    unitOfMeasureCode: item.unitOfMeasureCode,
                    companyId: settings.id,
                    createdBy: "system"
                  }))
                );
              }

              // Link work center
              await serviceRole.from("maintenanceDispatchWorkCenter").insert({
                maintenanceDispatchId: newDispatch.id,
                workCenterId: schedule.workCenterId,
                companyId: settings.id,
                createdBy: "system"
              });

              totalDispatchesCreated++;
              console.log(
                `Created dispatch ${sequenceData} for schedule "${schedule.name}" on ${targetDate.toISOString().split("T")[0]}`
              );

              // Get employees assigned to this work center to notify them
              const { data: workCenterEmployees } = await serviceRole
                .from("workCenterEmployee")
                .select("userId")
                .eq("workCenterId", schedule.workCenterId);

              if (workCenterEmployees && workCenterEmployees.length > 0) {
                const userIds = workCenterEmployees.map((e) => e.userId);
                await notifyTask.trigger({
                  event: NotificationEvent.MaintenanceDispatchCreated,
                  companyId: settings.id,
                  documentId: newDispatch.id,
                  recipient: {
                    type: "users",
                    userIds
                  }
                });
                console.log(
                  `Notified ${userIds.length} work center employees about dispatch ${sequenceData}`
                );
              }

              // Calculate next due date based on frequency
              currentNextDueAt = new Date(currentNextDueAt);
              switch (schedule.frequency) {
                case "Daily":
                  currentNextDueAt.setDate(currentNextDueAt.getDate() + 1);
                  break;
                case "Weekly":
                  currentNextDueAt.setDate(currentNextDueAt.getDate() + 7);
                  break;
                case "Monthly":
                  currentNextDueAt.setMonth(currentNextDueAt.getMonth() + 1);
                  break;
                case "Quarterly":
                  currentNextDueAt.setMonth(currentNextDueAt.getMonth() + 3);
                  break;
                case "Annual":
                  currentNextDueAt.setFullYear(currentNextDueAt.getFullYear() + 1);
                  break;
              }
            }

            // Update schedule's lastGeneratedAt and nextDueAt after processing all dates
            await serviceRole
              .from("maintenanceSchedule")
              .update({
                lastGeneratedAt: currentDateTime.toAbsoluteString(),
                nextDueAt: currentNextDueAt.toISOString()
              })
              .eq("id", schedule.id);

          } catch (err) {
            console.error(
              `Error processing schedule ${schedule.id}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      console.log(
        `🔧 Maintenance dispatch generation completed: ${totalDispatchesCreated} dispatches created`
      );

      return { dispatchesCreated: totalDispatchesCreated };
    } catch (error) {
      console.error(
        `Unexpected error in maintenance generation: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }
});
