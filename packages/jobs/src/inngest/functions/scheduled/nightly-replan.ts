import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { activeJobStatuses, fetchAllFromTable } from "@carbon/database";
import { datetime } from "@carbon/utils";
import { inngest } from "../../client";

// PostgREST .in() filters are URL-encoded — thousands of ids in one filter can
// exceed URL/statement limits, so page them.
const IN_FILTER_CHUNK_SIZE = 200;

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/**
 * Nightly replan — NET CHANGE + TIME-PASSED backstop for reactive replanning.
 *
 * The debounced replan wave (schedule-inputs-changed.ts) normally reschedules
 * stale jobs within minutes of an input change. This cron is the safety net for
 * two classes the event path misses:
 *
 *  1. Anything the event path dropped (direct DB writes, a wave that exhausted
 *     retries): jobs still stamped schedule-outdated.
 *  2. **Aged schedules.** A forward plan is anchored to the `now` of the regen
 *     that produced it; with no input change, an untouched schedule keeps
 *     showing that day's placements, so work drifts into the past as days pass
 *     (the engine floors placement at `now` — it never schedules in the past —
 *     but a stale plan DISPLAYS a past start). So it also stamps any active job
 *     whose earliest open operation was scheduled to start before today, forcing
 *     a re-anchor to the current `now`.
 *
 * Both classes are then drained the same way: emit one
 * `carbon/schedule.inputs.changed` per affected company — the wave regenerates
 * each location in full, with its usual per-company serialization. Companies
 * with nothing stale cost nothing.
 */
export const nightlyReplanFunction = inngest.createFunction(
  { id: "nightly-replan", retries: 2 },
  { cron: "0 1 * * *" },
  async ({ step }) => {
    const serviceRole = getCarbonServiceRole();

    // (2) Re-anchor aged schedules: stamp active jobs whose earliest open op is
    // scheduled to START before today. `startDate` is the projected start day;
    // an op still awaiting placement has none (NULL) and is skipped by `.lt`.
    // A UTC day threshold is fine for a daily backstop — a few hours of tz slop
    // only over-includes a boundary job, and re-anchoring is idempotent. Jobs
    // already stamped keep their original reason (scheduleOutdatedAt IS NULL).
    await step.run("stamp-aged-schedules", async () => {
      const today = datetime.today("UTC").toString();

      const agedOps = await fetchAllFromTable<{ jobId: string }>(
        serviceRole,
        "jobOperation",
        "jobId",
        (query) =>
          query
            .not("status", "in", '("Done","Canceled")')
            .lt("startDate", today)
      );
      if (agedOps.error) {
        throw new Error(
          `Failed to find aged schedules: ${agedOps.error.message}`
        );
      }
      const agedJobIds = [...new Set((agedOps.data ?? []).map((o) => o.jobId))];
      if (agedJobIds.length === 0) {
        return { stamped: 0 };
      }

      const stamp = {
        scheduleOutdatedReason: "Schedule re-anchored (day passed)",
        scheduleOutdatedAt: datetime.timestamp()
      };
      let stamped = 0;
      for (const jobIdChunk of chunkArray(agedJobIds, IN_FILTER_CHUNK_SIZE)) {
        const result = await serviceRole
          .from("job")
          .update(stamp)
          .in("id", jobIdChunk)
          .in("status", [...activeJobStatuses])
          .is("scheduleOutdatedAt", null)
          .select("id");
        if (result.error) {
          throw new Error(`Failed to stamp aged jobs: ${result.error.message}`);
        }
        stamped += result.data?.length ?? 0;
      }
      return { stamped };
    });

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
