import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type { Transaction } from "kysely";
import { getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import type { DB } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

// Types
type JobOperation = {
  id: string;
  jobId: string;
  workCenterId: string | null;
  status: string;
  priority: number | null;
  dueDate: string | null;
  startDate: string | null;
  setupTime: number | null;
  laborTime: number | null;
  machineTime: number | null;
  setupUnit: string | null;
  laborUnit: string | null;
  machineUnit: string | null;
  operationQuantity: number | null;
};

type Job = {
  id: string;
  dueDate: string | null;
  priority: number | null;
  deadlineType: string | null;
};

type JobOperationDependency = {
  operationId: string;
  dependsOnId: string;
  jobId: string;
};

type DependencyGraph = Map<
  string,
  {
    dependsOn: string[];
    requiredBy: string[];
  }
>;

type ScheduledOperation = JobOperation & {
  hasConflict: boolean;
  conflictReason: string | null;
};

type OperationWithJobInfo = {
  id: string;
  dueDate: string | null;
  priority: number | null;
  deadlineType: string | null;
  jobPriority: number | null;
  workCenterId: string | null;
};

// Helper: Get job with operations and dependencies
async function getJobWithOperations(trx: Transaction<DB>, jobId: string) {
  const job = await trx
    .selectFrom("job")
    .select(["id", "dueDate", "priority", "deadlineType"])
    .where("id", "=", jobId)
    .executeTakeFirstOrThrow();

  const operations = await trx
    .selectFrom("jobOperation")
    .selectAll()
    .where("jobId", "=", jobId)
    .where("status", "not in", ["Done", "Canceled"])
    .execute();

  const dependencies = await trx
    .selectFrom("jobOperationDependency")
    .selectAll()
    .where("jobId", "=", jobId)
    .execute();

  return { job, operations, dependencies };
}

// Helper: Build dependency graph
function buildDependencyGraph(
  operations: JobOperation[],
  dependencies: JobOperationDependency[]
): DependencyGraph {
  const graph = new Map<
    string,
    {
      dependsOn: string[];
      requiredBy: string[];
    }
  >();

  // Initialize all operations
  for (const op of operations) {
    graph.set(op.id, { dependsOn: [], requiredBy: [] });
  }

  // Build edges
  for (const dep of dependencies) {
    const opNode = graph.get(dep.operationId);
    const depNode = graph.get(dep.dependsOnId);

    if (opNode) {
      opNode.dependsOn.push(dep.dependsOnId);
    }
    if (depNode) {
      depNode.requiredBy.push(dep.operationId);
    }
  }

  return graph;
}

// Helper: Topological sort
function topologicalSort(
  operations: JobOperation[],
  graph: DependencyGraph,
  direction: "forward" | "reverse"
): JobOperation[] {
  const inDegree = new Map<string, number>();
  const queue: string[] = [];
  const result: JobOperation[] = [];

  // Calculate in-degrees
  for (const op of operations) {
    const deps =
      direction === "forward"
        ? graph.get(op.id)?.dependsOn || []
        : graph.get(op.id)?.requiredBy || [];
    inDegree.set(op.id, deps.length);
    if (deps.length === 0) queue.push(op.id);
  }

  // Process queue
  while (queue.length > 0) {
    const opId = queue.shift()!;
    const op = operations.find((o) => o.id === opId)!;
    result.push(op);

    const neighbors =
      direction === "forward"
        ? graph.get(opId)?.requiredBy || []
        : graph.get(opId)?.dependsOn || [];

    for (const neighborId of neighbors) {
      const degree = inDegree.get(neighborId)! - 1;
      inDegree.set(neighborId, degree);
      if (degree === 0) queue.push(neighborId);
    }
  }

  return result;
}

// Helper: Calculate operation duration in days
function calculateOperationDuration(op: JobOperation): number {
  const quantity = op.operationQuantity || 1;

  // Calculate total hours
  let setupHours = 0;
  let laborHours = 0;
  let machineHours = 0;

  if (op.setupTime) {
    setupHours =
      op.setupUnit === "Hours/Piece"
        ? (op.setupTime * quantity)
        : op.setupTime;
  }

  if (op.laborTime) {
    laborHours =
      op.laborUnit === "Hours/Piece"
        ? (op.laborTime * quantity)
        : op.laborTime;
  }

  if (op.machineTime) {
    machineHours =
      op.machineUnit === "Hours/Piece"
        ? (op.machineTime * quantity)
        : op.machineTime;
  }

  // Total hours (setup + max of labor/machine since they can overlap)
  const totalHours = setupHours + Math.max(laborHours, machineHours);

  // Convert to days (assuming 8-hour workday)
  const days = totalHours / 8;

  // Round up to at least 1 day
  return Math.max(Math.ceil(days), 1);
}

// Helper: Backward schedule operations
function backwardScheduleOperations(
  operations: JobOperation[],
  graph: DependencyGraph,
  jobDueDate: string | null
): ScheduledOperation[] {
  const scheduled = new Map<string, ScheduledOperation>();
  const today = new Date().toISOString().split("T")[0];

  // Default to today if no due date
  const finalDueDate = jobDueDate || today;

  // Topological sort (reverse: final ops first)
  const sorted = topologicalSort(operations, graph, "reverse");

  for (const op of sorted) {
    const deps = graph.get(op.id);
    if (!deps) continue;

    const totalDuration = calculateOperationDuration(op);

    // Calculate due date
    let dueDate: string;
    if (deps.requiredBy.length === 0) {
      // Leaf operation: use job due date
      dueDate = finalDueDate;
    } else {
      // Has dependents: must finish before earliest dependent starts
      const dependentStartDates = deps.requiredBy
        .map((depId) => scheduled.get(depId)?.startDate)
        .filter((date): date is string => date !== null && date !== undefined);

      if (dependentStartDates.length === 0) {
        dueDate = finalDueDate;
      } else {
        // Subtract 1 day buffer
        const minDate = new Date(
          Math.min(...dependentStartDates.map((d) => new Date(d).getTime()))
        );
        minDate.setDate(minDate.getDate() - 1);
        dueDate = minDate.toISOString().split("T")[0];
      }
    }

    // Calculate start date
    const dueDateObj = new Date(dueDate);
    dueDateObj.setDate(dueDateObj.getDate() - totalDuration);
    const startDate = dueDateObj.toISOString().split("T")[0];

    // Check for conflicts
    const hasConflict = startDate < today;
    const conflictReason = hasConflict
      ? `Operation must start on ${startDate} but current date is ${today}`
      : null;

    scheduled.set(op.id, {
      ...op,
      startDate,
      dueDate,
      hasConflict,
      conflictReason,
    });
  }

  return Array.from(scheduled.values());
}

// Helper: Sort operations by priority criteria
function sortOperationsByPriority(
  operations: OperationWithJobInfo[]
): OperationWithJobInfo[] {
  const deadlineOrder: Record<string, number> = {
    ASAP: 0,
    "Hard Deadline": 1,
    "Soft Deadline": 2,
    "No Deadline": 3,
  };

  return operations.sort((a, b) => {
    // 1. Deadline type
    const aDeadline = a.deadlineType || "No Deadline";
    const bDeadline = b.deadlineType || "No Deadline";
    if (aDeadline !== bDeadline) {
      return deadlineOrder[aDeadline] - deadlineOrder[bDeadline];
    }

    // 2. Due date (earliest first, nulls last)
    if (a.dueDate && b.dueDate) {
      const dateCompare =
        new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (dateCompare !== 0) return dateCompare;
    } else if (a.dueDate) {
      return -1;
    } else if (b.dueDate) {
      return 1;
    }

    // 3. Job priority
    const aPriority = a.jobPriority || 0;
    const bPriority = b.jobPriority || 0;
    return aPriority - bPriority;
  });
}

// Helper: Apply fractional priorities
function applyFractionalPriorities(
  sorted: OperationWithJobInfo[]
): OperationWithJobInfo[] {
  return sorted.map((op, index) => {
    if (index === 0) {
      op.priority = 0;
    } else {
      const prevPriority = sorted[index - 1].priority || 0;
      op.priority = prevPriority + 1;
    }
    return op;
  });
}

// Helper: Recalculate priorities by work center
async function recalculatePriorities(
  trx: Transaction<DB>,
  scheduledOps: ScheduledOperation[],
  workCenterIds: string[]
): Promise<ScheduledOperation[]> {
  const prioritizedOps = [...scheduledOps];

  for (const wcId of workCenterIds) {
    if (!wcId) continue;

    // Get ALL active operations at this work center (not just from current job)
    const allWcOps = await trx
      .selectFrom("jobOperation as jo")
      .innerJoin("job as j", "j.id", "jo.jobId")
      .select([
        "jo.id",
        "jo.dueDate",
        "jo.priority",
        "j.deadlineType",
        "j.priority as jobPriority",
        "jo.workCenterId",
      ])
      .where("jo.workCenterId", "=", wcId)
      .where("jo.status", "not in", ["Done", "Canceled"])
      .execute();

    // Merge with scheduled ops (use scheduled data if available)
    const mergedOps = allWcOps.map((wcOp) => {
      const scheduled = scheduledOps.find((s) => s.id === wcOp.id);
      if (scheduled) {
        return {
          id: scheduled.id,
          dueDate: scheduled.dueDate,
          priority: scheduled.priority,
          deadlineType: wcOp.deadlineType,
          jobPriority: wcOp.jobPriority,
          workCenterId: wcOp.workCenterId,
        };
      }
      return wcOp;
    });

    // Sort by priority criteria
    const sorted = sortOperationsByPriority(mergedOps);

    // Apply fractional indexing
    const prioritized = applyFractionalPriorities(sorted);

    // Update prioritized ops
    for (const op of prioritized) {
      const idx = prioritizedOps.findIndex((p) => p.id === op.id);
      if (idx >= 0) {
        prioritizedOps[idx].priority = op.priority;
      }
    }
  }

  return prioritizedOps;
}

// Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { jobId, companyId, userId } = await req.json();

    console.info(`🔰 Starting reschedule for job ${jobId}`);

    const result = await db.transaction().execute(async (trx) => {
      // 1. Get job and all its operations with dependencies
      const { job, operations, dependencies } = await getJobWithOperations(
        trx,
        jobId
      );

      console.info(
        `📊 Job has ${operations.length} operations, ${dependencies.length} dependencies`
      );

      // 2. Build dependency graph
      const graph = buildDependencyGraph(operations, dependencies);

      // 3. Backward schedule (calculate dates, flag conflicts)
      const scheduledOps = backwardScheduleOperations(
        operations,
        graph,
        job.dueDate
      );

      const conflicts = scheduledOps.filter((op) => op.hasConflict);
      console.info(`⚠️  Detected ${conflicts.length} scheduling conflicts`);

      // 4. Get affected work centers
      const workCenterIds = [
        ...new Set(
          scheduledOps
            .map((op) => op.workCenterId)
            .filter((id): id is string => id !== null)
        ),
      ];

      console.info(`🏭 Affected work centers: ${workCenterIds.length}`);

      // 5. Recalculate priorities for each work center
      const prioritizedOps = await recalculatePriorities(
        trx,
        scheduledOps,
        workCenterIds
      );

      // 6. Batch update all operations
      for (const op of prioritizedOps) {
        await trx
          .updateTable("jobOperation")
          .set({
            startDate: op.startDate,
            dueDate: op.dueDate,
            priority: op.priority,
            hasConflict: op.hasConflict,
            conflictReason: op.conflictReason,
            updatedAt: new Date().toISOString(),
            updatedBy: userId,
          })
          .where("id", "=", op.id)
          .execute();
      }

      console.info(`✅ Updated ${prioritizedOps.length} operations`);

      return {
        operationsUpdated: prioritizedOps.length,
        conflictsDetected: conflicts.length,
        workCentersAffected: workCenterIds.length,
      };
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      `❌ Reschedule failed: ${
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
