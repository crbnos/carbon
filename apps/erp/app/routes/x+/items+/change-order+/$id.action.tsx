import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { setChangeOrderActionTasks } from "~/modules/items";

// Reconcile a change order's action tasks to the set chosen in the sidebar's
// "Required Actions" multiselect (mirrors Quality's requiredActionIds field):
// selected templates are instantiated, deselected ones removed.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("id not found");

  const formData = await request.formData();
  const requiredActionIds = String(formData.get("actionIds") ?? "")
    .split(",")
    .filter(Boolean);

  const result = await setChangeOrderActionTasks(client, {
    changeOrderId: id,
    requiredActionIds,
    companyId,
    userId
  });

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to update actions"))
    );
  }

  return { success: true };
}
