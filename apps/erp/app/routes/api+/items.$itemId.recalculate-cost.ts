import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { ActionFunctionArgs } from "react-router";
import { flattenTree } from "~/components/TreeView";
import { getMethodTree } from "~/modules/items";
import type { BomOperation, WorkCenterRate } from "~/utils/bom";
import { calculateMadePartCosts, resolveOperationRates } from "~/utils/bom";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) {
    return { success: false, message: "Item ID is required" };
  }

  // Get the active (or draft fallback) make method for this item
  const makeMethodResult = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", itemId)
    .maybeSingle();

  if (makeMethodResult.error || !makeMethodResult.data) {
    return { success: false, message: "No make method found for this item" };
  }

  const makeMethodId = makeMethodResult.data.id;
  if (!makeMethodId) {
    return { success: false, message: "No make method found for this item" };
  }

  // Get the method tree
  const methodTree = await getMethodTree(client, makeMethodId);
  if (methodTree.error) {
    return { success: false, message: "Failed to load method tree" };
  }

  const methods =
    methodTree.data.length > 0 ? flattenTree(methodTree.data[0]) : [];

  if (methods.length === 0) {
    return { success: false, message: "No methods found in the method tree" };
  }

  // Get all method operations for cost calculation
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

  // Calculate costs using the same logic as the CSV export
  const computedCosts = calculateMadePartCosts(
    methods,
    bomOperationsByKey,
    (node) => node.data.materialMakeMethodId,
    lotSizesByItemId
  );

  // The top-level cost is the root node's computed cost
  const rootNode = methods[0];
  const unitCost = computedCosts.get(rootNode.id) ?? 0;

  // Update the item cost
  const updateResult = await client
    .from("itemCost")
    .update({ unitCost, updatedBy: userId })
    .eq("itemId", itemId);

  if (updateResult.error) {
    return {
      success: false,
      message: "Failed to update item cost"
    };
  }

  return {
    success: true,
    message: `Unit cost updated to ${unitCost.toFixed(2)}`
  };
}
