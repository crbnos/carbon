// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { datetime, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import {
  getProject,
  getProjectBorrows,
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

  // Overdue is against today on the company's calendar.
  const today = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  const [project, states, labels, milestones, overdueBorrows] =
    await Promise.all([
      getProject(client, companyId, projectId),
      getProjectStates(client, projectId, companyId),
      getProjectLabels(client, projectId, companyId),
      getProjectMilestones(client, projectId, companyId),
      // The Open borrows the project owes or has lent, past their payback
      // date: the header's exception badge.
      getProjectBorrows(client, companyId, {
        projectId,
        status: ["Open"],
        dueBefore: today
      })
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

  if (overdueBorrows.error) {
    logger.error("Failed to load the project's overdue borrows", {
      companyId,
      projectId,
      error: overdueBorrows.error
    });
  }

  return {
    project: project.data,
    underConstructionAssets,
    overdueBorrowCount: overdueBorrows.data?.length ?? 0,
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
