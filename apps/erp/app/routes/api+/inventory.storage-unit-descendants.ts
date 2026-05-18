import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getStorageUnitDescendants } from "~/modules/inventory";

/**
 * Returns every storage unit in the subtree rooted at `id` (the unit itself
 * plus every descendant). Used by StorageUnitForm to exclude invalid parent
 * choices so a user cannot accidentally create a cycle - the DB enforces
 * the same invariant via storage_unit_enforce_no_cycle, but filtering
 * client-side gives a cleaner UX than a round-trip rejection.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "inventory" });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return { data: [], error: null };
  }

  const result = await getStorageUnitDescendants(id);

  if (result.error) {
    return { data: [], error: result.error };
  }

  // Return just the ids — callers only need the set to filter against.
  return {
    data: (result.data ?? []).map((row) => ({ id: row.id })),
    error: null
  };
}
