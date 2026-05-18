import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSalesOrdersList } from "~/modules/sales";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  return await getSalesOrdersList();
}
