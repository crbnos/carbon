import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { activeJobStatuses, fetchAllFromTable } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "../../client";

const log = getLogger("jobs", "schedule-replan");

// One wave replans at most this many jobs (bounded step count per Inngest
// run); a remainder chains a follow-up wave via a self-sent event
const WAVE_BATCH_SIZE = 500;

// PostgREST .in() filters are URL-encoded — thousands of ids in one filter
// can exceed URL/statement limits and fail the whole step
const IN_FILTER_CHUNK_SIZE = 200;

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const scheduleInputsChangedData = z.object({
  companyId: z.string().min(1),
  kind: z.enum([
    "ability",
    "shift",
    "employee-shift",
    "work-center",
    "location",
    "reorder",
    "people"
  ]),
  reason: z.string(),
  entityId: z.string().optional(),
  continuation: z.boolean().optional()
});

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
    const parsed = scheduleInputsChangedData.safeParse(event.data);
    if (!parsed.success) {
      // A malformed event would otherwise silently over-scope to a
      // company-wide stamp (or no-op); fail loudly instead
      throw new NonRetriableError(
        `Invalid schedule.inputs.changed payload: ${parsed.error.message}`
      );
    }
    const { companyId, kind, reason, entityId, continuation } = parsed.data;

    // Wave continuations only re-trigger the wave; the remaining jobs are
    // already stamped. Re-marking here would stamp the whole company again
    // and the batch carry-over would never drain.
    if (continuation) {
      return { stamped: 0, scope: "continuation" };
    }

    if (kind === "work-center" && !entityId) {
      // Can't scope without the id — stamping company-wide is safe but
      // over-broad, so make the fallback visible
      log.warning(
        "work-center change without entityId — stamping company-wide",
        { companyId, reason }
      );
    }

    const serviceRole = getCarbonServiceRole();

    // Which jobs does this change actually touch?
    // - ability (with id)      -> jobs with unfinished ops on THAT ability's process
    // - ability/shift/employee-shift (no id) -> jobs with unfinished ops on ANY
    //   ability-gated process (people-availability changes only matter to gated work;
    //   a company with zero gated ops is untouched)
    // - work-center (with id)  -> jobs with unfinished ops assigned to that work center
    // - people (with id)         -> same as work-center (entityId = the assigned workCenterId)
    // - people (no id)           -> absence of an unassigned person; only gated ops care
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
      } else if (
        gatedKinds.includes(kind) ||
        (kind === "people" && !entityId)
      ) {
        const gated = await serviceRole
          .from("process")
          .select("id")
          .eq("companyId", companyId)
          .eq("requiresAbility", true);
        processIds = (gated.data ?? []).map((p) => p.id);
      }

      if (
        processIds !== null ||
        ((kind === "work-center" || kind === "people") && entityId)
      ) {
        if (processIds !== null && processIds.length === 0) {
          return []; // nothing gated -> nothing affected
        }
        // Chunk the .in() filter so a large gated-process set can't blow
        // past PostgREST's URL limits
        const processIdChunks: (string[] | null)[] =
          processIds !== null
            ? chunkArray(processIds, IN_FILTER_CHUNK_SIZE)
            : [null];
        const jobIds = new Set<string>();
        for (const processIdChunk of processIdChunks) {
          const ops = await fetchAllFromTable<{ jobId: string }>(
            serviceRole,
            "jobOperation",
            "jobId",
            (query) => {
              const scoped = query
                .eq("companyId", companyId)
                .not("status", "in", '("Done","Canceled")');
              return processIdChunk !== null
                ? scoped.in("processId", processIdChunk)
                : scoped.eq("workCenterId", entityId);
            }
          );
          if (ops.error) {
            throw new Error(
              `Failed to compute affected jobs: ${ops.error.message}`
            );
          }
          for (const op of ops.data ?? []) {
            jobIds.add(op.jobId);
          }
        }
        return [...jobIds];
      }

      return null; // company-wide (location, reorder, or no way to scope)
    });

    return await step.run("stamp-affected-jobs", async () => {
      if (affectedJobIds !== null && affectedJobIds.length === 0) {
        return { stamped: 0, scope: "none" };
      }

      const stamp = {
        scheduleOutdatedReason: reason,
        scheduleOutdatedAt: new Date().toISOString()
      };

      // Chunk the .in() filter (thousands of affected jobs would exceed
      // PostgREST's URL limits in a single filter)
      const jobIdChunks: (string[] | null)[] =
        affectedJobIds !== null
          ? chunkArray(affectedJobIds, IN_FILTER_CHUNK_SIZE)
          : [null];

      let stamped = 0;
      for (const jobIdChunk of jobIdChunks) {
        let update = serviceRole
          .from("job")
          .update(stamp)
          .eq("companyId", companyId)
          .in("status", [...activeJobStatuses]);
        if (jobIdChunk !== null) {
          update = update.in("id", jobIdChunk);
        }
        const result = await update.select("id");

        if (result.error) {
          throw new Error(`Failed to stamp jobs: ${result.error.message}`);
        }
        stamped += result.data?.length ?? 0;
      }

      return {
        stamped,
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
    // env scope + the shared "schedule:" key puts this in the SAME
    // serialization lane as the schedule-job function — per-function
    // concurrency would let a wave and a user-triggered reschedule run
    // concurrently for one company and double-book capacity
    concurrency: {
      limit: 1,
      scope: "env",
      key: '"schedule:" + event.data.companyId'
    },
    // The wave clears reservations up front (one wave = one consistent
    // queue). If the run dies after that clear, the stale jobs would sit
    // capacity-free until the nightly sweep — chain a recovery wave instead;
    // the jobs are still stamped, so a continuation drains exactly them.
    onFailure: async ({ event, step }) => {
      const companyId = event.data.event.data?.companyId;
      if (companyId) {
        await step.sendEvent("recover-replan-wave", {
          name: "carbon/schedule.inputs.changed",
          data: {
            companyId,
            kind: "reorder",
            reason: "Replan wave recovery",
            continuation: true
          }
        });
      }
    }
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
        const cleared = await serviceRole
          .from("job")
          .update({ scheduleOutdatedReason: null, scheduleOutdatedAt: null })
          .in("id", chunk)
          .eq("companyId", companyId);
        if (cleared.error) {
          // A silently-failed clear leaves rescheduled jobs stamped stale —
          // the next wave would clear their reservations and redo them
          throw new Error(
            `Failed to clear outdated flags: ${cleared.error.message}`
          );
        }
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
          reason: "Replan wave continuation",
          continuation: true
        }
      });
    }

    return { rescheduled, failed, total: staleJobs.length, remaining };
  }
);
