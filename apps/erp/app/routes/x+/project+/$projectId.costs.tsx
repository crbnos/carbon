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
  getChildServiceProjectCosts,
  getProjectCostSummary,
  getProjectElementCosts
} from "~/modules/projects";
import type { ProjectCostRow } from "~/modules/projects/ui/Costs/ProjectCostsTree";
import ProjectCostsTree from "~/modules/projects/ui/Costs/ProjectCostsTree";
import type { ServiceOrderCostRow } from "~/modules/projects/ui/Costs/ServiceOrderCosts";

const logger = getLogger("erp", "project-costs");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const [elements, costSummary, serviceCosts] = await Promise.all([
    getProjectElementCosts(client, projectId, companyId),
    getProjectCostSummary(client, projectId, companyId),
    getChildServiceProjectCosts(client, projectId, companyId)
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

  if (serviceCosts.error) {
    logger.error("Failed to load the project's service order costs", {
      companyId,
      projectId,
      error: serviceCosts.error
    });
  }

  // The service orders a coverage contract on this project covers. Their
  // actual adds to the project total; RLS returns none without service_view.
  const serviceOrders: ServiceOrderCostRow[] = (serviceCosts.data ?? []).map(
    (row) => ({
      serviceOrderId: row.serviceOrderId,
      serviceOrderReadableId: row.serviceOrderReadableId,
      status: row.status,
      serial: row.serial,
      actual: Number(row.actual),
      actualHours: Number(row.actualHours),
      billed: Number(row.billed),
      unbilled: Number(row.unbilled)
    })
  );
  const serviceActual = serviceOrders.reduce((sum, row) => sum + row.actual, 0);

  const elementRows = elements.data ?? [];
  const { byElement, project } = buildProjectCostFigures(
    elementRows,
    costSummary.data ?? [],
    serviceActual
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

  return { rows, project, serviceOrders, serviceActual };
}

export default function ProjectCostsRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");
  const { rows, project, serviceOrders, serviceActual } =
    useLoaderData<typeof loader>();

  return (
    <div className="h-full w-full">
      <ProjectCostsTree
        projectId={projectId}
        rows={rows}
        project={project}
        serviceOrders={serviceOrders}
        serviceActual={serviceActual}
      />
      <RecordOutlet />
    </div>
  );
}
