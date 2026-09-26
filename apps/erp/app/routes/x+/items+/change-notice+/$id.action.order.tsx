import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateChangeNoticeActionOrder } from "~/modules/items";
import { requireEditableChangeNoticeRoute } from "~/modules/items/items.server";
import { parseSortOrderUpdates } from "~/modules/shared/sort-order";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeNoticeId = params.id;
  if (!changeNoticeId) throw new Error("Could not find id");

  const locked = await requireEditableChangeNoticeRoute(request, {
    client,
    changeNoticeId,
    companyId,
    scope: "workflow"
  });
  if (locked) return locked;

  const updates = parseSortOrderUpdates(await request.formData());
  if (!updates) {
    return data(
      { success: false },
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  try {
    await updateChangeNoticeActionOrder(
      getDatabaseClient(),
      companyId,
      userId,
      changeNoticeId,
      updates
    );
  } catch (err) {
    return data(
      { success: false },
      await flash(request, error(err, "Failed to update sort order"))
    );
  }

  return { success: true };
}
