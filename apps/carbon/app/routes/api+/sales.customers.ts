import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCustomersList } from "~/modules/sales";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  return json(await getCustomersList(client, companyId));
}
