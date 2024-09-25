import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { deleteItem } from "~/modules/items";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const deletion = await deleteItem(client, itemId);
  if (deletion.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.items,
      await flash(request, error(deletion.error, "Failed to delete item"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.items,
    await flash(request, success("Successfully deleted item"))
  );
}
