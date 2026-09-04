import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { Transaction } from "kysely";
import z from "npm:zod@^3.24.1";
import { type DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { Database } from "../lib/types.ts";
import { requirePermissions } from "../lib/supabase.ts";
import {
  assertAllOperationsClaimed,
  assertBatchCompletionMembership,
  assertBatchWorkCenterMutable,
  buildBatchCompletionPlan,
  planBatchCompletion
} from "../shared/batch-time-split.ts";
import {
  BATCH_RULE_DIMENSIONS,
  type BatchRules,
  type MemberValueSets,
  mustViolations,
  resolveBatchRules
} from "../shared/batch-compatibility.ts";
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
    notes: z.string().optional().nullable(),
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
          scrapQuantity: z.number().int().min(0).optional(),
          // "Not in this run": detach the member back to the schedule instead
          // of completing it. Its quantities must be 0.
          excluded: z.boolean().optional()
        })
      )
      .min(1),
    companyId: z.string(),
    userId: z.string()
  })
]);

async function assertEligible(
  trx: Transaction<DB>,
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
    .where("companyId", "=", companyId)
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
    .where("companyId", "=", companyId)
    .limit(1)
    .execute();
  if (events.length > 0) {
    throw new Error(
      "Operations with recorded production events cannot be batched"
    );
  }
  return { operations, processId };
}

// Record ids in the payload come straight from the caller and prove nothing
// about tenancy — requirePermissions only authorizes the CALLER for companyId.
// Re-read the record under companyId and refuse on a miss (the same rule the
// composite FKs enforce at the schema level; this gives the caller a named
// error instead of a constraint violation).
async function assertCompanyRecord(
  trx: Transaction<DB>,
  table: "location" | "workCenter",
  id: string,
  companyId: string,
  label: string
) {
  const row = await trx
    .selectFrom(table)
    .select("id")
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!row) throw new Error(`${label} not found`);
}

// Enforce the process's "must match" compatibility rules across the WHOLE batch
// membership (create: the incoming set; add: existing members + incoming). Skips
// entirely when the process has no "must" dimension. Uses ids where the client
// (BatchBuilder) uses names — mustViolations is value-agnostic, so both agree.
async function assertMaterialCompatible(
  trx: Transaction<DB>,
  companyId: string,
  processId: string,
  jobOperationIds: string[]
) {
  const process = await trx
    .selectFrom("process")
    .select(["batchRules"])
    .where("id", "=", processId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const rules = resolveBatchRules(
    (process?.batchRules ?? null) as BatchRules | null
  );
  if (!BATCH_RULE_DIMENSIONS.some((d) => rules[d] === "must")) return;

  const rows = await trx
    .selectFrom("jobMaterial as jm")
    .innerJoin("item as mi", (join: any) =>
      join
        .onRef("mi.id", "=", "jm.itemId")
        .onRef("mi.companyId", "=", "jm.companyId")
    )
    .leftJoin("material as m", (join: any) =>
      join
        .onRef("m.id", "=", "mi.readableId")
        .onRef("m.companyId", "=", "mi.companyId")
    )
    .select([
      "jm.jobOperationId as opId",
      "mi.readableId as itemReadableId",
      "m.materialSubstanceId as substanceId",
      "m.gradeId as gradeId",
      "m.dimensionId as dimensionId",
      "m.materialFormId as formId",
      "m.finishId as finishId"
    ])
    .where("jm.jobOperationId", "in", jobOperationIds)
    .where("jm.companyId", "=", companyId)
    .execute();

  const byOp = new Map<string, MemberValueSets>();
  for (const id of jobOperationIds) {
    byOp.set(id, {
      item: [],
      substance: [],
      grade: [],
      dimension: [],
      form: [],
      finish: []
    });
  }
  for (const r of rows) {
    // jobMaterial.jobOperationId is nullable; a null-op row can't attribute to
    // a member (and byOp is keyed by the passed ids anyway).
    if (!r.opId) continue;
    const sets = byOp.get(r.opId);
    if (!sets) continue;
    if (r.itemReadableId) sets.item!.push(r.itemReadableId);
    if (r.substanceId) sets.substance!.push(r.substanceId);
    if (r.gradeId) sets.grade!.push(r.gradeId);
    if (r.dimensionId) sets.dimension!.push(r.dimensionId);
    if (r.formId) sets.form!.push(r.formId);
    if (r.finishId) sets.finish!.push(r.finishId);
  }

  const violations = mustViolations(rules, Array.from(byOp.values()));
  if (violations.length > 0) {
    throw new Error(
      `These operations can't share a batch — the ${violations.join(
        ", "
      )} must match on this process`
    );
  }
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
      excluded?: boolean;
    }[];
  }
): Promise<Record<string, unknown>> {
  const { companyId, userId, batchId } = args;
  // Partition "not in this run" members: they were never physically part of the
  // batch run, so they detach back to the schedule un-run instead of completing.
  // They may not carry quantities, and a batch cannot exclude everyone —
  // dissolve exists for that.
  const members = args.members.filter((m) => !m.excluded);
  const excluded = args.members.filter((m) => m.excluded);
  if (members.length === 0) {
    throw new Error(
      "Every operation is excluded — dissolve the batch instead of completing it"
    );
  }
  for (const m of excluded) {
    if (m.quantity > 0 || (m.scrapQuantity ?? 0) > 0) {
      throw new Error(
        `Excluded operation ${m.jobOperationId} cannot record quantities`
      );
    }
  }
  const memberIds = members.map((m) => m.jobOperationId);
  const excludedIds = excluded.map((m) => m.jobOperationId);
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
      // The payload must cover EXACTLY the batch's membership — phase 2 flips
      // every member Done batch-wide but issues materials only for the submitted
      // members, so a short payload would strand an omitted member Done with
      // unissued BOM. Re-assert membership on resume just as the slice path does.
      const currentMembers = await trx
        .selectFrom("jobOperation")
        .select("id")
        .where("jobOperationBatchId", "=", batchId)
        .where("companyId", "=", companyId)
        .execute();
      // deno-lint-ignore no-explicit-any
      const currentIds = new Set(currentMembers.map((o: any) => o.id));
      // An exclusion that phase 1 already applied is a stale-form resubmission
      // and passes (the op is no longer a member). Excluding an op that IS still
      // a member would rewrite phase 1's committed decision — reject it like a
      // changed quantity.
      const lateExclusion = excludedIds.find((id) => currentIds.has(id));
      if (lateExclusion) {
        throw new Error(
          `Operation ${lateExclusion} was included when completion started — ` +
            `retry with the recorded values; corrections happen after completion.`
        );
      }
      assertBatchCompletionMembership(memberIds, [...currentIds]);

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
    // quantities or material issue. Included AND excluded together must cover
    // the membership exactly; the excluded ones then detach below.
    assertBatchCompletionMembership(
      [...memberIds, ...excludedIds],
      // deno-lint-ignore no-explicit-any
      operations.map((o: any) => o.id)
    );

    // Detach "not in this run" members inside the same transaction: back to the
    // schedule un-run — no time slice, no quantities, and phase 2's batch-wide
    // Done flip no longer reaches them.
    if (excludedIds.length > 0) {
      const detached = await trx
        .updateTable("jobOperation")
        .set({ jobOperationBatchId: null, updatedBy: userId })
        .where("id", "in", excludedIds)
        .where("jobOperationBatchId", "=", batchId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (Number(detached?.numUpdatedRows ?? 0) !== excludedIds.length) {
        throw new Error("Failed to detach excluded operations — retry");
      }
    }
    const excludedIdSet = new Set(excludedIds);
    const runOperations = operations.filter(
      // deno-lint-ignore no-explicit-any
      (o: any) => !excludedIdSet.has(o.id)
    );

    // deno-lint-ignore no-explicit-any
    const opById = new Map(runOperations.map((o: any) => [o.id, o]));

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
          // The shared plan types `type` as `string | null`; narrow it back to
          // the column's enum here rather than casting the whole insert object.
          type: e.type as
            | Database["public"]["Enums"]["productionEventType"]
            | null,
          employeeId: e.employeeId,
          workCenterId: e.workCenterId,
          companyId,
          createdBy: userId,
          jobOperationBatchId: batchId,
          jobOperationId: e.jobOperationId,
          startTime: e.startTime,
          endTime: e.endTime,
          postedToGL: false
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      glEvents.push({ id: inserted.id, postedToGL: false });
    }

    if (plan.quantities.length > 0) {
      await trx
        .insertInto("productionQuantity")
        .values(
          // q.type is "Production" | "Scrap", a subset of productionQuantityType,
          // so the insert types cleanly without a cast.
          plan.quantities.map((q) => ({
            jobOperationId: q.jobOperationId,
            type: q.type,
            quantity: q.quantity,
            companyId,
            createdBy: userId
          }))
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

  return {
    completed: members.length,
    excluded: excludedIds.length,
    memberIds,
    eventIds: glEvents.map((e) => e.id)
  };
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
          const { operations, processId } = await assertEligible(
            trx,
            companyId,
            payload.jobOperationIds
          );
          await assertCompanyRecord(
            trx,
            "location",
            payload.locationId,
            companyId,
            "Location"
          );
          if (payload.workCenterId) {
            await assertCompanyRecord(
              trx,
              "workCenter",
              payload.workCenterId,
              companyId,
              "Work center"
            );
          }
          await assertMaterialCompatible(
            trx,
            companyId,
            processId,
            payload.jobOperationIds
          );
          // The board's "Create batch" sends no work center (assignment is a
          // drag) — but when every member already sits on the same one, that IS
          // the batch's work center; adopt it so the header isn't blank.
          const memberWorkCenters = new Set(
            operations
              // deno-lint-ignore no-explicit-any
              .map((o: any) => o.workCenterId)
              .filter(Boolean)
          );
          const workCenterId =
            payload.workCenterId ??
            (memberWorkCenters.size === 1
              ? ([...memberWorkCenters][0] as string)
              : null);
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
              workCenterId,
              locationId: payload.locationId,
              status: "Active",
              notes: payload.notes ?? null,
              createdBy: userId
            })
            .returning(["id", "readableId"])
            .executeTakeFirstOrThrow();

          const memberUpdate: Record<string, unknown> = {
            jobOperationBatchId: batch.id,
            updatedBy: userId
          };
          if (payload.workCenterId) memberUpdate.workCenterId = payload.workCenterId;
          // Claim only ops still unbatched (IS NULL) and in this company: two
          // concurrent creates sharing an op both pass assertEligible's read, so
          // the IS NULL predicate + row-count assert is what actually serializes
          // the claim (assertEligible is not FOR UPDATE).
          const claimed = await trx
            .updateTable("jobOperation")
            .set(memberUpdate)
            .where("id", "in", payload.jobOperationIds)
            .where("companyId", "=", companyId)
            .where("jobOperationBatchId", "is", null)
            .executeTakeFirst();
          assertAllOperationsClaimed(
            payload.jobOperationIds,
            Number(claimed?.numUpdatedRows ?? 0)
          );
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
            .where("companyId", "=", companyId)
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

          // Compatibility is a property of the whole run: check existing members
          // plus the incoming ops together, not the newcomers in isolation.
          const existingMembers = await trx
            .selectFrom("jobOperation")
            .select("id")
            .where("jobOperationBatchId", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .execute();
          await assertMaterialCompatible(trx, companyId, batch.processId, [
            // deno-lint-ignore no-explicit-any
            ...existingMembers.map((m: any) => m.id as string),
            ...payload.jobOperationIds
          ]);

          const memberUpdate: Record<string, unknown> = {
            jobOperationBatchId: batch.id,
            updatedBy: userId
          };
          if (batch.workCenterId) memberUpdate.workCenterId = batch.workCenterId;
          const claimed = await trx
            .updateTable("jobOperation")
            .set(memberUpdate)
            .where("id", "in", payload.jobOperationIds)
            .where("companyId", "=", companyId)
            .where("jobOperationBatchId", "is", null)
            .executeTakeFirst();
          assertAllOperationsClaimed(
            payload.jobOperationIds,
            Number(claimed?.numUpdatedRows ?? 0)
          );
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
            .where("companyId", "=", companyId)
            .limit(1)
            .execute();
          if (batchEvents.length > 0) {
            throw new Error(
              "Cannot remove operations: production has been recorded. Complete the batch instead."
            );
          }
          // Count actual detaches — an id that isn't a member of this batch
          // (already removed, or never belonged) must not be reported removed.
          const removedResult = await trx
            .updateTable("jobOperation")
            .set({ jobOperationBatchId: null, updatedBy: userId })
            .where("id", "in", payload.jobOperationIds)
            .where("jobOperationBatchId", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
          const removed = Number(removedResult?.numUpdatedRows ?? 0);

          const remaining = await trx
            .selectFrom("jobOperation")
            .select("id")
            .where("jobOperationBatchId", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .limit(1)
            .execute();
          if (remaining.length === 0) {
            await trx
              .deleteFrom("jobOperationBatch")
              .where("id", "=", payload.batchId)
              .where("companyId", "=", companyId)
              .execute();
            return { removed, dissolved: true };
          }
          return { removed, dissolved: false };
        });
        break;
      }

      case "update": {
        const nextWorkCenterId = payload.workCenterId ?? null;
        result = await db.transaction().execute(async (trx) => {
          const batch = await trx
            .selectFrom("jobOperationBatch")
            .select("status")
            .where("id", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
          if (!batch) throw new Error("Batch not found");
          if (nextWorkCenterId) {
            await assertCompanyRecord(
              trx,
              "workCenter",
              nextWorkCenterId,
              companyId,
              "Work center"
            );
          }
          // A Completed/Completing batch's events are already attributed to a
          // machine — re-pointing the work center would rewrite that history.
          assertBatchWorkCenterMutable(batch.status);
          // And once any production event exists, production has started against
          // the current work center, so the reassignment is no longer safe.
          const batchEvents = await trx
            .selectFrom("productionEvent")
            .select("id")
            .where("jobOperationBatchId", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .limit(1)
            .execute();
          if (batchEvents.length > 0) {
            throw new Error(
              "Cannot change the work center: production has been recorded."
            );
          }
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
          // Members mirror the header in BOTH directions: assigning pushes the
          // work center down, and clearing (nextWorkCenterId === null) clears it
          // on the members too — otherwise they keep a stale workCenterId the
          // header no longer has.
          await trx
            .updateTable("jobOperation")
            .set({ workCenterId: nextWorkCenterId, updatedBy: userId })
            .where("jobOperationBatchId", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .execute();
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
            .where("companyId", "=", companyId)
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
            .where("companyId", "=", companyId)
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
