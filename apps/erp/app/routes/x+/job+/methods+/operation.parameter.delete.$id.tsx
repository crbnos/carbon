import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteJobOperationParameter } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationParameter = await deleteJobOperationParameter(id);
  if (deleteOperationParameter.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationParameter.error,
          "Failed to delete job operation parameter"
        )
      )
    );
  }

  return {};
}
