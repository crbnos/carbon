import { json, type ActionFunctionArgs } from "@vercel/remix";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { updateMethodOperationStepOrder } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const formData = await request.formData();
  const updateMap = formData.get("updates") as string;

  const { operationId } = params;
  if (!operationId) {
    return json(
      {},
      await flash(request, error(null, "Failed to receive an operation id"))
    );
  }

  if (!updateMap) {
    return json(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, sortOrderString]) => ({
      id,
      sortOrder: Number(sortOrderString),
      updatedBy: userId,
    })
  );

  const updateSortOrders = await updateMethodOperationStepOrder(
    client,
    updates
  );
  if (updateSortOrders.some((update) => update.error))
    return json(
      {},
      await flash(
        request,
        error(updateSortOrders, "Failed to update sort order")
      )
    );

  return json({ success: true });
}
