import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { deleteJobMaterial } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "production",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteMaterial = await deleteJobMaterial(client, id);
  if (deleteMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(deleteMaterial.error, "Failed to delete job material")
      )
    );
  }

  // TODO: if it is a make method -- we should get the tree from the jobMakeMethod with parentMaterialId = id, and delete everything that comes back

  return json({});
}
