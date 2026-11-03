// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { indexBy, indexByMapped, pluckUnique } from "@carbon/utils";
import { inngest } from "../../client";

// 50 ids per `.in()` keeps the request line under the gateway's 4,096 bytes.
const ID_BATCH = 50;

/** Rows for every id, one request per batch. A failed batch is left out and
 *  reported, so only its ids miss their rows. */
async function readByIds<Row>(
  ids: string[],
  read: (batch: string[]) => PromiseLike<{ data: Row[] | null; error: unknown }>
): Promise<{ rows: Row[]; failed: boolean }> {
  const rows: Row[] = [];
  let failed = false;
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const { data, error } = await read(ids.slice(i, i + ID_BATCH));
    if (error) failed = true;
    else rows.push(...(data ?? []));
  }
  return { rows, failed };
}

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
              "Failed to fetch open entries for company {companyId}",
              { companyId: company.id, error: entriesError }
            );
            continue;
          }

          if (!openEntries || openEntries.length === 0) continue;

          logger.info(
            `Company ${company.id}: ${openEntries.length} open entries`
          );

          // 3. The employees' assigned shifts, read once for the company.
          const employeeJobs = await readByIds(
            pluckUnique(openEntries, (entry) => entry.employeeId),
            (ids) =>
              serviceRole
                .from("employeeJob")
                .select("id, shiftId")
                .in("id", ids)
                .eq("companyId", company.id)
          );
          const shifts = await readByIds(
            pluckUnique(employeeJobs.rows, (job) => job.shiftId),
            (ids) =>
              serviceRole
                .from("shift")
                .select("id, startTime, endTime")
                .in("id", ids)
                .eq("companyId", company.id)
          );
          // An entry whose read failed closes at the default clock-out, as a
          // failed per-entry read did, rather than staying open a week.
          if (employeeJobs.failed || shifts.failed) {
            logger.error("Failed to fetch shifts for company {companyId}", {
              companyId: company.id
            });
          }
          const shiftIdByEmployee = indexByMapped(
            employeeJobs.rows,
            (job) => job.id,
            (job) => job.shiftId
          );
          const shiftById = indexBy(shifts.rows, (shift) => shift.id);

          for (const entry of openEntries) {
            const employeeJob = {
              shiftId: shiftIdByEmployee.get(entry.employeeId) ?? null
            };

            let clockOut: Date;
            let shiftId: string | null = null;

            if (employeeJob.shiftId) {
              const shift = shiftById.get(employeeJob.shiftId);

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
              logger.error("Failed to auto-close entry {entryId}", {
                entryId: entry.id,
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
