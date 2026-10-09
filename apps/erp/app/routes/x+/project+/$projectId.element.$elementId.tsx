// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type {
  Project,
  ProjectLabel,
  ProjectMilestone,
  ProjectState
} from "~/modules/projects";
import { getProjectElementPageInChangeRequest } from "~/modules/projects/projects.server";
import { ElementView } from "~/modules/projects/ui/Element/ElementView";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-element");

export const handle: Handle = {
  breadcrumb: (
    _params: unknown,
    data: { element?: { readableId?: string } } | undefined
  ) => data?.element?.readableId
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  // `?cr=` shows the element as an open change request would leave it.
  const page = await getProjectElementPageInChangeRequest(client, {
    companyId,
    projectId,
    elementId,
    userId,
    changeRequestId: new URL(request.url).searchParams.get("cr")
  });
  if (page.error || !page.data) {
    logger.error("Failed to load project element", {
      companyId,
      projectId,
      elementId,
      error: page.error
    });
    throw redirect(
      path.to.projectElements(projectId),
      await flash(request, error(page.error, "Failed to load the element"))
    );
  }

  return page.data;
}

/** The element as a full page inside the project. */
export default function ProjectElementRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const page = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    project: Project;
    states: ProjectState[];
    labels: ProjectLabel[];
    milestones: ProjectMilestone[];
  }>(path.to.project(projectId));

  return (
    <div className="h-full">
      <ElementView
        {...page}
        projectId={projectId}
        project={routeData?.project}
        states={routeData?.states ?? []}
        labels={routeData?.labels ?? []}
        milestones={routeData?.milestones ?? []}
        variant="page"
      />
    </div>
  );
}
