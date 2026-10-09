// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import {
  buildProjectCostFigures,
  getProjectCostSummary,
  getProjectElementCosts
} from "~/modules/projects";
import type { ProjectCostRow } from "~/modules/projects/ui/Costs/ProjectCostsTree";
import ProjectCostsTree from "~/modules/projects/ui/Costs/ProjectCostsTree";

const logger = getLogger("erp", "project-costs");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const [elements, costSummary] = await Promise.all([
    getProjectElementCosts(client, projectId, companyId),
    getProjectCostSummary(client, projectId, companyId)
  ]);

  if (elements.error) {
    logger.error("Failed to load project elements", {
      companyId,
      projectId,
      error: elements.error
    });
  }
  if (costSummary.error) {
    logger.error("Failed to load project cost summary", {
      companyId,
      projectId,
      error: costSummary.error
    });
  }

  const elementRows = elements.data ?? [];
  const { byElement, project } = buildProjectCostFigures(
    elementRows,
    costSummary.data ?? []
  );

  const rows: ProjectCostRow[] = elementRows.map((element) => ({
    id: element.id,
    parentId: element.parentId,
    sortOrder: element.sortOrder,
    readableId: element.readableId,
    name: element.name,
    type: element.type,
    figures: byElement.get(element.id)!
  }));

  return { rows, project };
}

export default function ProjectCostsRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");
  const { rows, project } = useLoaderData<typeof loader>();

  return (
    <div className="h-full w-full">
      <ProjectCostsTree projectId={projectId} rows={rows} project={project} />
      <RecordOutlet />
    </div>
  );
}
