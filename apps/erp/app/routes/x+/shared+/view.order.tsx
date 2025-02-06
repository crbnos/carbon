import { json, type ActionFunctionArgs } from "@vercel/remix";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { updateSavedViewOrder } from "~/modules/shared/shared.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {});

  const updatesRaw = (await request.formData()).get("updates") as string;
  if (!updatesRaw) {
    return json(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  try {
    const updates = JSON.parse(updatesRaw).map(
      (update: { id: string; sortOrder: number }) => ({
        ...update,
        updatedBy: userId,
      })
    );

    const updateSortOrders = await updateSavedViewOrder(client, updates);

    if (updateSortOrders.some((update) => update.error))
      return json(
        {},
        await flash(
          request,
          error(updateSortOrders, "Failed to update sort order")
        )
      );
  } catch (err) {
    await flash(request, error(null, "Failed to parse updates"));
  }

  return null;
}
