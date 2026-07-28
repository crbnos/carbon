import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeNoticeAction } from "~/modules/items";
import {
  requireChangeNoticeChildRoute,
  requireEditableChangeNoticeRoute
} from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id: changeNoticeId, actionId } = params;
  if (!changeNoticeId) throw new Error("Could not find id");
  if (!actionId) throw new Error("Could not find actionId");
  const locked = await requireEditableChangeNoticeRoute(request, {
    client,
    changeNoticeId,
    companyId,
    scope: "workflow"
  });
  if (locked) return locked;

  const owned = await requireChangeNoticeChildRoute(request, {
    client,
    table: "changeOrderActionTask",
    id: actionId,
    changeNoticeId,
    companyId
  });
  if (owned) return owned;

  const remove = await deleteChangeNoticeAction(client, actionId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(request, error(remove.error, "Failed to remove action"))
    );
  }

  return { success: true };
}
