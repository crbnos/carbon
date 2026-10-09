// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import {
  getProject,
  getProjectLabels,
  getProjectMilestones,
  getProjectStates
} from "~/modules/projects";
import { getProjectCapitalAssets } from "~/modules/projects/projects.server";
import ProjectHeader from "~/modules/projects/ui/Project/ProjectHeader";
import { getDatabaseClient } from "~/services/database.server";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Projects`, to: path.to.projects },
    (data) => data?.project?.identifier
  ),
  module: "projects"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects",
    bypassRls: true
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const [project, states, labels, milestones] = await Promise.all([
    getProject(client, companyId, projectId),
    getProjectStates(client, projectId, companyId),
    getProjectLabels(client, projectId, companyId),
    getProjectMilestones(client, projectId, companyId)
  ]);

  if (project.error || project.data?.companyId !== companyId) {
    logger.error("Failed to load project", {
      companyId,
      projectId,
      error: project.error
    });
    throw redirect(
      path.to.projects,
      await flash(request, error(project.error, "Failed to load project"))
    );
  }

  // A capital project offers Place in service while an asset is under
  // construction.
  const underConstructionAssets =
    project.data.costTreatment === "Capitalize"
      ? (
          await getProjectCapitalAssets(getDatabaseClient(), {
            companyId,
            projectId
          })
        ).filter((asset) => asset.status === "Under Construction").length
      : 0;

  return {
    project: project.data,
    underConstructionAssets,
    states: states.data ?? [],
    labels: labels.data ?? [],
    milestones: milestones.data ?? []
  };
}

export default function ProjectRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
      <ProjectHeader key={projectId} />
      <div className="flex-1 min-h-0 overflow-y-auto bg-card w-full">
        <RecordOutlet />
      </div>
    </div>
  );
}
