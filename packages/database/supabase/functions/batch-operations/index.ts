import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import {
  assertAllOperationsClaimed,
  assertBatchCompletionMembership,
  assertBatchWorkCenterMutable,
  buildBatchCompletionPlan,
  planBatchCompletion,
  type PlannedMemberEvent,
} from "../shared/batch-time-split.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

// Job Operation Batching — membership lifecycle for a jobOperationBatch, a
// lightweight join over N real jobOperation rows that share one batchable
// process. Jobs are never merged: every member operation stays a first-class row
// on its own job. This function owns create / add / remove / updateWorkCenter /
// dissolve — all pure FK writes with nothing to unwind (they are blocked once any
// production event exists). Completion (event slicing + per-member issue + GL) is
// a separate flow that consumes shared/batch-time-split.ts.
//
// Follows .ai/rules/workflow-edge-function.md: module-scoped Kysely pool,
// requirePermissions gate, companyId + audit fields on every write.

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

// A candidate operation is "unstarted" while in one of these statuses AND with no
// productionEvent recorded (the started gate below checks both).
const UNSTARTED_STATUSES = ["Todo", "Ready", "Waiting"];

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    companyId: z.string(),
    userId: z.string(),
    processId: z.string(),
    locationId: z.string(),
    workCenterId: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    jobOperationIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("add"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
    jobOperationIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("remove"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
    jobOperationIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal("updateWorkCenter"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
    workCenterId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("dissolve"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
  }),
  z.object({
    type: z.literal("complete"),
    companyId: z.string(),
    userId: z.string(),
    jobOperationBatchId: z.string(),
    members: z
      .array(
        z.object({
          jobOperationId: z.string(),
          quantity: z.number().min(0),
          scrapQuantity: z.number().min(0).optional(),
        })
      )
      .min(1),
  }),
]);

// Throws if any batch production event exists — the guard for add/remove/dissolve.
// `recoveryNoun` names the action so the error can point at the recovery.
async function assertNoBatchProductionEvent(
  // deno-lint-ignore no-explicit-any
  trx: any,
  jobOperationBatchId: string,
  companyId: string,
  action: string
) {
  const event = await trx
    .selectFrom("productionEvent")
    .select("id")
    .where("jobOperationBatchId", "=", jobOperationBatchId)
    .where("companyId", "=", companyId)
    .limit(1)
    .executeTakeFirst();

  if (event) {
    if (action === "dissolve") {
      throw new Error(
        "Cannot dissolve a batch after production has started — complete the batch to finish it"
      );
    }
    throw new Error(
      `Cannot ${action} a batch after production has started — complete the batch to finish it`
    );
  }
}

// Validates that each candidate operation may join a batch on `processId`, throwing
// a specific error (AC[4]) on the first violation. Returns nothing on success.
async function assertOperationsEligible(
  // deno-lint-ignore no-explicit-any
  trx: any,
  jobOperationIds: string[],
  processId: string,
  companyId: string
) {
  const operations = await trx
    .selectFrom("jobOperation")
    .select(["id", "processId", "status", "jobOperationBatchId"])
    .where("id", "in", jobOperationIds)
    .where("companyId", "=", companyId)
    .execute();

  const found = new Set(operations.map((o: { id: string }) => o.id));
  for (const id of jobOperationIds) {
    if (!found.has(id)) throw new Error(`Operation ${id} was not found`);
  }

  for (const op of operations) {
    if (op.processId !== processId) {
      throw new Error(
        "All operations in a batch must share the same process"
      );
    }
    if (op.jobOperationBatchId) {
      throw new Error(`Operation ${op.id} is already in a batch`);
    }
    if (!UNSTARTED_STATUSES.includes(op.status)) {
      throw new Error(
        `Operation ${op.id} has already started and cannot be batched`
      );
    }
  }

  // No productionEvent recorded against any candidate (started via a timer even
  // if the status has not flipped).
  const startedEvent = await trx
    .selectFrom("productionEvent")
    .select("jobOperationId")
    .where("jobOperationId", "in", jobOperationIds)
    .where("companyId", "=", companyId)
    .limit(1)
    .executeTakeFirst();

  if (startedEvent) {
    throw new Error(
      `Operation ${startedEvent.jobOperationId} has already started and cannot be batched`
    );
  }
}

// Completion path. Turns the batch's ONE set of recorded (ended) timer events
// into per-member `productionEvent` slices proportional to planned quantity,
// writes per-member Production/Scrap `productionQuantity` rows, flips every
// member Done, issues each member's own BOM, and posts GL per sliced event.
//
// Two-phase, resumable workflow (see planBatchCompletion + the migration that
// adds the 'Completing' status):
//   Phase 1 (transaction): slice the timers + write quantities, flip
//     Active -> Completing. Runs once.
//   Phase 2 (post-commit, idempotent): issue BOMs, flip members Done, post GL.
//   Finalize: flip Completing -> Completed only after ALL of phase 2 succeeds.
// If any phase-2 effect throws, the batch stays 'Completing' and a retry re-runs
// phase 2 alone (the transaction re-loads the existing slices instead of
// re-slicing). This removes the old failure mode where a post-commit error left
// the batch permanently 'Completed' with partial effects and no recovery path.
async function completeBatch(
  client: Awaited<ReturnType<typeof requirePermissions>>,
  args: {
    companyId: string;
    userId: string;
    now: string;
    jobOperationBatchId: string;
    members: { jobOperationId: string; quantity: number; scrapQuantity?: number }[];
  }
): Promise<Response> {
  const { companyId, userId, now, jobOperationBatchId, members } = args;
  const memberIds = members.map((m) => m.jobOperationId);

  // The per-member sliced events whose GL is posted AFTER the transaction commits
  // (post-production-event runs in a separate edge function and can only see
  // committed rows). `postedToGL` lets the post-commit pass skip events a prior
  // attempt already posted. Populated inside the transaction below — freshly
  // sliced on the first attempt, re-loaded on a resume.
  let glEvents: { id: string; postedToGL: boolean }[] = [];

  // Phase 1 runs in ONE Kysely transaction. A FOR UPDATE lock on the batch row
  // serializes completers: a concurrent completer blocks on the lock, then
  // re-reads the row and either resumes (Completing) or is rejected (Completed).
  await db.transaction().execute(async (trx) => {
    const batch = await trx
      .selectFrom("jobOperationBatch")
      .select(["id", "status"])
      .where("id", "=", jobOperationBatchId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!batch) throw new Error(`Batch ${jobOperationBatchId} was not found`);

    // Rejects a terminal batch; returns "slice" for Active, "resume" for
    // Completing (a prior attempt's phase-2 step failed).
    const phase = planBatchCompletion(batch.status);

    if (phase === "resume") {
      // The prior attempt already sliced the aggregate timers into per-member
      // events; re-collect them so phase 2 can finish the GL posting. Do NOT
      // re-slice or re-write quantities.
      const existing = await trx
        .selectFrom("productionEvent")
        .select(["id", "postedToGL"])
        .where("jobOperationBatchId", "=", jobOperationBatchId)
        .where("companyId", "=", companyId)
        .where("endTime", "is not", null)
        .execute();
      glEvents = existing.map((e) => ({
        id: e.id,
        postedToGL: e.postedToGL ?? false,
      }));
      return;
    }

    // phase === "slice": first attempt.
    // Load the ACTUAL membership (its planned operationQuantity is the proportional
    // time weight) and validate the submitted list against it — reject duplicates,
    // unknown ids, and omitted real members (all would corrupt quantities/issue).
    const operations = await trx
      .selectFrom("jobOperation")
      .select(["id", "operationQuantity"])
      .where("jobOperationBatchId", "=", jobOperationBatchId)
      .where("companyId", "=", companyId)
      .execute();

    assertBatchCompletionMembership(
      memberIds,
      operations.map((o) => o.id)
    );

    const opById = new Map(operations.map((o) => [o.id, o]));

    // Refuse to complete while any batch timer is still open (endTime IS NULL) —
    // otherwise the still-running aggregate event is silently dropped and the
    // "Start Batch" affordance can spawn a duplicate timer.
    const openEvent = await trx
      .selectFrom("productionEvent")
      .select("id")
      .where("jobOperationBatchId", "=", jobOperationBatchId)
      .where("companyId", "=", companyId)
      .where("endTime", "is", null)
      .limit(1)
      .executeTakeFirst();

    if (openEvent) {
      throw new Error(
        "Cannot complete a batch while a timer is still running — stop the timer first"
      );
    }

    // The recorded aggregate batch timers (ended). Each is sliced across members.
    const recorded = await trx
      .selectFrom("productionEvent")
      .select([
        "id",
        "type",
        "startTime",
        "endTime",
        "workCenterId",
        "employeeId",
      ])
      .where("jobOperationBatchId", "=", jobOperationBatchId)
      .where("companyId", "=", companyId)
      .where("endTime", "is not", null)
      .execute();

    const plan = buildBatchCompletionPlan(
      recorded
        .filter((e) => e.endTime)
        .map((e) => ({
          id: e.id,
          type: e.type,
          startTime: e.startTime,
          endTime: e.endTime as string,
          workCenterId: e.workCenterId,
          employeeId: e.employeeId,
        })),
      members.map((m) => ({
        jobOperationId: m.jobOperationId,
        operationQuantity: opById.get(m.jobOperationId)?.operationQuantity ?? 0,
        quantity: m.quantity,
        scrapQuantity: m.scrapQuantity,
      }))
    );

    const memberEventRows: (PlannedMemberEvent & { id: string })[] =
      plan.memberEvents.map((e) => ({ ...e, id: nanoid() }));

    // Replace the aggregate timers with the per-member slices.
    if (recorded.length) {
      await trx
        .deleteFrom("productionEvent")
        .where("jobOperationBatchId", "=", jobOperationBatchId)
        .where("companyId", "=", companyId)
        .where("endTime", "is not", null)
        .execute();
    }

    if (memberEventRows.length) {
      await trx
        .insertInto("productionEvent")
        .values(
          // deno-lint-ignore no-explicit-any
          memberEventRows.map((e) => ({
            id: e.id,
            jobOperationId: e.jobOperationId,
            jobOperationBatchId,
            type: e.type,
            startTime: e.startTime,
            endTime: e.endTime,
            workCenterId: e.workCenterId,
            employeeId: e.employeeId,
            postedToGL: false,
            companyId,
            createdBy: userId,
            createdAt: now,
          })) as any
        )
        .execute();
    }

    if (plan.quantities.length) {
      await trx
        .insertInto("productionQuantity")
        .values(
          // deno-lint-ignore no-explicit-any
          plan.quantities.map((q) => ({
            id: nanoid(),
            jobOperationId: q.jobOperationId,
            type: q.type,
            quantity: q.quantity,
            companyId,
            createdBy: userId,
            createdAt: now,
          })) as any
        )
        .execute();
    }

    // Freshly sliced events are unposted — phase 2 posts every one.
    glEvents = memberEventRows.map((e) => ({ id: e.id, postedToGL: false }));

    // Guarded intermediate flip Active -> Completing. The `WHERE status = 'Active'`
    // precondition is the backstop to the FOR UPDATE lock: if it matches 0 rows a
    // concurrent completer won the race, so we throw and roll back every write in
    // this transaction, leaving that completer to carry the batch through.
    const marked = await trx
      .updateTable("jobOperationBatch")
      .set({ status: "Completing", updatedBy: userId, updatedAt: now })
      .where("id", "=", jobOperationBatchId)
      .where("companyId", "=", companyId)
      .where("status", "=", "Active")
      .returning(["id"])
      .executeTakeFirst();

    if (!marked) {
      throw new Error("Only an active batch can be completed");
    }
  });

  // Phase 2 (post-commit, idempotent) — safe to re-run on a resume. The batch is
  // 'Completing', so any failure below leaves it 'Completing' and a retry resumes.
  // Issue each member's OWN job BOM — the `issue` fn is backflush-capped, so a
  // re-issue on resume computes 0 remaining and doesn't double-issue.
  for (const m of members) {
    const issue = await client.functions.invoke("issue", {
      body: {
        id: m.jobOperationId,
        type: "jobOperation",
        quantity: m.quantity,
        companyId,
        userId,
      },
    });
    if (issue.error) {
      throw new Error(
        `Failed to issue materials for operation ${m.jobOperationId}: ${issue.error.message}`
      );
    }
  }

  // Flip every member Done — the sync_finish_job_operation trigger readies each
  // member job's next operation and completes the job independently. Skip members
  // already Done so a resume doesn't re-fire the trigger (idempotent).
  const done = await client
    .from("jobOperation")
    .update({ status: "Done", updatedBy: userId })
    .in("id", memberIds)
    .eq("companyId", companyId)
    .neq("status", "Done");
  if (done.error) {
    throw new Error(`Failed to finish batch operations: ${done.error.message}`);
  }

  // Post GL for each per-member sliced event (proportional share, no special
  // case). Skip events a prior attempt already posted, and propagate any error
  // (previously swallowed) so a GL failure keeps the batch resumable rather than
  // silently finalizing with missing journal lines.
  for (const e of glEvents) {
    if (e.postedToGL) continue;
    const posted = await client.functions.invoke("post-production-event", {
      body: { productionEventId: e.id, userId, companyId },
    });
    if (posted.error) {
      throw new Error(
        `Failed to post GL for production event ${e.id}: ${posted.error.message}`
      );
    }
  }

  // Finalize: flip Completing -> Completed now that every phase-2 effect
  // succeeded. Guarded so a concurrent finalizer that already flipped it is a
  // no-op rather than an error.
  const finalized = await client
    .from("jobOperationBatch")
    .update({ status: "Completed", updatedBy: userId, updatedAt: now })
    .eq("id", jobOperationBatchId)
    .eq("companyId", companyId)
    .eq("status", "Completing");
  if (finalized.error) {
    throw new Error(
      `Failed to finalize batch completion: ${finalized.error.message}`
    );
  }

  return new Response(
    JSON.stringify({ success: true, id: jobOperationBatchId, completed: true }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    }
  );
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const parsed = payloadValidator.parse(payload);
    const { companyId, userId } = parsed;

    // Batch mutations are production updates. The service-role client is used
    // only by the completion path (for its post-commit edge-function calls);
    // the membership cases write exclusively through the Kysely transaction.
    const client = await requirePermissions(req, companyId, userId, {
      update: "production",
    });

    const now = new Date().toISOString();

    // Completion is a distinct flow: a Kysely transaction slices the recorded
    // batch timer events into per-member events + writes per-member quantities,
    // then a post-commit pass consumes each member's own BOM (issue), flips the
    // members Done, and posts GL per sliced event. Kept out of the generic
    // membership switch because it mixes transactional writes with edge-fn calls.
    if (parsed.type === "complete") {
      return await completeBatch(client, {
        companyId,
        userId,
        now,
        jobOperationBatchId: parsed.jobOperationBatchId,
        members: parsed.members,
      });
    }

    const result = await db.transaction().execute(async (trx) => {
      switch (parsed.type) {
        case "create": {
          const { processId, jobOperationIds } = parsed;

          const process = await trx
            .selectFrom("process")
            .select(["id", "batchable"])
            .where("id", "=", processId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (!process) throw new Error(`Process ${processId} was not found`);
          if (!process.batchable) {
            throw new Error(`Process ${processId} is not batchable`);
          }

          await assertOperationsEligible(
            trx,
            jobOperationIds,
            processId,
            companyId
          );

          const readableId = await getNextSequence(
            trx,
            "jobOperationBatch",
            companyId
          );

          const id = nanoid();
          await trx
            .insertInto("jobOperationBatch")
            .values({
              id,
              readableId,
              companyId,
              processId,
              locationId: parsed.locationId,
              workCenterId: parsed.workCenterId ?? null,
              notes: parsed.notes ?? null,
              status: "Active",
              createdBy: userId,
              createdAt: now,
            })
            .execute();

          // Tag members; assigning a work center propagates it to every member
          // operation (batching physically puts the job on that machine).
          const memberUpdate: Record<string, unknown> = {
            jobOperationBatchId: id,
            updatedBy: userId,
            updatedAt: now,
          };
          if (parsed.workCenterId) {
            memberUpdate.workCenterId = parsed.workCenterId;
          }

          // Atomic claim: only grab operations still unbatched. A concurrent
          // create/add blocks on the row lock, then re-evaluates this WHERE
          // against the committed row and skips any operation the other txn took.
          const claimed = await trx
            .updateTable("jobOperation")
            .set(memberUpdate)
            .where("id", "in", jobOperationIds)
            .where("companyId", "=", companyId)
            .where("jobOperationBatchId", "is", null)
            .executeTakeFirst();

          assertAllOperationsClaimed(
            jobOperationIds,
            Number(claimed?.numUpdatedRows ?? 0n)
          );

          return { id, readableId };
        }

        case "add": {
          const { jobOperationBatchId, jobOperationIds } = parsed;

          const batch = await trx
            .selectFrom("jobOperationBatch")
            .select(["id", "processId", "workCenterId", "status"])
            .where("id", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (!batch) {
            throw new Error(`Batch ${jobOperationBatchId} was not found`);
          }
          if (batch.status !== "Active") {
            throw new Error("Cannot modify a batch that is not active");
          }

          await assertNoBatchProductionEvent(
            trx,
            jobOperationBatchId,
            companyId,
            "add operations to"
          );

          await assertOperationsEligible(
            trx,
            jobOperationIds,
            batch.processId,
            companyId
          );

          const memberUpdate: Record<string, unknown> = {
            jobOperationBatchId,
            updatedBy: userId,
            updatedAt: now,
          };
          // Adding to a work-centered batch sets the op's work center.
          if (batch.workCenterId) {
            memberUpdate.workCenterId = batch.workCenterId;
          }

          // Atomic claim (see create): only grab operations still unbatched, so
          // two concurrent adds can't both tag the same operation.
          const claimed = await trx
            .updateTable("jobOperation")
            .set(memberUpdate)
            .where("id", "in", jobOperationIds)
            .where("companyId", "=", companyId)
            .where("jobOperationBatchId", "is", null)
            .executeTakeFirst();

          assertAllOperationsClaimed(
            jobOperationIds,
            Number(claimed?.numUpdatedRows ?? 0n)
          );

          return { id: jobOperationBatchId };
        }

        case "remove": {
          const { jobOperationBatchId, jobOperationIds } = parsed;

          await assertNoBatchProductionEvent(
            trx,
            jobOperationBatchId,
            companyId,
            "remove operations from"
          );

          await trx
            .updateTable("jobOperation")
            .set({
              jobOperationBatchId: null,
              updatedBy: userId,
              updatedAt: now,
            })
            .where("id", "in", jobOperationIds)
            .where("jobOperationBatchId", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          // Removing the last member dissolves the batch (a batch never sits empty).
          const remaining = await trx
            .selectFrom("jobOperation")
            .select("id")
            .where("jobOperationBatchId", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .limit(1)
            .executeTakeFirst();

          if (!remaining) {
            await trx
              .deleteFrom("jobOperationBatch")
              .where("id", "=", jobOperationBatchId)
              .where("companyId", "=", companyId)
              .execute();
            return { id: jobOperationBatchId, dissolved: true };
          }

          return { id: jobOperationBatchId };
        }

        case "updateWorkCenter": {
          const { jobOperationBatchId, workCenterId } = parsed;

          const batch = await trx
            .selectFrom("jobOperationBatch")
            .select(["id", "status"])
            .where("id", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (!batch) {
            throw new Error(`Batch ${jobOperationBatchId} was not found`);
          }

          // Reject the change on a terminal (Completed/Cancelled) batch, then —
          // since a batch is Active for its whole working life — block it once
          // production has started (any production event exists). Moving the work
          // center after that would re-point recorded time to a different machine.
          assertBatchWorkCenterMutable(batch.status);
          await assertNoBatchProductionEvent(
            trx,
            jobOperationBatchId,
            companyId,
            "change the work center of"
          );

          await trx
            .updateTable("jobOperationBatch")
            .set({ workCenterId, updatedBy: userId, updatedAt: now })
            .where("id", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          // Assigning a work center writes it to every member operation.
          await trx
            .updateTable("jobOperation")
            .set({ workCenterId, updatedBy: userId, updatedAt: now })
            .where("jobOperationBatchId", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          return { id: jobOperationBatchId };
        }

        case "dissolve": {
          const { jobOperationBatchId } = parsed;

          await assertNoBatchProductionEvent(
            trx,
            jobOperationBatchId,
            companyId,
            "dissolve"
          );

          await trx
            .updateTable("jobOperation")
            .set({
              jobOperationBatchId: null,
              updatedBy: userId,
              updatedAt: now,
            })
            .where("jobOperationBatchId", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .deleteFrom("jobOperationBatch")
            .where("id", "=", jobOperationBatchId)
            .where("companyId", "=", companyId)
            .execute();

          return { id: jobOperationBatchId, dissolved: true };
        }
      }
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("Error in batch-operations:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
