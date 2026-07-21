import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateMaterialOrder } from "~/modules/items";
import { checkRevisionLock } from "~/modules/items/items.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const updateMap = (await request.formData()).get("updates") as string;
  if (!updateMap) {
    return data(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, orderString]) => ({
      id,
      order: Number(orderString),
      updatedBy: userId
    })
  );

  // Release-lock gate: block edits to a released (Production) revision unless a
  // change order is used. All materials in a reorder share one make method.
  const lock = await checkRevisionLock(client, {
    kind: "material",
    id: updates[0]?.id,
    companyId
  });
  if (!lock.ok) {
    return data({}, await flash(request, error(null, lock.message)));
  }

  const updateSortOrders = await updateMaterialOrder(client, updates);
  if (updateSortOrders.some((update) => update.error))
    return data(
      {},
      await flash(
        request,
        error(updateSortOrders, "Failed to update sort order")
      )
    );

  if (lock.warn) {
    return data(null, await flash(request, success(lock.message)));
  }

  return null;
}
