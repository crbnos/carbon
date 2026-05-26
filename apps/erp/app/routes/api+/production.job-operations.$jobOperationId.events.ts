import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getProductionEventsPage } from "~/modules/production/production.service.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "production"
  });

  const { jobOperationId } = params;
  if (!jobOperationId) {
    return { data: [], count: 0, page: 1, pageSize: 20, hasMore: false };
  }

  const url = new URL(request.url);
  const sortDescending = url.searchParams.get("sortDescending") === "true";
  const page = Number(url.searchParams.get("page") ?? "1") || 1;

  return await getProductionEventsPage(jobOperationId, sortDescending, page);
}
