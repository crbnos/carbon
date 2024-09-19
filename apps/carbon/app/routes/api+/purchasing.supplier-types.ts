import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getSupplierTypesList } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  return json(await getSupplierTypesList(client, companyId));
}
