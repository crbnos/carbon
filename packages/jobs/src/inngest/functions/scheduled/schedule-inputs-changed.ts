import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { activeJobStatuses, fetchAllFromTable } from "@carbon/database";
import { runLocationSchedule } from "@carbon/ee/planning";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

const log = getLogger("jobs", "schedule-replan");

// PostgREST .in() filters are URL-encoded — thousands of ids in one filter
// can exceed URL/statement limits and fail the whole step
const IN_FILTER_CHUNK_SIZE = 200;

// A recovery wave re-triggers this same function. Without a cap, a
// deterministic failure would retry forever, one cycle per debounce period.
const MAX_RECOVERY_ATTEMPTS = 3;

/** One job the regen flipped from on-time (or unforecast) to projected-late. */
type NewlyLateJob = {
  jobId: string;
  readableJobId: string | null;
  assignee: string | null;
  projectedCompletionAt: string | null;
};

type LocationRegenResult = {
  locationId: string;
  jobsScheduled: number;
  conflictsDetected: number;
  newlyLate: NewlyLateJob[];
};

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
  continuation: z.boolean().optional(),
  // Set only by the wave's own onFailure recovery send; a normal carry-over
  // continuation leaves it unset so the counter resets on real progress
  recoveryAttempt: z.number().int().min(0).optional()
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
 * Debounce coalesces a burst of input changes into ONE wave: the timer resets
 * on every event, and the 10m ceiling guarantees a wave at least that often
 * under a continuous stream of edits. 30s is affordable because regen is
 * idempotent and whole-location — there is no frozen-set to get wrong.
 *
 * The wave groups the stale jobs by LOCATION and regenerates each affected
 * location in full (the edge function is a whole-location forward simulation).
 * No pre-clear and no wave-side flag-clearing: the engine's reservation-
 * exclusion list replaces the clear, and each engine run clears its own job's
 * stale stamp on completion (fixing the stuck-stamp + lost-update defects by
 * construction — a regen always covers the whole location). Manually scheduled
 * operations are preserved by the engine as always.
 */
export const scheduleReplanWaveFunction = inngest.createFunction(
  {
    id: "schedule-replan-wave",
    retries: 1,
    debounce: {
      key: "event.data.companyId",
      period: "30s",
      timeout: "10m"
    },
    // env scope + the shared "schedule:" key serializes this per company so a
    // wave and a user-triggered regen never run concurrently for one company
    // and double-book capacity
    concurrency: {
      limit: 1,
      scope: "env",
      key: '"schedule:" + event.data.companyId'
    },
    // A regen is idempotent, so a died run just needs re-running; the jobs are
    // still stamped, so a continuation regenerates exactly their locations.
    onFailure: async ({ event, step }) => {
      const companyId = event.data.event.data?.companyId;
      if (!companyId) return;
      // Bounded: this event re-triggers THIS function, so an unbounded
      // recovery turns a deterministic failure into an endless retry loop
      const attempt = (event.data.event.data?.recoveryAttempt ?? 0) + 1;
      if (attempt > MAX_RECOVERY_ATTEMPTS) {
        log.error(
          "Replan wave recovery exhausted — jobs stay stale until the nightly sweep",
          { companyId, attempts: attempt - 1 }
        );
        return;
      }
      await step.sendEvent("recover-replan-wave", {
        name: "carbon/schedule.inputs.changed",
        data: {
          companyId,
          kind: "reorder",
          reason: "Replan wave recovery",
          continuation: true,
          recoveryAttempt: attempt
        }
      });
    }
  },
  { event: "carbon/schedule.inputs.changed" },
  async ({ event, step }) => {
    const { companyId, reason } = event.data;
    const serviceRole = getCarbonServiceRole();

    const locationIds = await step.run("get-stale-locations", async () => {
      // fetchAllFromTable pages past PostgREST's 1000-row cap; distinct in TS.
      const result = await fetchAllFromTable<{ locationId: string }>(
        serviceRole,
        "job",
        "locationId",
        (query) =>
          query
            .eq("companyId", companyId)
            .in("status", ["Ready", "In Progress", "Paused"])
            .not("scheduleOutdatedAt", "is", null)
      );
      if (result.error) {
        throw new Error(
          `Failed to load stale locations: ${result.error.message}`
        );
      }
      return [...new Set((result.data ?? []).map((j) => j.locationId))];
    });

    if (locationIds.length === 0) {
      return { locations: 0 };
    }

    // Regenerate each affected location in full, sequentially. The engine
    // clears each job's stale stamp per run and returns the newly-late jobs.
    const results: LocationRegenResult[] = [];
    for (const locationId of locationIds) {
      const result = await step.run(`regen-${locationId}`, async () => {
        // Regenerate the location IN-PROCESS (Node) — no edge cold-start or HTTP
        // hop. Idempotent, so an Inngest retry just re-runs it.
        try {
          return await runLocationSchedule({
            db: getJobDatabaseClient(),
            client: serviceRole,
            locationId,
            companyId,
            userId: "system"
          });
        } catch (err) {
          log.error("Location regen failed", {
            companyId,
            locationId,
            error: err instanceof Error ? err.message : String(err)
          });
          return null;
        }
      });
      if (result) {
        results.push(result);
      }
    }

    const jobsScheduled = results.reduce(
      (sum, r) => sum + (r.jobsScheduled ?? 0),
      0
    );
    const conflictsDetected = results.reduce(
      (sum, r) => sum + (r.conflictsDetected ?? 0),
      0
    );
    const newlyLate = results.flatMap((r) => r.newlyLate ?? []);

    // One digest per assignee for the jobs this wave flipped to projected-late.
    // Unassigned jobs are skipped in v1 (they still get badges/flags). This is
    // edge-triggered by construction (the engine's before/after delta), so a
    // second identical regen produces no entries and nothing is sent.
    const jobIdsByAssignee = new Map<string, string[]>();
    for (const job of newlyLate) {
      if (!job.assignee) continue;
      const list = jobIdsByAssignee.get(job.assignee) ?? [];
      list.push(job.jobId);
      jobIdsByAssignee.set(job.assignee, list);
    }

    for (const [userId, jobIds] of jobIdsByAssignee) {
      await step.sendEvent(`notify-newly-late-${userId}`, {
        name: "carbon/notify",
        data: {
          event: NotificationEvent.JobsProjectedLate,
          companyId,
          documentIds: jobIds,
          recipient: { type: "user", userId },
          body: reason
        }
      });
    }

    return {
      locations: locationIds.length,
      jobsScheduled,
      conflictsDetected,
      newlyLate: newlyLate.length
    };
  }
);
