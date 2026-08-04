import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { getLocalTimeZone, now } from "@internationalized/date";
import { inngest } from "../../client";

const log = getLogger("jobs", "dispatch");

// How many days ahead we pre-create preventive maintenance dispatches and
// advance each schedule's nextDueAt. Standardized for all companies.
const MAINTENANCE_ADVANCE_DAYS = 7;

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
  locationId: string | null;
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

/**
 * Create every preventive-maintenance dispatch for one schedule that falls
 * inside the advance window, then advance the schedule's `nextDueAt` past it.
 *
 * A `nextDueAt` of `null` means the schedule has never been generated (freshly
 * created), so generation starts from now. This is shared by the nightly cron
 * (which fans it out over every due schedule) and the on-create/on-update
 * trigger (which runs it for a single schedule immediately, so the schedule is
 * live on the maintenance displays right away instead of after the next cron).
 *
 * Idempotent within the window: a second run finds `nextDueAt` already past
 * `futureDate`, creates nothing, and re-writes the same value.
 */
export async function generateDispatchesForSchedule(args: {
  serviceRole: ReturnType<typeof getCarbonServiceRole>;
  schedule: MaintenanceSchedule;
  companyId: string;
  currentDateTime: ReturnType<typeof now>;
}): Promise<number> {
  const { serviceRole, schedule, companyId, currentDateTime } = args;
  const futureDate = currentDateTime.add({ days: MAINTENANCE_ADVANCE_DAYS });
  const horizon = new Date(futureDate.toAbsoluteString());

  let dispatchesCreated = 0;

  // Track current nextDueAt for this schedule (advanced as we create dispatches).
  // A never-generated schedule (nextDueAt null) starts one interval out rather
  // than "now": seeding at the current instant would create a dispatch whose
  // planned start is immediately in the past, so a brand-new schedule would show
  // as overdue the moment it is created.
  let currentNextDueAt = schedule.nextDueAt
    ? new Date(schedule.nextDueAt)
    : advanceByFrequency(new Date(), schedule.frequency);

  // Loop to create dispatches for all dates within the advance window
  while (currentNextDueAt <= horizon) {
    const targetDate = currentNextDueAt;

    // For Daily schedules, check if this day of week is enabled
    if (!isDayEnabledForSchedule(schedule, targetDate)) {
      log.info("Skipping schedule - day of week not enabled", {
        schedule: schedule.name,
        date: targetDate.toISOString().split("T")[0]
      });
      // Advance to next day for daily schedules
      if (schedule.frequency === "Daily") {
        currentNextDueAt = new Date(currentNextDueAt);
        currentNextDueAt.setDate(currentNextDueAt.getDate() + 1);
        continue;
      }
      break;
    }

    // Check if this date is a holiday and skipHolidays is enabled
    if (schedule.skipHolidays) {
      const isHolidayDate = await isHoliday(companyId, targetDate);
      if (isHolidayDate) {
        log.info("Skipping schedule - holiday", {
          schedule: schedule.name,
          date: targetDate.toISOString().split("T")[0]
        });
        // Advance to next occurrence based on frequency
        currentNextDueAt = advanceByFrequency(
          currentNextDueAt,
          schedule.frequency
        );
        continue;
      }
    }

    // Guard against duplicate generation. The nightly cron and the
    // on-create/update trigger can both run for the same schedule; each reads
    // nextDueAt and creates dispatches, so overlapping runs could insert two
    // dispatches for the same occurrence. Skip the date if one already exists
    // for this schedule that day (still advancing nextDueAt past it).
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);
    const { data: existingForDay } = await serviceRole
      .from("maintenanceDispatch")
      .select("id")
      .eq("companyId", companyId)
      .eq("maintenanceScheduleId", schedule.id)
      .gte("plannedStartTime", dayStart.toISOString())
      .lte("plannedStartTime", dayEnd.toISOString())
      .limit(1)
      .maybeSingle();
    if (existingForDay) {
      currentNextDueAt = advanceByFrequency(
        currentNextDueAt,
        schedule.frequency
      );
      continue;
    }

    // Get next sequence number
    const { data: sequenceData, error: sequenceError } = await serviceRole.rpc(
      "get_next_sequence",
      {
        sequence_name: "maintenanceDispatch",
        company_id: companyId
      }
    );

    if (sequenceError) {
      log.error("Failed to get sequence for schedule", {
        scheduleId: schedule.id,
        error: sequenceError
      });
      break;
    }

    // Create the dispatch
    const { data: newDispatch, error: dispatchError } = await serviceRole
      .from("maintenanceDispatch")
      .insert({
        maintenanceDispatchId: sequenceData,
        status: "Open",
        priority: schedule.priority as "Low" | "Medium" | "High" | "Critical",
        source: "Scheduled",
        severity: "Preventive",
        oeeImpact: "Planned",
        workCenterId: schedule.workCenterId,
        // The maintenance list filters dispatches by their own locationId, so a
        // generated dispatch must carry the schedule's location or it is
        // invisible in the ERP (it still shows on the work-center display).
        locationId: schedule.locationId,
        maintenanceScheduleId: schedule.id,
        procedureId: schedule.procedureId,
        plannedStartTime: targetDate.toISOString(),
        companyId,
        createdBy: "system"
      })
      .select("id")
      .single();

    if (dispatchError) {
      log.error("Failed to create dispatch for schedule", {
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
      const { error: itemsError } = await serviceRole
        .from("maintenanceDispatchItem")
        .insert(
          scheduleItems.map((item) => ({
            maintenanceDispatchId: newDispatch.id,
            itemId: item.itemId,
            quantity: item.quantity,
            unitOfMeasureCode: item.unitOfMeasureCode,
            companyId,
            createdBy: "system"
          }))
        );
      if (itemsError) {
        log.error("Failed to copy schedule items to dispatch", {
          scheduleId: schedule.id,
          dispatchId: sequenceData,
          error: itemsError
        });
      }
    }

    // Link work center
    const { error: workCenterLinkError } = await serviceRole
      .from("maintenanceDispatchWorkCenter")
      .insert({
        maintenanceDispatchId: newDispatch.id,
        workCenterId: schedule.workCenterId,
        companyId,
        createdBy: "system"
      });
    if (workCenterLinkError) {
      log.error("Failed to link work center to dispatch", {
        scheduleId: schedule.id,
        dispatchId: sequenceData,
        error: workCenterLinkError
      });
    }

    dispatchesCreated++;
    log.info("Created dispatch for schedule", {
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
      const userIds = workCenterEmployees.map((e: any) => e.userId as string);
      await inngest.send({
        name: "carbon/notify",
        data: {
          event: NotificationEvent.MaintenanceDispatchCreated,
          companyId,
          documentId: newDispatch.id,
          recipient: {
            type: "users" as const,
            userIds
          }
        }
      });
      log.info("Notified work center employees about dispatch", {
        count: userIds.length,
        dispatchId: sequenceData
      });
    }

    // Calculate next due date based on frequency
    currentNextDueAt = advanceByFrequency(currentNextDueAt, schedule.frequency);
  }

  // Update schedule's lastGeneratedAt and nextDueAt after processing all dates
  await serviceRole
    .from("maintenanceSchedule")
    .update({
      lastGeneratedAt: currentDateTime.toAbsoluteString(),
      nextDueAt: currentNextDueAt.toISOString()
    })
    .eq("id", schedule.id);

  return dispatchesCreated;
}

// Advance a date to the next occurrence for a given frequency.
function advanceByFrequency(from: Date, frequency: string): Date {
  const next = new Date(from);
  switch (frequency) {
    case "Daily":
      next.setDate(next.getDate() + 1);
      break;
    case "Weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "Monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    case "Quarterly":
      next.setMonth(next.getMonth() + 3);
      break;
    case "Annual":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
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
        // Generate for every company; the schedule query below is the real
        // gate (only active schedules that are due within the advance window).
        const { data: companiesWithSettings, error: settingsError } =
          await serviceRole.from("companySettings").select("id");

        if (settingsError) {
          logger.error("Failed to fetch company settings", {
            error: settingsError
          });
          return;
        }

        logger.info("Found companies", {
          count: companiesWithSettings?.length || 0
        });

        let totalDispatchesCreated = 0;

        for (const settings of companiesWithSettings ?? []) {
          const advanceDays = MAINTENANCE_ADVANCE_DAYS;
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
              totalDispatchesCreated += await generateDispatchesForSchedule({
                serviceRole,
                schedule: schedule as MaintenanceSchedule,
                companyId: settings.id,
                currentDateTime
              });
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

/**
 * Generate dispatches for a single schedule on demand, triggered when a
 * maintenance schedule is created or updated in the ERP. Runs the same logic
 * the nightly cron does, so a new schedule shows up on the maintenance
 * displays immediately instead of waiting until the next 6am run.
 */
export const generateMaintenanceForScheduleFunction = inngest.createFunction(
  { id: "generate-maintenance", retries: 2 },
  { event: "carbon/generate-maintenance" },
  async ({ event, step, logger }) => {
    const { companyId, scheduleId } = event.data;

    return await step.run("generate-schedule-dispatches", async () => {
      const serviceRole = getCarbonServiceRole();
      const currentDateTime = now(getLocalTimeZone());

      const { data: schedule, error } = await serviceRole
        .from("maintenanceSchedule")
        .select("*")
        .eq("id", scheduleId)
        .eq("companyId", companyId)
        .maybeSingle();

      if (error) {
        logger.error("Failed to load schedule for generation", {
          scheduleId,
          error
        });
        throw error;
      }

      // Nothing to do for a missing or deactivated schedule.
      if (!schedule || schedule.active !== true) {
        return { dispatchesCreated: 0 };
      }

      const dispatchesCreated = await generateDispatchesForSchedule({
        serviceRole,
        schedule: schedule as MaintenanceSchedule,
        companyId,
        currentDateTime
      });

      logger.info("Generated dispatches for schedule on demand", {
        scheduleId,
        dispatchesCreated
      });

      return { dispatchesCreated };
    });
  }
);
