import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { getLocalTimeZone, now } from "@internationalized/date";
import { inngest } from "../../client";

const log = getLogger("jobs", "dispatch");

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
  procedureId: string | null;
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
  const dayField = dayOfWeekFields[dayOfWeek]!;
  return schedule[dayField] === true;
}

// Check if a date is a holiday for the company
async function isHoliday(companyId: string, date: Date): Promise<boolean> {
  const dateString = date.toISOString().split("T")[0]!; // YYYY-MM-DD format

  const serviceRole = getCarbonServiceRole();
  const { data: holiday, error } = await serviceRole
    .from("holiday")
    .select("id")
    .eq("companyId", companyId)
    .eq("date", dateString)
    .maybeSingle();

  if (error) {
    log.error("Error checking holiday", { date: dateString, error });
    return false;
  }

  return holiday !== null;
}

export const dispatchFunction = inngest.createFunction(
  { id: "dispatch", retries: 2 },
  { cron: "0 6 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    return await step.run("generate-maintenance-dispatches", async () => {
      const currentDateTime = now(getLocalTimeZone());
      logger.info("Starting maintenance dispatch generation", {
        startedAt: currentDateTime.toString()
      });

      try {
        // Get all companies with maintenanceGenerateInAdvance enabled
        const { data: companiesWithSettings, error: settingsError } =
          await serviceRole
            .from("companySettings")
            .select("id, maintenanceGenerateInAdvance, maintenanceAdvanceDays")
            .eq("maintenanceGenerateInAdvance", true);

        if (settingsError) {
          logger.error("Failed to fetch company settings", {
            error: settingsError
          });
          return;
        }

        logger.info("Found companies with auto-generation enabled", {
          count: companiesWithSettings?.length || 0
        });

        let totalDispatchesCreated = 0;

        for (const settings of companiesWithSettings ?? []) {
          const advanceDays = settings.maintenanceAdvanceDays ?? 7;
          const futureDate = currentDateTime.add({ days: advanceDays });

          // Get active schedules that are due
          const { data: dueSchedules, error: schedulesError } =
            await serviceRole
              .from("maintenanceSchedule")
              .select("*")
              .eq("companyId", settings.id)
              .eq("active", true)
              .or(
                `nextDueAt.is.null,nextDueAt.lte.${futureDate.toAbsoluteString()}`
              );

          if (schedulesError) {
            logger.error("Failed to fetch schedules for company", {
              companyId: settings.id,
              error: schedulesError
            });
            continue;
          }

          logger.info("Schedules due for company", {
            companyId: settings.id,
            count: dueSchedules?.length || 0
          });

          for (const schedule of dueSchedules ?? []) {
            try {
              const typedSchedule = schedule as MaintenanceSchedule;

              // Track current nextDueAt for this schedule (will be updated as we create dispatches)
              let currentNextDueAt = typedSchedule.nextDueAt
                ? new Date(typedSchedule.nextDueAt)
                : new Date();

              // Loop to create dispatches for all dates within the advance window
              while (
                currentNextDueAt <= new Date(futureDate.toAbsoluteString())
              ) {
                const targetDate = currentNextDueAt;

                // For Daily schedules, check if this day of week is enabled
                if (!isDayEnabledForSchedule(typedSchedule, targetDate)) {
                  logger.info("Skipping schedule - day of week not enabled", {
                    schedule: typedSchedule.name,
                    date: targetDate.toISOString().split("T")[0]
                  });
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
                  const isHolidayDate = await isHoliday(
                    settings.id,
                    targetDate
                  );
                  if (isHolidayDate) {
                    logger.info("Skipping schedule - holiday", {
                      schedule: typedSchedule.name,
                      date: targetDate.toISOString().split("T")[0]
                    });
                    // Advance to next occurrence based on frequency
                    currentNextDueAt = new Date(currentNextDueAt);
                    switch (typedSchedule.frequency) {
                      case "Daily":
                        currentNextDueAt.setDate(
                          currentNextDueAt.getDate() + 1
                        );
                        break;
                      case "Weekly":
                        currentNextDueAt.setDate(
                          currentNextDueAt.getDate() + 7
                        );
                        break;
                      case "Monthly":
                        currentNextDueAt.setMonth(
                          currentNextDueAt.getMonth() + 1
                        );
                        break;
                      case "Quarterly":
                        currentNextDueAt.setMonth(
                          currentNextDueAt.getMonth() + 3
                        );
                        break;
                      case "Annual":
                        currentNextDueAt.setFullYear(
                          currentNextDueAt.getFullYear() + 1
                        );
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
                  logger.error("Failed to get sequence for schedule", {
                    scheduleId: schedule.id,
                    error: sequenceError
                  });
                  break;
                }

                // Create the dispatch
                const { data: newDispatch, error: dispatchError } =
                  await serviceRole
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
                      procedureId: schedule.procedureId,
                      plannedStartTime: targetDate.toISOString(),
                      companyId: settings.id,
                      createdBy: "system"
                    })
                    .select("id")
                    .single();

                if (dispatchError) {
                  logger.error("Failed to create dispatch for schedule", {
                    scheduleId: schedule.id,
                    error: dispatchError
                  });
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
                logger.info("Created dispatch for schedule", {
                  dispatchId: sequenceData,
                  schedule: schedule.name,
                  date: targetDate.toISOString().split("T")[0]
                });

                // Get employees assigned to this work center to notify them
                const { data: workCenterEmployees } = await (serviceRole as any)
                  .from("workCenterEmployee")
                  .select("userId")
                  .eq("workCenterId", schedule.workCenterId);

                if (workCenterEmployees && workCenterEmployees.length > 0) {
                  const userIds = workCenterEmployees.map(
                    (e: any) => e.userId as string
                  );
                  await inngest.send({
                    name: "carbon/notify",
                    data: {
                      event: NotificationEvent.MaintenanceDispatchCreated,
                      companyId: settings.id,
                      documentId: newDispatch.id,
                      recipient: {
                        type: "users" as const,
                        userIds
                      }
                    }
                  });
                  logger.info("Notified work center employees about dispatch", {
                    count: userIds.length,
                    dispatchId: sequenceData
                  });
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
                    currentNextDueAt.setFullYear(
                      currentNextDueAt.getFullYear() + 1
                    );
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
              logger.error("Error processing schedule", {
                scheduleId: schedule.id,
                error: err
              });
            }
          }
        }

        logger.info("Maintenance dispatch generation completed", {
          dispatchesCreated: totalDispatchesCreated
        });

        return { dispatchesCreated: totalDispatchesCreated };
      } catch (error) {
        logger.error("Unexpected error in maintenance generation", { error });
        throw error;
      }
    });
  }
);
