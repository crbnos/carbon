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

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { id } = params;
  const withOperations = request.url.includes("withOperations=true");

  if (!id) {
    return { data: [], error: null };
  }

  const quote = await client
    .from("quoteLine")
    .select("quoteId, quantity")
    .eq("id", id)
    .single();
  if (quote.error) {
    return { data: [], error: "Failed to load quote line" };
  }

  const methodTrees = await getQuoteMethodTrees(client, quote.data?.quoteId);

  if (methodTrees.error) {
    return { data: [], error: methodTrees.error };
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

  console.log({ withOperations, operationsByMakeMethodId });

  const bomIds = generateBomIds(flattenedMethods);

  const result = flattenedMethods.map((node, index) => {
    const total = calculateTotalQuantity(node, flattenedMethods);
    const totalCost = total * (node.data.unitCost || 0);

    const bomItem = {
      id: bomIds[index],
      itemId: node.data.itemReadableId,
      description: node.data.description,
      quantity: node.data.quantity,
      total,
      unitCost: node.data.unitCost,
      totalCost,
      methodType: node.data.methodType,
      itemType: node.data.itemType,
      level: node.level,
      version: node.data.version || null,
    };

    if (!withOperations) {
      return bomItem;
    }

    const operations =
      operationsByMakeMethodId[node.data.quoteMaterialMakeMethodId];
    if (!operations) {
      return { ...bomItem, operations: [] };
    }

    return {
      ...bomItem,
      operations: operations.map((operation) => {
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
          ...durations,
        };
      }),
    };
  });

  return { data: result, error: null };
}
