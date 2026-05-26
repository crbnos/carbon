import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getCustomersList } from "~/modules/sales/sales.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  return await getCustomersList();
}
