import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getStorageTypesList } from "~/modules/inventory";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });

  return await getStorageTypesList();
}
