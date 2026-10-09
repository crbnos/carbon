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
import { useMemo, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { EmployeeAvatar } from "~/components";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { usePermissions, useRouteData } from "~/hooks";
import type {
  Project,
  ProjectElementType,
  ProjectLabel,
  ProjectMilestone,
  ProjectState,
  ProjectStateGroup
} from "~/modules/projects";
import {
  getProjectCostSummary,
  getProjectElements,
  projectElementTypes,
  projectStateGroups,
  rollUpCostSummary
} from "~/modules/projects";
import { ElementBoard } from "~/modules/projects/ui/Elements/ElementBoard";
import { ElementList } from "~/modules/projects/ui/Elements/ElementList";
import { useElementDisplay } from "~/modules/projects/ui/Elements/ElementProperties";
import type { ElementLayout } from "~/modules/projects/ui/Elements/ElementsHeader";
import {
  ElementsHeader,
  elementLayouts
} from "~/modules/projects/ui/Elements/ElementsHeader";
import { StateIcon } from "~/modules/projects/ui/Project/StateIcon";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-elements");

/** The values of a `filter=key:eq:a` or `filter=key:in:a,b` search param. */
function filterValues(params: URLSearchParams, key: string): string[] | null {
  for (const filter of params.getAll("filter")) {
    const [column, operator, value] = filter.split(":");
    if (column !== key || !value) continue;
    if (operator === "in") return value.split(",").filter(Boolean);
    if (operator === "eq") return [value];
  }
  return null;
}

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
  const typeParam = searchParams.get("type");
  const type = projectElementTypes.includes(typeParam as ProjectElementType)
    ? (typeParam as ProjectElementType)
    : null;
  const stateGroup = filterValues(searchParams, "stateGroup")?.filter((g) =>
    projectStateGroups.includes(g as ProjectStateGroup)
  ) as ProjectStateGroup[] | undefined;

  const [elements, costSummary] = await Promise.all([
    getProjectElements(client, projectId, companyId, {
      type: type ? [type] : null,
      stateGroup: stateGroup ?? null,
      ownerId: filterValues(searchParams, "ownerId"),
      milestoneId: filterValues(searchParams, "milestoneId"),
      labelId: filterValues(searchParams, "labelId"),
      search: searchParams.get("search")
    }),
    getProjectCostSummary(client, projectId, companyId)
  ]);

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
    layout,
    type
  };
}

export default function ProjectElementsRoute() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const { elements, costSummary, layout, type } =
    useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    project: Project;
    states: ProjectState[];
    labels: ProjectLabel[];
    milestones: ProjectMilestone[];
  }>(path.to.project(projectId));

  const permissions = usePermissions();
  const [people] = usePeople();
  const [display, setDisplayProperty] = useElementDisplay(projectId);
  const [newType, setNewType] = useState<ProjectElementType>("Task");
  const quickAddRef = useRef<HTMLInputElement>(null);

  const states = routeData?.states ?? [];
  const labels = routeData?.labels ?? [];
  const milestones = routeData?.milestones ?? [];
  const isClosed = routeData?.project?.status === "Closed";

  const actualByElement = useMemo(() => {
    const { byElement } = rollUpCostSummary(elements, costSummary);
    return new Map(
      [...byElement.entries()].map(([id, totals]) => [id, totals.actual])
    );
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
        />
        <div className="min-h-0 flex-1">
          {layout === "board" ? (
            <ElementBoard
              {...layoutProps}
              newType={newType}
              onNewTypeChange={setNewType}
              quickAddRef={quickAddRef}
            />
          ) : (
            <ElementList
              {...layoutProps}
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
