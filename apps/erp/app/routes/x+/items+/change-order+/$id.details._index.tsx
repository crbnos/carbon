import { requirePermissions } from "@carbon/auth/auth.server";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getChangeOrderAffectedItems } from "~/modules/items";
import { path } from "~/utils/path";

// Bare /details: auto-select the first affected item (preserving the previous
// "default to first" UX) by redirecting into its URL. With no items, show the
// prompt so the sidebar's add form is the obvious next step.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const affected = await getChangeOrderAffectedItems(client, id, companyId);
  const first = affected.data?.[0];
  if (first) {
    throw redirect(path.to.changeOrderAffectedItem(id, first.id));
  }
  return null;
}

export default function ChangeOrderDetailsIndexRoute() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
      <Trans>Select an affected item, or add one on the left.</Trans>
    </div>
  );
}
