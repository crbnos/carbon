// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCopy,
  LuCornerDownRight,
  LuEllipsis,
  LuFolderInput,
  LuMaximize2,
  LuTrash
} from "react-icons/lu";
import { Link, useLocation, useNavigate } from "react-router";
import { EmployeeAvatar, Table } from "~/components";
import { DiffBadge } from "~/components/Diff";
import {
  EditableDate,
  EditableList,
  EditableText,
  useStableEditableComponents
} from "~/components/Editable";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { useCellSave } from "~/components/Setup";
import { useDateFormatter } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type {
  ChangeOperationMark,
  ProjectElementType
} from "../../projects.models";
import { buildElementTree } from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectState } from "../../types";
import {
  changeOperationStatus,
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { StateIcon } from "../Project/StateIcon";
import { sortStates } from "./ElementProperties";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";
import { MoveElementModal } from "./MoveElementModal";

type ElementTableRow = {
  id: string;
  level: number;
  readableId: string;
  name: string;
  type: ProjectElementType;
  stateId: string;
  ownerId: string | null;
  targetDate: string | null;
  startDate: string | null;
  changeOperation?: ChangeOperationMark;
};

type ElementTableProps = {
  projectId: string;
  elements: ProjectElementListItem[];
  states: ProjectState[];
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
  /** True when a filter or the search narrows the rows. */
  isFiltered: boolean;
  /** The element New Element just made: its row is highlighted. */
  highlightId: string | null;
  /** Creates an element; with `parentId`, under that element. */
  onNew: (type?: ProjectElementType, parentId?: string) => void;
};

/**
 * The Table layout: an inline-edit grid of the plan, one row per element in
 * tree order. Name, state, owner and target date edit in place; the id opens
 * the element. New Element adds a row here.
 */
export function ElementTable({
  projectId,
  elements,
  states,
  canUpdate,
  canCreate,
  canDelete,
  isFiltered,
  highlightId,
  onNew
}: ElementTableProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  // Opening an element keeps the layout and filters in the URL.
  const { search } = useLocation();
  const save = useCellSave();
  const changeRequestId = useActiveChangeRequestId();
  const { formatDate } = useDateFormatter();
  const [people] = usePeople();
  const typeLabels = useElementTypeLabels();
  const [moving, setMoving] = useState<ProjectElementListItem | null>(null);
  const [deleting, setDeleting] = useState<ElementTableRow | null>(null);

  const sortedStates = useMemo(() => sortStates(states), [states]);
  const statesById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states]
  );
  const elementsById = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements]
  );

  const rows = useMemo<ElementTableRow[]>(
    () =>
      buildElementTree(elements).map(({ data: element, level }) => ({
        id: element.id,
        level,
        readableId: element.readableId,
        name: element.name,
        type: element.type,
        stateId: element.stateId,
        ownerId: element.ownerId,
        targetDate: element.targetDate,
        startDate: element.startDate,
        changeOperation: (element as { changeOperation?: ChangeOperationMark })
          .changeOperation
      })),
    [elements]
  );

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

  // The text and date editors are built once, so a save's reload never
  // remounts the cell being typed in.
  const stableEditors = useStableEditableComponents(
    (latest) => ({
      name: EditableText<ElementTableRow>((key, value, row) =>
        latest.current.onCellEdit(key, value, row)
      ),
      targetDate: EditableDate<ElementTableRow>(
        (key, value, row) => latest.current.onCellEdit(key, value, row),
        {
          label: t`Target date`,
          clearable: true,
          bounds: (row) => ({ minValue: row.startDate ?? undefined })
        }
      )
    }),
    { onCellEdit }
  );

  // A list editor takes its options when it is built, so it is rebuilt only
  // when the options change (a pick commits at once; nothing is typed).
  const stateOptions = useMemo(
    () => sortedStates.map((state) => ({ value: state.id, label: state.name })),
    [sortedStates]
  );
  const ownerOptions = useMemo(
    () => [
      { value: "", label: t`No owner` },
      ...people.map((person) => ({ value: person.id, label: person.name }))
    ],
    [people, t]
  );
  const latestOnCellEdit = useRef(onCellEdit);
  useEffect(() => {
    latestOnCellEdit.current = onCellEdit;
  });
  const stateKey = stateOptions.map((o) => `${o.value}:${o.label}`).join("|");
  const ownerKey = ownerOptions.map((o) => `${o.value}:${o.label}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the options' content
  const listEditors = useMemo(
    () => ({
      stateId: EditableList<ElementTableRow>(
        (key, value, row) => latestOnCellEdit.current(key, value, row),
        stateOptions
      ),
      ownerId: EditableList<ElementTableRow>(
        (key, value, row) => latestOnCellEdit.current(key, value, row),
        ownerOptions
      )
    }),
    [stateKey, ownerKey]
  );
  const editableComponents = useMemo(
    () => ({ ...stableEditors, ...listEditors }),
    [stableEditors, listEditors]
  );

  const columns = useMemo<ColumnDef<ElementTableRow>[]>(
    () => [
      {
        accessorKey: "readableId",
        header: t`ID`,
        cell: ({ row }) => (
          <div
            className="flex items-center gap-2"
            style={{ paddingLeft: row.original.level * 12 }}
          >
            <ElementTypeIcon type={row.original.type} className="shrink-0" />
            <Link
              to={`${path.to.projectElement(projectId, row.original.id)}${search}`}
              className="whitespace-nowrap font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {row.original.readableId || t`New`}
            </Link>
            {changeOperationStatus(row.original.changeOperation) && (
              <DiffBadge
                status={changeOperationStatus(row.original.changeOperation)!}
              />
            )}
          </div>
        )
      },
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <span className="block max-w-[420px] truncate font-medium">
            {row.original.name}
          </span>
        )
      },
      {
        accessorKey: "type",
        header: t`Type`,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {typeLabels[row.original.type]}
          </span>
        )
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
        accessorKey: "ownerId",
        header: t`Owner`,
        cell: ({ row }) =>
          row.original.ownerId ? (
            <EmployeeAvatar employeeId={row.original.ownerId} size="xxs" />
          ) : null
      },
      {
        accessorKey: "targetDate",
        header: t`Target Date`,
        cell: ({ row }) =>
          row.original.targetDate ? (
            <span className="tabular-nums">
              {formatDate(row.original.targetDate)}
            </span>
          ) : null
      }
    ],
    [t, projectId, search, typeLabels, statesById, formatDate]
  );

  // The row menu reveals on hover or focus, so 40 rows do not show 40
  // buttons.
  const menuColumn = useMemo<ColumnDef<ElementTableRow>>(
    () => ({
      id: "rowMenu",
      header: () => <span className="sr-only">{t`Actions`}</span>,
      size: 48,
      cell: ({ row }) => (
        <div className="flex justify-end opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More options for ${row.original.readableId}`}
                icon={<LuEllipsis />}
                variant="ghost"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() =>
                  navigate(
                    path.to.projectElementFull(projectId, row.original.id)
                  )
                }
              >
                <DropdownMenuIcon icon={<LuMaximize2 />} />
                <Trans>Open</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canCreate || row.original.type === "Parameter"}
                onClick={() => onNew("Task", row.original.id)}
              >
                <DropdownMenuIcon icon={<LuCornerDownRight />} />
                <Trans>Add child</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() =>
                  setMoving(elementsById.get(row.original.id) ?? null)
                }
              >
                <DropdownMenuIcon icon={<LuFolderInput />} />
                <Trans>Move to…</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(row.original.readableId);
                  toast.success(t`Copied ${row.original.readableId}`);
                }}
              >
                <DropdownMenuIcon icon={<LuCopy />} />
                <Trans>Copy id</Trans>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                disabled={!canDelete}
                onClick={() => setDeleting(row.original)}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    }),
    [
      t,
      navigate,
      projectId,
      canCreate,
      canUpdate,
      canDelete,
      elementsById,
      onNew
    ]
  );
  const allColumns = useMemo(
    () => [...columns, menuColumn],
    [columns, menuColumn]
  );

  const getRowClassName = useCallback(
    (row: ElementTableRow) =>
      cn("group/row", row.id === highlightId && "bg-accent/70"),
    [highlightId]
  );

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <Table<ElementTableRow>
        compact
        columns={allColumns}
        data={rows}
        count={rows.length}
        editableComponents={editableComponents}
        withInlineEditing={canUpdate}
        forceEditMode={canUpdate}
        withPagination={false}
        withSearch={false}
        withSimpleSorting={false}
        withSidebarTrigger={false}
        withColumnOrdering={false}
        withCsvExport={false}
        sort={null}
        defaultColumnPinning={{ left: ["readableId"] }}
        getRowClassName={getRowClassName}
        emptyState={
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {isFiltered ? (
              <Trans>No elements match.</Trans>
            ) : (
              <>
                <Trans>No elements yet.</Trans>
                {canCreate && (
                  <Button variant="link" onClick={() => onNew()}>
                    <Trans>New element</Trans>
                  </Button>
                )}
              </>
            )}
          </p>
        }
      />
      {moving && (
        <MoveElementModal
          projectId={projectId}
          element={moving}
          elements={elements}
          onClose={() => setMoving(null)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          action={withChangeRequest(
            path.to.deleteProjectElement(projectId, deleting.id),
            changeRequestId
          )}
          name={deleting.readableId}
          text={t`Delete ${deleting.readableId} and every element below it? An element that has costs, time, a job or a purchase order line cannot be deleted.`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
