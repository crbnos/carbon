import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

const ACTIVE_JOB_STATUSES = ["Ready", "In Progress", "Paused"] as const;

/**
 * Nightly replan — NET CHANGE backstop for reactive replanning.
 *
 * The debounced replan wave (schedule-inputs-changed.ts) normally reschedules
 * stale jobs within minutes of a change. This cron is the safety net for
 * anything the event path missed (direct DB writes, a wave that exhausted
 * retries): it finds companies that still have schedule-outdated jobs and
 * emits one `carbon/schedule.inputs.changed` event per company — the wave
 * function does the actual work, with its usual per-company serialization.
 * Companies with nothing stale cost nothing.
 */
export const nightlyReplanFunction = inngest.createFunction(
  { id: "nightly-replan", retries: 2 },
  { cron: "0 1 * * *" },
  async ({ step }) => {
    const serviceRole = getCarbonServiceRole();

    const companies = await step.run(
      "get-companies-with-stale-jobs",
      async () => {
        const result = await serviceRole
          .from("job")
          .select("companyId")
          .in("status", [...ACTIVE_JOB_STATUSES])
          .not("scheduleOutdatedReason", "is", null)
          .limit(1000);

        if (result.error) {
          throw new Error(`Failed to load stale jobs: ${result.error.message}`);
        }
        return [...new Set((result.data ?? []).map((j) => j.companyId))];
      }
    );

    if (companies.length > 0) {
      await step.sendEvent(
        "fan-out-replan-waves",
        companies.map((companyId) => ({
          name: "carbon/schedule.inputs.changed" as const,
          data: {
            companyId,
            kind: "location" as const,
            reason: "Nightly replan (net change)"
          }
        }))
      );
    }

    return { companiesWithStaleJobs: companies.length };
  }
);
