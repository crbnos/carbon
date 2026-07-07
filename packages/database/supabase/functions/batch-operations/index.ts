import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import z from "npm:zod@^3.24.1";
import { type DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { proportionalShares } from "./proportional-shares.ts";

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = payloadValidator.parse(await req.json());
    const { companyId, userId } = payload;

    await requirePermissions(req, companyId, userId, {
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
        result = await db.transaction().execute(async (trx) => {
          const members = await trx
            .selectFrom("jobOperation")
            .selectAll()
            .where("jobOperationBatchId", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .execute();
          if (members.length === 0) throw new Error("Batch not found or empty");
          // deno-lint-ignore no-explicit-any
          if (members.some((m: any) => m.status === "Done")) {
            throw new Error("Batch already completed");
          }
          const inputById = new Map(
            payload.members.map((m) => [m.jobOperationId, m])
          );
          for (const m of members) {
            if (!inputById.has(m.id)) {
              throw new Error(`Missing completion quantity for operation ${m.id}`);
            }
          }

          // 1. Close open batch timers.
          await trx
            .updateTable("productionEvent")
            .set({ endTime: new Date().toISOString() })
            .where("jobOperationBatchId", "=", payload.batchId)
            .where("endTime", "is", null)
            .execute();

          // 2. Slice each batch event into contiguous per-member events whose
          // spans are ∝ operationQuantity. productionEvent.duration is a GENERATED
          // column (EXTRACT EPOCH of endTime - startTime, in seconds), so the
          // proportional windows make duration — and thus GL cost — proportional
          // with no manual duration write.
          // deno-lint-ignore no-explicit-any
          const weights = members.map((m: any) => Number(m.operationQuantity ?? 0));
          const events = await trx
            .selectFrom("productionEvent")
            .selectAll()
            .where("jobOperationBatchId", "=", payload.batchId)
            .execute();
          // deno-lint-ignore no-explicit-any
          const eventIds: string[] = events.map((e: any) => e.id);

          for (const event of events) {
            const start = new Date(event.startTime).getTime();
            const end = new Date(event.endTime!).getTime();
            const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
            if (totalSeconds === 0 || members.length === 1) continue;

            const shares = proportionalShares(totalSeconds, weights);
            let cursor = start;
            for (let i = 0; i < members.length; i++) {
              const sliceStart = new Date(cursor).toISOString();
              cursor += shares[i] * 1000;
              const sliceEnd = new Date(cursor).toISOString();
              if (i === 0) {
                await trx
                  .updateTable("productionEvent")
                  .set({
                    jobOperationId: members[0].id,
                    startTime: sliceStart,
                    endTime: sliceEnd
                  })
                  .where("id", "=", event.id)
                  .execute();
              } else {
                const inserted = await trx
                  .insertInto("productionEvent")
                  .values({
                    type: event.type,
                    employeeId: event.employeeId,
                    workCenterId: event.workCenterId,
                    companyId: event.companyId,
                    createdBy: event.createdBy ?? userId,
                    jobOperationBatchId: event.jobOperationBatchId,
                    jobOperationId: members[i].id,
                    startTime: sliceStart,
                    endTime: sliceEnd
                  })
                  .returning("id")
                  .executeTakeFirstOrThrow();
                eventIds.push(inserted.id);
              }
            }
          }

          // 3. Per-member produced + scrap quantities.
          const quantityRows = members.flatMap((m: { id: string }) => {
            const input = inputById.get(m.id)!;
            const rows: Record<string, unknown>[] = [];
            if (input.quantity > 0) {
              rows.push({
                jobOperationId: m.id,
                type: "Production",
                quantity: input.quantity,
                companyId,
                createdBy: userId
              });
            }
            if ((input.scrapQuantity ?? 0) > 0) {
              rows.push({
                jobOperationId: m.id,
                type: "Scrap",
                quantity: input.scrapQuantity,
                companyId,
                createdBy: userId
              });
            }
            return rows;
          });
          if (quantityRows.length > 0) {
            await trx
              .insertInto("productionQuantity")
              // deno-lint-ignore no-explicit-any
              .values(quantityRows as any)
              .execute();
          }

          // 4. Multi-row Done. trg_event_sync_jobOperation is a BEFORE/FOR EACH ROW
          // trigger: each member's own downstream operation is released
          // independently. No cross-job edges exist or are needed.
          await trx
            .updateTable("jobOperation")
            .set({ status: "Done", updatedBy: userId })
            .where("jobOperationBatchId", "=", payload.batchId)
            .execute();

          await trx
            .updateTable("jobOperationBatch")
            .set({
              status: "Completed",
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .execute();

          return {
            completed: members.length,
            // deno-lint-ignore no-explicit-any
            memberIds: members.map((m: any) => m.id),
            eventIds
          };
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
