import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import {
  getDayOfWeek,
  now,
  parseAbsolute,
  toCalendarDate,
  type ZonedDateTime
} from "@internationalized/date";
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
  estimatedDuration: number | null;
  takesWorkCenterOffline: boolean;
}

// Check if a date is enabled for the schedule based on day-of-week settings
function isDayEnabledForSchedule(
  schedule: MaintenanceSchedule,
  targetDate: ZonedDateTime
): boolean {
  // Only check day-of-week for Daily frequency
  if (schedule.frequency !== "Daily") {
    return true;
  }

  // en-US so the returned index is 0 = Sunday … 6 = Saturday, matching
  // dayOfWeekFields (independent of the runtime locale's first day of week).
  const dayOfWeek = getDayOfWeek(targetDate, "en-US");
  const dayField = dayOfWeekFields[dayOfWeek]!;
  return schedule[dayField] === true;
}

// Check if a date (YYYY-MM-DD) is a holiday for the company
async function isHoliday(
  companyId: string,
  dateString: string
): Promise<boolean> {
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
 * Catch up a schedule's preventive-maintenance dispatches: create one for every
 * occurrence that is already due (`nextDueAt` on or before now), then advance
 * `nextDueAt` to the next future occurrence.
 *
 * Catch-up only — it never pre-creates a future occurrence or advances a future
 * `nextDueAt`. A schedule whose next date is still in the future is left exactly
 * as-is, so saving a schedule (or setting its Next Due Date) does not push the
 * date around. Shared by the nightly cron (fans out over every due schedule) and
 * the on-create/on-update trigger (runs for one schedule immediately).
 *
 * A `nextDueAt` of `null` (never generated) seeds one interval out, so a
 * brand-new schedule gets a future due date for the displays without creating an
 * immediately-overdue dispatch.
 *
 * Idempotent: a run whose `nextDueAt` is already in the future creates nothing
 * and re-writes the same value.
 */
export async function generateDispatchesForSchedule(args: {
  serviceRole: ReturnType<typeof getCarbonServiceRole>;
  schedule: MaintenanceSchedule;
  companyId: string;
  currentDateTime: ReturnType<typeof now>;
}): Promise<number> {
  const { serviceRole, schedule, companyId, currentDateTime } = args;
  const timeZone = currentDateTime.timeZone;

  let dispatchesCreated = 0;

  let currentNextDueAt = schedule.nextDueAt
    ? parseAbsolute(schedule.nextDueAt, timeZone)
    : advanceByFrequency(currentDateTime, schedule.frequency);

  // Create dispatches only for occurrences that are already due (<= now).
  while (currentNextDueAt.compare(currentDateTime) <= 0) {
    const targetDate = currentNextDueAt;
    const targetDateString = toCalendarDate(targetDate).toString();

    // For Daily schedules, check if this day of week is enabled
    if (!isDayEnabledForSchedule(schedule, targetDate)) {
      log.info("Skipping schedule - day of week not enabled", {
        schedule: schedule.name,
        date: targetDateString
      });
      // Advance to next day for daily schedules
      if (schedule.frequency === "Daily") {
        currentNextDueAt = currentNextDueAt.add({ days: 1 });
        continue;
      }
      break;
    }

    // Check if this date is a holiday and skipHolidays is enabled
    if (schedule.skipHolidays) {
      const isHolidayDate = await isHoliday(companyId, targetDateString);
      if (isHolidayDate) {
        log.info("Skipping schedule - holiday", {
          schedule: schedule.name,
          date: targetDateString
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
    const dayStart = targetDate.set({
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0
    });
    const dayEnd = targetDate.set({
      hour: 23,
      minute: 59,
      second: 59,
      millisecond: 999
    });
    const { data: existingForDay } = await serviceRole
      .from("maintenanceDispatch")
      .select("id")
      .eq("companyId", companyId)
      .eq("maintenanceScheduleId", schedule.id)
      .gte("plannedStartTime", dayStart.toAbsoluteString())
      .lte("plannedStartTime", dayEnd.toAbsoluteString())
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

    // A scheduled PM is a due *date*, not a time. Anchor it to noon UTC so it
    // renders as the intended day in every timezone — midnight UTC would show a
    // day earlier for anyone behind UTC.
    const plannedStart = targetDate.set({
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0
    });
    // Give the dispatch a bounded expected window whenever the schedule declares
    // a duration (minutes). For an offline PM the scheduler subtracts this
    // window; for a non-offline PM it is just a self-describing "~N min" window.
    // `.add({ minutes })` is @internationalized/date arithmetic — never a JS Date.
    const plannedEnd =
      schedule.estimatedDuration && schedule.estimatedDuration > 0
        ? plannedStart.add({ minutes: schedule.estimatedDuration })
        : null;

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
        plannedStartTime: plannedStart.toAbsoluteString(),
        plannedEndTime: plannedEnd ? plannedEnd.toAbsoluteString() : null,
        // Mirror the schedule's capacity-blocking flag so a PM that takes the
        // machine offline reserves its window in the finite scheduler.
        takesWorkCenterOffline: schedule.takesWorkCenterOffline,
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
      date: targetDateString
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
      nextDueAt: currentNextDueAt.toAbsoluteString()
    })
    .eq("id", schedule.id);

  return dispatchesCreated;
}

// Advance a date to the next occurrence for a given frequency. `add` clamps
// month-ends (e.g. Jan 31 + 1 month → Feb 28), unlike a raw Date.
function advanceByFrequency(
  from: ZonedDateTime,
  frequency: string
): ZonedDateTime {
  switch (frequency) {
    case "Daily":
      return from.add({ days: 1 });
    case "Weekly":
      return from.add({ days: 7 });
    case "Monthly":
      return from.add({ months: 1 });
    case "Quarterly":
      return from.add({ months: 3 });
    case "Annual":
      return from.add({ years: 1 });
    default:
      return from;
  }
}

export const dispatchFunction = inngest.createFunction(
  { id: "dispatch", retries: 2 },
  { cron: "0 6 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    return await step.run("generate-maintenance-dispatches", async () => {
      const currentDateTime = now("UTC");
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
          // Active schedules that are already due (or never generated).
          // Generation is catch-up only, so future-dated schedules are skipped.
          const { data: dueSchedules, error: schedulesError } =
            await serviceRole
              .from("maintenanceSchedule")
              .select("*")
              .eq("companyId", settings.id)
              .eq("active", true)
              .or(
                `nextDueAt.is.null,nextDueAt.lte.${currentDateTime.toAbsoluteString()}`
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
  {
    id: "generate-maintenance",
    retries: 2,
    // Serialize runs for the same schedule (rapid saves / retries) so two
    // overlapping runs can't race to create the same dispatch. Combined with the
    // per-day existence check in generateDispatchesForSchedule, this keeps
    // generation idempotent per occurrence.
    concurrency: { limit: 1, key: "event.data.scheduleId" }
  },
  { event: "carbon/generate-maintenance" },
  async ({ event, step, logger }) => {
    const { companyId, scheduleId } = event.data;

    return await step.run("generate-schedule-dispatches", async () => {
      const serviceRole = getCarbonServiceRole();
      const currentDateTime = now("UTC");

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
