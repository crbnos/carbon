import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

export const timeCardAutoCloseFunction = inngest.createFunction(
  { id: "timecard-auto-close", retries: 2 },
  // Run every Sunday at 11pm UTC (after weekly task at 9pm)
  { cron: "0 23 * * 0" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    await step.run("auto-close-timecards", async () => {
      logger.info(`Starting timecard auto-close: ${new Date().toISOString()}`);

      try {
        // 1. Get all companies with time clock enabled
        const { data: companies, error: companiesError } = await serviceRole
          .from("companySettings")
          .select("id")
          .eq("timeCardEnabled", true);

        if (companiesError) {
          logger.error("Failed to fetch companies", {
            error: companiesError
          });
          return;
        }

        logger.info(
          `Found ${companies?.length || 0} companies with time clock enabled`
        );

        let totalClosed = 0;

        for (const company of companies ?? []) {
          // 2. Get all open time clock entries for this company
          const { data: openEntries, error: entriesError } = await serviceRole
            .from("timeCardEntry")
            .select("id, employeeId, clockIn")
            .eq("companyId", company.id)
            .is("clockOut", null);

          if (entriesError) {
            logger.error(
              `Failed to fetch open entries for company ${company.id}`,
              { error: entriesError }
            );
            continue;
          }

          if (!openEntries || openEntries.length === 0) continue;

          logger.info(
            `Company ${company.id}: ${openEntries.length} open entries`
          );

          for (const entry of openEntries) {
            // 3. Get the employee's assigned shift
            const { data: employeeJob } = await serviceRole
              .from("employeeJob")
              .select("shiftId")
              .eq("id", entry.employeeId)
              .eq("companyId", company.id)
              .single();

            let clockOut: Date;
            let shiftId: string | null = null;

            if (employeeJob?.shiftId) {
              const { data: shift } = await serviceRole
                .from("shift")
                .select("startTime, endTime")
                .eq("id", employeeJob.shiftId)
                .single();

              if (shift) {
                // Calculate shift duration
                const startParts = shift.startTime.split(":").map(Number);
                const endParts = shift.endTime.split(":").map(Number);
                let durationMinutes =
                  endParts[0]! * 60 +
                  endParts[1]! -
                  (startParts[0]! * 60 + startParts[1]!);
                // Handle overnight shifts
                if (durationMinutes <= 0) durationMinutes += 24 * 60;

                clockOut = new Date(
                  new Date(entry.clockIn).getTime() + durationMinutes * 60000
                );
                shiftId = employeeJob.shiftId;
              } else {
                // Shift not found, fall back to 8 hours
                clockOut = new Date(
                  new Date(entry.clockIn).getTime() + 8 * 3600000
                );
              }
            } else {
              // No shift assigned, fall back to 8 hours
              clockOut = new Date(
                new Date(entry.clockIn).getTime() + 8 * 3600000
              );
            }

            // 4. Update the entry
            const { error: updateError } = await serviceRole
              .from("timeCardEntry")
              .update({
                clockOut: clockOut.toISOString(),
                autoCloseShiftId: shiftId,
                updatedAt: new Date().toISOString(),
                note: "Auto-closed by system (Sunday weekly close)"
              })
              .eq("id", entry.id);

            if (updateError) {
              logger.error(`Failed to auto-close entry ${entry.id}`, {
                error: updateError
              });
            } else {
              totalClosed++;
              logger.info(
                `Auto-closed entry ${entry.id} for employee ${entry.employeeId}`
              );
            }
          }
        }

        logger.info(
          `Timecard auto-close completed: ${totalClosed} entries closed`
        );
      } catch (err) {
        logger.error("Unexpected error in timecard auto-close", {
          error: err
        });
      }
    });
  }
);
