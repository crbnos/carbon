import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { LoaderFunctionArgs } from "react-router";
import { flattenTree } from "~/components/TreeView";
import { getQuoteMethodTrees } from "~/modules/sales";
import type { BomOperation } from "~/utils/bom";
import {
  calculateMadePartCosts,
  calculateTotalQuantity,
  generateBomIds
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
  "Machine Unit"
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  const withOperations = request.url.includes("withOperations=true");

  if (!id) {
    return new Response(bomHeaders.join(",") + "\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=bom.csv"
      }
    });
  }

  const quote = await client
    .from("quoteLines")
    .select("quoteId, quantity, itemReadableId")
    .eq("id", id)
    .single();
  const fileName = `${quote.data?.itemReadableId}-bom.csv`;
  if (quote.error) {
    return new Response(bomHeaders.join(",") + "\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=${fileName}`
      }
    });
  }

  if (!quote.data?.quoteId) {
    throw new Error("Failed to fetch quote");
  }
  const methodTrees = await getQuoteMethodTrees(client, quote.data?.quoteId);

  if (methodTrees.error) {
    return new Response(bomHeaders.join(",") + "\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=bom.csv"
      }
    });
  }

  const methodTree = methodTrees.data.find((m) => m.data.quoteLineId === id);
  const flattenedMethods = methodTree ? flattenTree(methodTree) : [];

  const makeMethodIds = [
    ...new Set(flattenedMethods.map((method) => method.data.quoteMakeMethodId))
  ];

  const quoteOperations = await client
    .from("quoteOperation")
    .select(
      "*, ...process(processName:name), ...workCenter(workCenterName:name)"
    )
    .in("quoteMakeMethodId", makeMethodIds)
    .eq("companyId", companyId);

  let operationsByMakeMethodId: Record<
    string,
    Array<
      Database["public"]["Tables"]["quoteOperation"]["Row"] & {
        processName: string;
        workCenterName: string | null;
      }
    >
  > = {};

  if (quoteOperations.data) {
    operationsByMakeMethodId = quoteOperations.data.reduce(
      (acc, operation) => {
        acc[operation.quoteMakeMethodId ?? ""] = [
          ...(acc[operation.quoteMakeMethodId ?? ""] || []),
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

  // Use the first quote quantity as the batch size for the root item
  const batchSizesByItemId = new Map<string, number>();
  const rootQuoteNode = flattenedMethods[0];
  const firstQuantity = quote.data?.quantity?.[0];
  if (rootQuoteNode && firstQuantity && firstQuantity > 1) {
    batchSizesByItemId.set(rootQuoteNode.data.itemId, firstQuantity);
  }

  const computedCosts = calculateMadePartCosts(
    flattenedMethods,
    bomOperationsByKey,
    (node) => node.data.quoteMaterialMakeMethodId,
    batchSizesByItemId
  );

  const bomIds = generateBomIds(flattenedMethods);

  // Build headers including duration columns for each quantity
  let headers = bomHeaders.join(",");
  if (withOperations) {
    headers += "," + operationHeaders.join(",");
    // Add duration column for each quantity
    if (quote.data?.quantity) {
      quote.data.quantity.forEach((qty) => {
        headers += `,Total Duration x ${qty} (ms)`;
      });
    }
  }
  headers += "\n";

  let csv = headers;

  flattenedMethods.forEach((node, index) => {
    const total = calculateTotalQuantity(node, flattenedMethods);
    const unitCost = computedCosts.get(node.id) ?? node.data.unitCost ?? 0;
    const totalCost = total * unitCost;

    csv += `${bomIds[index]},${
      node.data.itemReadableId
    },"${node.data.description?.replace(/"/g, '""')}",${
      node.data.quantity
    },${total},${unitCost},${totalCost},${node.data.methodType},${
      node.data.itemType
    },${node.level},${node.data.version || ""}\n`;

    if (withOperations) {
      const operations =
        operationsByMakeMethodId[node.data.quoteMaterialMakeMethodId];
      if (operations) {
        operations.forEach((operation) => {
          const durations: Record<string, number> = (quote.data?.quantity ?? [])
            .map((quantity) => {
              const duration = makeDurations({
                ...operation,
                operationQuantity: quantity
              });
              return [quantity, duration.duration];
            })
            .reduce(
              (acc, [quantity, duration]) => {
                acc[`totalDuration${quantity}`] = duration;
                return acc;
              },
              {} as Record<string, number>
            );

          csv += Array(bomHeaders.length).fill(",").join("");
          csv += `${operation.description},${operation.processName},${
            operation.workCenterName ?? ""
          },${operation.operationType},${operation.setupTime},${
            operation.setupUnit
          },${operation.laborTime},${operation.laborUnit},${
            operation.machineTime
          },${operation.machineUnit}`;

          // Add duration values for each quantity
          if (quote.data?.quantity) {
            quote.data.quantity.forEach((qty) => {
              csv += `,${durations[`totalDuration${qty}`] || 0}`;
            });
          }
          csv += "\n";
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
