import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
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

const bomHeaders = [
  "ID",
  "Item ID",
  "Description",
  "Quantity",
  "Total",
  "Unit Cost",
  "Total Cost",
  "UOM",
  "Method Type",
  "Item Type",
  "Level",
  "Version"
];

const operationHeaders = [
  "Operation",
  "Process",
  "Work Center",
  "Operation Type",
  "Setup Time",
  "Setup Unit",
  "Labor Time",
  "Labor Unit",
  "Machine Time",
  "Machine Unit",
  "Total Duration x 1 (ms)",
  "Total Duration x 100 (ms)",
  "Total Duration x 1000 (ms)"
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { id } = params;
  const withOperations = request.url.includes("withOperations=true");

  const headers =
    (withOperations
      ? [...bomHeaders, ...operationHeaders].join(",")
      : bomHeaders.join(",")) + "\n";

  if (!id) {
    return new Response(headers, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=bom.csv"
      }
    });
  }

  const methodTree = await getMethodTree(client, id);
  if (methodTree.error) {
    return new Response(headers, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=bom.csv"
      }
    });
  }

  const fileName = `${methodTree.data[0].data.itemReadableId}-bom.csv`;

  const methods = (
    methodTree.data.length > 0 ? flattenTree(methodTree.data[0]) : []
  ) satisfies FlatTreeItem<Method>[];

  const makeMethodIds = [
    ...new Set(methods.map((method) => method.data.makeMethodId))
  ];

  const itemIds = [...new Set(methods.map((m) => m.data.itemId))];

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

  let csv = headers;

  methods.forEach((node, index) => {
    const total = calculateTotalQuantity(node, methods);
    const unitCost = computedCosts.get(node.id) ?? node.data.unitCost ?? 0;
    const totalCost = total * unitCost;

    csv += `${bomIds[index]},${
      node.data.itemReadableId
    },"${node.data.description?.replace(/"/g, '""')}",${
      node.data.quantity
    },${total},${unitCost},${totalCost},${
      node.data.unitOfMeasureCode
    },${node.data.methodType},${node.data.itemType},${node.level},${
      node.data.version || ""
    }\n`;

    if (withOperations) {
      const operations =
        operationsByMakeMethodId[node.data.materialMakeMethodId];
      if (operations) {
        operations.forEach((operation) => {
          const op1 = makeDurations({ ...operation, operationQuantity: total });
          const op100 = makeDurations({
            ...operation,
            operationQuantity: total * 100
          });
          const op1000 = makeDurations({
            ...operation,
            operationQuantity: total * 1000
          });

          csv += Array(bomHeaders.length).fill(",").join("");
          csv += `${operation.description},${operation.processName},${
            operation.workCenterName ?? ""
          },${operation.operationType},${operation.setupTime},${
            operation.setupUnit
          },${operation.laborTime},${operation.laborUnit},${
            operation.machineTime
          },${operation.machineUnit},${op1.duration},${op100.duration},${
            op1000.duration
          }\n`;
        });
      }
    }
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=${fileName}`
    }
  });
}
