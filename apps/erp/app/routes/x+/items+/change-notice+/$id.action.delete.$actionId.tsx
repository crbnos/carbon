import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeOrderAction } from "~/modules/items";
import {
  requireChangeOrderChildRoute,
  requireEditableChangeOrderRoute
} from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id: changeOrderId, actionId } = params;
  if (!changeOrderId) throw new Error("Could not find id");
  if (!actionId) throw new Error("Could not find actionId");
  const locked = await requireEditableChangeOrderRoute(request, {
    client,
    changeOrderId,
    companyId,
    scope: "workflow"
  });
  if (locked) return locked;

  const owned = await requireChangeOrderChildRoute(request, {
    client,
    table: "changeOrderActionTask",
    id: actionId,
    changeOrderId,
    companyId
  });
  if (owned) return owned;

  const remove = await deleteChangeOrderAction(client, actionId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(request, error(remove.error, "Failed to remove action"))
    );
  }

  return { success: true };
}
