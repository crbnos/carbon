import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getJobMethodTree } from "~/modules/production/production.service.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;
  if (!jobId) {
    return { data: [], error: null };
  }

  return await getJobMethodTree(jobId);
}
