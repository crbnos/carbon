import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteQuoteOperationStep } from "~/modules/sales";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationStep = await deleteQuoteOperationStep(id);
  if (deleteOperationStep.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(
          deleteOperationStep.error,
          "Failed to delete quote operation step"
        )
      )
    );
  }

  return {};
}
