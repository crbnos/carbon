// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  buildProjectCostFigures,
  getChildServiceProjectCosts,
  getProjectCostSummary,
  getProjectElements,
  getProjectMilestones,
  getProjectOpenTimesheetEntries,
  summarizeMilestones
} from "~/modules/projects";
import ProjectOverview from "~/modules/projects/ui/Project/ProjectOverview";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";

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
    timeZone
  ] = await Promise.all([
    getProjectElements(client, projectId, companyId),
    getProjectCostSummary(client, projectId, companyId),
    getChildServiceProjectCosts(client, projectId, companyId),
    getProjectMilestones(client, projectId, companyId),
    getProjectOpenTimesheetEntries(client, projectId, companyId),
    getCompanyTimeZone(client, companyId)
  ]);

  for (const [what, result] of [
    ["elements", elements],
    ["cost summary", costSummary],
    ["service order costs", serviceCosts],
    ["milestones", milestones],
    ["open time", openEntries]
  ] as const) {
    if (result.error) {
      logger.error(`Failed to load the project's ${what}`, {
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
    openTimeCount: openEntries.data?.length ?? 0
  };
}

export default function ProjectOverviewRoute() {
  const { figures, nextMilestone, openTimeCount } =
    useLoaderData<typeof loader>();
  return (
    <ProjectOverview
      figures={figures}
      nextMilestone={nextMilestone}
      openTimeCount={openTimeCount}
    />
  );
}
