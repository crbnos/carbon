// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import {
  getEarnedValue,
  getEarnedValueSnapshots
} from "@carbon/ee/project-control.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { datetime, round } from "@carbon/utils";
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
import type {
  EarnedValueData,
  EarnedValuePeriodOption
} from "~/modules/projects/ui/Costs/ProjectEarnedValue.ee";
import ProjectEarnedValue from "~/modules/projects/ui/Costs/ProjectEarnedValue.ee";
import type { ServiceOrderCostRow } from "~/modules/projects/ui/Costs/ServiceOrderCosts";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";

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

  const earnedValue = await loadEarnedValue({
    request,
    client,
    companyId,
    projectId,
    hasControlAccount: elementRows.some((element) => element.isControlAccount)
  });

  return {
    earnedValue,
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

/**
 * Earned value for the Costs tab (Government Contracting 5c). `?evPeriod`
 * is `current` (live, as of today on the company's calendar) or the id of a
 * Closed accounting period (its frozen snapshot). Null when the project has
 * no control account.
 */
async function loadEarnedValue(args: {
  request: Request;
  client: Parameters<typeof getEarnedValueSnapshots>[0];
  companyId: string;
  projectId: string;
  hasControlAccount: boolean;
}): Promise<EarnedValueData | null> {
  const { request, client, companyId, projectId, hasControlAccount } = args;
  // Layer 5: earned value shows only on a project with a control account,
  // and only then does a company without the feature see its upgrade row.
  if (!hasControlAccount) return null;
  if (
    !(await companyHasFeature(client, companyId, {
      feature: "GOVERNMENT_CONTRACTING"
    }))
  ) {
    return { gated: true };
  }

  const periodId = new URL(request.url).searchParams.get("evPeriod");
  const closedPeriods = await client
    .from("accountingPeriod")
    .select("id, startDate, endDate, fiscalYear, periodNumber")
    .eq("companyId", companyId)
    .eq("closeStatus", "Closed")
    .order("startDate", { ascending: false });
  if (closedPeriods.error) {
    logger.error("Failed to load the closed accounting periods", {
      companyId,
      error: closedPeriods.error
    });
  }
  const periods: EarnedValuePeriodOption[] = closedPeriods.data ?? [];
  const period =
    periodId && periodId !== "current"
      ? (periods.find((p) => p.id === periodId) ?? null)
      : null;

  try {
    if (period) {
      const snapshot = await getEarnedValueSnapshots(client, {
        companyId,
        projectId,
        accountingPeriodId: period.id
      });
      return { gated: false, periodId: period.id, periods, ...snapshot };
    }
    const asOf = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();
    const live = await getEarnedValue(getDatabaseClient(), client, {
      companyId,
      projectId,
      asOf
    });
    if (live.gated) return { gated: true };
    const { gated: _, ...values } = live;
    return { gated: false, periodId: null, periods, ...values };
  } catch (err) {
    logger.error("Failed to load the project's earned value", {
      companyId,
      projectId,
      error: err
    });
    return {
      gated: false,
      periodId: period?.id ?? null,
      periods,
      workPackages: [],
      controlAccounts: [],
      warnings: ["Earned value could not be loaded."]
    };
  }
}

export default function ProjectCostsRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");
  const {
    earnedValue,
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
        footer={
          earnedValue ? (
            <ProjectEarnedValue projectId={projectId} data={earnedValue} />
          ) : null
        }
      />
      <RecordOutlet />
    </div>
  );
}
