import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { schedules } from "@trigger.dev/sdk";

const serviceRole = getCarbonServiceRole();
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

function timeCardBreakTable() {
  return (serviceRole as any).from("timeCardBreak");
}

function calculateScheduledClockOut(
  clockIn: string,
  shift: { startTime: string; endTime: string } | null
) {
  if (!shift) {
    return new Date(new Date(clockIn).getTime() + EIGHT_HOURS_MS);
  }

  const [startHour, startMinute] = shift.startTime.split(":").map(Number);
  const [endHour, endMinute] = shift.endTime.split(":").map(Number);

  let durationMinutes =
    endHour * 60 + endMinute - (startHour * 60 + startMinute);

  if (durationMinutes <= 0) {
    durationMinutes += 24 * 60;
  }

  return new Date(new Date(clockIn).getTime() + durationMinutes * 60000);
}

export const timeCardAutoClose = schedules.task({
  id: "timecard-auto-close",
  cron: "*/15 * * * *",
  run: async () => {
    console.log(
      `Starting timecard auto-close: ${new Date().toISOString()}`
    );

    try {
      const { data: companies, error: companiesError } = await serviceRole
        .from("companySettings")
        .select("id")
        .eq("timeCardEnabled", true);

      if (companiesError) {
        console.error(`Failed to fetch companies: ${companiesError.message}`);
        return;
      }

      let totalClosedEntries = 0;
      let totalClosedBreaks = 0;
      const now = Date.now();

      for (const company of companies ?? []) {
        const [{ data: openEntries, error: entriesError }, { data: openBreaks, error: breaksError }] =
          await Promise.all([
            serviceRole
              .from("timeCardEntry")
              .select("id, employeeId, clockIn")
              .eq("companyId", company.id)
              .is("clockOut", null),
            timeCardBreakTable()
              .select("id, employeeId, startTime")
              .eq("companyId", company.id)
              .is("endTime", null)
          ]);

        if (entriesError) {
          console.error(
            `Failed to fetch open entries for company ${company.id}: ${entriesError.message}`
          );
          continue;
        }

        if (breaksError) {
          console.error(
            `Failed to fetch open breaks for company ${company.id}: ${breaksError.message}`
          );
        }

        for (const entry of openEntries ?? []) {
          const { data: employeeJob } = await serviceRole
            .from("employeeJob")
            .select("shiftId")
            .eq("id", entry.employeeId)
            .eq("companyId", company.id)
            .maybeSingle();

          let shiftId: string | null = null;
          let shift: { startTime: string; endTime: string } | null = null;

          if (employeeJob?.shiftId) {
            shiftId = employeeJob.shiftId;
            const shiftResult = await serviceRole
              .from("shift")
              .select("startTime, endTime")
              .eq("id", employeeJob.shiftId)
              .maybeSingle();

            if (shiftResult.data) {
              shift = shiftResult.data;
            }
          }

          const scheduledClockOut = calculateScheduledClockOut(
            entry.clockIn,
            shift
          );
          const closeAt = scheduledClockOut.getTime() + FIFTEEN_MINUTES_MS;

          if (closeAt > now) {
            continue;
          }

          const closeTime = scheduledClockOut.toISOString();
          const reason = shiftId
            ? "Auto-closed by system at scheduled shift end"
            : "Auto-closed by system after 8 hours";

          const { error: updateError } = await serviceRole
            .from("timeCardEntry")
            .update({
              clockOut: closeTime,
              autoCloseShiftId: shiftId,
              updatedAt: new Date().toISOString(),
              note: reason
            })
            .eq("id", entry.id);

          if (updateError) {
            console.error(
              `Failed to auto-close entry ${entry.id}: ${updateError.message}`
            );
            continue;
          }

          totalClosedEntries++;
        }

        for (const timecardBreak of openBreaks ?? []) {
          const breakStart = new Date(timecardBreak.startTime).getTime();
          const shouldClose = breakStart + 12 * 60 * 60 * 1000 <= now;

          if (!shouldClose) {
            continue;
          }

          const { error: updateError } = await timeCardBreakTable()
            .update({
              endTime: timecardBreak.startTime,
              updatedAt: new Date().toISOString(),
              note: "Auto-closed by system at shift end"
            })
            .eq("id", timecardBreak.id);

          if (updateError) {
            console.error(
              `Failed to auto-close break ${timecardBreak.id}: ${updateError.message}`
            );
            continue;
          }

          totalClosedBreaks++;
        }
      }

      console.log(
        `Timecard auto-close completed: ${totalClosedEntries} entries, ${totalClosedBreaks} breaks`
      );
    } catch (err) {
      console.error(
        `Unexpected error in timecard auto-close: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
});
