import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { deleteConfigurationRule } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "parts"
  });

  const { itemId, field } = params;
  if (!itemId || !field) throw notFound("itemId or field not found");

  const remove = await deleteConfigurationRule(field, itemId);

  if (remove.error) {
    return {
      success: false,
      error: "Failed to delete configuration rule"
    };
  }

  return {
    success: true
  };
}
