import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { deleteMethodOperationAttribute } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteOperationAttribute = await deleteMethodOperationAttribute(
    client,
    id
  );
  if (deleteOperationAttribute.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(
          deleteOperationAttribute.error,
          "Failed to delete method operation attribute"
        )
      )
    );
  }

  return json({});
}
