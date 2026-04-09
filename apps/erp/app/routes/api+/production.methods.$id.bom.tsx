import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { LoaderFunctionArgs } from "react-router";
import type { FlatTreeItem } from "~/components/TreeView";
import { flattenTree } from "~/components/TreeView";
import { getJobMethodTree } from "~/modules/production";
import type { JobMethod } from "~/modules/production/types";
import type { BomOperation } from "~/utils/bom";
import {
  calculateMadePartCosts,
  calculateTotalQuantity,
  generateBomIds
} from "~/utils/bom";
import { makeDurations } from "~/utils/duration";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { id } = params;
  const withOperations = request.url.includes("withOperations=true");

  if (!id) {
    return { data: [], error: null };
  }

  const methodTree = await getJobMethodTree(client, id);
  if (methodTree.error) {
    return { data: [], error: methodTree.error };
  }

  const methods = (
    methodTree.data.length > 0 ? flattenTree(methodTree.data[0]) : []
  ) satisfies FlatTreeItem<JobMethod>[];

  const makeMethodIds = [
    ...new Set(methods.map((method) => method.data.jobMakeMethodId))
  ];

  // Get the job quantity for batch size calculation
  const rootNode = methods[0];
  const jobId = rootNode?.data.jobId;

  const [methodOperations, jobResult] = await Promise.all([
    client
      .from("jobOperation")
      .select(
        "*, ...process(processName:name), ...workCenter(workCenterName:name)"
      )
      .in("jobMakeMethodId", makeMethodIds)
      .eq("companyId", companyId),
    jobId
      ? client.from("job").select("quantity").eq("id", jobId).single()
      : null
  ]);

  const batchSizesByItemId = new Map<string, number>();
  if (rootNode && jobResult?.data?.quantity) {
    batchSizesByItemId.set(rootNode.data.itemId, jobResult.data.quantity);
  }

  let operationsByMakeMethodId: Record<
    string,
    Array<
      Database["public"]["Tables"]["jobOperation"]["Row"] & {
        processName: string;
        workCenterName: string | null;
      }
    >
  > = {};

  if (methodOperations.data) {
    operationsByMakeMethodId = methodOperations.data.reduce(
      (acc, operation) => {
        acc[operation.jobMakeMethodId ?? ""] = [
          ...(acc[operation.jobMakeMethodId ?? ""] || []),
          operation
        ];
        return acc;
      },
      {} as typeof operationsByMakeMethodId
    );
  }

  // Build BomOperation map for cost calculation
  const bomOperationsByKey: Record<string, BomOperation[]> = {};
  for (const [key, ops] of Object.entries(operationsByMakeMethodId)) {
    bomOperationsByKey[key] = ops.map((op) => ({
      operationType: op.operationType,
      setupTime: op.setupTime,
      setupUnit: op.setupUnit,
      laborTime: op.laborTime,
      laborUnit: op.laborUnit,
      machineTime: op.machineTime,
      machineUnit: op.machineUnit,
      operationUnitCost: op.operationUnitCost,
      operationMinimumCost: op.operationMinimumCost,
      laborRate: op.laborRate ?? 0,
      machineRate: op.machineRate ?? 0,
      overheadRate: op.overheadRate ?? 0
    }));
  }

  const computedCosts = calculateMadePartCosts(
    methods,
    bomOperationsByKey,
    (node) => node.data.jobMaterialMakeMethodId,
    batchSizesByItemId
  );

  const bomIds = generateBomIds(methods);

  const result = methods.map((node, index) => {
    const total = calculateTotalQuantity(node, methods);
    const unitCost = computedCosts.get(node.id) ?? node.data.unitCost ?? 0;
    const totalCost = total * unitCost;

    const bomItem = {
      id: bomIds[index],
      itemId: node.data.itemReadableId,
      description: node.data.description,
      quantity: node.data.quantity,
      total,
      unitCost,
      totalCost,
      methodType: node.data.methodType,
      itemType: node.data.itemType,
      level: node.level,
      version: node.data.version || null
    };

    if (!withOperations) {
      return bomItem;
    }

    const operations =
      operationsByMakeMethodId[node.data.jobMaterialMakeMethodId];
    if (!operations) {
      return { ...bomItem, operations: [] };
    }

    return {
      ...bomItem,
      operations: operations.map((operation) => {
        const op1 = makeDurations({ ...operation, operationQuantity: total });
        const op100 = makeDurations({
          ...operation,
          operationQuantity: total * 100
        });
        const op1000 = makeDurations({
          ...operation,
          operationQuantity: total * 1000
        });

        return {
          description: operation.description,
          process: operation.processName,
          workCenter: operation.workCenterName,
          operationType: operation.operationType,
          setupTime: operation.setupTime,
          setupUnit: operation.setupUnit,
          laborTime: operation.laborTime,
          laborUnit: operation.laborUnit,
          machineTime: operation.machineTime,
          machineUnit: operation.machineUnit,
          totalDurationX1: op1.duration,
          totalDurationX100: op100.duration,
          totalDurationX1000: op1000.duration
        };
      })
    };
  });

  return { data: result, error: null };
}
