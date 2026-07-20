import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeOrderAction } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { actionId } = params;
  if (!actionId) throw new Error("Could not find actionId");

  const remove = await deleteChangeOrderAction(client, actionId);

  if (remove.error) {
    return data(
      { success: false },
      await flash(request, error(remove.error, "Failed to remove action"))
    );
  }

  return { success: true };
}
