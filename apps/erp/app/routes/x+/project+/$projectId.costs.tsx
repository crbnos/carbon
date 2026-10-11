// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { round } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import {
  buildProjectCostFigures,
  getChildServiceProjectCosts,
  getProjectBurdenSummary,
  getProjectCostSummary,
  getProjectElementCosts,
  preproductionActual
} from "~/modules/projects";
import type { ProjectBurdenPoolRow } from "~/modules/projects/ui/Costs/ProjectBurdenByPool.ee";
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

  const [elements, costSummary, serviceCosts, burdenSummary] =
    await Promise.all([
      getProjectElementCosts(client, projectId, companyId),
      getProjectCostSummary(client, projectId, companyId),
      getChildServiceProjectCosts(client, projectId, companyId),
      getProjectBurdenSummary(client, projectId, companyId)
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

  if (burdenSummary.error) {
    logger.error("Failed to load the project's burden", {
      companyId,
      projectId,
      error: burdenSummary.error
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
    isPreproduction: element.isPreproduction,
    figures: byElement.get(element.id)!
  }));

  // Shown only when the project has a preproduction element.
  const preproduction = elementRows.some((element) => element.isPreproduction)
    ? preproductionActual(elementRows, byElement)
    : null;

  // Burden (Phase 5b): per pool for the project, and the allowable burden of
  // each element's subtree for the tree's "of which burden" tooltip. A row
  // with no element is the project's own and counts only in the total.
  const parentOf = new Map(
    elementRows.map((element) => [element.id, element.parentId])
  );
  const subtreeBurden = new Map<string, number>();
  const byPool = new Map<string, ProjectBurdenPoolRow>();
  let projectBurden = 0;
  for (const row of burdenSummary.data ?? []) {
    const amount = Number(row.amount);
    const unallowable = Number(row.unallowableAmount);
    const allowable = amount - unallowable;
    const pool = byPool.get(row.indirectPoolId) ?? {
      indirectPoolId: row.indirectPoolId,
      poolName: row.poolName,
      allowable: 0,
      unallowable: 0
    };
    pool.allowable += allowable;
    pool.unallowable += unallowable;
    byPool.set(row.indirectPoolId, pool);
    projectBurden += allowable;
    let elementId: string | null = row.projectElementId;
    while (elementId) {
      subtreeBurden.set(
        elementId,
        (subtreeBurden.get(elementId) ?? 0) + allowable
      );
      elementId = parentOf.get(elementId) ?? null;
    }
  }
  const burdenByPool = [...byPool.values()]
    .map((pool) => ({
      ...pool,
      allowable: round(pool.allowable),
      unallowable: round(pool.unallowable)
    }))
    .sort((a, b) => a.poolName.localeCompare(b.poolName));
  const burdenByElement = Object.fromEntries(
    [...subtreeBurden].map(([id, amount]) => [id, round(amount)])
  );

  return {
    rows,
    project,
    serviceOrders,
    serviceActual,
    preproduction,
    burdenByElement,
    projectBurden: round(projectBurden),
    burdenByPool
  };
}

export default function ProjectCostsRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");
  const {
    rows,
    project,
    serviceOrders,
    serviceActual,
    preproduction,
    burdenByElement,
    projectBurden,
    burdenByPool
  } = useLoaderData<typeof loader>();

  return (
    <div className="h-full w-full">
      <ProjectCostsTree
        projectId={projectId}
        rows={rows}
        project={project}
        serviceOrders={serviceOrders}
        serviceActual={serviceActual}
        preproduction={preproduction}
        burdenByElement={burdenByElement}
        projectBurden={projectBurden}
        burdenByPool={burdenByPool}
      />
      <RecordOutlet />
    </div>
  );
}
