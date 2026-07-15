import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { addChangeOrderActionTasksFromTemplates } from "~/modules/items";

// Add actions to a change order by instantiating the selected required-action
// templates (the "Add Actions" modal). The only add path — freeform actions were
// dropped in favor of the template picker (mirrors Quality).
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

  const add = await addChangeOrderActionTasksFromTemplates(client, {
    changeOrderId: id,
    requiredActionIds,
    companyId,
    userId
  });

  if (add.error) {
    return data(
      { success: false },
      await flash(request, error(add.error, "Failed to add actions"))
    );
  }

  return { success: true };
}
