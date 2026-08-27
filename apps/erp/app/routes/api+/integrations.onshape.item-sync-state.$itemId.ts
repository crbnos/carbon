import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getOnshapeItemState } from "~/modules/items";

// Polled by the part sidebar's Onshape block while a pull is in flight, and
// after the pull request lands so the queued state shows immediately. Same
// view model the part loader hands the block on first render.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Response("Not found", { status: 404 });

  return getOnshapeItemState(client, itemId, companyId);
}
