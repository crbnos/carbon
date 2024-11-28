import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { deleteQuoteOperationTool } from "~/modules/sales";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationTool = await deleteQuoteOperationTool(client, id);
  if (deleteOperationTool.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(
          deleteOperationTool.error,
          "Failed to delete quote operation tool"
        )
      )
    );
  }

  return json({});
}
