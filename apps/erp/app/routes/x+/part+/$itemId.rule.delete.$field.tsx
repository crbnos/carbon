import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { deleteConfigurationRule } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { itemId, field } = params;
  if (!itemId || !field) throw notFound("itemId or field not found");

  const remove = await deleteConfigurationRule(client, field, itemId);

  if (remove.error) {
    return json({
      success: false,
      error: "Failed to delete configuration rule",
    });
  }

  return json({
    success: true,
  });
}
