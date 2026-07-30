import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { assertMethodOperationIsDraft } from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";
import { updateMethodOperationStepOrder } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  // Release-lock gate: enforce -> block; warn -> proceed + flash; off -> no-op.
  const lock = await checkRevisionLock(client, {
    kind: "operation",
    id: operationId,
    companyId
  });
  if (!lock.ok) {
    return data({}, await flash(request, error(null, lock.message)));
  }

  await assertMethodOperationIsDraft(client, operationId);

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, sortOrderString]) => ({
      id,
      sortOrder: Number(sortOrderString),
      updatedBy: userId
    })
  );

  const updateSortOrders = await updateMethodOperationStepOrder(
    client,
    updates
  );
  if (updateSortOrders.some((update) => update.error))
    return data(
      {},
      await flash(
        request,
        error(updateSortOrders, "Failed to update sort order")
      )
    );

  if (lock.warn) {
    return data({ success: true }, await flash(request, success(lock.message)));
  }

  return { success: true };
}
