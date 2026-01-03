import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod/v3";

const addAndIssueValidator = z.object({
  itemId: z.string().min(1),
  unitOfMeasureCode: z.string().min(1),
  // For inventory items
  quantity: z.number().optional(),
  // For tracked items (serial/batch)
  children: z
    .array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    )
    .optional()
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const { dispatchId } = params;

  if (!dispatchId) {
    return data(
      { success: false, message: "Dispatch ID is required" },
      { status: 400 }
    );
  }

  const json = await request.json();
  const validation = addAndIssueValidator.safeParse(json);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const { itemId, unitOfMeasureCode, quantity, children } = validation.data;

  // Calculate total quantity from children if provided, otherwise use quantity
  const totalQuantity = children
    ? children.reduce((sum, c) => sum + c.quantity, 0)
    : (quantity ?? 0);

  if (totalQuantity <= 0) {
    return data(
      { success: false, message: "Quantity must be greater than 0" },
      { status: 400 }
    );
  }

  const serviceRole = await getCarbonServiceRole();

  if (children && children.length > 0) {
    // Tracked entities (serial/batch)
    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        type: "maintenanceDispatchTrackedEntities",
        maintenanceDispatchId: dispatchId,
        itemId,
        unitOfMeasureCode,
        children,
        companyId,
        userId
      },
      region: FunctionRegion.UsEast1
    });

    if (issue.error) {
      console.error(issue.error);
      return data(
        { success: false, message: "Failed to issue tracked items" },
        { status: 400 }
      );
    }
  } else {
    // Inventory item
    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        type: "maintenanceDispatchInventory",
        maintenanceDispatchId: dispatchId,
        itemId,
        unitOfMeasureCode,
        quantity: totalQuantity,
        companyId,
        userId
      },
      region: FunctionRegion.UsEast1
    });

    if (issue.error) {
      console.error(issue.error);
      return data(
        { success: false, message: "Failed to issue from inventory" },
        { status: 400 }
      );
    }
  }

  return {
    success: true,
    message: "Part added and issued successfully"
  };
}
