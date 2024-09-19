import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { arrayToTree } from "performant-array-to-tree";
import type { Group } from "~/modules/users";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const type = searchParams.get("type");

  const query = client.from("groups").select("*").eq("companyId", companyId);

  if (type === "employee") query.eq("isEmployeeTypeGroup", true);
  if (type === "customer") query.eq("isCustomerOrgGroup", true);
  if (type === "supplier") query.eq("isSupplierOrgGroup", true);

  const groups = await query;

  if (groups.error) {
    return json(
      { groups: [], error: groups.error },
      await flash(request, error(groups.error, "Failed to load groups"))
    );
  }

  return json({
    groups: arrayToTree(groups.data) as Group[],
  });
}
