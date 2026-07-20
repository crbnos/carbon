import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { removeChangeOrderAffectedItem } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { affectedId } = params;
  if (!affectedId) throw new Error("Could not find affectedId");

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
