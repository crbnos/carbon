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
 * immediately; nothing is recomputed here. The affected set is scoped per
 * change kind (see compute-affected-jobs) so e.g. a qualification change in
 * a company with no gated operations stamps nothing and no wave work runs;
 * kinds that genuinely touch everything (location timezone, reorder) stamp
 * company-wide.
 */
export const markScheduleStaleFunction = inngest.createFunction(
  {
    id: "mark-schedule-stale",
    retries: 2,
    concurrency: { limit: 1, key: "event.data.companyId" }
  },
  { event: "carbon/schedule.inputs.changed" },
  async ({ event, step }) => {
    const { companyId, kind, reason, entityId } = event.data;
    const serviceRole = getCarbonServiceRole();

    // Which jobs does this change actually touch?
    // - ability (with id)      -> jobs with unfinished ops on THAT ability's process
    // - ability/shift/employee-shift (no id) -> jobs with unfinished ops on ANY
    //   ability-gated process (people-availability changes only matter to gated work;
    //   a company with zero gated ops is untouched)
    // - work-center (with id)  -> jobs with unfinished ops assigned to that work center
    // - location/reorder       -> everything (timezone/order changes affect all placements)
    const affectedJobIds = await step.run("compute-affected-jobs", async () => {
      const gatedKinds = ["ability", "shift", "employee-shift"];

      let processIds: string[] | null = null;
      if (kind === "ability" && entityId) {
        const ability = await serviceRole
          .from("ability")
          .select("processId")
          .eq("id", entityId)
          .eq("companyId", companyId)
          .maybeSingle();
        processIds = ability.data?.processId ? [ability.data.processId] : [];
      } else if (gatedKinds.includes(kind)) {
        const gated = await serviceRole
          .from("process")
          .select("id")
          .eq("companyId", companyId)
          .eq("requiresAbility", true);
        processIds = (gated.data ?? []).map((p) => p.id);
      }

      if (processIds !== null || (kind === "work-center" && entityId)) {
        if (processIds !== null && processIds.length === 0) {
          return []; // nothing gated -> nothing affected
        }
        const ops = await fetchAllFromTable<{ jobId: string }>(
          serviceRole,
          "jobOperation",
          "jobId",
          (query) => {
            const scoped = query
              .eq("companyId", companyId)
              .not("status", "in", '("Done","Canceled")');
            return processIds !== null
              ? scoped.in("processId", processIds)
              : scoped.eq("workCenterId", entityId);
          }
        );
        if (ops.error) {
          throw new Error(
            `Failed to compute affected jobs: ${ops.error.message}`
          );
        }
        return [...new Set((ops.data ?? []).map((o) => o.jobId))];
      }

      return null; // company-wide (location, reorder, or no way to scope)
    });

    return await step.run("stamp-affected-jobs", async () => {
      if (affectedJobIds !== null && affectedJobIds.length === 0) {
        return { stamped: 0, scope: "none" };
      }

      let update = serviceRole
        .from("job")
        .update({
          scheduleOutdatedReason: reason,
          scheduleOutdatedAt: new Date().toISOString()
        })
        .eq("companyId", companyId)
        .in("status", [...activeJobStatuses]);
      if (affectedJobIds !== null) {
        update = update.in("id", affectedJobIds);
      }
      const result = await update.select("id");

      if (result.error) {
        throw new Error(`Failed to stamp jobs: ${result.error.message}`);
      }
      return {
        stamped: result.data?.length ?? 0,
        scope: affectedJobIds === null ? "company" : "scoped"
      };
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

    // Batch mode: one edge-function invocation schedules a CHUNK of jobs in
    // order — the per-call HTTP overhead is paid once per chunk, not per job
    const INVOKE_CHUNK_SIZE = 25;
    const chunks: string[][] = [];
    for (let i = 0; i < staleJobs.length; i += INVOKE_CHUNK_SIZE) {
      chunks.push(staleJobs.slice(i, i + INVOKE_CHUNK_SIZE));
    }

    let rescheduled = 0;
    let failed = 0;
    for (const [index, chunk] of chunks.entries()) {
      const ok = await step.run(`replan-chunk-${index}`, async () => {
        const { error } = await serviceRole.functions.invoke("schedule", {
          body: {
            jobIds: chunk,
            companyId,
            userId: "system",
            mode: "reschedule",
            direction: "backward"
          }
        });
        if (error) {
          log.error("Replan wave chunk failed", {
            companyId,
            chunkIndex: index,
            jobIds: chunk,
            error: error.message ?? String(error)
          });
          return false;
        }
        await serviceRole
          .from("job")
          .update({ scheduleOutdatedReason: null, scheduleOutdatedAt: null })
          .in("id", chunk)
          .eq("companyId", companyId);
        return true;
      });
      if (ok) rescheduled += chunk.length;
      else failed += chunk.length;
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
