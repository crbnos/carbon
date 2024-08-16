import { json, type ActionFunctionArgs } from "@remix-run/node";
import logger from "~/lib/logger";
import { updateItemCost } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { assertIsPost } from "~/utils/http";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const formData = await request.formData();
  const unitCost = parseInt(formData.get("unitCost") as string);

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const deletion = await updateItemCost(client, itemId, {
    unitCost,
    updatedBy: userId,
  });
  if (deletion.error) {
    logger.error("Failed to update item cost", deletion.error);
    return json({
      error: "Failed to update item cost",
    });
  }

  return json({
    error: null,
  });
}
