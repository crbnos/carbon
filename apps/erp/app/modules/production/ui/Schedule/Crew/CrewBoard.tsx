import {
  Badge,
  ClientOnly,
  cn,
  IconButton,
  ScrollArea,
  ScrollBar,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast
} from "@carbon/react";
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
import { useLocale } from "@react-aria/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LuChevronRight,
  LuGripVertical,
  LuStickyNote,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetchers, useSubmit } from "react-router";
import { EmployeeAvatar } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { BoardContainer } from "../Kanban/components/ColumnCard";
import { hasDraggableData } from "../Kanban/utils";
import { CrewPill } from "./CrewChip";
import { CrewHoursModal } from "./CrewHoursModal";

const UNASSIGNED = "unassigned";

export type CrewEmployee = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type CrewAssignment = {
  id: string;
  workCenterId: string;
  employeeId: string;
  shiftId: string | null;
  note: string | null;
  date: string;
  overtimeHours: number;
  /** partial-day hours at this station; null = the whole shift */
  hours: number | null;
};

export type CrewAbsence = {
  id: string;
  employeeId: string;
  shiftId: string | null;
  note: string | null;
  date: string;
};

type CrewBoardProps = {
  date: string;
  shiftId: string | null;
  locationId: string;
  locationTimeZone?: string;
  employees: CrewEmployee[];
  workCenters: { id: string; name: string }[];
  assignments: CrewAssignment[];
  absences: CrewAbsence[];
  requiredAbilities: {
    workCenterId: string;
    abilityId: string;
    abilityName: string;
  }[];
  employeeAbilities: {
    employeeId: string;
    abilityId: string;
    trainingCompleted: boolean | null;
    expiresAt: string | null;
  }[];
  shiftHoursById: Record<string, number>;
  employeeShiftHours: Record<string, number>;
  defaultShiftHours: number;
  shiftStartById: Record<string, string>;
  shiftEndById: Record<string, string>;
  employeeShiftStart: Record<string, string>;
  employeeShiftEnd: Record<string, string>;
  /** each person's own shift — what new assignments get stamped with */
  employeeShiftId: Record<string, string>;
  defaultShiftStart: string;
  defaultShiftEnd: string | null;
};

/** page context the Working-hours editor needs on every card */
type CardEditorContext = {
  date: string;
  shiftId: string | null;
  locationId: string;
  workCenters: { id: string; name: string }[];
};

type CrewCardItem = {
  employee: CrewEmployee;
  assignment: CrewAssignment | null;
  isAbsent: boolean;
  absenceId: string | null;
  missingAbilities: string[];
  /** remaining unallocated hours (pool card of a partially-assigned person) */
  freeHours: number | null;
  /** hours this card occupies at its station (explicit or shift-derived) */
  displayHours: number | null;
  /** the person's whole day (all stations) — the Working-hours editor input */
  dayRows: {
    workCenterId: string;
    hours: number | null;
  }[];
  /** day-scoped overtime (max across the day's rows — never their sum) */
  overtimeHours: number;
  /** shift-ladder hours for this person/day */
  baseHours: number;
  /** "HH:MM" start of the person's day, for the editor's time echo */
  dayStartTime: string | null;
  /** "HH:MM" end of the person's shift, for the card's shift window */
  dayEndTime: string | null;
  /** day-scoped note (first non-empty across the day's rows) */
  note: string | null;
};

/**
 * "14:00" -> "2:00 PM".
 *
 * `hour12` is forced rather than left to the locale: a shop-floor supervisor on
 * an en-GB browser would otherwise get 24h, and there is no in-app setting that
 * can change it (the language picker stores a bare code like "en", and
 * getPreferenceHeaders then resolves the region from accept-language). The rest
 * of the app formats by locale — this is a deliberate, board-local exception.
 */
function formatTime(time: string, locale: string) {
  const [hour, minute] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hour ?? 0, minute ?? 0).toLocaleTimeString(
    locale,
    { hour: "numeric", minute: "2-digit", hour12: true }
  );
}

/** stable sortable/React id — assignment cards are keyed by the ROW, so one
 * person can appear in several columns (split days) */
function cardId(item: CrewCardItem) {
  if (item.assignment && !item.isAbsent) return item.assignment.id;
  return `${item.isAbsent ? "absent" : "free"}:${item.employee.id}`;
}

// Optimistic board state from in-flight assign/unassign fetchers
function usePendingMoves() {
  type PendingFetcher = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingFetcher => {
      return (
        fetcher.formAction === path.to.scheduleCrewUpdate &&
        fetcher.formData != null &&
        ["assign", "unassign"].includes(String(fetcher.formData.get("intent")))
      );
    })
    .map((fetcher) => ({
      intent: String(fetcher.formData.get("intent")),
      employeeId: String(fetcher.formData.get("employeeId")),
      workCenterId: String(fetcher.formData.get("workCenterId") ?? ""),
      hours: fetcher.formData.get("hours")
    }));
}

function CrewCard({
  item,
  editor,
  isOverlay,
  isDisabled,
  onOpen
}: {
  item: CrewCardItem;
  editor: CardEditorContext;
  isOverlay?: boolean;
  isDisabled?: boolean;
  onOpen: (item: CrewCardItem) => void;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
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
    // the overlay clone must not register as a sortable — it would inherit the
    // active card's drag transform/state and render as a ghost
    disabled: isOverlay || isDisabled || item.isAbsent
  });

  const style = isOverlay
    ? undefined
    : {
        transition,
        transform: CSS.Translate.toString(transform)
      };

  const stationName = (id: string) =>
    editor.workCenters.find((wc) => wc.id === id)?.name ?? id;

  // split day: this card's station is one of several
  const isSplit = item.assignment != null && item.dayRows.length > 1;
  const otherStations = isSplit
    ? item.dayRows.filter(
        (row) => row.workCenterId !== item.assignment!.workCenterId
      )
    : [];

  const shiftWindow =
    item.dayStartTime && item.dayEndTime
      ? `${formatTime(item.dayStartTime, locale)} – ${formatTime(
          item.dayEndTime,
          locale
        )}`
      : null;

  // the shift window is the card's anchor fact — it always shows; a split day
  // and a note are additions to it, never replacements
  const otherStationNames = otherStations
    .map((row) => stationName(row.workCenterId))
    .join(", ");

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={style}
      onClick={() => {
        if (!isOverlay && !isDisabled) onOpen(item);
      }}
      className={cn(
        // the schedule board's card shell, so both boards read the same
        "flex min-h-14 flex-wrap items-center gap-2 rounded-xl border-[0.5px] bg-card px-3 py-2 dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]",
        // the card body opens the editor; only the grip drags
        !isDisabled && !isOverlay && "cursor-pointer",
        isDragging && !isOverlay && "border-dashed bg-muted",
        isOverlay &&
          "ring-2 ring-primary opacity-100 !bg-card shadow-lg cursor-grabbing",
        item.isAbsent && "opacity-60"
      )}
    >
      {/* drag lives on the handle only — the rest of the card is tap-to-open.
          Ghost variant so it picks up the same hover fill as the schedule
          board's grip, but kept 44px tall for tablets. */}
      {!isDisabled && !item.isAbsent && (
        <IconButton
          aria-label={t`Drag to assign`}
          variant="ghost"
          icon={<LuGripVertical />}
          className={cn(
            "-ml-1.5 h-11 w-9 flex-shrink-0 touch-none text-muted-foreground/50 hover:text-muted-foreground",
            isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
          onClick={(e) => e.stopPropagation()}
          {...(isOverlay ? {} : { ...attributes, ...listeners })}
        />
      )}
      {/* EmployeeAvatar hardcodes `truncate` and ignores className, so it
          clips instead of holding its size — pin it from the outside */}
      <div className="flex-shrink-0">
        <EmployeeAvatar
          employeeId={item.employee.id}
          withName={false}
          size="sm"
        />
      </div>
      <div className="min-w-[7rem] flex-1">
        <p className="truncate text-sm font-medium">{item.employee.name}</p>
        {/* one fact per line — nothing shares a row, so nothing truncates */}
        {!item.isAbsent && shiftWindow && (
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {shiftWindow}
          </p>
        )}
        {otherStationNames && (
          <p className="truncate text-xs text-muted-foreground">
            <Trans>also at {otherStationNames}</Trans>
          </p>
        )}
        {item.note && (
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <LuStickyNote className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{item.note}</span>
          </p>
        )}
      </div>
      <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
        {item.freeHours != null && !item.isAbsent && (
          <CrewPill tone="emerald" tooltip={t`Hours not yet assigned`}>
            <Trans>{item.freeHours}h free</Trans>
          </CrewPill>
        )}
        {item.assignment && item.displayHours != null && !item.isAbsent && (
          // only THIS station's hours — never "x of the shift", which reads as
          // under-scheduled on each half of a split day
          <CrewPill tone="blue" tooltip={t`Hours at this station`}>
            {item.displayHours}h
          </CrewPill>
        )}
        {item.overtimeHours > 0 && !item.isAbsent && (
          <CrewPill
            tone="amber"
            tooltip={t`Authorized overtime on top of the shift`}
          >
            +{item.overtimeHours}h
          </CrewPill>
        )}
        {item.missingAbilities.length > 0 && !item.isAbsent && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-amber-500">
                <LuTriangleAlert />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t`Missing:`} {item.missingAbilities.join(", ")}
            </TooltipContent>
          </Tooltip>
        )}
        {/* Absent is state only here — flipping it lives in the day editor,
            so the row stays readable when hours and overtime are also shown */}
        {item.isAbsent && (
          <CrewPill tone="red" tooltip={t`Not working today`}>
            <Trans>Absent</Trans>
          </CrewPill>
        )}
        {!isDisabled && !isOverlay && (
          <LuChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
        )}
      </div>
    </div>
  );
}

type CardHandlers = {
  onOpen: (item: CrewCardItem) => void;
};

function CrewColumn({
  id,
  title,
  items,
  isDisabled,
  sticky = false,
  editor,
  cardHandlers
}: {
  id: string;
  title: string;
  items: CrewCardItem[];
  isDisabled: boolean;
  sticky?: boolean;
  editor: CardEditorContext;
  cardHandlers: CardHandlers;
}) {
  const { setNodeRef } = useSortable({
    id,
    data: { type: "column", column: { id, title } },
    // draggable only — a boolean would ALSO disable the droppable, making
    // empty columns dead drop targets (dnd-kit normalizes true to both)
    disabled: { draggable: true, droppable: false }
  });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  // shadow only once the board is actually scrolled — at rest the sticky
  // column sits flush and needs no separation
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
  const headcount = items.filter((item) => !item.isAbsent).length;

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
        <Badge variant="secondary">{headcount}</Badge>
      </div>
      <ScrollArea className="flex-grow">
        <SortableContext items={itemIds}>
          <div className="flex flex-col gap-2 p-2">
            {items.map((item) => (
              <CrewCard
                key={cardId(item)}
                item={item}
                editor={editor}
                isDisabled={isDisabled}
                {...cardHandlers}
              />
            ))}
            {/* the dashed box doubles as the drop affordance — an empty
                station should still look like somewhere you can drop */}
            {items.length === 0 && (
              <div className="flex items-center justify-center rounded-md border border-dashed border-border py-8 text-xs text-muted-foreground">
                {id === UNASSIGNED ? (
                  <Trans>No one to assign</Trans>
                ) : (
                  <Trans>No one crewed</Trans>
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

const CrewBoard = ({
  date,
  shiftId,
  locationId,
  locationTimeZone,
  employees,
  workCenters,
  assignments,
  absences,
  requiredAbilities,
  employeeAbilities,
  shiftHoursById,
  employeeShiftHours,
  defaultShiftHours,
  shiftStartById,
  shiftEndById,
  employeeShiftStart,
  employeeShiftEnd,
  employeeShiftId,
  defaultShiftStart,
  defaultShiftEnd
}: CrewBoardProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const submit = useSubmit();
  const isDisabled = !permissions.can("update", "production");

  const [activeItem, setActiveItem] = useState<CrewCardItem | null>(null);
  const [editorItem, setEditorItem] = useState<CrewCardItem | null>(null);
  // a completed drag still fires a click on the source card — swallow it
  const recentDragRef = useRef(false);

  const sensors = useSensors(
    // under ~5px of travel is a tap (opens the editor), beyond it a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const pendingMoves = usePendingMoves();

  // assignment's shift → the person's own shift → most-common location shift
  const ladderHours = (assignment: CrewAssignment) =>
    (assignment.shiftId ? shiftHoursById[assignment.shiftId] : undefined) ??
    employeeShiftHours[assignment.employeeId] ??
    defaultShiftHours;
  const effectiveHours = (assignment: CrewAssignment) =>
    assignment.hours ?? ladderHours(assignment);
  const baseShiftHoursFor = (employeeId: string) =>
    (shiftId ? shiftHoursById[shiftId] : undefined) ??
    employeeShiftHours[employeeId] ??
    defaultShiftHours;

  // employeeId -> ALL their rows for the day (split days = several rows)
  const assignmentsByEmployee = useMemo(() => {
    const map = new Map<string, CrewAssignment[]>();
    for (const assignment of assignments) {
      const list = map.get(assignment.employeeId);
      if (list) list.push(assignment);
      else map.set(assignment.employeeId, [assignment]);
    }
    // optimistic: a plain full-shift assign replaces the person's rows
    for (const move of pendingMoves) {
      if (move.intent === "assign" && !move.hours) {
        map.set(move.employeeId, [
          {
            id: `pending:${move.employeeId}`,
            workCenterId: move.workCenterId,
            employeeId: move.employeeId,
            shiftId,
            note: null,
            date,
            overtimeHours: 0,
            hours: null
          }
        ]);
      } else if (move.intent === "unassign") {
        map.delete(move.employeeId);
      }
    }
    return map;
  }, [assignments, pendingMoves, shiftId, date]);

  const absenceByEmployee = useMemo(() => {
    const map = new Map<string, CrewAbsence>();
    for (const absence of absences) {
      map.set(absence.employeeId, absence);
    }
    return map;
  }, [absences]);

  // qualification = active row ∧ trainingCompleted ∧ not expired
  const qualifiedAbilitiesByEmployee = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const today = date;
    for (const row of employeeAbilities) {
      if (!row.trainingCompleted) continue;
      if (row.expiresAt && row.expiresAt.slice(0, 10) < today) continue;
      const set = map.get(row.employeeId) ?? new Set<string>();
      set.add(row.abilityId);
      map.set(row.employeeId, set);
    }
    return map;
  }, [employeeAbilities, date]);

  const requiredByWorkCenter = useMemo(() => {
    const map = new Map<string, { abilityId: string; abilityName: string }[]>();
    for (const row of requiredAbilities) {
      const list = map.get(row.workCenterId) ?? [];
      if (!list.some((a) => a.abilityId === row.abilityId)) {
        list.push({ abilityId: row.abilityId, abilityName: row.abilityName });
      }
      map.set(row.workCenterId, list);
    }
    return map;
  }, [requiredAbilities]);

  const missingAbilitiesFor = (employeeId: string, workCenterId: string) => {
    const required = requiredByWorkCenter.get(workCenterId) ?? [];
    if (required.length === 0) return [];
    const qualified = qualifiedAbilitiesByEmployee.get(employeeId);
    return required
      .filter((a) => !qualified?.has(a.abilityId))
      .map((a) => a.abilityName);
  };

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, CrewCardItem[]>();
    map.set(UNASSIGNED, []);
    for (const workCenter of workCenters) {
      map.set(workCenter.id, []);
    }
    const dayRowsFor = (rows: CrewAssignment[]) =>
      rows.map((row) => ({
        workCenterId: row.workCenterId,
        hours: row.hours
      }));
    // overtime is one value for the DAY, stamped on each row — take the max,
    // never the sum, or a split person's overtime multiplies
    const dayOvertimeFor = (rows: CrewAssignment[]) =>
      rows.reduce((max, row) => Math.max(max, row.overtimeHours ?? 0), 0);
    const dayStartFor = (employeeId: string, rows: CrewAssignment[]) =>
      (rows[0]?.shiftId ? shiftStartById[rows[0].shiftId] : undefined) ??
      employeeShiftStart[employeeId] ??
      defaultShiftStart;
    const dayEndFor = (employeeId: string, rows: CrewAssignment[]) =>
      (rows[0]?.shiftId ? shiftEndById[rows[0].shiftId] : undefined) ??
      employeeShiftEnd[employeeId] ??
      defaultShiftEnd;
    const presentAbsentees: CrewCardItem[] = [];
    for (const employee of employees) {
      const absence = absenceByEmployee.get(employee.id) ?? null;
      const rows = assignmentsByEmployee.get(employee.id) ?? [];
      const dayRows = dayRowsFor(rows);
      const dayOvertime = dayOvertimeFor(rows);
      const baseHours = baseShiftHoursFor(employee.id);
      const dayStartTime = dayStartFor(employee.id, rows);
      const dayEndTime = dayEndFor(employee.id, rows);
      // day-scoped note (setCrewDay writes it to every row)
      const note = rows.find((row) => row.note)?.note ?? null;

      // Absent people always sit (grayed) at the bottom of Unassigned — their
      // assignment rows survive so clearing the absence restores the station.
      if (absence !== null) {
        presentAbsentees.push({
          employee,
          assignment: rows[0] ?? null,
          isAbsent: true,
          absenceId: absence.id,
          missingAbilities: [],
          freeHours: null,
          displayHours: null,
          dayRows,
          overtimeHours: dayOvertime,
          baseHours,
          dayStartTime,
          dayEndTime,
          note
        });
        continue;
      }

      // one card PER ASSIGNMENT — a split person appears in several columns
      for (const row of rows) {
        if (!map.has(row.workCenterId)) continue;
        map.get(row.workCenterId)!.push({
          employee,
          assignment: row,
          isAbsent: false,
          absenceId: null,
          missingAbilities: missingAbilitiesFor(employee.id, row.workCenterId),
          freeHours: null,
          displayHours: Math.round(effectiveHours(row) * 100) / 100,
          dayRows,
          overtimeHours: dayOvertime,
          baseHours,
          dayStartTime,
          dayEndTime,
          note
        });
      }

      // the Unassigned pool = people with free hours: nobody scheduled yet
      // (plain card) or a partially-allocated remainder ("Xh free")
      if (rows.length === 0) {
        map.get(UNASSIGNED)!.push({
          employee,
          assignment: null,
          isAbsent: false,
          absenceId: null,
          missingAbilities: [],
          freeHours: null,
          displayHours: null,
          dayRows,
          overtimeHours: dayOvertime,
          baseHours,
          dayStartTime,
          dayEndTime,
          note
        });
      } else if (rows.every((row) => row.hours != null)) {
        const free =
          baseShiftHoursFor(employee.id) -
          rows.reduce((sum, row) => sum + effectiveHours(row), 0);
        if (free > 0.01) {
          map.get(UNASSIGNED)!.push({
            employee,
            assignment: null,
            isAbsent: false,
            absenceId: null,
            missingAbilities: [],
            freeHours: Math.round(free * 100) / 100,
            displayHours: null,
            dayRows,
            overtimeHours: dayOvertime,
            baseHours,
            dayStartTime,
            dayEndTime,
            note
          });
        }
      }
    }
    map.get(UNASSIGNED)!.push(...presentAbsentees);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    employees,
    workCenters,
    assignmentsByEmployee,
    absenceByEmployee,
    requiredByWorkCenter,
    qualifiedAbilitiesByEmployee,
    shiftHoursById,
    employeeShiftHours,
    defaultShiftHours,
    shiftStartById,
    shiftEndById,
    employeeShiftStart,
    employeeShiftEnd,
    defaultShiftStart,
    defaultShiftEnd,
    shiftId
  ]);

  const submitIntent = (payload: Record<string, string>) => {
    submit(payload, {
      method: "post",
      action: path.to.scheduleCrewUpdate,
      navigate: false,
      fetcherKey: `crew:${payload.employeeId ?? payload.id ?? "board"}`
    });
  };

  // Stamp new rows with the PERSON's own shift so the shift filter (an exact
  // match on the assignment) finds them. Falls back to the active filter for
  // people who have no shift of their own.
  const shiftForEmployee = (employeeId: string) =>
    employeeShiftId[employeeId] ?? shiftId;

  function onDragStart(event: DragStartEvent) {
    if (!hasDraggableData(event.active)) return;
    const data = event.active.data.current;
    if (data?.type === "item") {
      recentDragRef.current = true;
      setActiveItem(data.item as unknown as CrewCardItem);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveItem(null);
    // let this drag's trailing click pass before re-enabling tap-to-open
    setTimeout(() => {
      recentDragRef.current = false;
    }, 0);
    if (!over || isDisabled) return;
    if (!hasDraggableData(active)) return;

    const activeData = active.data.current;
    if (activeData?.type !== "item") return;
    const item = activeData.item as unknown as CrewCardItem;

    // Resolve the target column: a column id directly, or the column of the
    // card we dropped on
    let targetColumnId: string | null = null;
    if (hasDraggableData(over)) {
      const overData = over.data.current;
      if (overData?.type === "column") {
        targetColumnId = String(over.id);
      } else if (overData?.type === "item") {
        const overItem = overData.item as unknown as CrewCardItem;
        targetColumnId = overItem.assignment?.workCenterId ?? UNASSIGNED;
      }
    }
    if (!targetColumnId) return;

    const currentColumnId = item.assignment?.workCenterId ?? UNASSIGNED;
    if (targetColumnId === currentColumnId) return;

    if (targetColumnId === UNASSIGNED) {
      if (item.assignment) {
        submitIntent({
          intent: "unassign",
          id: item.assignment.id,
          employeeId: item.employee.id
        });
      }
      return;
    }

    if (item.assignment) {
      // dropping an assigned card on another station always MOVES it —
      // splitting is done on the card (hours chip) + the free-hours pool
      submitIntent({
        intent: "move",
        id: item.assignment.id,
        employeeId: item.employee.id,
        workCenterId: targetColumnId
      });
      const employeeName = item.employee.name ?? "";
      const targetName =
        workCenters.find((wc) => wc.id === targetColumnId)?.name ?? "";
      toast.success(t`Moved ${employeeName} to ${targetName}`);
      return;
    }

    // pool card: fresh person = whole shift; remainder card = its free hours
    const assignShiftId = shiftForEmployee(item.employee.id);
    submitIntent({
      intent: "assign",
      employeeId: item.employee.id,
      workCenterId: targetColumnId,
      locationId,
      date,
      ...(assignShiftId ? { shiftId: assignShiftId } : {}),
      ...(item.freeHours != null ? { hours: String(item.freeHours) } : {})
    });
  }

  const cardHandlers: CardHandlers = {
    onOpen: (item: CrewCardItem) => {
      if (recentDragRef.current) return;
      setEditorItem(item);
    }
  };

  const editor: CardEditorContext = { date, shiftId, locationId, workCenters };

  return (
    <DndContext
      sensors={sensors}
      // the Unassigned column is position: sticky, so droppable rects must be
      // re-measured while dragging (cached rects drift when the board scrolls)
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveItem(null);
        setTimeout(() => {
          recentDragRef.current = false;
        }, 0);
      }}
    >
      <BoardContainer>
        <CrewColumn
          id={UNASSIGNED}
          title={t`Unassigned`}
          items={itemsByColumn.get(UNASSIGNED) ?? []}
          isDisabled={isDisabled}
          sticky
          editor={editor}
          cardHandlers={cardHandlers}
        />
        {workCenters.map((workCenter) => (
          <CrewColumn
            key={workCenter.id}
            id={workCenter.id}
            title={workCenter.name}
            items={itemsByColumn.get(workCenter.id) ?? []}
            isDisabled={isDisabled}
            editor={editor}
            cardHandlers={cardHandlers}
          />
        ))}
      </BoardContainer>

      <ClientOnly fallback={null}>
        {() =>
          createPortal(
            <DragOverlay>
              {activeItem && (
                <CrewCard
                  item={activeItem}
                  editor={editor}
                  isOverlay
                  isDisabled
                  {...cardHandlers}
                />
              )}
            </DragOverlay>,
            document.body
          )
        }
      </ClientOnly>

      {editorItem && (
        <CrewHoursModal
          key={`${editorItem.employee.id}:${date}`}
          open
          onOpenChange={(open) => {
            if (!open) setEditorItem(null);
          }}
          employeeId={editorItem.employee.id}
          employeeName={editorItem.employee.name}
          date={date}
          shiftId={shiftForEmployee(editorItem.employee.id)}
          locationId={locationId}
          locationTimeZone={locationTimeZone}
          workCenters={workCenters}
          rows={editorItem.dayRows}
          note={editorItem.note}
          overtimeHours={editorItem.overtimeHours}
          baseHours={editorItem.baseHours}
          dayStartTime={editorItem.dayStartTime}
          dayEndTime={editorItem.dayEndTime}
          isAbsent={editorItem.isAbsent}
          absenceId={editorItem.absenceId}
        />
      )}
    </DndContext>
  );
};

export { CrewBoard };
