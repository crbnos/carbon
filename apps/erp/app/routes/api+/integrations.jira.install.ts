import { requirePermissions } from "@carbon/auth/auth.server";
import { getJiraInstallUrl } from "@carbon/ee/jira.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const url = getJiraInstallUrl({
    companyId,
    userId
  });

  return { url };
}
