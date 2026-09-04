import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { LoaderFunctionArgs } from "react-router";
import { getJobsList, jobStatus } from "~/modules/production";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const url = new URL(request.url);
  const statuses = url.searchParams
    .getAll("status")
    .filter((status): status is Database["public"]["Enums"]["jobStatus"] =>
      jobStatus.includes(status as (typeof jobStatus)[number])
    );

  return await getJobsList(client, companyId, statuses);
}
