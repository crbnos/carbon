import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { flattenTree } from "~/components/TreeView";
import { getQuoteMethodTrees } from "~/modules/sales";
import { calculateTotalQuantity, generateBomIds } from "~/utils/bom";
import { makeDurations } from "~/utils/duration";

export const config = {
  runtime: "nodejs",
};

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
  "Version",
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
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { id } = params;
  const withOperations = request.url.includes("withOperations=true");

  if (!id) {
    return new Response(bomHeaders.join(",") + "\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=bom.csv",
      },
    });
  }

  const quote = await client
    .from("quoteLine")
    .select("quoteId, quantity, itemReadableId")
    .eq("id", id)
    .single();
  const fileName = `${quote.data?.itemReadableId}-bom.csv`;
  if (quote.error) {
    return new Response(bomHeaders.join(",") + "\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=${fileName}`,
      },
    });
  }

  const methodTrees = await getQuoteMethodTrees(client, quote.data?.quoteId);

  if (methodTrees.error) {
    return new Response(bomHeaders.join(",") + "\n", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=bom.csv",
      },
    });
  }

  const methodTree = methodTrees.data.find((m) => m.data.quoteLineId === id);
  const flattenedMethods = methodTree ? flattenTree(methodTree) : [];

  const makeMethodIds = [
    ...new Set(flattenedMethods.map((method) => method.data.quoteMakeMethodId)),
  ];

  let operationsByMakeMethodId: Record<
    string,
    Array<
      Database["public"]["Tables"]["quoteOperation"]["Row"] & {
        processName: string;
        workCenterName: string | null;
      }
    >
  > = {};

  if (withOperations) {
    const quoteOperations = await client
      .from("quoteOperation")
      .select(
        "*, ...process(processName:name), ...workCenter(workCenterName:name)"
      )
      .in("quoteMakeMethodId", makeMethodIds)
      .eq("companyId", companyId);
    if (quoteOperations.data) {
      operationsByMakeMethodId = quoteOperations.data.reduce(
        (acc, operation) => {
          acc[operation.quoteMakeMethodId ?? ""] = [
            ...(acc[operation.quoteMakeMethodId ?? ""] || []),
            operation,
          ];
          return acc;
        },
        {} as typeof operationsByMakeMethodId
      );
    }
  }

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
    const totalCost = total * (node.data.unitCost || 0);

    csv += `${bomIds[index]},${
      node.data.itemReadableId
    },"${node.data.description?.replace(/"/g, '""')}",${
      node.data.quantity
    },${total},${node.data.unitCost},${totalCost},${node.data.methodType},${
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
                operationQuantity: quantity,
              });
              return [quantity, duration.duration];
            })
            .reduce((acc, [quantity, duration]) => {
              acc[`totalDuration${quantity}`] = duration;
              return acc;
            }, {} as Record<string, number>);

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
      "Content-Disposition": `attachment; filename=${fileName}`,
    },
  });
}
