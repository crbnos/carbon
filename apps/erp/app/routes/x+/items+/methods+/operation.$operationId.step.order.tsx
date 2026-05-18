import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { assertMethodOperationIsDraft } from "~/modules/items";
import { updateMethodOperationStepOrder } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const updateMap = formData.get("updates") as string;

  const { operationId } = params;
  if (!operationId) {
    return data(
      {},
      await flash(request, error(null, "Failed to receive an operation id"))
    );
  }

  if (!updateMap) {
    return data(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  await assertMethodOperationIsDraft(operationId);

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, sortOrderString]) => ({
      id,
      sortOrder: Number(sortOrderString),
      updatedBy: userId
    })
  );

  const updateSortOrders = await updateMethodOperationStepOrder(updates);
  if (updateSortOrders.some((update) => update.error))
    return data(
      {},
      await flash(
        request,
        error(updateSortOrders, "Failed to update sort order")
      )
    );

  return { success: true };
}
