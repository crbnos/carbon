import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "npm:zod@^3.24.1";
import { type DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import {
  assertBatchCompletionMembership,
  buildBatchCompletionPlan,
  planBatchCompletion
} from "../shared/batch-time-split.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const NOT_STARTED = ["Todo", "Ready", "Waiting"];

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    jobOperationIds: z.array(z.string()).min(1),
    locationId: z.string(),
    workCenterId: z.string().optional().nullable(),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("add"),
    batchId: z.string(),
    jobOperationIds: z.array(z.string()).min(1),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("remove"),
    batchId: z.string(),
    jobOperationIds: z.array(z.string()).min(1),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("update"),
    batchId: z.string(),
    workCenterId: z.string().nullable().optional(),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("dissolve"),
    batchId: z.string(),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("complete"),
    batchId: z.string(),
    members: z
      .array(
        z.object({
          jobOperationId: z.string(),
          quantity: z.number().int().min(0),
          scrapQuantity: z.number().int().min(0).optional()
        })
      )
      .min(1),
    companyId: z.string(),
    userId: z.string()
  })
]);

// deno-lint-ignore no-explicit-any
async function assertEligible(
  // deno-lint-ignore no-explicit-any
  trx: any,
  companyId: string,
  jobOperationIds: string[],
  expectedProcessId?: string
) {
  const operations = await trx
    .selectFrom("jobOperation")
    .selectAll()
    .where("id", "in", jobOperationIds)
    .where("companyId", "=", companyId)
    .execute();
  if (operations.length !== jobOperationIds.length) {
    throw new Error("One or more operations not found");
  }
  const processId = expectedProcessId ?? operations[0].processId;
  const process = await trx
    .selectFrom("process")
    .select(["id", "batchable"])
    .where("id", "=", processId)
    .executeTakeFirst();
  if (!process?.batchable) {
    throw new Error("The process is not batchable");
  }
  for (const op of operations) {
    if (op.processId !== processId) {
      throw new Error(`Operation ${op.id} is not on the batch's process`);
    }
    if (op.jobOperationBatchId) {
      throw new Error(`Operation ${op.id} is already in a batch`);
    }
    if (!NOT_STARTED.includes(op.status)) {
      throw new Error(`Operation ${op.id} has already started`);
    }
  }
  const events = await trx
    .selectFrom("productionEvent")
    .select("id")
    .where("jobOperationId", "in", jobOperationIds)
    .limit(1)
    .execute();
  if (events.length > 0) {
    throw new Error(
      "Operations with recorded production events cannot be batched"
    );
  }
  return { operations, processId };
}

// Two-phase, resumable batch completion.
//
// Phase 1 (one Kysely transaction, runs once): FOR UPDATE the batch row to
// serialize completers, then slice the recorded aggregate timers into per-member
// productionEvent rows (∝ operationQuantity) + write per-member productionQuantity
// rows, and flip the batch Active -> Completing (guarded). productionEvent.duration
// is a GENERATED column, so the proportional windows make each member's duration —
// and thus GL cost — proportional with no manual duration write.
//
// Phase 2 (post-commit, idempotent): issue each member's own BOM (backflush-capped),
// flip members Done (skipping already-Done), and post GL per sliced event (skipping
// already-posted). Any throw here leaves the batch Completing; re-invoking with the
// same payload re-enters via planBatchCompletion -> "resume" and finishes phase 2
// without re-slicing. Only after every phase-2 effect succeeds is the batch flipped
// Completing -> Completed. This removes the old failure mode where a post-commit
// error left the batch Completed with unissued materials or unposted GL and no
// recovery path.
async function completeBatch(
  client: Awaited<ReturnType<typeof requirePermissions>>,
  args: {
    companyId: string;
    userId: string;
    batchId: string;
    members: {
      jobOperationId: string;
      quantity: number;
      scrapQuantity?: number;
    }[];
  }
): Promise<Record<string, unknown>> {
  const { companyId, userId, batchId, members } = args;
  const memberIds = members.map((m) => m.jobOperationId);
  const now = new Date().toISOString();

  // The per-member sliced events whose GL is posted AFTER the transaction commits.
  // postedToGL lets a resume skip events a prior attempt already posted. Populated
  // inside the transaction: freshly sliced on the first attempt, re-loaded on resume.
  let glEvents: { id: string; postedToGL: boolean }[] = [];

  await db.transaction().execute(async (trx) => {
    const batch = await trx
      .selectFrom("jobOperationBatch")
      .select(["id", "status"])
      .where("id", "=", batchId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!batch) throw new Error(`Batch ${batchId} was not found`);

    // "resume" if the batch is already Completing (a prior phase-2 step failed);
    // "slice" if Active; throws for Completed/terminal.
    const phase = planBatchCompletion(batch.status);

    if (phase === "resume") {
      // Resume contract: the payload must match what phase 1 already recorded —
      // an edited quantity on retry is rejected, never silently ignored and never
      // rewritten (phase 1's slices/quantities are already committed). Batch
      // members were unstarted at batch time and batch completion is the only
      // productionQuantity writer between Active and Completing, so per-op sums
      // equal the phase-1 inserts.
      const recordedQuantities = await trx
        .selectFrom("productionQuantity")
        .select(["jobOperationId", "type", "quantity"])
        .where("jobOperationId", "in", memberIds)
        .where("companyId", "=", companyId)
        .execute();
      const sums = new Map<string, { produced: number; scrap: number }>();
      // deno-lint-ignore no-explicit-any
      for (const r of recordedQuantities as any[]) {
        const s = sums.get(r.jobOperationId) ?? { produced: 0, scrap: 0 };
        if (r.type === "Production") s.produced += Number(r.quantity);
        if (r.type === "Scrap") s.scrap += Number(r.quantity);
        sums.set(r.jobOperationId, s);
      }
      const mismatches = members.filter((m) => {
        const s = sums.get(m.jobOperationId) ?? { produced: 0, scrap: 0 };
        return s.produced !== m.quantity || s.scrap !== (m.scrapQuantity ?? 0);
      });
      if (mismatches.length > 0) {
        const detail = mismatches
          .map((m) => {
            const s = sums.get(m.jobOperationId) ?? { produced: 0, scrap: 0 };
            return `${m.jobOperationId}: ${s.produced} produced / ${s.scrap} scrap`;
          })
          .join(", ");
        throw new Error(
          `Quantities were already recorded for this batch (${detail}). ` +
            `Retry with the recorded values; corrections happen after completion.`
        );
      }

      const existing = await trx
        .selectFrom("productionEvent")
        .select(["id", "postedToGL"])
        .where("jobOperationBatchId", "=", batchId)
        .where("companyId", "=", companyId)
        .where("endTime", "is not", null)
        .execute();
      // deno-lint-ignore no-explicit-any
      glEvents = existing.map((e: any) => ({
        id: e.id,
        postedToGL: e.postedToGL ?? false
      }));
      return;
    }

    // phase === "slice": first attempt.
    const operations = await trx
      .selectFrom("jobOperation")
      .select(["id", "operationQuantity"])
      .where("jobOperationBatchId", "=", batchId)
      .where("companyId", "=", companyId)
      .execute();
    if (operations.length === 0) throw new Error("Batch not found or empty");

    // Reject dupes / unknown ids / omitted members — any would corrupt
    // quantities or material issue.
    assertBatchCompletionMembership(
      memberIds,
      // deno-lint-ignore no-explicit-any
      operations.map((o: any) => o.id)
    );

    // deno-lint-ignore no-explicit-any
    const opById = new Map(operations.map((o: any) => [o.id, o]));

    // Refuse to complete while a batch timer is still running — otherwise the
    // still-open aggregate event is silently dropped.
    const openEvent = await trx
      .selectFrom("productionEvent")
      .select("id")
      .where("jobOperationBatchId", "=", batchId)
      .where("companyId", "=", companyId)
      .where("endTime", "is", null)
      .limit(1)
      .executeTakeFirst();
    if (openEvent) {
      throw new Error(
        "Cannot complete a batch while a timer is still running — stop the timer first"
      );
    }

    const recorded = await trx
      .selectFrom("productionEvent")
      .select(["id", "type", "startTime", "endTime", "workCenterId", "employeeId"])
      .where("jobOperationBatchId", "=", batchId)
      .where("companyId", "=", companyId)
      .where("endTime", "is not", null)
      .execute();

    const plan = buildBatchCompletionPlan(
      recorded
        // deno-lint-ignore no-explicit-any
        .filter((e: any) => e.endTime)
        // deno-lint-ignore no-explicit-any
        .map((e: any) => ({
          id: e.id,
          type: e.type,
          startTime: e.startTime,
          endTime: e.endTime as string,
          workCenterId: e.workCenterId,
          employeeId: e.employeeId
        })),
      members.map((m) => ({
        jobOperationId: m.jobOperationId,
        operationQuantity: Number(opById.get(m.jobOperationId)?.operationQuantity ?? 0),
        quantity: m.quantity,
        scrapQuantity: m.scrapQuantity
      }))
    );

    // Replace the aggregate timers with the per-member slices.
    if (recorded.length > 0) {
      await trx
        .deleteFrom("productionEvent")
        .where("jobOperationBatchId", "=", batchId)
        .where("companyId", "=", companyId)
        .where("endTime", "is not", null)
        .execute();
    }

    for (const e of plan.memberEvents) {
      const inserted = await trx
        .insertInto("productionEvent")
        .values({
          type: e.type,
          employeeId: e.employeeId,
          workCenterId: e.workCenterId,
          companyId,
          createdBy: userId,
          jobOperationBatchId: batchId,
          jobOperationId: e.jobOperationId,
          startTime: e.startTime,
          endTime: e.endTime,
          postedToGL: false
          // deno-lint-ignore no-explicit-any
        } as any)
        .returning("id")
        .executeTakeFirstOrThrow();
      glEvents.push({ id: inserted.id, postedToGL: false });
    }

    if (plan.quantities.length > 0) {
      await trx
        .insertInto("productionQuantity")
        .values(
          plan.quantities.map((q) => ({
            jobOperationId: q.jobOperationId,
            type: q.type,
            quantity: q.quantity,
            companyId,
            createdBy: userId
            // deno-lint-ignore no-explicit-any
          })) as any
        )
        .execute();
    }

    // Guarded Active -> Completing. WHERE status='Active' is the backstop to the
    // FOR UPDATE lock: 0 rows means a concurrent completer won — throw and roll
    // back every write in this transaction.
    const marked = await trx
      .updateTable("jobOperationBatch")
      .set({ status: "Completing", updatedBy: userId, updatedAt: now })
      .where("id", "=", batchId)
      .where("companyId", "=", companyId)
      .where("status", "=", "Active")
      .returning("id")
      .executeTakeFirst();
    if (!marked) throw new Error("Only an active batch can be completed");
  });

  // Phase 2 (post-commit, idempotent). Any throw leaves the batch Completing; a
  // retry re-runs these steps alone.
  for (const m of members) {
    if (m.quantity <= 0) continue;
    const issue = await client.functions.invoke("issue", {
      body: {
        id: m.jobOperationId,
        type: "jobOperation",
        quantity: m.quantity,
        companyId,
        userId
      }
    });
    if (issue.error) {
      throw new Error(
        `Failed to issue materials for operation ${m.jobOperationId}: ${issue.error.message}`
      );
    }
  }

  // Flip members Done — sync_finish_job_operation readies each member job's next
  // operation and completes the job independently. Skip already-Done so a resume
  // does not re-fire the trigger.
  const done = await client
    .from("jobOperation")
    .update({ status: "Done", updatedBy: userId })
    .eq("jobOperationBatchId", batchId)
    .eq("companyId", companyId)
    .neq("status", "Done");
  if (done.error) {
    throw new Error(`Failed to finish batch operations: ${done.error.message}`);
  }

  // Post GL per sliced event; skip events a prior attempt already posted, and
  // propagate errors so a GL failure keeps the batch resumable.
  for (const e of glEvents) {
    if (e.postedToGL) continue;
    const posted = await client.functions.invoke("post-production-event", {
      body: { productionEventId: e.id, userId, companyId }
    });
    if (posted.error) {
      throw new Error(
        `Failed to post GL for production event ${e.id}: ${posted.error.message}`
      );
    }
  }

  // Finalize: Completing -> Completed now that every phase-2 effect succeeded.
  const finalized = await client
    .from("jobOperationBatch")
    .update({ status: "Completed", updatedBy: userId, updatedAt: now })
    .eq("id", batchId)
    .eq("companyId", companyId)
    .eq("status", "Completing");
  if (finalized.error) {
    throw new Error(
      `Failed to finalize batch completion: ${finalized.error.message}`
    );
  }

  return { completed: members.length, memberIds, eventIds: glEvents.map((e) => e.id) };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = payloadValidator.parse(await req.json());
    const { companyId, userId } = payload;

    const client = await requirePermissions(req, companyId, userId, {
      update: "production"
    });

    let result: Record<string, unknown> = {};

    switch (payload.type) {
      case "create": {
        result = await db.transaction().execute(async (trx) => {
          const { processId } = await assertEligible(
            trx,
            companyId,
            payload.jobOperationIds
          );
          const readableId = await getNextSequence(
            trx,
            "jobOperationBatch",
            companyId
          );
          const batch = await trx
            .insertInto("jobOperationBatch")
            .values({
              readableId,
              companyId,
              processId,
              workCenterId: payload.workCenterId ?? null,
              locationId: payload.locationId,
              status: "Active",
              createdBy: userId
            })
            .returning(["id", "readableId"])
            .executeTakeFirstOrThrow();

          const memberUpdate: Record<string, unknown> = {
            jobOperationBatchId: batch.id,
            updatedBy: userId
          };
          if (payload.workCenterId) memberUpdate.workCenterId = payload.workCenterId;
          await trx
            .updateTable("jobOperation")
            .set(memberUpdate)
            .where("id", "in", payload.jobOperationIds)
            .execute();
          return batch;
        });
        break;
      }

      case "add": {
        result = await db.transaction().execute(async (trx) => {
          const batch = await trx
            .selectFrom("jobOperationBatch")
            .selectAll()
            .where("id", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
          if (!batch) throw new Error("Batch not found");
          if (batch.status !== "Active") throw new Error("Batch is not active");

          const batchEvents = await trx
            .selectFrom("productionEvent")
            .select("id")
            .where("jobOperationBatchId", "=", payload.batchId)
            .limit(1)
            .execute();
          if (batchEvents.length > 0) {
            throw new Error("The batch has already started — complete it instead");
          }

          await assertEligible(
            trx,
            companyId,
            payload.jobOperationIds,
            batch.processId
          );

          const memberUpdate: Record<string, unknown> = {
            jobOperationBatchId: batch.id,
            updatedBy: userId
          };
          if (batch.workCenterId) memberUpdate.workCenterId = batch.workCenterId;
          await trx
            .updateTable("jobOperation")
            .set(memberUpdate)
            .where("id", "in", payload.jobOperationIds)
            .execute();
          return { added: payload.jobOperationIds.length };
        });
        break;
      }

      case "remove": {
        result = await db.transaction().execute(async (trx) => {
          const batchEvents = await trx
            .selectFrom("productionEvent")
            .select("id")
            .where("jobOperationBatchId", "=", payload.batchId)
            .limit(1)
            .execute();
          if (batchEvents.length > 0) {
            throw new Error(
              "Cannot remove operations: production has been recorded. Complete the batch instead."
            );
          }
          await trx
            .updateTable("jobOperation")
            .set({ jobOperationBatchId: null, updatedBy: userId })
            .where("id", "in", payload.jobOperationIds)
            .where("jobOperationBatchId", "=", payload.batchId)
            .execute();

          const remaining = await trx
            .selectFrom("jobOperation")
            .select("id")
            .where("jobOperationBatchId", "=", payload.batchId)
            .limit(1)
            .execute();
          if (remaining.length === 0) {
            await trx
              .deleteFrom("jobOperationBatch")
              .where("id", "=", payload.batchId)
              .where("companyId", "=", companyId)
              .execute();
            return { removed: payload.jobOperationIds.length, dissolved: true };
          }
          return { removed: payload.jobOperationIds.length, dissolved: false };
        });
        break;
      }

      case "update": {
        const nextWorkCenterId = payload.workCenterId ?? null;
        result = await db.transaction().execute(async (trx) => {
          await trx
            .updateTable("jobOperationBatch")
            .set({
              workCenterId: nextWorkCenterId,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .execute();
          if (nextWorkCenterId) {
            await trx
              .updateTable("jobOperation")
              .set({ workCenterId: nextWorkCenterId, updatedBy: userId })
              .where("jobOperationBatchId", "=", payload.batchId)
              .execute();
          }
          return { updated: true };
        });
        break;
      }

      case "dissolve": {
        result = await db.transaction().execute(async (trx) => {
          const batchEvents = await trx
            .selectFrom("productionEvent")
            .select("id")
            .where("jobOperationBatchId", "=", payload.batchId)
            .limit(1)
            .execute();
          if (batchEvents.length > 0) {
            throw new Error(
              "Cannot dissolve: production has been recorded. Complete the batch instead — member jobs then proceed independently."
            );
          }
          const members = await trx
            .updateTable("jobOperation")
            .set({ jobOperationBatchId: null, updatedBy: userId })
            .where("jobOperationBatchId", "=", payload.batchId)
            .returning("id")
            .execute();
          await trx
            .deleteFrom("jobOperationBatch")
            .where("id", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .execute();
          return { dissolved: members.length };
        });
        break;
      }

      case "complete": {
        result = await completeBatch(client, {
          companyId,
          userId,
          batchId: payload.batchId,
          // zod has already validated the shape at runtime; the npm:zod type
          // inference under Deno widens the element props to optional.
          members: payload.members as {
            jobOperationId: string;
            quantity: number;
            scrapQuantity?: number;
          }[]
        });
        break;
      }
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });
  } catch (err) {
    console.error("Error in batch-operations:", err);
    return new Response(
      JSON.stringify({ success: false, message: (err as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500
      }
    );
  }
});
