import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { pluckUnique } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import type { FlatTreeItem } from "~/components/TreeView";
import { flattenTree } from "~/components/TreeView";
import type { Method } from "~/modules/items";
import { getMethodTree } from "~/modules/items";
import type { BomOperation, WorkCenterRate } from "~/utils/bom";
import {
  calculateMadePartCosts,
  calculateTotalQuantity,
  generateBomIds,
  resolveOperationRates
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

  const methodTree = await getMethodTree(id);
  if (methodTree.error) {
    return { data: [], error: methodTree.error };
  }

  const methods = (
    methodTree.data.length > 0 ? flattenTree(methodTree.data[0]) : []
  ) satisfies FlatTreeItem<Method>[];

  const makeMethodIds = pluckUnique(methods, (m) => m.data.makeMethodId);

  const itemIds = pluckUnique(methods, (m) => m.data.itemId);

  const [methodOperations, workCentersResult, lotSizesResult] =
    await Promise.all([
      client
        .from("methodOperation")
        .select(
          "*, ...process(processName:name), ...workCenter(workCenterName:name, laborRate, machineRate, overheadRate)"
        )
        .in("makeMethodId", makeMethodIds)
        .eq("companyId", companyId),
      client
        .from("workCenters")
        .select("id, active, laborRate, machineRate, overheadRate, processes")
        .eq("companyId", companyId),
      client
        .from("itemReplenishment")
        .select("itemId, lotSize")
        .in("itemId", itemIds)
    ]);

  const lotSizesByItemId = new Map(
    (lotSizesResult.data ?? []).map((r) => [r.itemId, r.lotSize ?? 1])
  );

  const workCenters: WorkCenterRate[] = (workCentersResult.data ?? []).map(
    (wc) => ({
      id: wc.id!,
      active: wc.active ?? false,
      laborRate: wc.laborRate,
      machineRate: wc.machineRate,
      overheadRate: wc.overheadRate,
      processes: wc.processes
    })
  );

  let operationsByMakeMethodId: Record<
    string,
    Array<
      Database["public"]["Tables"]["methodOperation"]["Row"] & {
        processName: string;
        workCenterName: string | null;
        laborRate: number | null;
        machineRate: number | null;
        overheadRate: number | null;
      }
    >
  > = {};

  if (methodOperations.data) {
    operationsByMakeMethodId = methodOperations.data.reduce(
      (acc, operation) => {
        acc[operation.makeMethodId] = [
          ...(acc[operation.makeMethodId] || []),
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
    // @ts-expect-error TS2322 - TODO: fix type
    bomOperationsByKey[key] = ops.map((op) => {
      const rates = resolveOperationRates(
        op.workCenterId,
        op.processId,
        op.laborRate,
        op.machineRate,
        op.overheadRate,
        workCenters
      );
      return {
        operationType: op.operationType,
        setupTime: op.setupTime,
        setupUnit: op.setupUnit,
        laborTime: op.laborTime,
        laborUnit: op.laborUnit,
        machineTime: op.machineTime,
        machineUnit: op.machineUnit,
        operationUnitCost: op.operationUnitCost,
        operationMinimumCost: op.operationMinimumCost,
        ...rates
      };
    });
  }

  const computedCosts = calculateMadePartCosts(
    methods,
    bomOperationsByKey,
    (node) => node.data.materialMakeMethodId,
    lotSizesByItemId
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
      uom: node.data.unitOfMeasureCode,
      methodType: node.data.methodType,
      itemType: node.data.itemType,
      level: node.level,
      version: node.data.version || null
    };

    if (!withOperations) {
      return bomItem;
    }

    const operations = operationsByMakeMethodId[node.data.materialMakeMethodId];
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
