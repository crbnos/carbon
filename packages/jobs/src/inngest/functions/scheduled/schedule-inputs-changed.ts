import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

const ACTIVE_JOB_STATUSES = ["Ready", "In Progress", "Paused"] as const;

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
        .in("status", [...ACTIVE_JOB_STATUSES])
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

    const staleJobs = await step.run("get-stale-jobs", async () => {
      const result = await serviceRole
        .from("job")
        .select("id")
        .eq("companyId", companyId)
        .in("status", [...ACTIVE_JOB_STATUSES])
        .not("scheduleOutdatedReason", "is", null)
        .order("dueDate", { ascending: true })
        .order("createdAt", { ascending: true })
        .limit(500);

      if (result.error) {
        throw new Error(`Failed to load stale jobs: ${result.error.message}`);
      }
      return (result.data ?? []).map((j) => j.id);
    });

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
          console.error(
            `Replan wave failed for job ${jobId} (company ${companyId}): ${
              error.message ?? String(error)
            }`
          );
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

    return { rescheduled, failed, total: staleJobs.length };
  }
);
