import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getJobsList } from "~/modules/production/production.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "production"
  });

  return await getJobsList();
}
