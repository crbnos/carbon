import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { activeJobStatuses, fetchAllFromTable } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { inngest } from "../../client";

const log = getLogger("jobs", "schedule-replan");

// One wave replans at most this many jobs (bounded step count per Inngest
// run); a remainder chains a follow-up wave via a self-sent event
const WAVE_BATCH_SIZE = 500;

/**
 * Reactive replanning, part 1 — MARK (immediate, cheap).
 *
 * When a scheduling input changes (shift assignment, qualification, work
 * center, location timezone), stamp the company's active jobs as
 * schedule-outdated with the reason. The boards surface the reason
 * immediately; nothing is recomputed here. v1 scopes the affected set to the
 * whole company — precise per-kind scoping (only jobs touching the changed
 * ability's process, etc.) is a later refinement; over-marking is safe
 * because the wave replans in one consistent pass.
 */
export const markScheduleStaleFunction = inngest.createFunction(
  {
    id: "mark-schedule-stale",
    retries: 2,
    concurrency: { limit: 1, key: "event.data.companyId" }
  },
  { event: "carbon/schedule.inputs.changed" },
  async ({ event, step }) => {
    const { companyId, reason } = event.data;
    const serviceRole = getCarbonServiceRole();

    return await step.run("stamp-active-jobs", async () => {
      const result = await serviceRole
        .from("job")
        .update({
          scheduleOutdatedReason: reason,
          scheduleOutdatedAt: new Date().toISOString()
        })
        .eq("companyId", companyId)
        .in("status", [...activeJobStatuses])
        .select("id");

      if (result.error) {
        throw new Error(`Failed to stamp jobs: ${result.error.message}`);
      }
      return { stamped: result.data?.length ?? 0 };
    });
  }
);

/**
 * Reactive replanning, part 2 — WAVE (debounced, per company).
 *
 * Debounce coalesces a burst of input changes into ONE replan wave: the
 * timer resets on every event, and the timeout ceiling guarantees a wave at
 * least every 30 minutes under a continuous stream of edits. The wave clears
 * every stale job's reservations FIRST, then reschedules in due-date order —
 * one wave = one consistent queue (reschedule order must not become queue
 * priority, and all conflict notes must describe the same final world).
 * Manually scheduled operations are preserved by the engine as always.
 */
export const scheduleReplanWaveFunction = inngest.createFunction(
  {
    id: "schedule-replan-wave",
    retries: 1,
    debounce: {
      key: "event.data.companyId",
      period: "3m",
      timeout: "30m"
    },
    // Same serialization lane as user-triggered reschedules for this company
    concurrency: { limit: 1, key: "event.data.companyId" }
  },
  { event: "carbon/schedule.inputs.changed" },
  async ({ event, step }) => {
    const { companyId } = event.data;
    const serviceRole = getCarbonServiceRole();

    const { staleJobs, remaining } = await step.run(
      "get-stale-jobs",
      async () => {
        // fetchAllFromTable pages past PostgREST's 1000-row cap so the batch
        // boundary below is OURS (explicit + logged), never a silent select cap
        const result = await fetchAllFromTable<{ id: string }>(
          serviceRole,
          "job",
          "id",
          (query) =>
            query
              .eq("companyId", companyId)
              .in("status", [...activeJobStatuses])
              .not("scheduleOutdatedReason", "is", null)
              .order("dueDate", { ascending: true })
              // job.priority is the planner's manual ordering from the dates
              // board drag — within the same due date, the top card goes first
              .order("priority", { ascending: true })
              .order("createdAt", { ascending: true })
        );

        if (result.error) {
          throw new Error(`Failed to load stale jobs: ${result.error.message}`);
        }
        const ids = (result.data ?? []).map((j) => j.id);
        return {
          staleJobs: ids.slice(0, WAVE_BATCH_SIZE),
          remaining: Math.max(ids.length - WAVE_BATCH_SIZE, 0)
        };
      }
    );

    if (staleJobs.length === 0) {
      return { rescheduled: 0, failed: 0 };
    }

    // Clear the whole wave's reservations up front so the due-date-ordered
    // rebuild starts from an empty queue for these jobs
    await step.run("clear-stale-reservations", async () => {
      const result = await serviceRole
        .from("capacityReservation")
        .delete()
        .eq("companyId", companyId)
        .in("jobId", staleJobs)
        .is("scenarioId", null);
      if (result.error) {
        throw new Error(
          `Failed to clear reservations: ${result.error.message}`
        );
      }
    });

    let rescheduled = 0;
    let failed = 0;
    for (const jobId of staleJobs) {
      const ok = await step.run(`replan-${jobId}`, async () => {
        const { error } = await serviceRole.functions.invoke("schedule", {
          body: {
            jobId,
            companyId,
            userId: "system",
            mode: "reschedule",
            direction: "backward"
          }
        });
        if (error) {
          log.error("Replan wave failed for job", {
            jobId,
            companyId,
            error: error.message ?? String(error)
          });
          return false;
        }
        await serviceRole
          .from("job")
          .update({ scheduleOutdatedReason: null, scheduleOutdatedAt: null })
          .eq("id", jobId)
          .eq("companyId", companyId);
        return true;
      });
      if (ok) rescheduled++;
      else failed++;
    }

    if (remaining > 0) {
      // Never a silent cap: log the carry-over and chain a follow-up wave
      // (debounce turns this into the next batch a few minutes later)
      log.warning("Replan wave batch full — chaining follow-up wave", {
        companyId,
        remaining
      });
      await step.sendEvent("chain-next-wave", {
        name: "carbon/schedule.inputs.changed",
        data: {
          companyId,
          kind: "reorder",
          reason: "Replan wave continuation"
        }
      });
    }

    return { rescheduled, failed, total: staleJobs.length, remaining };
  }
);
