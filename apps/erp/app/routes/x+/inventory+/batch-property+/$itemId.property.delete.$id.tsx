import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { deleteBatchProperty } from "~/modules/inventory";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "inventory",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const remove = await deleteBatchProperty(client, id);

  if (remove.error) {
    return json({
      success: false,
      error: "Failed to delete batch property",
    });
  }

  return json({
    success: true,
  });
}
