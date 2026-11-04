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
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  LuChevronRight,
  LuCopy,
  LuCornerDownRight,
  LuEllipsis,
  LuFolderInput,
  LuPlus,
  LuTrash
} from "react-icons/lu";
import { Link, useLocation } from "react-router";
import { DiffBadge } from "~/components/Diff";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import type {
  ChangeOperationMark,
  ProjectElementType,
  RequirementStatus
} from "../../projects.models";
import {
  buildElementTree,
  type ElementWbsCode,
  projectElementTypes
} from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectLabel, ProjectState } from "../../types";
import {
  changeOperationStatus,
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { StateIcon } from "../Project/StateIcon";
import {
  DatePill,
  OwnerPill,
  StatePill,
  sortStates
} from "./ElementProperties";
import { useElementRoutes } from "./ElementRoutes";
import { ElementTypeIcon, useElementTypeLabels } from "./ElementTypeIcon";
import { MoveElementModal } from "./MoveElementModal";
import { VerificationIcon } from "./VerificationStatus";
import { WbsCode } from "./WbsCode";

type ListElement = ProjectElementListItem & {
  changeOperation?: ChangeOperationMark;
};

type ElementListProps = {
  projectId: string;
  elements: ListElement[];
  /** Each element's WBS code, or null while the project pins none. */
  wbsCodes?: Record<string, ElementWbsCode> | null;
  states: ProjectState[];
  labels: ProjectLabel[];
  requirementStatus: Record<string, RequirementStatus>;
  canUpdate: boolean;
  canCreate: boolean;
  canDelete: boolean;
  /** True when a filter or the search narrows the rows. */
  isFiltered: boolean;
  /** The element New Element just made: its row is highlighted. */
  highlightId: string | null;
  /** The types the empty list's New element offers; every type by default. */
  types?: readonly ProjectElementType[];
  /** Opens New element; with `parentId` under it, with `stateId` in it. */
  onNew: (
    type?: ProjectElementType,
    parentId?: string,
    stateId?: string
  ) => void;
};

/**
 * The List layout: the plan grouped by state, Linear's list. A row opens the
 * element's page. Only the state, the owner and the target date edit in
 * place, each through its picker; every other field is edited on the page.
 */
export function ElementList({
  projectId,
  elements,
  wbsCodes,
  states,
  labels,
  requirementStatus,
  canUpdate,
  canCreate,
  canDelete,
  isFiltered,
  highlightId,
  types = projectElementTypes,
  onNew
}: ElementListProps) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  const { search } = useLocation();
  const routes = useElementRoutes(projectId);
  const changeRequestId = useActiveChangeRequestId();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<ProjectElementListItem | null>(null);
  const [deleting, setDeleting] = useState<ListElement | null>(null);

  // One group per state, in state-group order. Inside a group the rows keep
  // tree order; a row is indented only under a parent in the same group.
  const groups = useMemo(() => {
    const tree = buildElementTree(elements);
    const stateOf = new Map(elements.map((e) => [e.id, e.stateId]));
    const depth = new Map<string, number>();
    const rowsByState = new Map<
      string,
      { element: ListElement; level: number }[]
    >();
    for (const { data: element, parentId } of tree) {
      const sameGroup = !!parentId && stateOf.get(parentId) === element.stateId;
      const level = sameGroup ? (depth.get(parentId) ?? 0) + 1 : 0;
      depth.set(element.id, level);
      const rows = rowsByState.get(element.stateId) ?? [];
      rows.push({ element, level });
      rowsByState.set(element.stateId, rows);
    }
    return sortStates(states)
      .map((state) => ({ state, rows: rowsByState.get(state.id) ?? [] }))
      .filter((group) => group.rows.length > 0);
  }, [elements, states]);

  const idChars = useMemo(
    () => Math.max(0, ...elements.map((e) => e.readableId.length)),
    [elements]
  );
  const wbsChars = useMemo(
    () =>
      wbsCodes
        ? Math.max(0, ...Object.values(wbsCodes).map((w) => w.code.length))
        : 0,
    [wbsCodes]
  );

  const labelsById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels]
  );

  useEffect(() => {
    if (!highlightId) return;
    document
      .querySelector(`[data-element-row="${highlightId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightId]);

  const toggle = (stateId: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(stateId)) next.delete(stateId);
      else next.add(stateId);
      return next;
    });

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-start justify-center pt-16">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {isFiltered ? (
            <Trans>No elements match.</Trans>
          ) : (
            <>
              <Trans>No elements yet.</Trans>
              {canCreate && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="link">
                      <Trans>New element</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {types.map((value) => (
                      <DropdownMenuItem
                        key={value}
                        onClick={() => onNew(value)}
                      >
                        <DropdownMenuIcon
                          icon={<ElementTypeIcon type={value} />}
                        />
                        {typeLabels[value]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {groups.map(({ state, rows }) => {
        const isOpen = !collapsed.has(state.id);
        return (
          <section key={state.id} aria-label={state.name}>
            <div className="group/header sticky top-0 z-20 flex h-9 items-center gap-2 bg-muted/50 px-4 backdrop-blur-sm">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(state.id)}
                className="-ml-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <StateIcon group={state.group} color={state.color} />
                <span className="truncate">{state.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {rows.length}
                </span>
              </button>
              {canCreate && (
                <IconButton
                  aria-label={t`New element in ${state.name}`}
                  icon={<LuPlus />}
                  variant="ghost"
                  size="sm"
                  className="ml-auto opacity-0 transition-opacity focus-visible:opacity-100 group-hover/header:opacity-100"
                  onClick={() => onNew("Task", undefined, state.id)}
                />
              )}
            </div>
            {isOpen &&
              rows.map(({ element, level }) => (
                <ElementRow
                  key={element.id}
                  projectId={projectId}
                  element={element}
                  level={level}
                  states={states}
                  labelsById={labelsById}
                  requirementStatus={requirementStatus[element.id]}
                  href={`${routes.element(element.id)}${search}`}
                  isHighlighted={element.id === highlightId}
                  canUpdate={canUpdate}
                  idChars={idChars}
                  wbs={wbsCodes?.[element.id]}
                  wbsChars={wbsChars}
                  menu={
                    <ElementRowMenu
                      readableId={element.readableId}
                      href={routes.element(element.id)}
                      canAddChild={canCreate && element.type !== "Parameter"}
                      canMove={canUpdate}
                      canDelete={canDelete}
                      onAddChild={() => onNew("Task", element.id)}
                      onMove={() => setMoving(element)}
                      onDelete={() => setDeleting(element)}
                    />
                  }
                />
              ))}
          </section>
        );
      })}
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
            routes.remove(deleting.id),
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

type ElementRowProps = {
  projectId: string;
  element: Pick<
    ListElement,
    | "id"
    | "readableId"
    | "name"
    | "type"
    | "stateId"
    | "ownerId"
    | "targetDate"
    | "labels"
    | "changeOperation"
  >;
  /** The indent, in steps of one level. */
  level?: number;
  states: ProjectState[];
  labelsById: Map<string, ProjectLabel>;
  requirementStatus?: RequirementStatus;
  /** Where a click on the row goes: the element's page. */
  href: string;
  isHighlighted?: boolean;
  canUpdate: boolean;
  /** The row's ⋯ menu, shown on hover. */
  menu?: ReactNode;
  /** The id's minimum width in characters: the longest id in the list, so
   *  the names line up while the cluster stays tight. */
  idChars?: number;
  /** The element's WBS code, when the project uses a contract WBS. */
  wbs?: ElementWbsCode;
  wbsChars?: number;
  className?: string;
};

/**
 * One element as a list row: the type, the id, the state and the name on the
 * left; the owner, the labels, the target date and a Requirement's
 * verification on the right, each only when set. The state, the owner and
 * the date open their pickers; a click anywhere else opens the element.
 */
export function ElementRow({
  projectId,
  element,
  level = 0,
  states,
  labelsById,
  requirementStatus,
  href,
  isHighlighted,
  canUpdate,
  menu,
  idChars,
  wbs,
  wbsChars,
  className
}: ElementRowProps) {
  const state = states.find((s) => s.id === element.stateId);
  const isComplete =
    state?.group === "Completed" || state?.group === "Cancelled";
  const rowLabels = (element.labels ?? [])
    .map((label) => labelsById.get(label.projectLabelId))
    .filter((label): label is ProjectLabel => !!label);
  const status = changeOperationStatus(element.changeOperation);
  // An unset property shows a placeholder only while the row is hovered.
  const onHover =
    "opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100";

  return (
    <div
      data-element-row={element.id}
      className={cn(
        "group/row relative flex h-9 items-center gap-3 px-4 transition-colors hover:bg-accent/50",
        isHighlighted && "bg-accent/70",
        className
      )}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        style={{ paddingLeft: level * 20 }}
      >
        <ElementTypeIcon
          type={element.type}
          className="size-3.5 text-muted-foreground"
        />
        <span
          className="shrink-0 whitespace-nowrap text-sm text-muted-foreground tabular-nums"
          style={idChars ? { minWidth: `${idChars}ch` } : undefined}
        >
          {element.readableId}
        </span>
        {wbs && <WbsCode wbs={wbs} minChars={wbsChars} />}
        {/* The picker's 24 px square, pulled in so the icon sits 8 px from
            its neighbours like the rest of the cluster. */}
        <span className="relative z-10 -mx-[5px] flex">
          <StatePill
            projectId={projectId}
            elementId={element.id}
            stateId={element.stateId}
            states={states}
            variant="icon"
            isDisabled={!canUpdate}
          />
        </span>
        <Link
          to={href}
          className="min-w-0 truncate text-sm before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:before:ring-1 focus-visible:before:ring-inset focus-visible:before:ring-ring"
        >
          {element.name}
        </Link>
        {status && (
          <span className="relative z-10 flex shrink-0">
            <DiffBadge status={status} />
          </span>
        )}
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1.5">
        {rowLabels.length > 0 && <LabelChip labels={rowLabels} />}
        {element.type === "Requirement" && (
          <VerificationIcon status={requirementStatus} />
        )}
        {(element.targetDate || canUpdate) && (
          <span className={cn("flex", !element.targetDate && onHover)}>
            <DatePill
              projectId={projectId}
              elementId={element.id}
              field="targetDate"
              date={element.targetDate}
              isComplete={isComplete}
              variant="plain"
              isDisabled={!canUpdate}
            />
          </span>
        )}
        {(element.ownerId || canUpdate) && (
          <span className={cn("flex", !element.ownerId && onHover)}>
            <OwnerPill
              projectId={projectId}
              elementId={element.id}
              ownerId={element.ownerId}
              variant="icon"
              isDisabled={!canUpdate}
            />
          </span>
        )}
        {menu && <span className={cn("flex", onHover)}>{menu}</span>}
      </div>
    </div>
  );
}

/** The labels of a row, read-only: "● Name", or "● N labels" for several. */
function LabelChip({ labels }: { labels: ProjectLabel[] }) {
  const names = labels.map((label) => label.name).join(", ");
  return (
    <span
      title={names}
      className="inline-flex h-6 max-w-[12rem] shrink-0 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground"
    >
      <span className="flex -space-x-0.5">
        {labels.slice(0, 3).map((label) => (
          <span
            key={label.id}
            aria-hidden
            className="size-2 shrink-0 rounded-full ring-1 ring-background"
            style={{ backgroundColor: label.color }}
          />
        ))}
      </span>
      <span className="truncate">
        {labels.length === 1 ? (
          labels[0].name
        ) : (
          <Plural value={labels.length} one="# label" other="# labels" />
        )}
      </span>
    </span>
  );
}

/** The ⋯ menu of a row: Open, Add child, Move to…, Copy id, Delete. */
export function ElementRowMenu({
  readableId,
  href,
  canAddChild,
  canMove,
  canDelete,
  onAddChild,
  onMove,
  onDelete
}: {
  readableId: string;
  href: string;
  canAddChild: boolean;
  canMove: boolean;
  canDelete: boolean;
  onAddChild: () => void;
  onMove?: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t`More options for ${readableId}`}
          icon={<LuEllipsis />}
          variant="ghost"
          size="sm"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link to={href}>
            <DropdownMenuIcon icon={<LuChevronRight />} />
            <Trans>Open</Trans>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canAddChild} onClick={onAddChild}>
          <DropdownMenuIcon icon={<LuCornerDownRight />} />
          <Trans>Add child</Trans>
        </DropdownMenuItem>
        {onMove && (
          <DropdownMenuItem disabled={!canMove} onClick={onMove}>
            <DropdownMenuIcon icon={<LuFolderInput />} />
            <Trans>Move to…</Trans>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => {
            navigator.clipboard.writeText(readableId);
            toast.success(t`Copied ${readableId}`);
          }}
        >
          <DropdownMenuIcon icon={<LuCopy />} />
          <Trans>Copy id</Trans>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={!canDelete} onClick={onDelete}>
          <DropdownMenuIcon icon={<LuTrash />} />
          <Trans>Delete</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
