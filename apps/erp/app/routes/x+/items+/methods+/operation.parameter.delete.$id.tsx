import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteMethodOperationParameter } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationParameter = await deleteMethodOperationParameter(id);
  if (deleteOperationParameter.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationParameter.error,
          "Failed to delete method operation parameter"
        )
      )
    );
  }

  return {};
}
