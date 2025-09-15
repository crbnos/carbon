import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { deleteJobOperationStep } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "production",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationStep = await deleteJobOperationStep(client, id);
  if (deleteOperationStep.error) {
    return json(
      {
        id: null,
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

  return json({});
}
