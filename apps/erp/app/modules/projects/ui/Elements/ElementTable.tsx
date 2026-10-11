// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router";
import { EmployeeAvatar, Table } from "~/components";
import {
  EditableDate,
  EditableList,
  EditableNumber
} from "~/components/Editable";
import { useCellSave } from "~/components/Setup";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type {
  CostTotals,
  ProjectElementPriority,
  ProjectElementType
} from "../../projects.models";
import {
  buildElementTree,
  projectElementPriorities
} from "../../projects.models";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { StateIcon } from "../Project/StateIcon";
import type { ElementLayoutProps } from "./ElementList";
import type { ElementGrouping } from "./ElementProperties";
import {
  ElementPriorityIcon,
  sortStates,
  usePriorityLabels
} from "./ElementProperties";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";

type ElementTableRow = {
  id: string;
  level: number;
  readableId: string;
  name: string;
  type: ProjectElementType;
  stateId: string;
  priority: ProjectElementPriority;
  ownerId: string | null;
  milestoneId: string | null;
  startDate: string | null;
  targetDate: string | null;
  estimatedHours: number | null;
  budget: number | null;
  actualHours: number;
  committed: number;
  actual: number;
  /** Budget less committed and actual; null when the element has no budget. */
  remaining: number | null;
};

const NO_COST: CostTotals = {
  plan: 0,
  committed: 0,
  actual: 0,
  unallowable: 0,
  hours: 0
};
const DASH = <span className="text-muted-foreground">—</span>;

type ElementTableProps = ElementLayoutProps & {
  /** Plan, committed, actual and hours of each element and its subtree. */
  costByElement: Map<string, CostTotals>;
  grouping: ElementGrouping;
};

export function ElementTable({
  projectId,
  elements,
  states,
  milestones,
  costByElement,
  grouping,
  canUpdate
}: ElementTableProps) {
  const { t } = useLingui();
  // Opening an element keeps the layout and filters in the URL.
  const { search } = useLocation();
  const save = useCellSave();
  const changeRequestId = useActiveChangeRequestId();
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const currencyDecimals = useCurrencyDecimals(currency);
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  const [people] = usePeople();
  const typeLabels = useElementTypeLabels();
  const priorityLabels = usePriorityLabels();

  const sortedStates = useMemo(() => sortStates(states), [states]);
  const statesById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states]
  );
  const milestonesById = useMemo(
    () => new Map(milestones.map((m) => [m.id, m])),
    [milestones]
  );

  const rows = useMemo<ElementTableRow[]>(() => {
    const tree = buildElementTree(elements);
    const treeRows = tree.map(({ data: element, level }) => {
      const cost = costByElement.get(element.id) ?? NO_COST;
      const budget = element.budget === null ? null : Number(element.budget);
      return {
        id: element.id,
        level,
        readableId: element.readableId,
        name: element.name,
        type: element.type,
        stateId: element.stateId,
        priority: element.priority,
        ownerId: element.ownerId,
        milestoneId: element.milestoneId,
        startDate: element.startDate,
        targetDate: element.targetDate,
        estimatedHours:
          element.estimatedHours === null
            ? null
            : Number(element.estimatedHours),
        budget,
        actualHours: cost.hours,
        committed: cost.committed,
        actual: cost.actual,
        remaining:
          budget === null ? null : budget - cost.committed - cost.actual
      };
    });
    if (grouping === "none") return treeRows;

    // Group runs follow the data's order: sort by the group key first. The
    // sort is stable, so each group keeps the tree order. Rows with no owner
    // or no milestone go last.
    const order = (row: ElementTableRow): string | number | null => {
      switch (grouping) {
        case "state":
          return sortedStates.findIndex((s) => s.id === row.stateId);
        case "type":
          return row.type;
        case "owner":
          return row.ownerId;
        case "milestone":
          return row.milestoneId
            ? (milestonesById.get(row.milestoneId)?.name ?? row.milestoneId)
            : null;
      }
    };
    return [...treeRows].sort((a, b) => {
      const x = order(a);
      const y = order(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -1 : 1;
    });
  }, [elements, costByElement, grouping, sortedStates, milestonesById]);

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: ElementTableRow) =>
      save(
        withChangeRequest(
          path.to.projectElementUpdate(projectId),
          changeRequestId
        ),
        {
          ids: row.id,
          field: accessorKey,
          value: value === null || value === undefined ? "" : String(value)
        }
      ),
    [projectId, save, changeRequestId]
  );

  // Each EditableX call returns a NEW component, so rebuilding the editors
  // remounts the open cell and drops what the user is typing (see the
  // planning order grids). The latest save goes through a ref.
  const latestOnCellEdit = useRef(onCellEdit);
  useEffect(() => {
    latestOnCellEdit.current = onCellEdit;
  });
  const stableOnCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: ElementTableRow) =>
      latestOnCellEdit.current(accessorKey, value, row),
    []
  );

  const editableComponents = useMemo(
    () => ({
      stateId: EditableList<ElementTableRow>(
        stableOnCellEdit,
        sortedStates.map((state) => ({ value: state.id, label: state.name }))
      ),
      priority: EditableList<ElementTableRow>(
        stableOnCellEdit,
        projectElementPriorities.map((value) => ({
          value,
          label: priorityLabels[value]
        }))
      ),
      milestoneId: EditableList<ElementTableRow>(stableOnCellEdit, [
        { value: "", label: t`No milestone` },
        ...milestones.map((m) => ({ value: m.id, label: m.name }))
      ]),
      startDate: EditableDate<ElementTableRow>(stableOnCellEdit, {
        label: t`Start date`,
        clearable: true
      }),
      targetDate: EditableDate<ElementTableRow>(stableOnCellEdit, {
        label: t`Target date`,
        clearable: true,
        bounds: (row) => ({ minValue: row.startDate ?? undefined })
      }),
      estimatedHours: EditableNumber<ElementTableRow>(
        stableOnCellEdit,
        {
          minValue: 0,
          step: INPUT_STEP.quantity,
          formatOptions: INPUT_FORMAT.quantity
        },
        { clearable: true }
      ),
      budget: EditableNumber<ElementTableRow>(
        stableOnCellEdit,
        {
          minValue: 0,
          step: INPUT_STEP.money(currencyDecimals),
          formatOptions: INPUT_FORMAT.money(currency, currencyDecimals)
        },
        { clearable: true }
      )
    }),
    [
      stableOnCellEdit,
      sortedStates,
      milestones,
      priorityLabels,
      currency,
      currencyDecimals,
      t
    ]
  );

  const money = useCallback(
    (value: number) => (
      <span className="tabular-nums">{formatMoney.format(value)}</span>
    ),
    [formatMoney]
  );

  const columns = useMemo<ColumnDef<ElementTableRow>[]>(
    () => [
      {
        accessorKey: "readableId",
        header: t`Element`,
        cell: ({ row }) => (
          <div
            className="flex max-w-[360px] items-center gap-2"
            style={{ paddingLeft: row.original.level * 12 }}
          >
            <ElementTypeIcon type={row.original.type} />
            <Link
              to={`${path.to.projectElement(projectId, row.original.id)}${search}`}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                {row.original.readableId}
              </span>
              <span className="truncate font-medium">{row.original.name}</span>
            </Link>
          </div>
        ),
        meta: { exportValue: (row) => `${row.readableId} ${row.name}` }
      },
      {
        accessorKey: "type",
        header: t`Type`,
        cell: ({ row }) => typeLabels[row.original.type]
      },
      {
        accessorKey: "stateId",
        header: t`State`,
        cell: ({ row }) => {
          const state = statesById.get(row.original.stateId);
          return state ? (
            <span className="inline-flex items-center gap-2">
              <StateIcon group={state.group} color={state.color} />
              {state.name}
            </span>
          ) : null;
        },
        meta: {
          exportValue: (row) => statesById.get(row.stateId)?.name ?? ""
        }
      },
      {
        accessorKey: "priority",
        header: t`Priority`,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <ElementPriorityIcon priority={row.original.priority} />
            {priorityLabels[row.original.priority]}
          </span>
        )
      },
      {
        accessorKey: "ownerId",
        header: t`Owner`,
        cell: ({ row }) =>
          row.original.ownerId ? (
            <EmployeeAvatar employeeId={row.original.ownerId} size="xxs" />
          ) : (
            DASH
          ),
        meta: {
          exportValue: (row) =>
            people.find((p) => p.id === row.ownerId)?.name ?? ""
        }
      },
      {
        accessorKey: "milestoneId",
        header: t`Milestone`,
        cell: ({ row }) =>
          row.original.milestoneId
            ? (milestonesById.get(row.original.milestoneId)?.name ?? DASH)
            : DASH,
        meta: {
          exportValue: (row) =>
            row.milestoneId
              ? (milestonesById.get(row.milestoneId)?.name ?? "")
              : ""
        }
      },
      {
        accessorKey: "startDate",
        header: t`Start Date`,
        cell: ({ row }) =>
          row.original.startDate ? (
            <span className="tabular-nums">
              {formatDate(row.original.startDate)}
            </span>
          ) : (
            DASH
          )
      },
      {
        accessorKey: "targetDate",
        header: t`Target Date`,
        cell: ({ row }) =>
          row.original.targetDate ? (
            <span className="tabular-nums">
              {formatDate(row.original.targetDate)}
            </span>
          ) : (
            DASH
          )
      },
      {
        accessorKey: "estimatedHours",
        header: t`Hours Estimated`,
        cell: ({ row }) =>
          row.original.estimatedHours === null ? (
            DASH
          ) : (
            <span className="tabular-nums">
              {formatQuantity(row.original.estimatedHours)}
            </span>
          )
      },
      {
        accessorKey: "actualHours",
        header: t`Hours Actual`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatQuantity(row.original.actualHours)}
          </span>
        )
      },
      {
        accessorKey: "budget",
        header: t`Budget`,
        cell: ({ row }) =>
          row.original.budget === null ? DASH : money(row.original.budget)
      },
      {
        accessorKey: "committed",
        header: t`Committed`,
        cell: ({ row }) => money(row.original.committed)
      },
      {
        accessorKey: "actual",
        header: t`Actual`,
        cell: ({ row }) => money(row.original.actual)
      },
      {
        accessorKey: "remaining",
        header: t`Remaining`,
        cell: ({ row }) =>
          row.original.remaining === null ? (
            DASH
          ) : (
            <span
              className={
                row.original.remaining < 0 ? "text-red-500" : undefined
              }
            >
              {money(row.original.remaining)}
            </span>
          )
      }
    ],
    [
      t,
      projectId,
      search,
      typeLabels,
      priorityLabels,
      statesById,
      milestonesById,
      people,
      formatDate,
      formatQuantity,
      money
    ]
  );

  const groupRowsBy = useMemo(() => {
    if (grouping === "none") return undefined;
    const key = (row: ElementTableRow) => {
      switch (grouping) {
        case "state":
          return row.stateId;
        case "type":
          return row.type;
        case "owner":
          return row.ownerId ?? "";
        case "milestone":
          return row.milestoneId ?? "";
      }
    };
    const header = (group: ElementTableRow[]) => {
      const first = group[0];
      if (!first) return null;
      let label: React.ReactNode;
      switch (grouping) {
        case "state": {
          const state = statesById.get(first.stateId);
          label = state ? (
            <span className="inline-flex items-center gap-2">
              <StateIcon group={state.group} color={state.color} />
              {state.name}
            </span>
          ) : null;
          break;
        }
        case "type":
          label = (
            <span className="inline-flex items-center gap-2">
              <ElementTypeIcon type={first.type} />
              {typeLabels[first.type]}
            </span>
          );
          break;
        case "owner":
          label = first.ownerId ? (
            <EmployeeAvatar employeeId={first.ownerId} size="xxs" />
          ) : (
            <Trans>No owner</Trans>
          );
          break;
        case "milestone":
          label = first.milestoneId ? (
            (milestonesById.get(first.milestoneId)?.name ?? null)
          ) : (
            <Trans>No milestone</Trans>
          );
          break;
      }
      return (
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          {label}
          <span className="text-xs text-muted-foreground tabular-nums">
            {group.length}
          </span>
        </span>
      );
    };
    return { key, header };
  }, [grouping, statesById, milestonesById, typeLabels]);

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <Table<ElementTableRow>
        compact
        columns={columns}
        data={rows}
        count={rows.length}
        editableComponents={editableComponents}
        withInlineEditing={canUpdate}
        forceEditMode={canUpdate}
        withPagination={false}
        withSearch={false}
        withSimpleSorting={false}
        withSidebarTrigger={false}
        sort={null}
        groupRowsBy={groupRowsBy}
        defaultColumnPinning={{ left: ["readableId"] }}
        emptyState={
          <div className="flex h-full w-full items-center justify-center py-16 text-sm text-muted-foreground">
            <Trans>No elements yet</Trans>
          </div>
        }
      />
    </div>
  );
}
