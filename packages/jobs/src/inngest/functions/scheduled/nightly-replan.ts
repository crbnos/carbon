import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

const ACTIVE_JOB_STATUSES = ["Ready", "In Progress", "Paused"] as const;

/**
 * Nightly replan: re-runs the finite scheduler for every active job.
 *
 * Conflict flags (`jobOperation.hasConflict`/`conflictReason`) and capacity
 * reservations are snapshots written at scheduling time — they do NOT react
 * to master-data changes (operator qualifications granted/expiring, shift
 * assignments changing) or to time simply passing. Without this cron, a
 * stale conflict badge sticks to the schedule boards until someone manually
 * re-triggers scheduling for that job.
 *
 * Runs at 01:00 UTC. Within a company, jobs are rescheduled sequentially in
 * due-date order so the most urgent job claims capacity first (matching
 * backward-scheduling semantics).
 */
export const nightlyReplanFunction = inngest.createFunction(
  { id: "nightly-replan", retries: 2 },
  { cron: "0 1 * * *" },
  async ({ step }) => {
    const serviceRole = getCarbonServiceRole();

    const jobsByCompany = await step.run("get-active-jobs", async () => {
      const result = await serviceRole
        .from("job")
        .select("id, companyId")
        .in("status", [...ACTIVE_JOB_STATUSES])
        .order("dueDate", { ascending: true })
        .order("createdAt", { ascending: true });

      if (result.error) {
        throw new Error(`Failed to load active jobs: ${result.error.message}`);
      }

      const byCompany: Record<string, string[]> = {};
      for (const job of result.data ?? []) {
        (byCompany[job.companyId] ??= []).push(job.id);
      }
      return byCompany;
    });

    let rescheduled = 0;
    let failed = 0;
    let conflicts = 0;

    for (const [companyId, jobIds] of Object.entries(jobsByCompany)) {
      const companyResult = await step.run(`replan-${companyId}`, async () => {
        let companyRescheduled = 0;
        let companyFailed = 0;
        let companyConflicts = 0;

        for (const jobId of jobIds) {
          const { data, error } = await serviceRole.functions.invoke(
            "schedule",
            {
              body: {
                jobId,
                companyId,
                userId: "system",
                mode: "reschedule",
                direction: "backward"
              }
            }
          );

          if (error) {
            companyFailed++;
            console.error(
              `Nightly replan failed for job ${jobId} (company ${companyId}): ${
                error.message ?? String(error)
              }`
            );
            continue;
          }

          companyRescheduled++;
          companyConflicts += data?.conflictsDetected ?? 0;
        }

        console.info(
          `Nightly replan for company ${companyId}: ${companyRescheduled}/${jobIds.length} jobs rescheduled, ${companyConflicts} conflicts, ${companyFailed} failures`
        );

        return {
          rescheduled: companyRescheduled,
          failed: companyFailed,
          conflicts: companyConflicts
        };
      });

      rescheduled += companyResult.rescheduled;
      failed += companyResult.failed;
      conflicts += companyResult.conflicts;
    }

    return {
      companies: Object.keys(jobsByCompany).length,
      rescheduled,
      failed,
      conflicts
    };
  }
);
