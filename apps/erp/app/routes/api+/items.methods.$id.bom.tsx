import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { LoaderFunctionArgs } from "@vercel/remix";
import type { FlatTreeItem } from "~/components/TreeView";
import { flattenTree } from "~/components/TreeView";
import type { Method } from "~/modules/items";
import { getMethodTree } from "~/modules/items";
import { calculateTotalQuantity, generateBomIds } from "~/utils/bom";
import { makeDurations } from "~/utils/duration";

export const config = {
  runtime: "nodejs",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  const withOperations = request.url.includes("withOperations=true");

  if (!id) {
    return { data: [], error: null };
  }

  const methodTree = await getMethodTree(client, id);
  if (methodTree.error) {
    return { data: [], error: methodTree.error };
  }

  const methods = (
    methodTree.data.length > 0 ? flattenTree(methodTree.data[0]) : []
  ) satisfies FlatTreeItem<Method>[];

  const makeMethodIds = [
    ...new Set(methods.map((method) => method.data.makeMethodId)),
  ];

  let operationsByMakeMethodId: Record<
    string,
    Array<
      Database["public"]["Tables"]["methodOperation"]["Row"] & {
        processName: string;
        workCenterName: string | null;
      }
    >
  > = {};

  if (withOperations) {
    const methodOperations = await client
      .from("methodOperation")
      .select(
        "*, ...process(processName:name), ...workCenter(workCenterName:name)"
      )
      .in("makeMethodId", makeMethodIds)
      .eq("companyId", companyId);
    if (methodOperations.data) {
      operationsByMakeMethodId = methodOperations.data.reduce(
        (acc, operation) => {
          acc[operation.makeMethodId] = [
            ...(acc[operation.makeMethodId] || []),
            operation,
          ];
          return acc;
        },
        {} as typeof operationsByMakeMethodId
      );
    }
  }

  const bomIds = generateBomIds(methods);

  const result = methods.map((node, index) => {
    const total = calculateTotalQuantity(node, methods);
    const totalCost = total * (node.data.unitCost || 0);

    const bomItem = {
      id: bomIds[index],
      itemId: node.data.itemReadableId,
      description: node.data.description,
      quantity: node.data.quantity,
      total,
      unitCost: node.data.unitCost,
      totalCost,
      uom: node.data.unitOfMeasureCode,
      methodType: node.data.methodType,
      itemType: node.data.itemType,
      level: node.level,
      version: node.data.version || null,
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
          operationQuantity: total * 100,
        });
        const op1000 = makeDurations({
          ...operation,
          operationQuantity: total * 1000,
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
          totalDurationX1000: op1000.duration,
        };
      }),
    };
  });

  return { data: result, error: null };
}
