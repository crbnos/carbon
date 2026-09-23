import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { setChangeNoticeActionTasks } from "~/modules/items";
import { requireEditableChangeNoticeRoute } from "~/modules/items/items.server";
import { getDatabaseClient } from "~/services/database.server";

// Reconcile a change notice's action tasks to the set chosen in the sidebar's
// "Required Actions" multiselect (mirrors Quality's requiredActionIds field):
// selected templates are instantiated, deselected ones removed.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("id not found");
  const locked = await requireEditableChangeNoticeRoute(request, {
    client,
    changeNoticeId: params.id,
    companyId,
    scope: "workflow"
  });
  if (locked) return locked;

  const formData = await request.formData();
  const requiredActionIds = String(formData.get("actionIds") ?? "")
    .split(",")
    .filter(Boolean);

  try {
    await setChangeNoticeActionTasks(getDatabaseClient(), {
      changeNoticeId: id,
      requiredActionIds,
      companyId,
      userId
    });
  } catch (err) {
    return data(
      { success: false },
      await flash(request, error(err, "Failed to update actions"))
    );
  }

  return { success: true };
}
