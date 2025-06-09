import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { flattenTree } from "~/components/TreeView";
import type { JobOperation } from "~/modules/production";
import { getJobMethodTree } from "~/modules/production";
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
  "UOM",
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
  "Total Duration x 1 (ms)",
  "Total Duration x 100 (ms)",
  "Total Duration x 1000 (ms)",
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
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
        "Content-Disposition": "attachment; filename=bom.csv",
      },
    });
  }

  const methodTree = await getJobMethodTree(client, id);
  if (methodTree.error) {
    return new Response(headers, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=bom.csv",
      },
    });
  }

  const fileName = `${methodTree.data[0].data.itemReadableId}-bom.csv`;

  const methods =
    methodTree.data.length > 0 ? flattenTree(methodTree.data[0]) : [];

  const makeMethodIds = [
    ...new Set(methods.map((method) => method.data.jobMakeMethodId)),
  ];

  let operationsByMakeMethodId: Record<
    string,
    Array<
      JobOperation & {
        processName: string;
        workCenterName: string | null;
      }
    >
  > = {};

  if (withOperations) {
    const methodOperations = await client
      .from("jobOperation")
      .select(
        "*, ...process(processName:name), ...workCenter(workCenterName:name), ...jobMakeMethod(parentMaterialId, item(readableIdWithRevision))"
      )
      .in("jobMakeMethodId", makeMethodIds)
      .eq("companyId", companyId);
    if (methodOperations.data) {
      operationsByMakeMethodId = methodOperations.data.reduce<
        typeof operationsByMakeMethodId
      >((acc, operation) => {
        const transformedOperation = {
          ...operation,
          jobMakeMethod: operation.item
            ? {
                parentMaterialId: operation.parentMaterialId,
                item: {
                  readableIdWithRevision: operation.item.readableIdWithRevision,
                },
              }
            : null,
        };
        acc[operation.jobMakeMethodId ?? ""] = [
          ...(acc[operation.jobMakeMethodId ?? ""] || []),
          transformedOperation,
        ];
        return acc;
      }, {});
    }
  }

  const bomIds = generateBomIds(methods);

  let csv = headers;

  methods.forEach((node, index) => {
    const total = calculateTotalQuantity(node, methods);
    const totalCost = total * (node.data.unitCost || 0);

    csv += `${bomIds[index]},${
      node.data.itemReadableId
    },"${node.data.description?.replace(/"/g, '""')}",${
      node.data.quantity
    },${total},${node.data.unitCost},${totalCost},,${node.data.methodType},${
      node.data.itemType
    },${node.level},${node.data.version || ""}\n`;

    if (withOperations) {
      const operations =
        operationsByMakeMethodId[node.data.jobMaterialMakeMethodId];
      if (operations) {
        operations.forEach((operation) => {
          const op1 = makeDurations({ ...operation, operationQuantity: total });
          const op100 = makeDurations({
            ...operation,
            operationQuantity: total * 100,
          });
          const op1000 = makeDurations({
            ...operation,
            operationQuantity: total * 1000,
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
      "Content-Disposition": `attachment; filename=${fileName}`,
    },
  });
}
