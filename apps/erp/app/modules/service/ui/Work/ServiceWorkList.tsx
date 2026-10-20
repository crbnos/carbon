// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { EmployeeAvatar } from "~/components";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import type {
  ProjectElementListItem,
  ProjectElementType,
  ProjectLabel,
  ProjectState,
  ProjectStateGroup
} from "~/modules/projects";
import { projectStateGroups } from "~/modules/projects";
import type { BuildFromPartSource } from "~/modules/projects/projects.models";
import { BuildFromPartDrawer } from "~/modules/projects/ui/Elements/BuildFromPartDrawer";
import { ElementList } from "~/modules/projects/ui/Elements/ElementList";
import { useElementRoutes } from "~/modules/projects/ui/Elements/ElementRoutes";
import { ElementsHeader } from "~/modules/projects/ui/Elements/ElementsHeader";
import {
  ElementTypeIcon,
  useElementTypeLabels
} from "~/modules/projects/ui/Elements/ElementTypeIcon";
import { StateIcon } from "~/modules/projects/ui/Project/StateIcon";
import { usePeople } from "~/stores";
import { serviceNodeTypes } from "../../service.models";

/**
 * A service order's or a service template's work, as the project Plan page's
 * List: one toolbar row (Filter, New Element with Build from part in its
 * menu, and the page's own ⋯ menu), then the elements grouped by state. An
 * element opens on its own page. Wrap it in the work's
 * `ElementRoutesProvider`.
 */
export function ServiceWorkList({
  projectId,
  elements,
  states,
  labels,
  isFiltered,
  isDisabled,
  buildEndpoint,
  buildInitial,
  menu
}: {
  projectId: string;
  elements: ProjectElementListItem[];
  states: ProjectState[];
  labels: ProjectLabel[];
  isFiltered: boolean;
  /** The work cannot change: no permission, or the order is closed. */
  isDisabled: boolean;
  /** Build from part's preview and build route; none, no Build from part. */
  buildEndpoint?: string;
  /** The source Build from part starts from (the order's unit). */
  buildInitial?: {
    source: BuildFromPartSource;
    itemId?: string | null;
    trackedEntityId?: string | null;
  };
  /** The page's ⋯ menu (Print estimate). */
  menu?: ReactNode;
}) {
  const { t } = useLingui();
  const routes = useElementRoutes(projectId);
  const [people] = usePeople();
  const typeLabels = useElementTypeLabels();
  const [buildingFromPart, setBuildingFromPart] = useState(false);

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
        isExclusive: true,
        options: serviceNodeTypes.map((value) => ({
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

  // New Element adds a row with a default name, as on the Plan page; the
  // name is edited on the element's page.
  const newNames: Partial<Record<ProjectElementType, string>> = {
    System: t`New System`,
    Task: t`New Task`
  };
  const [createdId, setCreatedId] = useState<string | null>(null);
  const createFetcher = useAction<{
    id?: string;
    error?: { message: string };
  }>({
    onSuccess: (data) => {
      if (data.id) setCreatedId(data.id);
    },
    onError: (data) =>
      toast.error(data.error?.message ?? t`Failed to create the element`)
  });
  const createElement = (
    elementType: ProjectElementType = "Task",
    parentId?: string,
    stateId?: string
  ) => {
    if (createFetcher.isPending) return;
    const formData = new FormData();
    formData.append("type", elementType);
    formData.append("name", newNames[elementType] ?? t`New Task`);
    if (parentId) formData.append("parentId", parentId);
    if (stateId) formData.append("stateId", stateId);
    createFetcher.submit(formData, { method: "post", action: routes.create });
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      <ElementsHeader
        layout="list"
        layouts={["list"]}
        types={serviceNodeTypes}
        filters={filters}
        onNew={(elementType) => createElement(elementType)}
        onBuildFromPart={
          buildEndpoint ? () => setBuildingFromPart(true) : undefined
        }
        canCreate={!isDisabled}
        isCreating={createFetcher.isPending}
        menu={menu}
      />
      <div className="min-h-0 flex-1">
        <ElementList
          projectId={projectId}
          elements={elements}
          states={states}
          labels={labels}
          requirementStatus={{}}
          canUpdate={!isDisabled}
          canCreate={!isDisabled}
          canDelete={!isDisabled}
          isFiltered={isFiltered}
          highlightId={createdId}
          types={serviceNodeTypes}
          onNew={createElement}
        />
      </div>
      {buildingFromPart && buildEndpoint && (
        <BuildFromPartDrawer
          projectId={projectId}
          elements={elements}
          defaultParentId={null}
          endpoint={buildEndpoint}
          initial={buildInitial}
          onClose={() => setBuildingFromPart(false)}
        />
      )}
    </div>
  );
}
