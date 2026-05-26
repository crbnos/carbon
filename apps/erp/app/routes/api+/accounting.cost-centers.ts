import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getCostCentersList } from "~/modules/accounting/accounting.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  return await getCostCentersList();
}
