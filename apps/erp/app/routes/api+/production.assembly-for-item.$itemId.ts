import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

// The item's most relevant assembly instruction for the BOP editors' steps-source
// panel: a Published one wins (it can be synced), else the newest Draft/Archived
// (it can be opened/finished), else null (one can be created from the item's model).
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });
  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const instructions = await client
    .from("assemblyInstruction")
    .select("id, status, name")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("updatedAt", { ascending: false, nullsFirst: false });

  const rows = instructions.data ?? [];
  const instruction =
    rows.find((row) => row.status === "Published") ??
    rows.find((row) => row.status === "Draft") ??
    rows[0] ??
    null;

  return { instruction };
}
