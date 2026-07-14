import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type { Transaction } from "kysely";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/nanoid.ts";
import z from "npm:zod@^3.24.1";
import { getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import type { DB } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

interface TriggerReworkRequest {
  jobId: string;
  triggeredAtJobOperationId: string;
  targetJobOperationId: string;
  reason: string;
  quantity: number;
  trackedEntityIds?: string[];
  companyId: string;
  userId: string;
}

/**
 * Finds the shortest path from targetOperationId to triggeredAtOperationId
 * by walking backwards through the DAG from triggeredAt.
 * Returns operations in forward order (target → ... → triggeredAt).
 */
async function findReworkPath(
  trx: Transaction<DB>,
  jobId: string,
  targetOperationId: string,
  triggeredAtOperationId: string
): Promise<string[]> {
  const dependencies = await trx
    .selectFrom("jobOperationDependency")
    .select(["operationId", "dependsOnId"])
    .where("jobId", "=", jobId)
    .execute();

  // Build adjacency list: operationId → [operations it depends on]
  const dependsOn = new Map<string, string[]>();
  for (const dep of dependencies) {
    const existing = dependsOn.get(dep.operationId) ?? [];
    existing.push(dep.dependsOnId);
    dependsOn.set(dep.operationId, existing);
  }

  // BFS backwards from triggeredAt to find target
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [triggeredAtOperationId];
  visited.add(triggeredAtOperationId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetOperationId) break;

    for (const predecessor of dependsOn.get(current) ?? []) {
      if (!visited.has(predecessor)) {
        visited.add(predecessor);
        parent.set(predecessor, current);
        queue.push(predecessor);
      }
    }
  }

  if (!visited.has(targetOperationId)) {
    throw new Error(
      `No path found from target operation ${targetOperationId} to triggered operation ${triggeredAtOperationId}`
    );
  }

  // Trace path from target back to triggeredAt (forward order)
  const path: string[] = [];
  let current = targetOperationId;
  while (current !== triggeredAtOperationId) {
    path.push(current);
    current = parent.get(current)!;
  }
  path.push(triggeredAtOperationId);

  return path;
}

async function triggerRework(
  trx: Transaction<DB>,
  body: TriggerReworkRequest
) {
  const {
    jobId,
    triggeredAtJobOperationId,
    targetJobOperationId,
    reason,
    quantity,
    trackedEntityIds,
    companyId,
    userId,
  } = body;

  // 1. Find the path of operations to clone
  const operationPath = await findReworkPath(
    trx,
    jobId,
    targetJobOperationId,
    triggeredAtJobOperationId
  );

  console.info(
    `📋 Rework path: ${operationPath.length} operations to clone`
  );

  // 2. Create the rework record
  // @ts-expect-error - rework table not in generated types until migration is applied
  const [rework] = await trx
    .insertInto("rework")
    .values({
      jobId,
      triggeredAtJobOperationId,
      targetJobOperationId,
      reason,
      quantity,
      requestedById: userId,
      companyId,
    })
    .returning(["id"])
    .execute();

  // 2b. Create tracked activity for traceability
  if (trackedEntityIds && trackedEntityIds.length > 0) {
    const activityId = nanoid();
    await trx
      .insertInto("trackedActivity")
      .values({
        id: activityId,
        type: "Rework",
        sourceDocument: "Rework",
        sourceDocumentId: rework.id,
        attributes: {
          Job: jobId,
          "Triggered At": triggeredAtJobOperationId,
          Target: targetJobOperationId,
          Reason: reason,
          Quantity: quantity,
        },
        companyId,
        createdBy: userId,
      })
      .execute();

    const isSerial = trackedEntityIds.length > 1 || quantity === 1;
    for (const entityId of trackedEntityIds) {
      await trx
        .insertInto("trackedActivityInput")
        .values({
          trackedActivityId: activityId,
          trackedEntityId: entityId,
          quantity: isSerial ? 1 : quantity,
          companyId,
          createdBy: userId,
        })
        .execute();
    }
  }

  // 3. Fetch the source operations to clone
  const sourceOperations = await trx
    .selectFrom("jobOperation")
    .selectAll()
    .where("id", "in", operationPath)
    .execute();

  // Sort by path order
  const pathIndex = new Map(operationPath.map((id, i) => [id, i]));
  sourceOperations.sort(
    (a, b) => (pathIndex.get(a.id) ?? 0) - (pathIndex.get(b.id) ?? 0)
  );

  // 4. Compute sort order: place rework ops after the triggering operation
  // "With Previous" on the first rework op lets it run in parallel with
  // the triggering operation's successors until the DAG converges.
  const [triggerOp, nextOp] = await Promise.all([
    trx
      .selectFrom("jobOperation")
      .select("order")
      .where("id", "=", triggeredAtJobOperationId)
      .executeTakeFirstOrThrow(),
    trx
      .selectFrom("jobOperation")
      .select("order")
      .where("jobId", "=", jobId)
      .where(
        "order",
        ">",
        trx
          .selectFrom("jobOperation")
          .select("order")
          .where("id", "=", triggeredAtJobOperationId)
      )
      .orderBy("order", "asc")
      .executeTakeFirst(),
  ]);

  const triggerOrder = Number(triggerOp.order);
  const upperBound = nextOp?.order ? Number(nextOp.order) : triggerOrder + 1;
  const gap = upperBound - triggerOrder;
  const increment = gap / (sourceOperations.length + 1);

  // 5. Clone operations (batch insert)
  const clonedOps = await trx
    .insertInto("jobOperation")
    .values(
      sourceOperations.map((sourceOp, i) => ({
        jobId: sourceOp.jobId,
        jobMakeMethodId: sourceOp.jobMakeMethodId,
        order: triggerOrder + increment * (i + 1),
        processId: sourceOp.processId,
        workCenterId: sourceOp.workCenterId,
        description: sourceOp.description,
        setupTime: sourceOp.setupTime,
        setupUnit: sourceOp.setupUnit,
        laborTime: sourceOp.laborTime,
        laborUnit: sourceOp.laborUnit,
        machineTime: sourceOp.machineTime,
        machineUnit: sourceOp.machineUnit,
        operationOrder: i === 0 ? "With Previous" : sourceOp.operationOrder,
        laborRate: sourceOp.laborRate,
        overheadRate: sourceOp.overheadRate,
        machineRate: sourceOp.machineRate,
        operationType: sourceOp.operationType,
        operationMinimumCost: sourceOp.operationMinimumCost,
        operationLeadTime: sourceOp.operationLeadTime,
        operationUnitCost: sourceOp.operationUnitCost,
        operationSupplierProcessId: sourceOp.operationSupplierProcessId,
        workInstruction: sourceOp.workInstruction,
        procedureId: sourceOp.procedureId,
        operationQuantity: quantity,
        targetQuantity: quantity,
        tags: sourceOp.tags,
        companyId,
        createdBy: userId,
        // @ts-expect-error - reworkId not in generated types until migration is applied
        reworkId: rework.id,
        status: i === 0 ? "Ready" : "Waiting",
        customFields: sourceOp.customFields,
      }))
    )
    .returning(["id"])
    .execute();

  const clonedOperationIds = clonedOps.map((op) => op.id);
  const sourceToCloneMap = new Map<string, string>();
  sourceOperations.forEach((sourceOp, i) => {
    sourceToCloneMap.set(sourceOp.id, clonedOps[i].id);
  });

  console.info(`🔧 Cloned ${clonedOperationIds.length} operations`);

  // 6. Clone steps, tools, and parameters (batch fetch + batch insert)
  const [allSteps, allTools, allParams] = await Promise.all([
    trx
      .selectFrom("jobOperationStep")
      .selectAll()
      .where("operationId", "in", operationPath)
      .execute(),
    trx
      .selectFrom("jobOperationTool")
      .selectAll()
      .where("operationId", "in", operationPath)
      .execute(),
    trx
      .selectFrom("jobOperationParameter")
      .selectAll()
      .where("operationId", "in", operationPath)
      .execute(),
  ]);

  const stepValues = allSteps.map(
    ({
      id: _id,
      operationId,
      createdAt: _ca,
      updatedAt: _ua,
      updatedBy: _ub,
      ...step
    }) => ({
      ...step,
      operationId: sourceToCloneMap.get(operationId)!,
      createdBy: userId,
    })
  );

  const toolValues = allTools.map((tool) => ({
    toolId: tool.toolId,
    quantity: tool.quantity,
    operationId: sourceToCloneMap.get(tool.operationId)!,
    companyId,
    createdBy: userId,
  }));

  const paramValues = allParams.map((param) => ({
    key: param.key,
    value: param.value,
    operationId: sourceToCloneMap.get(param.operationId)!,
    companyId,
    createdBy: userId,
  }));

  await Promise.all([
    stepValues.length > 0
      ? trx.insertInto("jobOperationStep").values(stepValues).execute()
      : null,
    toolValues.length > 0
      ? trx.insertInto("jobOperationTool").values(toolValues).execute()
      : null,
    paramValues.length > 0
      ? trx.insertInto("jobOperationParameter").values(paramValues).execute()
      : null,
  ]);

  // 7. Wire the rework operations into the DAG
  // First rework op has no dependencies — it's an independent parallel branch.
  // Traceability is captured via the rework record, not DAG edges.
  const dagEdges: Array<{
    operationId: string;
    dependsOnId: string;
    jobId: string;
    companyId: string;
  }> = [];

  // 7a. Each subsequent rework op depends on the previous
  for (let i = 1; i < clonedOperationIds.length; i++) {
    dagEdges.push({
      operationId: clonedOperationIds[i],
      dependsOnId: clonedOperationIds[i - 1],
      jobId,
      companyId,
    });
  }

  // 7b. Convergence: downstream ops that depended on triggeredAt also depend
  //     on the last rework op so the DAG merges back.
  const downstreamDeps = await trx
    .selectFrom("jobOperationDependency")
    .select(["operationId"])
    .where("dependsOnId", "=", triggeredAtJobOperationId)
    .where("operationId", "not in", clonedOperationIds)
    .execute();

  const lastReworkOpId = clonedOperationIds[clonedOperationIds.length - 1];

  for (const dep of downstreamDeps) {
    dagEdges.push({
      operationId: dep.operationId,
      dependsOnId: lastReworkOpId,
      jobId,
      companyId,
    });
  }

  if (dagEdges.length > 0) {
    await trx
      .insertInto("jobOperationDependency")
      .values(dagEdges)
      .execute();
  }

  console.info(`🔗 DAG wired with ${downstreamDeps.length} downstream deps rewired`);

  // 8. Record a productionQuantity entry for the rework
  await trx
    .insertInto("productionQuantity")
    .values({
      jobOperationId: triggeredAtJobOperationId,
      type: "Rework",
      quantity,
      companyId,
      createdBy: userId,
    })
    .execute();

  return {
    reworkId: rework.id,
    clonedOperationIds,
    operationsCloned: clonedOperationIds.length,
  };
}

// Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const raw = await req.json();
    const parsed = z
      .object({
        jobId: z.string().min(1),
        triggeredAtJobOperationId: z.string().min(1),
        targetJobOperationId: z.string().min(1),
        reason: z.string().min(1),
        quantity: z.number().positive(),
        trackedEntityIds: z.array(z.string()).optional(),
        companyId: z.string().min(1),
        userId: z.string().min(1),
      })
      .safeParse(raw);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Invalid request: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = parsed.data;

    console.info(
      `🔰 Starting rework for job ${body.jobId}: go back to ${body.targetJobOperationId} from ${body.triggeredAtJobOperationId}`
    );

    const result = await db.transaction().execute(async (trx) => {
      return await triggerRework(trx, body);
    });

    // Trigger reschedule for date/priority recalculation (after transaction)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      await fetch(`${supabaseUrl}/functions/v1/reschedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          jobId: body.jobId,
          companyId: body.companyId,
          userId: body.userId,
        }),
      });
    } catch (err) {
      console.error("Failed to trigger reschedule after rework:", err);
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      `❌ Rework failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
