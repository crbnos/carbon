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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedTooltipText
} from "@carbon/react";
import type { AssemblyStep, SubAssemblyInfo } from "@carbon/viewer";
import {
  buildSubAssemblyPlan,
  displayOrder,
  subAssemblyPartIds,
  validateSubAssemblies
} from "@carbon/viewer";
import type {
  Announcements,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
  UniqueIdentifier
} from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  LuArrowLeft,
  LuBoxes,
  LuChevronDown,
  LuCornerLeftUp,
  LuEllipsisVertical,
  LuFolderInput,
  LuGripVertical,
  LuHand,
  LuSquareArrowOutUpRight,
  LuTrash,
  LuTriangleAlert,
  LuUngroup
} from "react-icons/lu";
import { useFetcher, useParams, useSearchParams } from "react-router";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  assemblyStepStatuses,
  hasCustomMotion,
  stepPlanWarningsSchema
} from "../../production.models";
import type { AssemblyInstructionStepRow } from "../../types";
import type { AssemblyStepStatusValue } from "./AssemblyStepStatus";
import {
  AssemblyStepStatusIcon,
  normalizeStepStatus,
  useStepStatusLabel
} from "./AssemblyStepStatus";

// Module constants: a new options object makes a new sensor, and with it new
// listeners for every draggable on every render.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };

/** The search param that opens a sub-assembly: the list and player show only its steps. */
export const SUB_ASSEMBLY_PARAM = "subAssembly";

/** Horizontal drag distance (px) that moves a step one level in or out. */
const INDENT = 24;
const DROP_ZONE_PREFIX = "drop:";

type StepLink = { id: string; parentStepId: string | null };
type Row = { stepId: string; depth: 0 | 1 };

// Up/Down reorder like any sortable list; Left/Right move a step out of or
// into the sub-assembly it sits next to (same as dragging sideways).
const coordinateGetter: KeyboardCoordinateGetter = (event, args) => {
  if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
    event.preventDefault();
    const shift = event.code === "ArrowRight" ? INDENT : -INDENT;
    return {
      ...args.currentCoordinates,
      x: args.currentCoordinates.x + shift
    };
  }
  return sortableKeyboardCoordinates(event, args);
};

/** Display rows (header above its members) → stored play order (members before their header). */
function toPlayOrder(rows: Row[], isHeader: (id: string) => boolean) {
  const order: StepLink[] = [];
  let header: string | null = null;
  let members: StepLink[] = [];
  const flush = () => {
    if (header) order.push(...members, { id: header, parentStepId: null });
    header = null;
    members = [];
  };
  for (const row of rows) {
    if (row.depth === 1 && header) {
      members.push({ id: row.stepId, parentStepId: header });
      continue;
    }
    flush();
    if (isHeader(row.stepId)) {
      header = row.stepId;
    } else {
      order.push({ id: row.stepId, parentStepId: null });
    }
  }
  flush();
  return order;
}

/** Index just past a header's last member in `rows` (the header's own index + 1 when empty). */
function groupEnd(rows: Row[], headerIndex: number) {
  let end = headerIndex + 1;
  while (end < rows.length && rows[end].depth === 1) end += 1;
  return end;
}

type AssemblyStepListProps = {
  steps: AssemblyInstructionStepRow[];
  viewerStepMap: Map<string, AssemblyStep>;
  stepTitles: Map<string, string>;
  /** Lower-cased search needle; empty = not searching */
  search: string;
  searchText: Map<string, string>;
  selectedStepId: string | null;
  isDisabled: boolean;
  onSelectStep: (stepId: string) => void;
  onPreviewStep: (stepId: string) => void;
  onDeleteStep: (step: AssemblyInstructionStepRow) => void;
};

export default function AssemblyStepList({
  steps,
  viewerStepMap,
  stepTitles,
  search,
  searchText,
  selectedStepId,
  isDisabled,
  onSelectStep,
  onPreviewStep,
  onDeleteStep
}: AssemblyStepListProps) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { t } = useLingui();

  const sortOrderFetcher = useFetcher<{ success: boolean }>();
  const subAssemblyFetcher = useFetcher<{ success: boolean; id?: string }>();
  const ungroupFetcher = useFetcher<{ success: boolean }>();
  // One structural change at a time: each is saved from the list's current
  // order, so starting another before it lands would build on a stale one.
  const isSaving =
    sortOrderFetcher.state !== "idle" ||
    subAssemblyFetcher.state !== "idle" ||
    ungroupFetcher.state !== "idle";

  const isSearching = search.length > 0;
  const canDrag = !isDisabled && !isSearching && !isSaving;

  const [order, setOrder] = useState<StepLink[]>(() =>
    steps.map((step) => ({ id: step.id, parentStepId: step.parentStepId }))
  );

  useEffect(() => {
    setOrder((prev) => {
      const next = steps.map((step) => ({
        id: step.id,
        parentStepId: step.parentStepId
      }));
      const prevIds = new Set(prev.map((link) => link.id));
      const sameSet =
        prev.length === next.length &&
        next.every((link) => prevIds.has(link.id));
      if (sameSet) {
        // Until a move's save lands, the server list still has the old
        // order; keep the local one so the move doesn't snap back.
        if (sortOrderFetcher.state !== "idle") return prev;
        const same = next.every(
          (link, i) =>
            prev[i].id === link.id && prev[i].parentStepId === link.parentStepId
        );
        return same ? prev : next;
      }
      // Steps added or removed — resync to the server list.
      return next;
    });
  }, [steps, sortOrderFetcher.state]);

  // Select a sub-assembly right after "Make Sub-Assembly" creates it, so it
  // can be named in Properties.
  useEffect(() => {
    if (subAssemblyFetcher.data?.success && subAssemblyFetcher.data.id) {
      onSelectStep(subAssemblyFetcher.data.id);
    }
  }, [subAssemblyFetcher.data, onSelectStep]);

  const structureFor = useCallback(
    (links: StepLink[]) =>
      links.flatMap(({ id: stepId, parentStepId }) => {
        const step = viewerStepMap.get(stepId);
        return step ? [{ ...step, parentStepId }] : [];
      }),
    [viewerStepMap]
  );
  const structure = useMemo(() => structureFor(order), [structureFor, order]);
  const plan = useMemo(() => buildSubAssemblyPlan(structure), [structure]);
  const rows = useMemo(() => displayOrder(structure), [structure]);

  const isHeader = useCallback(
    (stepId: string) => plan.get(stepId)?.isHeader === true,
    [plan]
  );
  const partCountByHeader = useMemo(() => {
    const counts = new Map<string, number>();
    for (const step of structure) {
      if (plan.get(step.id)?.isHeader) {
        counts.set(step.id, subAssemblyPartIds(structure, step.id).length);
      }
    }
    return counts;
  }, [structure, plan]);
  const headers = useMemo(
    () => rows.filter((row) => isHeader(row.stepId)).map((row) => row.stepId),
    [rows, isHeader]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedOpen = searchParams.get(SUB_ASSEMBLY_PARAM);
  const openHeaderId =
    requestedOpen && isHeader(requestedOpen) ? requestedOpen : null;

  const setOpenHeader = useCallback(
    (headerId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (headerId) {
            next.set(SUB_ASSEMBLY_PARAM, headerId);
          } else {
            next.delete(SUB_ASSEMBLY_PARAM);
          }
          return next;
        },
        { preventScrollReset: true }
      );
    },
    [setSearchParams]
  );

  // A stale ?subAssembly= (ungrouped, deleted) falls back to all steps.
  useEffect(() => {
    if (requestedOpen && !openHeaderId && steps.length > 0) {
      setOpenHeader(null);
    }
  }, [requestedOpen, openHeaderId, steps.length, setOpenHeader]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  const activeIsHeader = activeId ? isHeader(activeId) : false;

  const visibleRows = useMemo(() => {
    if (openHeaderId) {
      return rows.filter(
        (row) =>
          row.depth === 1 && plan.get(row.stepId)?.headerId === openHeaderId
      );
    }
    if (isSearching) {
      return rows.filter((row) => searchText.get(row.stepId)?.includes(search));
    }
    return rows.filter((row) => {
      if (row.depth === 0) return true;
      const headerId = plan.get(row.stepId)?.headerId;
      if (!headerId) return true;
      // A dragged sub-assembly moves as one block: its steps travel with it.
      if (activeIsHeader && headerId === activeId) return false;
      return !collapsed.has(headerId);
    });
  }, [
    rows,
    plan,
    openHeaderId,
    isSearching,
    search,
    searchText,
    collapsed,
    activeIsHeader,
    activeId
  ]);
  const visibleIds = useMemo(
    () => visibleRows.map((row) => row.stepId),
    [visibleRows]
  );
  const rowById = useMemo(
    () => new Map(rows.map((row) => [row.stepId, row])),
    [rows]
  );
  const stepById = useMemo(
    () => new Map(steps.map((step) => [step.id, step])),
    [steps]
  );

  // Saved right away: a drop (or menu move) is one discrete change.
  const saveOrder = (links: StepLink[]) => {
    const updates: Record<
      string,
      { sortOrder: number; parentStepId: string | null }
    > = {};
    links.forEach((link, index) => {
      updates[link.id] = {
        sortOrder: index + 1,
        parentStepId: link.parentStepId
      };
    });
    const formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    sortOrderFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstructionStepOrder(id)
    });
  };

  /** Apply new display rows if they keep the sub-assembly rules; false = refused. */
  const commitRows = (nextRows: Row[]) => {
    const nextOrder = toPlayOrder(nextRows, isHeader);
    if (validateSubAssemblies(structureFor(nextOrder)).length > 0) return false;
    setOrder(nextOrder);
    saveOrder(nextOrder);
    return true;
  };

  /** Take a row (and a header's steps) out of `rows`. */
  const extract = (stepId: string) => {
    const index = rows.findIndex((row) => row.stepId === stepId);
    if (index < 0) return null;
    const end = isHeader(stepId) ? groupEnd(rows, index) : index + 1;
    const block = rows.slice(index, end);
    const rest = [...rows.slice(0, index), ...rows.slice(end)];
    return { block, rest };
  };

  const moveInto = (stepId: string, headerId: string) => {
    const taken = extract(stepId);
    if (!taken) return;
    const headerIndex = taken.rest.findIndex((row) => row.stepId === headerId);
    if (headerIndex < 0) return;
    const at = groupEnd(taken.rest, headerIndex);
    commitRows([
      ...taken.rest.slice(0, at),
      { stepId, depth: 1 },
      ...taken.rest.slice(at)
    ]);
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(headerId);
      return next;
    });
  };

  const moveOut = (stepId: string) => {
    const headerId = plan.get(stepId)?.headerId;
    const taken = extract(stepId);
    if (!taken || !headerId) return;
    const headerIndex = taken.rest.findIndex((row) => row.stepId === headerId);
    if (headerIndex < 0) return;
    const at = groupEnd(taken.rest, headerIndex);
    commitRows([
      ...taken.rest.slice(0, at),
      { stepId, depth: 0 },
      ...taken.rest.slice(at)
    ]);
  };

  const makeSubAssembly = (stepId: string) => {
    const formData = new FormData();
    formData.append("stepId", stepId);
    subAssemblyFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblySubAssemblyNew(id)
    });
  };

  const ungroup = (headerId: string) => {
    if (openHeaderId === headerId) setOpenHeader(null);
    ungroupFetcher.submit(new FormData(), {
      method: "post",
      action: path.to.assemblySubAssemblyUngroup(id, headerId)
    });
  };
  const [headerToDelete, setHeaderToDelete] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)
  );

  /**
   * Where the dragged row would land: its depth (top level or inside a
   * sub-assembly) from the rows it would sit between and how far it was
   * dragged sideways. `null` = not a place it can go.
   */
  const projection = useMemo(() => {
    if (!activeId || !overId) return null;
    if (overId.startsWith(DROP_ZONE_PREFIX)) {
      if (activeIsHeader) return null;
      return {
        kind: "zone" as const,
        headerId: overId.slice(DROP_ZONE_PREFIX.length)
      };
    }
    const from = visibleIds.indexOf(activeId);
    const to = visibleIds.indexOf(overId);
    if (from < 0 || to < 0) return null;
    const moved = arrayMove(visibleIds, from, to);
    const prev = to > 0 ? rowById.get(moved[to - 1]) : undefined;
    const next = rowById.get(moved[to + 1] ?? "");
    const nextIsMember = next?.depth === 1;

    if (openHeaderId) {
      return { kind: "row" as const, moved, depth: 1 as const };
    }
    if (activeIsHeader) {
      return nextIsMember
        ? null
        : { kind: "row" as const, moved, depth: 0 as const };
    }
    const prevOpenHeader =
      prev && isHeader(prev.stepId) && !collapsed.has(prev.stepId);
    const maxDepth = prevOpenHeader || prev?.depth === 1 ? 1 : 0;
    const minDepth = nextIsMember ? 1 : 0;
    const current = rowById.get(activeId)?.depth ?? 0;
    const wanted = current + Math.round(offsetX / INDENT);
    const depth = Math.max(minDepth, Math.min(maxDepth, wanted)) as 0 | 1;
    return { kind: "row" as const, moved, depth };
  }, [
    activeId,
    overId,
    offsetX,
    visibleIds,
    rowById,
    activeIsHeader,
    openHeaderId,
    isHeader,
    collapsed
  ]);

  const rowsForDrop = (): Row[] | null => {
    if (!activeId || !projection) return null;
    const taken = extract(activeId);
    if (!taken) return null;
    const { block, rest } = taken;

    if (projection.kind === "zone") {
      const headerIndex = rest.findIndex(
        (row) => row.stepId === projection.headerId
      );
      if (headerIndex < 0) return null;
      const at = groupEnd(rest, headerIndex);
      return [
        ...rest.slice(0, at),
        { stepId: activeId, depth: 1 },
        ...rest.slice(at)
      ];
    }

    const to = projection.moved.indexOf(activeId);
    const anchorId = to > 0 ? projection.moved[to - 1] : null;
    let at = 0;
    if (anchorId) {
      const anchorIndex = rest.findIndex((row) => row.stepId === anchorId);
      if (anchorIndex < 0) return null;
      // After a sub-assembly: inside it (first step) only when dropped one
      // level in; otherwise after all of its steps.
      at =
        isHeader(anchorId) && projection.depth === 0
          ? groupEnd(rest, anchorIndex)
          : anchorIndex + 1;
    } else if (openHeaderId) {
      at = rest.findIndex((row) => row.stepId === openHeaderId) + 1;
    }
    const placed: Row[] = isHeader(activeId)
      ? block
      : [{ stepId: activeId, depth: projection.depth }];
    return [...rest.slice(0, at), ...placed, ...rest.slice(at)];
  };

  const resetDrag = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setOverId(String(active.id));
  };
  const onDragMove = ({ delta }: DragMoveEvent) => setOffsetX(delta.x);
  const onDragOver = ({ over }: DragOverEvent) =>
    setOverId(over ? String(over.id) : null);
  const onDragEnd = (_event: DragEndEvent) => {
    const nextRows = rowsForDrop();
    resetDrag();
    if (!nextRows) return;
    const unchanged =
      nextRows.length === rows.length &&
      nextRows.every(
        (row, i) => row.stepId === rows[i].stepId && row.depth === rows[i].depth
      );
    if (!unchanged) commitRows(nextRows);
  };

  const plainTitle = (stepId: UniqueIdentifier) => {
    const key = String(stepId);
    if (key.startsWith(DROP_ZONE_PREFIX)) {
      const headerId = key.slice(DROP_ZONE_PREFIX.length);
      return t`inside ${stepTitles.get(headerId) ?? ""}`;
    }
    const number = plan.get(key)?.number ?? "";
    return `${number} ${stepTitles.get(key) ?? ""}`.trim();
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => t`Picked up step ${plainTitle(active.id)}`,
    onDragOver: ({ active, over }) =>
      over
        ? t`Step ${plainTitle(active.id)} is over ${plainTitle(over.id)}`
        : t`Step ${plainTitle(active.id)} is no longer over a drop position`,
    onDragEnd: ({ active, over }) =>
      over
        ? t`Step ${plainTitle(active.id)} was dropped at ${plainTitle(over.id)}`
        : t`Step ${plainTitle(active.id)} was dropped`,
    onDragCancel: ({ active }) =>
      t`Moving step ${plainTitle(active.id)} was cancelled`
  };

  const openInfo = openHeaderId ? plan.get(openHeaderId) : null;
  const openTitle = openHeaderId ? (stepTitles.get(openHeaderId) ?? "") : "";

  const depthFor = (row: Row) =>
    row.stepId === activeId && projection?.kind === "row"
      ? projection.depth
      : row.depth;

  const renderRow = (row: Row) => {
    const step = stepById.get(row.stepId);
    const info = plan.get(row.stepId);
    if (!step || !info) return null;
    const common = {
      step,
      info,
      title: stepTitles.get(step.id) ?? "",
      isDisabled,
      isBusy: isSaving,
      canDrag,
      isSelected: step.id === selectedStepId,
      onSelect: () => onSelectStep(step.id)
    };
    if (info.isHeader) {
      const usedIn = viewerStepMap.get(step.id)?.usedInStepId;
      const isCollapsed = collapsed.has(step.id);
      return (
        <SubAssemblyRow
          key={step.id}
          {...common}
          usedInNumber={usedIn ? (plan.get(usedIn)?.number ?? null) : null}
          partCount={partCountByHeader.get(step.id) ?? 0}
          isCollapsed={isCollapsed}
          onToggle={() =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (isCollapsed) next.delete(step.id);
              else next.add(step.id);
              return next;
            })
          }
          onOpen={() => setOpenHeader(step.id)}
          onUngroup={() => ungroup(step.id)}
          onDelete={() => setHeaderToDelete(step.id)}
        />
      );
    }
    return (
      <StepRow
        key={step.id}
        {...common}
        depth={openHeaderId ? 0 : depthFor(row)}
        uses={info.carriesIn.map((headerId) => ({
          headerId,
          number: plan.get(headerId)?.number ?? "",
          title: stepTitles.get(headerId) ?? ""
        }))}
        headers={headers.map((headerId) => ({
          headerId,
          label: `${plan.get(headerId)?.number ?? ""} · ${
            stepTitles.get(headerId) ?? ""
          }`,
          isOwn: info.headerId === headerId
        }))}
        onPreview={() => onPreviewStep(step.id)}
        onSelectHeader={onSelectStep}
        onMakeSubAssembly={() => makeSubAssembly(step.id)}
        onMoveInto={(headerId) => moveInto(step.id, headerId)}
        onMoveOut={() => moveOut(step.id)}
        onDelete={() => onDeleteStep(step)}
      />
    );
  };

  const emptyZone = (headerId: string) => (
    <SubAssemblyDropZone
      key={`${DROP_ZONE_PREFIX}${headerId}`}
      headerId={headerId}
      isDisabled={!canDrag || activeIsHeader}
    />
  );

  const listRows: ReactNode[] = [];
  for (const row of visibleRows) {
    listRows.push(renderRow(row));
    const info = plan.get(row.stepId);
    if (
      !openHeaderId &&
      !isSearching &&
      info?.isHeader &&
      !collapsed.has(row.stepId) &&
      !rows.some(
        (other) =>
          other.depth === 1 && plan.get(other.stepId)?.headerId === row.stepId
      )
    ) {
      listRows.push(emptyZone(row.stepId));
    }
  }
  if (openHeaderId && visibleRows.length === 0) {
    listRows.push(emptyZone(openHeaderId));
  }

  const activeRow = activeId ? rowById.get(activeId) : null;

  return (
    <>
      {openHeaderId && openInfo && (
        <div className="flex w-full flex-none items-center gap-2 border-b border-border px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<LuArrowLeft />}
            onClick={() => {
              onSelectStep(openHeaderId);
              setOpenHeader(null);
            }}
          >
            <Trans>All steps</Trans>
          </Button>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            <Trans>
              Sub-Assembly {openInfo.number} · {openTitle}
            </Trans>
          </span>
        </div>
      )}
      <DndContext
        sensors={sensors}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={resetDrag}
      >
        <SortableContext
          items={visibleIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="w-full">{listRows}</div>
        </SortableContext>
        {typeof document !== "undefined" &&
          createPortal(
            <DragOverlay dropAnimation={null}>
              {activeRow ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-md">
                  <LuGripVertical className="size-3.5 text-muted-foreground" />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {plan.get(activeRow.stepId)?.number}
                  </span>
                  {isHeader(activeRow.stepId) && (
                    <LuBoxes className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="truncate">
                    {stepTitles.get(activeRow.stepId)}
                  </span>
                </div>
              ) : null}
            </DragOverlay>,
            document.body
          )}
      </DndContext>
      {steps.length > 0 && isSearching && visibleRows.length === 0 && (
        <p className="w-full px-4 py-3 text-center text-xs text-muted-foreground">
          <Trans>No steps match "{search}"</Trans>
        </p>
      )}
      {headerToDelete && (
        <ConfirmDelete
          action={path.to.assemblySubAssemblyDelete(id, headerToDelete)}
          name={stepTitles.get(headerToDelete) ?? t`Sub-Assembly`}
          text={t`Delete this sub-assembly and all of its steps? This cannot be undone.`}
          onCancel={() => setHeaderToDelete(null)}
          onSubmit={() => {
            if (openHeaderId === headerToDelete) setOpenHeader(null);
            setHeaderToDelete(null);
          }}
        />
      )}
    </>
  );
}

/** Where an empty sub-assembly takes its first step. */
function SubAssemblyDropZone({
  headerId,
  isDisabled
}: {
  headerId: string;
  isDisabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${DROP_ZONE_PREFIX}${headerId}`,
    disabled: isDisabled
  });
  return (
    <div className="relative border-b border-border py-2 pl-6 pr-2.5">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-[17px] w-px bg-border"
      />
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-md border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground",
          isOver && "border-primary bg-primary/5 text-foreground"
        )}
      >
        <Trans>Drag steps here to build them on their own.</Trans>
      </div>
    </div>
  );
}

type RowBaseProps = {
  step: AssemblyInstructionStepRow;
  info: SubAssemblyInfo;
  title: string;
  isDisabled: boolean;
  /** A structural change is saving; moves wait for it. */
  isBusy: boolean;
  canDrag: boolean;
  isSelected: boolean;
  onSelect: () => void;
};

function useRowSortable(stepId: string, canDrag: boolean) {
  const sortable = useSortable({ id: stepId, disabled: !canDrag });
  return {
    ...sortable,
    style: {
      transform: CSS.Translate.toString(sortable.transform),
      transition: sortable.transition
    }
  };
}

function DragHandle({
  canDrag,
  sortable
}: {
  canDrag: boolean;
  sortable: ReturnType<typeof useRowSortable>;
}) {
  const { t } = useLingui();
  return (
    <IconButton
      ref={sortable.setActivatorNodeRef}
      aria-label={t`Drag handle`}
      icon={<LuGripVertical />}
      variant="ghost"
      size="sm"
      disabled={!canDrag}
      className="size-6 shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
      onClick={(e) => e.stopPropagation()}
      {...sortable.attributes}
      {...sortable.listeners}
    />
  );
}

function SubAssemblyRow({
  step,
  info,
  title,
  isDisabled,
  isBusy,
  canDrag,
  isSelected,
  onSelect,
  usedInNumber,
  partCount,
  isCollapsed,
  onToggle,
  onOpen,
  onUngroup,
  onDelete
}: RowBaseProps & {
  usedInNumber: string | null;
  partCount: number;
  isCollapsed: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const sortable = useRowSortable(step.id, canDrag);
  const name = title || t`Sub-Assembly`;

  return (
    <div
      ref={sortable.setNodeRef}
      style={sortable.style}
      className={cn(
        "group relative flex w-full cursor-pointer select-none items-center gap-1.5 border-b border-border bg-card py-2.5 pl-1.5 pr-2.5 hover:bg-accent/30",
        isSelected && "bg-accent/40 hover:bg-accent/40",
        sortable.isDragging && "opacity-40"
      )}
      onClick={onSelect}
      onDoubleClick={onOpen}
      title={t`Double-click to open this sub-assembly`}
    >
      {isSelected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-primary"
        />
      )}
      <DragHandle canDrag={canDrag} sortable={sortable} />
      <IconButton
        aria-label={isCollapsed ? t`Expand ${name}` : t`Collapse ${name}`}
        aria-expanded={!isCollapsed}
        icon={
          <LuChevronDown
            className={cn(
              "transition-transform duration-150",
              isCollapsed && "-rotate-90"
            )}
          />
        }
        variant="ghost"
        size="sm"
        className="size-5 shrink-0 text-muted-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      />
      <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">
        {info.number}
      </span>
      <LuBoxes className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <TruncatedTooltipText
          tooltip={name}
          className="block w-full truncate text-sm font-medium text-foreground"
        >
          {name}
        </TruncatedTooltipText>
        <span className="block w-full truncate text-xs text-muted-foreground">
          {usedInNumber
            ? t`Sub-Assembly · used in ${usedInNumber}`
            : t`Sub-Assembly · joins main build`}
        </span>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        ×{partCount}
      </span>
      <StepStatusControl
        stepId={step.id}
        status={normalizeStepStatus(step.status)}
        isDisabled={isDisabled}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={t`More options`}
            size="sm"
            variant="ghost"
            className="size-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
            icon={<LuEllipsisVertical />}
            onClick={(e) => e.stopPropagation()}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={onOpen}>
            <DropdownMenuIcon icon={<LuSquareArrowOutUpRight />} />
            <Trans>Open Sub-Assembly</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isDisabled || isBusy} onClick={onUngroup}>
            <DropdownMenuIcon icon={<LuUngroup />} />
            <Trans>Ungroup</Trans>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            shortcut={MENU_ITEM_SHORTCUTS.delete}
            destructive
            disabled={isDisabled || !permissions.can("delete", "production")}
            onClick={onDelete}
          >
            <DropdownMenuIcon icon={<LuTrash />} />
            <Trans>Delete Sub-Assembly</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function StepRow({
  step,
  info,
  title,
  isDisabled,
  isBusy,
  canDrag,
  isSelected,
  onSelect,
  depth,
  uses,
  headers,
  onPreview,
  onSelectHeader,
  onMakeSubAssembly,
  onMoveInto,
  onMoveOut,
  onDelete
}: RowBaseProps & {
  depth: 0 | 1;
  uses: { headerId: string; number: string; title: string }[];
  headers: { headerId: string; label: string; isOwn: boolean }[];
  onPreview: () => void;
  onSelectHeader: (headerId: string) => void;
  onMakeSubAssembly: () => void;
  onMoveInto: (headerId: string) => void;
  onMoveOut: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const sortable = useRowSortable(step.id, canDrag);

  const componentCount = step.componentNodeIds?.length ?? 0;
  const stepType = step.type ?? "Task";
  const needsSupport = (step.warnings as { needsSupport?: boolean } | null)
    ?.needsSupport;
  // A hand-drawn path overrides the planner's flag.
  const flagged =
    stepPlanWarningsSchema.safeParse(step.warnings).data?.flagged === true &&
    !hasCustomMotion(step.warnings, step.motion);
  const isMember = info.headerId !== null;
  const displayTitle = title || t`Untitled step`;

  return (
    <div
      ref={sortable.setNodeRef}
      style={sortable.style}
      className={cn(
        "group relative flex w-full cursor-pointer select-none items-center gap-1.5 border-b border-border bg-card py-3 pl-1.5 pr-2.5 hover:bg-accent/30",
        depth === 1 && "pl-6",
        isSelected && "bg-accent/40 hover:bg-accent/40",
        sortable.isDragging && "opacity-40"
      )}
      onClick={onSelect}
      onDoubleClick={onPreview}
      title={t`Double-click to play this step`}
    >
      {isSelected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-primary"
        />
      )}
      {depth === 1 && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-[17px] w-px bg-border"
        />
      )}
      <DragHandle canDrag={canDrag} sortable={sortable} />
      <span className="w-7 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {info.number}
      </span>
      {/* Only a non-default type earns an icon — the same Task icon on every row said nothing */}
      {stepType !== "Task" && (
        <ProcedureStepTypeIcon
          type={stepType}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      )}
      <TruncatedTooltipText
        tooltip={displayTitle}
        className="min-w-0 flex-1 truncate text-sm text-foreground"
      >
        {displayTitle}
      </TruncatedTooltipText>
      {flagged && (
        <RowIcon label={t`No collision-free path`}>
          <LuTriangleAlert className="size-3.5 text-amber-500" />
        </RowIcon>
      )}
      {needsSupport && (
        <RowIcon
          label={t`A part in this step may tip once placed — consider a fixture or a second person.`}
        >
          <LuHand className="size-3.5 text-amber-500" />
        </RowIcon>
      )}
      {uses.map((use) => (
        <Tooltip key={use.headerId}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md border border-border bg-card px-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={(e) => {
                e.stopPropagation();
                onSelectHeader(use.headerId);
              }}
            >
              <Trans>Uses {use.number}</Trans>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <Trans>
              Uses sub-assembly {use.number} · {use.title}
            </Trans>
          </TooltipContent>
        </Tooltip>
      ))}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        ×{componentCount}
      </span>
      <StepStatusControl
        stepId={step.id}
        status={normalizeStepStatus(step.status)}
        isDisabled={isDisabled}
      />
      {!isDisabled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`More options`}
              size="sm"
              variant="ghost"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
              icon={<LuEllipsisVertical />}
              onClick={(e) => e.stopPropagation()}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              disabled={isMember || isBusy}
              onClick={onMakeSubAssembly}
            >
              <DropdownMenuIcon icon={<LuBoxes />} />
              <Trans>Make Sub-Assembly</Trans>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={headers.length === 0 || isBusy}>
                <DropdownMenuIcon icon={<LuFolderInput />} />
                <Trans>Move Into</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {headers.map((header) => (
                  <DropdownMenuItem
                    key={header.headerId}
                    disabled={header.isOwn}
                    onClick={() => onMoveInto(header.headerId)}
                  >
                    {header.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={!isMember || isBusy}
              onClick={onMoveOut}
            >
              <DropdownMenuIcon icon={<LuCornerLeftUp />} />
              <Trans>Move Out of Sub-Assembly</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              destructive
              disabled={!permissions.can("delete", "production")}
              onClick={onDelete}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete Step</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function StepStatusControl({
  stepId,
  status,
  isDisabled
}: {
  stepId: string;
  status: AssemblyStepStatusValue;
  isDisabled: boolean;
}) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { t } = useLingui();
  const statusLabel = useStepStatusLabel();
  const fetcher = useFetcher<{ success: boolean }>();

  // Optimistic: show the in-flight status while the fetcher is busy
  const displayed =
    fetcher.state !== "idle" && fetcher.formData
      ? normalizeStepStatus(fetcher.formData.get("status") as string | null)
      : status;
  const label = statusLabel(displayed);

  const onSelect = (value: string) => {
    if (value === status) return;
    const formData = new FormData();
    formData.append("status", value);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.assemblyInstructionStepStatus(id, stepId)
    });
  };

  // Published/archived instructions can't be edited: the icon alone, named by its tooltip
  if (isDisabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={t`Step status: ${label}`}
            className="inline-flex size-6 shrink-0 items-center justify-center"
          >
            <AssemblyStepStatusIcon status={displayed} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t`Step status: ${label}. Change status`}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
              onClick={(e) => e.stopPropagation()}
            >
              <AssemblyStepStatusIcon status={displayed} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-[8rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuRadioGroup value={displayed} onValueChange={onSelect}>
          {assemblyStepStatuses.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <span className="flex items-center gap-2">
                <AssemblyStepStatusIcon status={option} className="size-3.5" />
                {statusLabel(option)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A small meaning-carrying icon in a step row, named by its tooltip. */
function RowIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} className="inline-flex shrink-0">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Declared after `coordinateGetter`. A module constant: a new options object
// makes a new sensor, and with it new listeners for every draggable on every
// render.
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter };
