import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { removeChangeNoticeAffectedItem } from "~/modules/items";
import {
  requireChangeNoticeChildRoute,
  requireEditableChangeNoticeRoute
} from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id: changeNoticeId, affectedId } = params;
  if (!changeNoticeId) throw new Error("Could not find id");
  if (!affectedId) throw new Error("Could not find affectedId");
  const locked = await requireEditableChangeNoticeRoute(request, {
    client,
    changeNoticeId,
    companyId,
    scope: "engineering"
  });
  if (locked) return locked;

  const owned = await requireChangeNoticeChildRoute(request, {
    client,
    table: "changeOrderAffectedItem",
    id: affectedId,
    changeNoticeId,
    companyId
  });
  if (owned) return owned;

  const remove = await removeChangeNoticeAffectedItem(
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
