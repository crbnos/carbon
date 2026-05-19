import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { updateItemCost } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const unitCost = parseFloat(formData.get("unitCost") as string);

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const update = await updateItemCost(itemId, { unitCost });
  if (update.error) {
    console.error("Failed to update item cost", update.error);
    return {
      error: "Failed to update item cost"
    };
  }

  return {
    error: null
  };
}
