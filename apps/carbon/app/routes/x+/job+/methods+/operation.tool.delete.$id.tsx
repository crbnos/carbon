import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { deleteJobOperationTool } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "production",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationTool = await deleteJobOperationTool(client, id);
  if (deleteOperationTool.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(deleteOperationTool.error, "Failed to delete job operation tool")
      )
    );
  }

  return json({});
}
