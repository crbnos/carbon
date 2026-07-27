import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { removeChangeOrderAffectedItem } from "~/modules/items";
import {
  requireChangeOrderChildRoute,
  requireEditableChangeOrderRoute
} from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id: changeOrderId, affectedId } = params;
  if (!changeOrderId) throw new Error("Could not find id");
  if (!affectedId) throw new Error("Could not find affectedId");
  const locked = await requireEditableChangeOrderRoute(request, {
    client,
    changeOrderId,
    companyId,
    scope: "engineering"
  });
  if (locked) return locked;

  const owned = await requireChangeOrderChildRoute(request, {
    client,
    table: "changeOrderAffectedItem",
    id: affectedId,
    changeOrderId,
    companyId
  });
  if (owned) return owned;

  const remove = await removeChangeOrderAffectedItem(
    client,
    affectedId,
    companyId
  );

  if (remove.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(remove.error, "Failed to remove affected item")
      )
    );
  }

  return { success: true };
}
