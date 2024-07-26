import { json, type ActionFunctionArgs } from "@remix-run/node";
import { deleteQuoteMaterial } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteMaterial = await deleteQuoteMaterial(client, id);
  if (deleteMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(deleteMaterial.error, "Failed to delete quote material")
      )
    );
  }

  return json({});
}
