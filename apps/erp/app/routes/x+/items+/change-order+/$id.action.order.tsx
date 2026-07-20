import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateChangeOrderActionOrder } from "~/modules/items";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
  });

  const updateMap = (await request.formData()).get("updates") as string;
  if (!updateMap) {
    return data(
      { success: false },
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const updates = Object.entries(
    JSON.parse(updateMap) as Record<string, number>
  ).map(([id, sortOrder]) => ({
    id,
    sortOrder: Number(sortOrder),
    updatedBy: userId
  }));

  try {
    await updateChangeOrderActionOrder(getDatabaseClient(), updates);
  } catch (err) {
    return data(
      { success: false },
      await flash(request, error(err, "Failed to update sort order"))
    );
  }

  return { success: true };
}
