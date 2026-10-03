// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { assertCompanyRecords } from "../company-records";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import reschedule from "../reschedule";
import { ServerFnContext } from "../server-fn-context";

const logger = getLogger("server-functions", "trigger-rework");

interface TriggerReworkRequest {
  jobId: string;
  triggeredAtJobOperationId: string;
  targetJobOperationId: string;
  reason: string;
  quantity: number;
  trackedEntityIds?: string[];
  // Provenance link when an inspection disposition triggered the rework —
  // stamped on the Rework productionQuantity row.
  inspectionId?: string;
  companyId: string;
  userId: string;
}

/**
 * Finds the shortest path from targetOperationId to triggeredAtOperationId
 * by walking backwards through the DAG from triggeredAt.
 * Returns operations in forward order (target → ... → triggeredAt).
 */
async function findReworkPath(
  trx: Transaction<KyselyDatabase>,
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

async function cloneReworkOperations(
  trx: Transaction<KyselyDatabase>,
  body: TriggerReworkRequest
) {
  const {
    jobId,
    triggeredAtJobOperationId,
    targetJobOperationId,
    reason,
    quantity,
    trackedEntityIds,
    inspectionId,
    companyId,
    userId
  } = body;

  // 1. Find the path of operations to clone
  const operationPath = await findReworkPath(
    trx,
    jobId,
    targetJobOperationId,
    triggeredAtJobOperationId
  );

  logger.info(`📋 Rework path: ${operationPath.length} operations to clone`);

  // 2. Create the rework record
  const [rework] = await trx
    .insertInto("rework")
    .values({
      jobId,
      triggeredAtJobOperationId,
      targetJobOperationId,
      reason,
      quantity,
      requestedById: userId,
      companyId
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
        sourceDocumentId: rework!.id,
        attributes: {
          Job: jobId,
          "Triggered At": triggeredAtJobOperationId,
          Target: targetJobOperationId,
          Reason: reason,
          Quantity: quantity
        },
        companyId,
        createdBy: userId
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
          createdBy: userId
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
      .executeTakeFirst()
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
        // A cloned Inspection op must re-inspect against the SAME plan — its
        // lazily-created lot resolves features/sampling from this document.
        // Assembly ops likewise keep their instruction link for 3D playback.
        inspectionDocumentId: sourceOp.inspectionDocumentId,
        assemblyInstructionId: sourceOp.assemblyInstructionId,
        operationQuantity: quantity,
        targetQuantity: quantity,
        tags: sourceOp.tags,
        companyId,
        createdBy: userId,
        reworkId: rework!.id,
        status: i === 0 ? "Ready" : "Waiting",
        customFields: sourceOp.customFields
      }))
    )
    .returning(["id"])
    .execute();

  const clonedOperationIds = clonedOps.map((op) => op.id);
  const sourceToCloneMap = new Map<string, string>();
  sourceOperations.forEach((sourceOp, i) => {
    sourceToCloneMap.set(sourceOp.id, clonedOps[i]!.id);
  });

  logger.info(`🔧 Cloned ${clonedOperationIds.length} operations`);

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
      .execute()
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
      createdBy: userId
    })
  );

  const toolValues = allTools.map((tool) => ({
    toolId: tool.toolId,
    quantity: tool.quantity,
    operationId: sourceToCloneMap.get(tool.operationId)!,
    companyId,
    createdBy: userId
  }));

  const paramValues = allParams.map((param) => ({
    key: param.key,
    value: param.value,
    operationId: sourceToCloneMap.get(param.operationId)!,
    companyId,
    createdBy: userId
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
      : null
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
      operationId: clonedOperationIds[i]!,
      dependsOnId: clonedOperationIds[i - 1]!,
      jobId,
      companyId
    });
  }

  // 7b. Convergence: downstream ops that depended on triggeredAt also depend
  //     on the last rework op so the DAG merges back.
  // Filter on `jobId`, not `companyId`: dependency edges are per-job, and
  // `jobId` is the column the scheduler's own rebuild filters on. Trusting the
  // row's stamped `companyId` would trust exactly the field that cross-tenant
  // mis-stamping makes unreliable. Without any filter this read reaches every
  // tenant's edges and re-inserts them under this job's company.
  const downstreamDeps = await trx
    .selectFrom("jobOperationDependency")
    .select(["operationId"])
    .where("jobId", "=", jobId)
    .where("dependsOnId", "=", triggeredAtJobOperationId)
    .where("operationId", "not in", clonedOperationIds)
    .execute();

  const lastReworkOpId = clonedOperationIds[clonedOperationIds.length - 1]!;

  for (const dep of downstreamDeps) {
    dagEdges.push({
      operationId: dep.operationId,
      dependsOnId: lastReworkOpId,
      jobId,
      companyId
    });
  }

  if (dagEdges.length > 0) {
    await trx.insertInto("jobOperationDependency").values(dagEdges).execute();
  }

  logger.info(
    `🔗 DAG wired with ${downstreamDeps.length} downstream deps rewired`
  );

  // 8. Record a productionQuantity entry for the rework
  await trx
    .insertInto("productionQuantity")
    .values({
      jobOperationId: triggeredAtJobOperationId,
      type: "Rework",
      quantity,
      inspectionId: inspectionId ?? null,
      companyId,
      createdBy: userId
    })
    .execute();

  return {
    reworkId: rework!.id,
    clonedOperationIds,
    operationsCloned: clonedOperationIds.length
  };
}

export const triggerReworkInput = z.object({
  jobId: z.string().min(1),
  triggeredAtJobOperationId: z.string().min(1),
  targetJobOperationId: z.string().min(1),
  reason: z.string().min(1),
  quantity: z.number().positive(),
  trackedEntityIds: z.array(z.string()).optional(),
  inspectionId: z.string().optional()
});

/**
 * Sends a job back to an earlier operation: clones the operations from the
 * target up to where the problem was found, then reschedules the job.
 */
const triggerRework = defineServerFn({
  name: "trigger-rework",
  input: triggerReworkInput,
  // Writes rework operations, dependency edges and productionQuantity rows, so
  // it needs the same gate every other write function uses. The system (the two
  // MES callers) skips this check, which is exactly why the ownership check in
  // `run` — not this gate — is what protects those paths.
  permissions: { update: "production" },
  async run(ctx, parsed) {
    const { db } = ctx;

    const body: TriggerReworkRequest = {
      ...parsed,
      companyId: ctx.companyId,
      userId: ctx.userId
    };

    // `jobId` and `companyId` both arrive in the payload, and nothing proved
    // they belong together. Without this, a request pairing one company's id
    // with another company's job writes rows attributed to the wrong tenant.
    // See .ai/specs/2026-08-25-backup-durability.md Part 3.
    const job = await db
      .selectFrom("job")
      .select(["id", "companyId"])
      .where("id", "=", body.jobId)
      .executeTakeFirst();

    // 404, not 403: a job in another company must be indistinguishable from a
    // job that does not exist.
    if (!job || job.companyId !== body.companyId) {
      throw new NotFoundError("Job not found in this company");
    }

    // The same holds for the two operation ids: triggerRework reads, clones and
    // writes productionQuantity against them by id alone, so both must be
    // operations of this job (the job is already proven to be this company's).
    const operationIds = [
      ...new Set([body.triggeredAtJobOperationId, body.targetJobOperationId])
    ];
    const operations = await db
      .selectFrom("jobOperation")
      .select("id")
      .where("id", "in", operationIds)
      .where("jobId", "=", body.jobId)
      .where("companyId", "=", body.companyId)
      .execute();
    if (operations.length !== operationIds.length) {
      throw new NotFoundError("Job operation not found in this company");
    }

    await assertCompanyRecords(
      db,
      "trackedEntity",
      body.trackedEntityIds ?? [],
      body.companyId,
      "Tracked entity"
    );

    // Written as productionQuantity.inspectionId, whose FK accepts any company's
    // inspection.
    await assertCompanyRecords(
      db,
      "inspection",
      [body.inspectionId],
      body.companyId,
      "Inspection"
    );

    logger.info(
      `🔰 Starting rework for job ${body.jobId}: go back to ${body.targetJobOperationId} from ${body.triggeredAtJobOperationId}`
    );

    const result = await db.transaction().execute(async (trx) => {
      return await cloneReworkOperations(trx, body);
    });

    // Reschedule for date/priority recalculation (after the transaction). A
    // failure is logged, not raised: the rework itself has committed.
    const rescheduled = await reschedule(
      ServerFnContext.system({
        db,
        companyId: body.companyId,
        userId: body.userId
      }),
      { jobId: body.jobId }
    );
    if (rescheduled.error) {
      logger.error("Failed to trigger reschedule after rework", {
        error: rescheduled.error
      });
    }

    return { success: true, ...result };
  }
});

export default triggerRework;
