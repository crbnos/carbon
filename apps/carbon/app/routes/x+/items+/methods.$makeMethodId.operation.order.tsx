import { json, type ActionFunctionArgs } from "@remix-run/node";

import { updateOperationOrder } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const updateMap = (await request.formData()).get("updates") as string;
  if (!updateMap) {
    return json(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, orderString]) => ({
      id,
      order: Number(orderString),
      updatedBy: userId,
    })
  );

  const updateSortOrders = await updateOperationOrder(client, updates);
  if (updateSortOrders.some((update) => update.error))
    return json(
      {},
      await flash(
        request,
        error(updateSortOrders, "Failed to update sort order")
      )
    );

  return null;
}
