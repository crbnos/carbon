import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteJobOperationTool } from "~/modules/production/production.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationTool = await deleteJobOperationTool(id);
  if (deleteOperationTool.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(deleteOperationTool.error, "Failed to delete job operation tool")
      )
    );
  }

  return {};
}
