import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { deleteBatchProperty } from "~/modules/inventory/inventory.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "inventory"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const remove = await deleteBatchProperty(id);

  if (remove.error) {
    return {
      success: false,
      error: "Failed to delete batch property"
    };
  }

  return {
    success: true
  };
}
