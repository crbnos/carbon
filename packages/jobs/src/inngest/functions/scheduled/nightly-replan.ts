import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { activeJobStatuses, fetchAllFromTable } from "@carbon/database";
import { inngest } from "../../client";

/**
 * Nightly replan — NET CHANGE backstop for reactive replanning.
 *
 * The debounced replan wave (schedule-inputs-changed.ts) normally reschedules
 * stale jobs within minutes of a change. This cron is the safety net for
 * anything the event path missed (direct DB writes, a wave that exhausted
 * retries): it finds companies that still have schedule-outdated jobs and
 * emits one `carbon/schedule.inputs.changed` event per company — the wave
 * function then regenerates each affected location in full, with its usual
 * per-company serialization. Companies with nothing stale cost nothing.
 */
export const nightlyReplanFunction = inngest.createFunction(
  { id: "nightly-replan", retries: 2 },
  { cron: "0 1 * * *" },
  async ({ step }) => {
    const serviceRole = getCarbonServiceRole();

    const companies = await step.run(
      "get-companies-with-stale-jobs",
      async () => {
        // fetchAllFromTable pages past PostgREST's 1000-row cap — a large
        // stale backlog must not silently skip companies
        const result = await fetchAllFromTable<{ companyId: string }>(
          serviceRole,
          "job",
          "companyId",
          (query) =>
            query
              .in("status", [...activeJobStatuses])
              .not("scheduleOutdatedReason", "is", null)
        );

        if (result.error) {
          throw new Error(`Failed to load stale jobs: ${result.error.message}`);
        }
        return [...new Set((result.data ?? []).map((j) => j.companyId))];
      }
    );

    if (companies.length > 0) {
      // continuation: true — the stale jobs are already stamped, so the mark
      // function must not run (a company-wide kind would re-stamp EVERY
      // active job and turn one stale job into a full-company replan). The
      // wave drains exactly the stamped set.
      await step.sendEvent(
        "fan-out-replan-waves",
        companies.map((companyId) => ({
          name: "carbon/schedule.inputs.changed" as const,
          data: {
            companyId,
            kind: "reorder" as const,
            reason: "Nightly replan (net change)",
            continuation: true
          }
        }))
      );
    }

    return { companiesWithStaleJobs: companies.length };
  }
);
