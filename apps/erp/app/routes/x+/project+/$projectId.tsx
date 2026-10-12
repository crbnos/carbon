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
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLocation, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout";
import type { ProjectElementListItem } from "~/modules/projects";
import {
  getContractBillingLines,
  getProject,
  getProjectBorrows,
  getProjectChangeRequests,
  getProjectElements,
  getProjectLabels,
  getProjectMilestones,
  getProjectStates,
  getProjectSwitcherOptions,
  openChangeRequestStatuses
} from "~/modules/projects";
import type { ChangeRequestOverlay } from "~/modules/projects/projects.server";
import {
  getProjectCapitalAssets,
  loadChangeRequestOverlay,
  overlayElementList
} from "~/modules/projects/projects.server";
import type { ProjectTreeElement } from "~/modules/projects/ui/Project/ProjectElementTree";
import ProjectHeader from "~/modules/projects/ui/Project/ProjectHeader";
import { ProjectSidebar } from "~/modules/projects/ui/Project/ProjectSidebar";
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

  const [
    project,
    states,
    labels,
    milestones,
    overdueBorrows,
    elements,
    switcherOptions,
    changeRequests,
    planningGroups,
    billingLines,
    stockRows,
    pegRows
  ] = await Promise.all([
    getProject(client, companyId, projectId),
    getProjectStates(client, companyId),
    getProjectLabels(client, companyId),
    getProjectMilestones(client, projectId, companyId),
    // The Open borrows the project owes or has lent, past their payback
    // date: the header's exception badge.
    getProjectBorrows(client, companyId, {
      projectId,
      status: ["Open"],
      dueBefore: today
    }),
    // The sidebar (the element tree, the change request picker) and the
    // header's project switcher.
    getProjectElements(client, projectId, companyId),
    getProjectSwitcherOptions(client, companyId),
    getProjectChangeRequests(client, projectId, companyId),
    // Planning group fields show only to a company that has a group.
    client
      .from("planningGroup")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId),
    // Billing shows under Costs only while a contract line bills the project.
    getContractBillingLines(client, { companyId, projectId }),
    // Stock and Pegging show under Costs only once the project has project
    // stock (an item ledger row of its own) or a current peg (Layer 5).
    client
      .from("itemLedger")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("projectId", projectId),
    client
      .from("projectPeg")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("projectId", projectId)
      .is("supersededAt", null)
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

  for (const [what, result] of [
    ["elements", elements],
    ["switcher projects", switcherOptions],
    ["change requests", changeRequests],
    ["planning groups", planningGroups],
    ["contract billing lines", billingLines],
    ["stock", stockRows],
    ["pegs", pegRows]
  ] as const) {
    if (result.error) {
      logger.error("Failed to load a part of the project", {
        what,
        companyId,
        projectId,
        error: result.error
      });
    }
  }

  // `?cr=` shows the plan as the open change request would leave it, in the
  // sidebar's tree as on the Plan page.
  let elementRows: ProjectElementListItem[] = elements.data ?? [];
  let activeChangeRequest: ChangeRequestOverlay["changeRequest"] | null = null;
  const changeRequestId = new URL(request.url).searchParams.get("cr");
  if (changeRequestId) {
    const overlay = await loadChangeRequestOverlay(getDatabaseClient(), {
      companyId,
      projectId,
      changeRequestId
    });
    if (overlay) {
      activeChangeRequest = overlay.changeRequest;
      elementRows = await overlayElementList(client, overlay, elementRows, {
        companyId,
        projectId
      });
    }
  }
  const treeElements: ProjectTreeElement[] = elementRows.map((element) => ({
    id: element.id,
    parentId: element.parentId,
    sortOrder: element.sortOrder,
    readableId: element.readableId,
    name: element.name,
    type: element.type
  }));

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
    milestones: milestones.data ?? [],
    treeElements,
    switcherOptions: switcherOptions.data ?? [],
    openChangeRequests: (changeRequests.data ?? [])
      .filter((cr) =>
        (openChangeRequestStatuses as readonly string[]).includes(cr.status)
      )
      .map((cr) => ({
        id: cr.id,
        readableId: cr.readableId,
        title: cr.title,
        status: cr.status
      })),
    activeChangeRequest,
    hasPlanningGroups: (planningGroups.count ?? 0) > 0,
    hasControlAccount: (elements.data ?? []).some(
      (element) => element.isControlAccount
    ),
    hasBillingLines:
      project.data.costTreatment === "Contract" &&
      (billingLines.data ?? []).length > 0,
    hasProjectStock: (stockRows.count ?? 0) > 0,
    hasPegs: (pegRows.count ?? 0) > 0
  };
}

export default function ProjectRoute() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");
  // An element opens on its own full-width page: no project header and no
  // project sidebar there.
  const { pathname } = useLocation();
  const isElementPage = pathname.startsWith(
    `${path.to.project(projectId)}/element/`
  );

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        {isElementPage ? (
          // The element page draws its own one header row (back, the
          // breadcrumb, copy, ⋯); the topbar breadcrumb names the project.
          <div className="bg-card min-h-0 flex-1 overflow-hidden w-full">
            <RecordOutlet />
          </div>
        ) : (
          <>
            <ProjectHeader key={projectId} />
            <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
              <div className="flex flex-grow overflow-hidden">
                <ResizablePanels
                  explorerLabel={t`Project`}
                  explorer={<ProjectSidebar />}
                  content={
                    <div className="bg-card h-full overflow-y-auto w-full">
                      <RecordOutlet />
                    </div>
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    </PanelProvider>
  );
}
