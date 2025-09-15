import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { deleteQuoteOperationStep } from "~/modules/sales";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationStep = await deleteQuoteOperationStep(client, id);
  if (deleteOperationStep.error) {
    return json(
      {
        id: null,
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

  return json({});
}
