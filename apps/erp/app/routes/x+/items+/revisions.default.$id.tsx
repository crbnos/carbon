import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { updateDefaultRevision } from "~/modules/items/items.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const update = await updateDefaultRevision(client, {
    id: id,
    updatedBy: userId,
  });

  if (update.error) {
    return json(
      {
        success: false,
        error: update.error,
      },
      await flash(request, error(update.error, "Failed to update item group"))
    );
  }

  return json({ success: true });
}
