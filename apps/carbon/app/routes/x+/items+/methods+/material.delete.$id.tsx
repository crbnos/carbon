import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { deleteMethodMaterial } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteMaterial = await deleteMethodMaterial(client, id);
  if (deleteMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(deleteMaterial.error, "Failed to delete method material")
      )
    );
  }

  return json({});
}
