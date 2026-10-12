// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  RecordOutlet,
  ResizablePanel,
  ResizablePanelGroup
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import XYFlowStyle from "@xyflow/react/dist/style.css?url";
import { useMemo, useRef, useState } from "react";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { useLoaderData, useLocation, useParams } from "react-router";
import { EmployeeAvatar } from "~/components";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { usePermissions, useRouteData } from "~/hooks";
import type {
  ChangeOperationMark,
  Project,
  ProjectElementLink,
  ProjectElementListItem,
  ProjectElementType,
  ProjectLabel,
  ProjectMilestone,
  ProjectState,
  ProjectStateGroup,
  VerificationElement
} from "~/modules/projects";
import {
  canonicalElementsParams,
  elementLayoutFromParams,
  getProjectCostSummary,
  getProjectElementCommentCounts,
  getProjectElementDescriptions,
  getProjectElements,
  isProjectPlanLocked,
  parseElementFilters,
  projectElementTypes,
  projectPlanLockedMessage,
  projectStateGroups,
  rollUpCostSummary
} from "~/modules/projects";
import type { ChangeRequestOverlay } from "~/modules/projects/projects.server";
import {
  getProjectVerification,
  loadChangeRequestOverlay,
  overlayElementList,
  overlayLinkList
} from "~/modules/projects/projects.server";
import ChangeRequestBanner from "~/modules/projects/ui/ChangeRequests/ChangeRequestBanner";
import { BuildFromPartDrawer } from "~/modules/projects/ui/Elements/BuildFromPartDrawer";
import { ElementGraph } from "~/modules/projects/ui/Elements/ElementGraph";
import { QuickAddRow } from "~/modules/projects/ui/Elements/ElementList";
import { resolveElementDisplay } from "~/modules/projects/ui/Elements/ElementProperties";
import { ElementReader } from "~/modules/projects/ui/Elements/ElementReader";
import { ElementsHeader } from "~/modules/projects/ui/Elements/ElementsHeader";
import { ElementTable } from "~/modules/projects/ui/Elements/ElementTable";
import {
  ElementTypeIcon,
  useElementTypeLabels
} from "~/modules/projects/ui/Elements/ElementTypeIcon";
import { StateIcon } from "~/modules/projects/ui/Project/StateIcon";
import { getDatabaseClient } from "~/services/database.server";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-elements");

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: XYFlowStyle }
];

/** Every element property shows in the Table; there is no Display menu. */
const display = resolveElementDisplay({});

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate
}) => {
  // `root` changes only what the Tree layout draws: skip the reload.
  if (!formMethod && currentUrl.pathname === nextUrl.pathname) {
    const withoutRoot = (url: URL) => {
      const params = new URLSearchParams(url.search);
      params.delete("root");
      params.sort();
      return params.toString();
    };
    if (
      currentUrl.search !== nextUrl.search &&
      withoutRoot(currentUrl) === withoutRoot(nextUrl)
    ) {
      return false;
    }
  }
  return defaultShouldRevalidate;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const url = new URL(request.url);
  const searchParams = url.searchParams;

  // The page always has a layout in its URL. A URL with none, a retired one
  // (List, Board, Timeline) or the old `?type=` param redirects to the Table
  // or the Type filter, keeping every other param (`cr` included).
  const canonical = canonicalElementsParams(searchParams);
  if (canonical) throw redirect(`${url.pathname}?${canonical}`);

  const layout = elementLayoutFromParams(searchParams) ?? "table";
  const { filters: elementFilters, type } = parseElementFilters(searchParams);
  // The Tree layout applies the type filter on the canvas, so it loads every
  // type: a box must still show the parent of a matching card.
  const queryFilters =
    layout === "tree" ? { ...elementFilters, type: null } : elementFilters;
  const isQueryFiltered = Object.values(queryFilters).some(
    (value) => value !== null
  );

  const [elements, costSummary, descriptions, commentCounts] =
    await Promise.all([
      getProjectElements(client, projectId, companyId, queryFilters),
      getProjectCostSummary(client, projectId, companyId),
      // Only the Reader shows descriptions; the list query leaves them out.
      layout === "reader"
        ? getProjectElementDescriptions(client, projectId, companyId)
        : Promise.resolve({ data: [], error: null }),
      // Only the Tree's cards show comment counts.
      layout === "tree"
        ? getProjectElementCommentCounts(client, projectId, companyId)
        : Promise.resolve({ data: [], error: null })
    ]);
  if (descriptions.error) {
    logger.error("Failed to load element descriptions", {
      companyId,
      projectId,
      error: descriptions.error
    });
  }
  if (commentCounts.error) {
    logger.error("Failed to load element comment counts", {
      companyId,
      projectId,
      error: commentCounts.error
    });
  }

  if (elements.error) {
    logger.error("Failed to load project elements", {
      companyId,
      projectId,
      error: elements.error
    });
    throw redirect(
      path.to.projects,
      await flash(request, error(elements.error, "Failed to load elements"))
    );
  }
  // Verification reads every element: a filter could hide an input.
  const verification = await getProjectVerification(client, {
    companyId,
    projectId,
    elements: isQueryFiltered
      ? undefined
      : ((elements.data ?? []) as VerificationElement[])
  });
  if (verification.error) {
    logger.error("Failed to load project verification", {
      companyId,
      projectId,
      error: verification.error
    });
  }

  if (costSummary.error) {
    logger.error("Failed to load project cost summary", {
      companyId,
      projectId,
      error: costSummary.error
    });
  }

  // `?cr=` shows the plan as an open change request would leave it. Each row
  // carries its `changeOperation`, so the layouts can badge it.
  let elementRows: (ProjectElementListItem & {
    changeOperation?: ChangeOperationMark;
  })[] = elements.data ?? [];
  let linkRows: (ProjectElementLink & {
    changeOperation?: ChangeOperationMark;
  })[] = verification.data?.links ?? [];
  let changeRequest: ChangeRequestOverlay["changeRequest"] | null = null;
  const changeRequestId = searchParams.get("cr");
  if (changeRequestId) {
    const overlay = await loadChangeRequestOverlay(getDatabaseClient(), {
      companyId,
      projectId,
      changeRequestId
    });
    if (!overlay) {
      throw redirect(
        path.to.projectElements(projectId),
        await flash(request, error(null, "The change request does not exist"))
      );
    }
    changeRequest = overlay.changeRequest;
    elementRows = await overlayElementList(client, overlay, elementRows, {
      companyId,
      projectId
    });
    linkRows = overlayLinkList(overlay, linkRows);
  }

  return {
    elements: elementRows,
    changeRequest,
    costSummary: costSummary.data ?? [],
    links: linkRows,
    requirementStatus: verification.data?.requirementStatus ?? {},
    verification: verification.data?.verification ?? {},
    descriptions: Object.fromEntries(
      (descriptions.data ?? []).map((row) => [row.id, row.description])
    ),
    commentCounts: Object.fromEntries(
      (commentCounts.data ?? []).map((row) => [row.id, row.count])
    ) as Record<string, number>,
    layout,
    type
  };
}

export default function ProjectElementsRoute() {
  const { t } = useLingui();
  const { projectId, elementId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");
  const [buildingFromPart, setBuildingFromPart] = useState(false);

  const {
    elements,
    changeRequest,
    costSummary,
    links,
    requirementStatus,
    verification,
    descriptions,
    commentCounts,
    layout,
    type
  } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    project: Project;
    states: ProjectState[];
    labels: ProjectLabel[];
    milestones: ProjectMilestone[];
  }>(path.to.project(projectId));

  const permissions = usePermissions();
  const { search } = useLocation();
  const [people] = usePeople();
  const typeLabels = useElementTypeLabels();

  const [newType, setNewType] = useState<ProjectElementType>("Task");
  const quickAddRef = useRef<HTMLInputElement>(null);

  const states = routeData?.states ?? [];
  const labels = routeData?.labels ?? [];
  const milestones = routeData?.milestones ?? [];
  const isClosed = routeData?.project?.status === "Closed";

  const { costByElement, actualByElement } = useMemo(() => {
    const { byElement } = rollUpCostSummary(elements, costSummary);
    return {
      costByElement: byElement,
      actualByElement: new Map(
        [...byElement.entries()].map(([id, totals]) => [id, totals.actual])
      )
    };
  }, [elements, costSummary]);

  const groupLabels: Record<ProjectStateGroup, string> = {
    Backlog: t`Backlog`,
    Unstarted: t`Unstarted`,
    Started: t`Started`,
    Completed: t`Completed`,
    Cancelled: t`Cancelled`
  };
  const groupColor = (group: ProjectStateGroup) =>
    states.find((s) => s.group === group && s.isDefault)?.color ??
    states.find((s) => s.group === group)?.color ??
    "currentColor";

  const filters: ColumnFilter[] = [
    {
      accessorKey: "type",
      header: t`Type`,
      pluralHeader: t`Types`,
      filter: {
        type: "static",
        // One type at a time: the Tree layout uses it as a lens.
        isExclusive: true,
        options: projectElementTypes.map((value) => ({
          value,
          label: (
            <span className="inline-flex items-center gap-2">
              <ElementTypeIcon type={value} className="size-3.5" />
              {typeLabels[value]}
            </span>
          )
        }))
      }
    },
    {
      accessorKey: "stateGroup",
      header: t`State`,
      pluralHeader: t`States`,
      filter: {
        type: "static",
        options: projectStateGroups.map((group) => ({
          value: group,
          label: (
            <span className="inline-flex items-center gap-2">
              <StateIcon group={group} color={groupColor(group)} />
              {groupLabels[group]}
            </span>
          )
        }))
      }
    },
    {
      accessorKey: "ownerId",
      header: t`Owner`,
      pluralHeader: t`Owners`,
      filter: {
        type: "static",
        options: people.map((person) => ({
          value: person.id,
          label: <EmployeeAvatar employeeId={person.id} size="xxs" />
        }))
      }
    },
    {
      accessorKey: "milestoneId",
      header: t`Milestone`,
      pluralHeader: t`Milestones`,
      filter: {
        type: "static",
        options: milestones.map((m) => ({ value: m.id, label: m.name }))
      }
    },
    {
      accessorKey: "labelId",
      header: t`Label`,
      pluralHeader: t`Labels`,
      filter: {
        type: "static",
        options: labels.map((label) => ({
          value: label.id,
          label: (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
            </span>
          )
        }))
      }
    }
  ];

  const focusQuickAdd = (next?: ProjectElementType) => {
    if (next) setNewType(next);
    // The input may mount in this render (an empty project shows it too).
    requestAnimationFrame(() => quickAddRef.current?.focus());
  };

  // After the lock milestone completes, the plan changes only through a
  // Draft change request: no create or delete in the live plan.
  const lockMilestone = milestones.find(
    (milestone) => milestone.id === routeData?.project?.lockPlanAfterMilestoneId
  );
  const planLocked =
    isProjectPlanLocked({ lockMilestone }) && changeRequest?.status !== "Draft";

  const layoutProps = {
    projectId,
    identifier: routeData?.project?.identifier ?? "",
    elements,
    states,
    labels,
    milestones,
    display,
    actualByElement,
    canUpdate: permissions.can("update", "projects") && !isClosed,
    canCreate:
      permissions.can("create", "projects") && !isClosed && !planLocked,
    canDelete: permissions.can("delete", "projects") && !isClosed && !planLocked
  };

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel
        defaultSize={50}
        minSize={30}
        className="flex h-full min-w-0 flex-col bg-card"
      >
        {changeRequest && (
          <ChangeRequestBanner
            projectId={projectId}
            changeRequest={changeRequest}
          />
        )}
        <ElementsHeader
          count={
            layout === "tree" && type
              ? elements.filter((element) => element.type === type).length
              : elements.length
          }
          layout={layout}
          filters={filters}
          onNew={focusQuickAdd}
          onBuildFromPart={() => setBuildingFromPart(true)}
          canCreate={layoutProps.canCreate}
          exportHref={
            layout === "reader"
              ? `${path.to.file.projectReader(projectId)}${search}`
              : undefined
          }
          planLock={
            planLocked && lockMilestone
              ? {
                  message: projectPlanLockedMessage(lockMilestone.name),
                  changeRequestsHref: path.to.projectChangeRequests(projectId)
                }
              : null
          }
        />
        <div className="min-h-0 flex-1">
          {layout === "table" ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                <ElementTable
                  {...layoutProps}
                  costByElement={costByElement}
                  grouping="none"
                />
              </div>
              {layoutProps.canCreate && (
                <QuickAddRow
                  projectId={projectId}
                  identifier={layoutProps.identifier}
                  type={newType}
                  onTypeChange={setNewType}
                  inputRef={quickAddRef}
                />
              )}
            </div>
          ) : layout === "tree" ? (
            <ElementGraph
              projectId={projectId}
              projectName={routeData?.project?.name ?? ""}
              elements={elements}
              type={type}
              links={links}
              requirementStatus={requirementStatus}
              commentCounts={commentCounts}
              canUpdate={layoutProps.canUpdate}
            />
          ) : (
            <ElementReader
              projectId={projectId}
              elements={elements}
              descriptions={descriptions}
              verification={verification}
              requirementStatus={requirementStatus}
            />
          )}
        </div>
      </ResizablePanel>
      <RecordOutlet />
      {buildingFromPart && (
        <BuildFromPartDrawer
          projectId={projectId}
          elements={elements}
          defaultParentId={elementId ?? null}
          onClose={() => setBuildingFromPart(false)}
        />
      )}
    </ResizablePanelGroup>
  );
}
