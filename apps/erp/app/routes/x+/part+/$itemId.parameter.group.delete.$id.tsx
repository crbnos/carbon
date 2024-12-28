import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { deleteConfigurationParameterGroup } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const remove = await deleteConfigurationParameterGroup(client, id);

  if (remove.error) {
    return json({
      success: false,
      error: "Failed to delete configuration parameter group",
    });
  }

  return json({
    success: true,
  });
}
