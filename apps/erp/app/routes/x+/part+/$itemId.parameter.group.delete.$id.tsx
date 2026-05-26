import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { deleteConfigurationParameterGroup } from "~/modules/items/items.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const remove = await deleteConfigurationParameterGroup(id);

  if (remove.error) {
    return {
      success: false,
      error: "Failed to delete configuration parameter group"
    };
  }

  return {
    success: true
  };
}
