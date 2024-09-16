import { json, type ActionFunctionArgs } from "@remix-run/node";
import { deleteJobMaterial } from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

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

  return json({});
}
