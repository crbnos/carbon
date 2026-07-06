import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deletePickingList } from "~/modules/inventory";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "inventory"
  });

  const { pickingListId } = params;
  if (!pickingListId) throw new Response("Not found", { status: 404 });

  const result = await deletePickingList(client, pickingListId);

  if (result.error) {
    throw redirect(
      path.to.pickingListDetails(pickingListId),
      await flash(request, error(result.error, "Failed to delete picking list"))
    );
  }

  // Return to wherever the delete came from (e.g. the lists view with its
  // filters/location params). Fall back to the lists view, and never redirect
  // back to the just-deleted detail page.
  const referrer = requestReferrer(request);
  const destination =
    referrer && !referrer.includes(`/picking-list/${pickingListId}`)
      ? referrer
      : path.to.pickingListsTable;

  throw redirect(
    destination,
    await flash(request, success("Picking list deleted successfully"))
  );
}
