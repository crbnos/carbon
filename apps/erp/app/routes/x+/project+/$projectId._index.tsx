// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import {
  buildProjectCostFigures,
  getChildServiceProjectCosts,
  getProjectCostSummary,
  getProjectElements,
  getProjectMembers,
  getProjectMilestones,
  getProjectOpenTimesheetEntries,
  type Project,
  summarizeMilestones
} from "~/modules/projects";
import ProjectMembers from "~/modules/projects/ui/Project/ProjectMembers";
import ProjectOverview from "~/modules/projects/ui/Project/ProjectOverview";
import { ProjectProperties } from "~/modules/projects/ui/Project/ProjectProperties";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-overview");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const [
    elements,
    costSummary,
    serviceCosts,
    milestones,
    openEntries,
    timeZone,
    members
  ] = await Promise.all([
    getProjectElements(client, projectId, companyId),
    getProjectCostSummary(client, projectId, companyId),
    getChildServiceProjectCosts(client, projectId, companyId),
    getProjectMilestones(client, projectId, companyId),
    getProjectOpenTimesheetEntries(client, projectId, companyId),
    getCompanyTimeZone(client, companyId),
    getProjectMembers(client, projectId, companyId)
  ]);

  for (const [what, result] of [
    ["elements", elements],
    ["cost summary", costSummary],
    ["service order costs", serviceCosts],
    ["milestones", milestones],
    ["open time", openEntries],
    ["members", members]
  ] as const) {
    if (result.error) {
      logger.error("Failed to load a part of the project overview", {
        what,
        companyId,
        projectId,
        error: result.error
      });
    }
  }

  const today = datetime.today(timeZone).toString();
  const elementRows = elements.data ?? [];

  // The project total, as the Costs page's "Project total" row shows it.
  const serviceActual = (serviceCosts.data ?? []).reduce(
    (sum, row) => sum + Number(row.actual),
    0
  );
  const { project: figures } = buildProjectCostFigures(
    elementRows.map((element) => ({
      id: element.id,
      parentId: element.parentId,
      budget: element.budget,
      estimateAtCompletion: null
    })),
    costSummary.data ?? [],
    serviceActual
  );

  // The next milestone: the first one not completed that ends today or later.
  const nextMilestone =
    summarizeMilestones({
      milestones: milestones.data ?? [],
      elements: elementRows,
      costSummary: costSummary.data ?? [],
      today
    }).find(
      (milestone) =>
        !milestone.completedAt &&
        milestone.endDate !== null &&
        milestone.endDate >= today
    ) ?? null;

  return {
    figures: {
      budget: figures.budget,
      committed: figures.committed,
      actual: figures.actual
    },
    nextMilestone: nextMilestone && {
      id: nextMilestone.id,
      name: nextMilestone.name,
      startDate: nextMilestone.startDate,
      endDate: nextMilestone.endDate,
      elementCount: nextMilestone.elementCount,
      completedCount: nextMilestone.completedCount
    },
    openTimeCount: openEntries.data?.length ?? 0,
    members: members.data ?? []
  };
}

/**
 * The project's Overview, as an element's page: the summary in a readable
 * main column, and the project's properties in a column beside it, each
 * saved as it changes. There is no Settings page.
 */
export default function ProjectOverviewRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const { figures, nextMilestone, openTimeCount, members } =
    useLoaderData<typeof loader>();
  const routeData = useRouteData<{ project: Project }>(
    path.to.project(projectId)
  );
  const permissions = usePermissions();
  const project = routeData?.project;
  const isDisabled =
    !permissions.can("update", "projects") || project?.status === "Closed";

  return (
    <div className="@container flex h-full min-h-0 w-full">
      <div className="flex min-w-0 flex-1 flex-col @min-[56rem]:flex-row">
        <main className="min-w-0 flex-1 @min-[56rem]:overflow-y-auto">
          <ProjectOverview
            figures={figures}
            nextMilestone={nextMilestone}
            openTimeCount={openTimeCount}
          >
            {project?.restrictCharging && (
              <ProjectMembers
                projectId={projectId}
                members={members}
                action={path.to.projectSettings(projectId)}
                isDisabled={isDisabled}
              />
            )}
          </ProjectOverview>
        </main>
        <aside className="shrink-0 border-t border-border px-5 py-6 @min-[56rem]:w-[300px] @min-[56rem]:overflow-y-auto @min-[56rem]:border-t-0 @min-[56rem]:border-l">
          <ProjectProperties />
        </aside>
      </div>
    </div>
  );
}
