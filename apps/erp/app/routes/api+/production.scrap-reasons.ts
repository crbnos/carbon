import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getScrapReasonsList } from "~/modules/production/production.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  return await getScrapReasonsList();
}
