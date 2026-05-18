import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSuppliersList } from "~/modules/purchasing";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing"
  });

  return await getSuppliersList();
}
