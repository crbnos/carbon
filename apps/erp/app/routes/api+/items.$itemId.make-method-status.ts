import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getMakeMethods } from "~/modules/items";

// Lightweight status check for the "Add Affected Item" modal: does this item have
// an Active make method? When it doesn't (its current method is still an
// un-activated Draft — the common case), adding a Version change promotes that
// Draft to Active, which the modal warns about before the user commits.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { itemId } = params;
  if (!itemId) return { hasActiveMethod: false, hasAnyMethod: false };

  const methods = await getMakeMethods(client, itemId, companyId);
  const rows = methods.data ?? [];

  return {
    hasAnyMethod: rows.length > 0,
    hasActiveMethod: rows.some((m) => m.status === "Active")
  };
}
