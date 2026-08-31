import { Badge, cn, ScrollArea, ScrollBar, toast } from "@carbon/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuGripVertical, LuX } from "react-icons/lu";
import { useSubmit } from "react-router";
import { EmployeeAvatar } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { BoardContainer } from "../Kanban/components/ColumnCard";
import { hasDraggableData } from "../Kanban/utils";
import { assignmentMatchesShift } from "./peopleShared";

const UNASSIGNED = "unassigned";

type WeekEmployee = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

type WeekAssignment = {
  id: string;
  employeeId: string;
  workCenterId: string;
  date: string;
  shiftId: string | null;
};

type WeekCardItem = {
  employee: WeekEmployee;
  /** station this card sits in (null = unassigned pool) */
  workCenterId: string | null;
  /** distinct days assigned at this station this week */
  days: number;
  /** distinct absence days this week */
  daysOff: number;
  /** the person's qualified (non-expired) abilities — badged on the card */
  abilities: string[];
};

type PeopleWeekBoardProps = {
  weekDates: string[];
  shiftId: string | null;
  locationId: string;
  employees: WeekEmployee[];
  workCenters: { id: string; name: string }[];
  assignments: WeekAssignment[];
  absences: { employeeId: string; date: string }[];
  /** each person's own shift — what new assignments get stamped with */
  employeeShiftId: Record<string, string>;
  /** employeeId → their qualified ability names, for the card badges */
  employeeAbilityNames: Record<string, string[]>;
};

function cardId(item: WeekCardItem) {
  return item.workCenterId
    ? `${item.employee.id}:${item.workCenterId}`
    : `pool:${item.employee.id}`;
}

function WeekCard({
  item,
  isOverlay,
  isDisabled,
  onRemove
}: {
  item: WeekCardItem;
  isOverlay?: boolean;
  isDisabled?: boolean;
  onRemove: (item: WeekCardItem) => void;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: cardId(item),
    data: { type: "item", item },
    disabled: isOverlay || isDisabled
  });

  const style = isOverlay
    ? undefined
    : { transition, transform: CSS.Translate.toString(transform) };

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={style}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]",
        !isDisabled && "cursor-grab",
        isDragging && !isOverlay && "border-dashed bg-muted",
        isOverlay &&
          "ring-2 ring-primary opacity-100 !bg-card shadow-lg cursor-grabbing"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {!isDisabled && (
            <LuGripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
          )}
          <EmployeeAvatar employeeId={item.employee.id} size="sm" />
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {item.workCenterId && (
            <span className="inline-flex items-center rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-400 tabular-nums">
              <Trans>{item.days}d</Trans>
            </span>
          )}
          {item.daysOff > 0 && (
            <span className="inline-flex items-center rounded-md bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400 tabular-nums">
              <Trans>{item.daysOff}d off</Trans>
            </span>
          )}
          {item.workCenterId && !isDisabled && !isOverlay && (
            <button
              type="button"
              aria-label="Remove"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 dark:hover:text-red-400"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onRemove(item)}
            >
              <LuX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {item.abilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.abilities.map((ability) => (
            <span
              key={ability}
              className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {ability}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WeekColumn({
  id,
  title,
  items,
  isDisabled,
  sticky = false,
  onRemove
}: {
  id: string;
  title: string;
  items: WeekCardItem[];
  isDisabled: boolean;
  sticky?: boolean;
  onRemove: (item: WeekCardItem) => void;
}) {
  const { setNodeRef } = useSortable({
    id,
    data: { type: "column", column: { id, title } },
    disabled: { draggable: true, droppable: false }
  });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    if (!sticky) return;
    const viewport = elementRef.current?.closest(
      "[data-radix-scroll-area-viewport]"
    );
    if (!viewport) return;
    const onScroll = () => setIsScrolled(viewport.scrollLeft > 0);
    onScroll();
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [sticky]);
  const itemIds = useMemo(() => items.map((item) => cardId(item)), [items]);

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        elementRef.current = node;
      }}
      className={cn(
        "w-[300px] max-w-full flex flex-col flex-shrink-0 snap-center rounded-none bg-card/30 border-0 border-r h-[calc(100dvh-var(--header-height)*2)]",
        sticky && "sticky left-0 z-10 bg-card transition-shadow",
        sticky && isScrolled && "shadow-[6px_0_12px_-6px_rgba(0,0,0,0.15)]"
      )}
    >
      <div className="p-4 w-full font-semibold text-left flex flex-row items-center sticky top-0 z-1 border-b bg-card">
        <span className="mr-auto truncate">{title}</span>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <ScrollArea className="flex-grow">
        <SortableContext items={itemIds}>
          <div className="flex flex-col gap-2 p-2">
            {items.map((item) => (
              <WeekCard
                key={cardId(item)}
                item={item}
                isDisabled={isDisabled}
                onRemove={onRemove}
              />
            ))}
            {/* the dashed box doubles as the drop affordance — an empty
                station should still look like somewhere you can drop */}
            {items.length === 0 && (
              <div className="flex items-center justify-center rounded-md border border-dashed border-border py-8 text-xs text-muted-foreground">
                {id === UNASSIGNED ? (
                  <Trans>No one to assign</Trans>
                ) : (
                  <Trans>No one assigned</Trans>
                )}
              </div>
            )}
          </div>
        </SortableContext>
        <ScrollBar orientation="vertical" />
      </ScrollArea>
    </div>
  );
}

/**
 * Week-basis manning: drag a person onto a station once and they're assigned
 * there for the whole week (the shift's working days; absences and existing
 * days are skipped). Cards show days at the station; day-level detail (splits,
 * notes, overtime) lives on the Day board.
 */
const PeopleWeekBoard = ({
  weekDates,
  shiftId,
  locationId,
  employees,
  workCenters,
  assignments,
  absences,
  employeeShiftId,
  employeeAbilityNames
}: PeopleWeekBoardProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const submit = useSubmit();
  const isDisabled = !permissions.can("update", "production");
  const weekStart = weekDates[0];

  const [activeItem, setActiveItem] = useState<WeekCardItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // shift-less rows resolve through the person's own shift, like the hours do
  const scopedAssignments = useMemo(
    () =>
      shiftId
        ? assignments.filter((assignment) =>
            assignmentMatchesShift(assignment, shiftId, employeeShiftId)
          )
        : assignments,
    [assignments, shiftId, employeeShiftId]
  );

  const daysOffByEmployee = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const absence of absences) {
      const set = map.get(absence.employeeId) ?? new Set<string>();
      set.add(absence.date);
      map.set(absence.employeeId, set);
    }
    return map;
  }, [absences]);

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, WeekCardItem[]>();
    map.set(UNASSIGNED, []);
    for (const workCenter of workCenters) {
      map.set(workCenter.id, []);
    }
    // employee → station → distinct assigned days
    const byEmployeeStation = new Map<string, Map<string, Set<string>>>();
    for (const assignment of scopedAssignments) {
      const stations =
        byEmployeeStation.get(assignment.employeeId) ??
        new Map<string, Set<string>>();
      const days = stations.get(assignment.workCenterId) ?? new Set<string>();
      days.add(assignment.date);
      stations.set(assignment.workCenterId, days);
      byEmployeeStation.set(assignment.employeeId, stations);
    }
    for (const employee of employees) {
      const stations = byEmployeeStation.get(employee.id);
      const daysOff = daysOffByEmployee.get(employee.id)?.size ?? 0;
      const abilities = employeeAbilityNames[employee.id] ?? [];
      if (!stations || stations.size === 0) {
        map.get(UNASSIGNED)!.push({
          employee,
          workCenterId: null,
          days: 0,
          daysOff,
          abilities
        });
        continue;
      }
      for (const [workCenterId, days] of stations) {
        if (!map.has(workCenterId)) continue;
        map.get(workCenterId)!.push({
          employee,
          workCenterId,
          days: days.size,
          daysOff,
          abilities
        });
      }
    }
    return map;
  }, [
    employees,
    workCenters,
    scopedAssignments,
    daysOffByEmployee,
    employeeAbilityNames
  ]);

  const submitIntent = (payload: Record<string, string>) => {
    submit(payload, {
      method: "post",
      action: path.to.priorityPeopleUpdate,
      navigate: false,
      fetcherKey: `people-week:${payload.employeeId ?? "board"}`
    });
  };

  // Stamp new rows with the PERSON's own shift only — never the active filter
  // shift, which is a view scope, not a fact about the person. A shift-less
  // person's rows stay unstamped and resolve through the ladder.
  const shiftForEmployee = (employeeId: string) =>
    employeeShiftId[employeeId] ?? null;

  function onDragStart(event: DragStartEvent) {
    if (!hasDraggableData(event.active)) return;
    const data = event.active.data.current;
    if (data?.type === "item") {
      setActiveItem(data.item as unknown as WeekCardItem);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveItem(null);
    if (!over || isDisabled) return;
    if (!hasDraggableData(active)) return;

    const activeData = active.data.current;
    if (activeData?.type !== "item") return;
    const item = activeData.item as unknown as WeekCardItem;

    let targetColumnId: string | null = null;
    if (hasDraggableData(over)) {
      const overData = over.data.current;
      if (overData?.type === "column") {
        targetColumnId = String(over.id);
      } else if (overData?.type === "item") {
        const overItem = overData.item as unknown as WeekCardItem;
        targetColumnId = overItem.workCenterId ?? UNASSIGNED;
      }
    }
    if (!targetColumnId) return;

    const currentColumnId = item.workCenterId ?? UNASSIGNED;
    if (targetColumnId === currentColumnId) return;

    const targetName =
      workCenters.find((wc) => wc.id === targetColumnId)?.name ?? "";
    const employeeName = item.employee.name ?? "";
    const weekShiftId = shiftForEmployee(item.employee.id);

    if (targetColumnId === UNASSIGNED) {
      if (item.workCenterId) {
        submitIntent({
          intent: "unassign-week",
          employeeId: item.employee.id,
          workCenterId: item.workCenterId,
          weekStart,
          ...(weekShiftId ? { shiftId: weekShiftId } : {})
        });
      }
      return;
    }

    if (item.workCenterId) {
      submitIntent({
        intent: "move-week",
        employeeId: item.employee.id,
        fromWorkCenterId: item.workCenterId,
        workCenterId: targetColumnId,
        weekStart,
        ...(weekShiftId ? { shiftId: weekShiftId } : {})
      });
      toast.success(t`Moved ${employeeName}'s week to ${targetName}`);
      return;
    }

    submitIntent({
      intent: "assign-week",
      employeeId: item.employee.id,
      workCenterId: targetColumnId,
      locationId,
      weekStart,
      ...(weekShiftId ? { shiftId: weekShiftId } : {})
    });
    toast.success(t`Assigned ${employeeName} to ${targetName} for the week`);
  }

  const onRemove = (item: WeekCardItem) => {
    if (!item.workCenterId) return;
    const weekShiftId = shiftForEmployee(item.employee.id);
    submitIntent({
      intent: "unassign-week",
      employeeId: item.employee.id,
      workCenterId: item.workCenterId,
      weekStart,
      ...(weekShiftId ? { shiftId: weekShiftId } : {})
    });
  };

  return (
    <DndContext
      sensors={sensors}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <BoardContainer>
        <WeekColumn
          id={UNASSIGNED}
          title={t`Unassigned`}
          items={itemsByColumn.get(UNASSIGNED) ?? []}
          isDisabled={isDisabled}
          sticky
          onRemove={onRemove}
        />
        {workCenters.map((workCenter) => (
          <WeekColumn
            key={workCenter.id}
            id={workCenter.id}
            title={workCenter.name}
            items={itemsByColumn.get(workCenter.id) ?? []}
            isDisabled={isDisabled}
            onRemove={onRemove}
          />
        ))}
      </BoardContainer>

      <ClientPortalOverlay activeItem={activeItem} onRemove={onRemove} />
    </DndContext>
  );
};

function ClientPortalOverlay({
  activeItem,
  onRemove
}: {
  activeItem: WeekCardItem | null;
  onRemove: (item: WeekCardItem) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <DragOverlay>
      {activeItem && (
        <WeekCard item={activeItem} isOverlay isDisabled onRemove={onRemove} />
      )}
    </DragOverlay>,
    document.body
  );
}

export { PeopleWeekBoard };
