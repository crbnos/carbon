// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useOutlet, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Project } from "~/modules/projects/types";
import ChangeRequestsTable from "~/modules/projects/ui/ChangeRequests/ChangeRequestsTable";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-change-requests");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api, companyId } = await authorize(request, {
    "projects.projects": "View"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const changeRequests = await api.projects.getProjectChangeRequests({
    projectId
  });
  if (changeRequests.error) {
    logger.error("Failed to load change requests", {
      companyId,
      projectId,
      error: changeRequests.error
    });
  }

  return { changeRequests: changeRequests.data ?? [] };
}

export default function ProjectChangeRequestsRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const { changeRequests } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ project: Project }>(
    path.to.project(projectId)
  );
  // The review page is a child route: it replaces the list.
  const outlet = useOutlet();
  if (outlet) return outlet;

  return (
    <ChangeRequestsTable
      projectId={projectId}
      changeRequests={changeRequests}
      isClosed={routeData?.project?.status === "Closed"}
    />
  );
}
