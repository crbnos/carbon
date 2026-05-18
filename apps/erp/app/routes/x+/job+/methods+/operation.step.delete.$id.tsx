import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteJobOperationStep } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationStep = await deleteJobOperationStep(id);
  if (deleteOperationStep.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationStep.error,
          "Failed to delete job operation attribute"
        )
      )
    );
  }

  return {};
}
