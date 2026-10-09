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
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useLocation, useParams } from "react-router";
import { EmployeeAvatar } from "~/components";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { usePermissions, useRouteData } from "~/hooks";
import type {
  Project,
  ProjectElementType,
  ProjectLabel,
  ProjectMilestone,
  ProjectState,
  ProjectStateGroup,
  VerificationElement
} from "~/modules/projects";
import {
  getProjectCostSummary,
  getProjectElementDescriptions,
  getProjectElements,
  parseElementFilters,
  projectStateGroups,
  rollUpCostSummary
} from "~/modules/projects";
import { getProjectVerification } from "~/modules/projects/projects.server";
import { ElementBoard } from "~/modules/projects/ui/Elements/ElementBoard";
import { ElementGraph } from "~/modules/projects/ui/Elements/ElementGraph";
import {
  ElementList,
  QuickAddRow
} from "~/modules/projects/ui/Elements/ElementList";
import {
  useElementDisplay,
  useElementGrouping
} from "~/modules/projects/ui/Elements/ElementProperties";
import { ElementReader } from "~/modules/projects/ui/Elements/ElementReader";
import type { ElementLayout } from "~/modules/projects/ui/Elements/ElementsHeader";
import {
  ElementsHeader,
  elementLayouts
} from "~/modules/projects/ui/Elements/ElementsHeader";
import { ElementTable } from "~/modules/projects/ui/Elements/ElementTable";
import { ElementTimeline } from "~/modules/projects/ui/Elements/ElementTimeline";
import { StateIcon } from "~/modules/projects/ui/Project/StateIcon";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-elements");

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: XYFlowStyle }
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const searchParams = new URL(request.url).searchParams;
  const layoutParam = searchParams.get("layout");
  const layout: ElementLayout = elementLayouts.includes(
    layoutParam as ElementLayout
  )
    ? (layoutParam as ElementLayout)
    : "list";
  const {
    filters: elementFilters,
    type,
    isFiltered
  } = parseElementFilters(searchParams);

  const [elements, costSummary, descriptions] = await Promise.all([
    getProjectElements(client, projectId, companyId, elementFilters),
    getProjectCostSummary(client, projectId, companyId),
    // Only the Reader shows descriptions; the list query leaves them out.
    layout === "reader"
      ? getProjectElementDescriptions(client, projectId, companyId)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (descriptions.error) {
    logger.error("Failed to load element descriptions", {
      companyId,
      projectId,
      error: descriptions.error
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
    elements: isFiltered
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

  return {
    elements: elements.data ?? [],
    costSummary: costSummary.data ?? [],
    links: verification.data?.links ?? [],
    requirementStatus: verification.data?.requirementStatus ?? {},
    verification: verification.data?.verification ?? {},
    descriptions: Object.fromEntries(
      (descriptions.data ?? []).map((row) => [row.id, row.description])
    ),
    layout,
    type
  };
}

export default function ProjectElementsRoute() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const {
    elements,
    costSummary,
    links,
    requirementStatus,
    verification,
    descriptions,
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
  const [display, setDisplayProperty] = useElementDisplay(projectId);
  const [newType, setNewType] = useState<ProjectElementType>("Task");
  const quickAddRef = useRef<HTMLInputElement>(null);

  const states = routeData?.states ?? [];
  const labels = routeData?.labels ?? [];
  const milestones = routeData?.milestones ?? [];
  const isClosed = routeData?.project?.status === "Closed";

  const [grouping, setGrouping] = useElementGrouping(projectId);
  const { costByElement, actualByElement } = useMemo(() => {
    const { byElement } = rollUpCostSummary(elements, costSummary);
    return {
      costByElement: byElement,
      actualByElement: new Map(
        [...byElement.entries()].map(([id, totals]) => [id, totals.actual])
      )
    };
  }, [elements, costSummary]);

  // An element with a suspect link at either end shows the amber triangle.
  const suspectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const link of links) {
      if (!link.suspectSince) continue;
      ids.add(link.fromElementId);
      ids.add(link.toElementId);
    }
    return ids;
  }, [links]);

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
    canCreate: permissions.can("create", "projects") && !isClosed,
    canDelete: permissions.can("delete", "projects") && !isClosed
  };

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel
        defaultSize={50}
        minSize={30}
        className="flex h-full min-w-0 flex-col bg-card"
      >
        <ElementsHeader
          count={elements.length}
          layout={layout}
          type={type}
          filters={filters}
          display={display}
          onDisplayChange={setDisplayProperty}
          onNew={focusQuickAdd}
          canCreate={layoutProps.canCreate}
          exportHref={
            layout === "reader"
              ? `${path.to.file.projectReader(projectId)}${search}`
              : undefined
          }
          grouping={layout === "table" ? grouping : undefined}
          onGroupingChange={layout === "table" ? setGrouping : undefined}
        />
        <div className="min-h-0 flex-1">
          {layout === "table" ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                <ElementTable
                  {...layoutProps}
                  costByElement={costByElement}
                  grouping={grouping}
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
              elements={elements}
              links={links}
              requirementStatus={requirementStatus}
              canUpdate={layoutProps.canUpdate}
            />
          ) : layout === "reader" ? (
            <ElementReader
              projectId={projectId}
              elements={elements}
              descriptions={descriptions}
              verification={verification}
              requirementStatus={requirementStatus}
            />
          ) : layout === "timeline" ? (
            <ElementTimeline
              projectId={projectId}
              elements={elements}
              links={links}
            />
          ) : layout === "board" ? (
            <ElementBoard
              {...layoutProps}
              newType={newType}
              onNewTypeChange={setNewType}
              quickAddRef={quickAddRef}
            />
          ) : (
            <ElementList
              {...layoutProps}
              requirementStatus={requirementStatus}
              suspectIds={suspectIds}
              newType={newType}
              onNewTypeChange={setNewType}
              quickAddRef={quickAddRef}
              onCreateFirst={() => focusQuickAdd()}
            />
          )}
        </div>
      </ResizablePanel>
      <RecordOutlet />
    </ResizablePanelGroup>
  );
}
