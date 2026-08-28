import { ClientOnly, toast } from "@carbon/react";
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
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetchers, useSubmit } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { BoardContainer } from "../Kanban/components/ColumnCard";
import { hasDraggableData } from "../Kanban/utils";
import type { CardEditorContext, PeopleCardItem } from "./PeopleCard";
import { PeopleCard } from "./PeopleCard";
import type { CardHandlers } from "./PeopleColumn";
import { PeopleColumn } from "./PeopleColumn";
import { PeopleHoursModal } from "./PeopleHoursModal";
import type {
  PeopleAbsence,
  PeopleAssignment,
  PeopleEmployee
} from "./peopleShared";
import {
  assignmentHours,
  dayOvertime,
  ladderShiftHours,
  ladderShiftTime,
  UNASSIGNED
} from "./peopleShared";

export type {
  PeopleAbsence,
  PeopleAssignment,
  PeopleEmployee
} from "./peopleShared";

type PeopleBoardProps = {
  date: string;
  shiftId: string | null;
  locationId: string;
  locationTimeZone?: string;
  employees: PeopleEmployee[];
  workCenters: { id: string; name: string }[];
  assignments: PeopleAssignment[];
  absences: PeopleAbsence[];
  requiredAbilities: {
    workCenterId: string;
    abilityId: string;
    abilityName: string;
  }[];
  /** operation-hours each work center needs on the board's date (demand) */
  requiredHoursByWorkCenter: Record<string, number>;
  employeeAbilities: {
    employeeId: string;
    abilityId: string;
    expiresAt: string | null;
  }[];
  /** employeeId → their qualified ability names, for the card badges */
  employeeAbilityNames: Record<string, string[]>;
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

// Optimistic board state from in-flight assign/unassign fetchers
function usePendingMoves() {
  type PendingFetcher = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingFetcher => {
      return (
        fetcher.formAction === path.to.priorityPeopleUpdate &&
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

const PeopleBoard = ({
  date,
  shiftId,
  locationId,
  locationTimeZone,
  employees,
  workCenters,
  assignments,
  absences,
  requiredAbilities,
  requiredHoursByWorkCenter,
  employeeAbilities,
  employeeAbilityNames,
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
}: PeopleBoardProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const submit = useSubmit();
  const isDisabled = !permissions.can("update", "production");

  const [activeItem, setActiveItem] = useState<PeopleCardItem | null>(null);
  const [editorItem, setEditorItem] = useState<PeopleCardItem | null>(null);
  // a completed drag still fires a click on the source card — swallow it
  const recentDragRef = useRef(false);

  const sensors = useSensors(
    // under ~5px of travel is a tap (opens the editor), beyond it a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const pendingMoves = usePendingMoves();

  const hoursLadder = { shiftHoursById, employeeShiftHours, defaultShiftHours };
  const effectiveHours = (assignment: PeopleAssignment) =>
    assignmentHours(assignment, hoursLadder);
  const baseShiftHoursFor = (employeeId: string) =>
    ladderShiftHours(shiftId, employeeId, hoursLadder);

  // employeeId -> ALL their rows for the day (split days = several rows)
  const assignmentsByEmployee = useMemo(() => {
    const map = new Map<string, PeopleAssignment[]>();
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
            shiftId: employeeShiftId[move.employeeId] ?? null,
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
  }, [assignments, pendingMoves, employeeShiftId, date]);

  const absenceByEmployee = useMemo(() => {
    const map = new Map<string, PeopleAbsence>();
    for (const absence of absences) {
      map.set(absence.employeeId, absence);
    }
    return map;
  }, [absences]);

  // qualification = has an ability row ∧ not expired
  const qualifiedAbilitiesByEmployee = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const today = date;
    for (const row of employeeAbilities) {
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
    const map = new Map<string, PeopleCardItem[]>();
    map.set(UNASSIGNED, []);
    for (const workCenter of workCenters) {
      map.set(workCenter.id, []);
    }
    const dayRowsFor = (rows: PeopleAssignment[]) =>
      rows.map((row) => ({
        workCenterId: row.workCenterId,
        hours: row.hours
      }));
    const dayStartFor = (employeeId: string, rows: PeopleAssignment[]) =>
      ladderShiftTime(rows[0]?.shiftId, employeeId, {
        byShift: shiftStartById,
        byEmployee: employeeShiftStart,
        fallback: defaultShiftStart
      });
    const dayEndFor = (employeeId: string, rows: PeopleAssignment[]) =>
      ladderShiftTime(rows[0]?.shiftId, employeeId, {
        byShift: shiftEndById,
        byEmployee: employeeShiftEnd,
        fallback: defaultShiftEnd
      });
    const presentAbsentees: PeopleCardItem[] = [];
    for (const employee of employees) {
      const absence = absenceByEmployee.get(employee.id) ?? null;
      const rows = assignmentsByEmployee.get(employee.id) ?? [];
      const dayRows = dayRowsFor(rows);
      const overtimeForDay = dayOvertime(rows);
      const baseHours = baseShiftHoursFor(employee.id);
      const dayStartTime = dayStartFor(employee.id, rows);
      const dayEndTime = dayEndFor(employee.id, rows);
      // day-scoped note (setPeopleDay writes it to every row)
      const note = rows.find((row) => row.note)?.note ?? null;
      const abilities = employeeAbilityNames[employee.id] ?? [];

      // Absent people always sit (grayed) at the bottom of Unassigned — their
      // assignment rows survive so clearing the absence restores the station.
      if (absence !== null) {
        presentAbsentees.push({
          employee,
          assignment: rows[0] ?? null,
          isAbsent: true,
          absenceId: absence.id,
          missingAbilities: [],
          abilities,
          freeHours: null,
          displayHours: null,
          dayRows,
          overtimeHours: overtimeForDay,
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
          abilities,
          freeHours: null,
          displayHours: Math.round(effectiveHours(row) * 100) / 100,
          dayRows,
          overtimeHours: overtimeForDay,
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
          abilities,
          freeHours: null,
          displayHours: null,
          dayRows,
          overtimeHours: overtimeForDay,
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
            abilities,
            freeHours: Math.round(free * 100) / 100,
            displayHours: null,
            dayRows,
            overtimeHours: overtimeForDay,
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
    shiftId,
    employeeAbilityNames
  ]);

  const submitIntent = (payload: Record<string, string>) => {
    submit(payload, {
      method: "post",
      action: path.to.priorityPeopleUpdate,
      navigate: false,
      fetcherKey: `people:${payload.employeeId ?? payload.id ?? "board"}`
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
      recentDragRef.current = true;
      setActiveItem(data.item as unknown as PeopleCardItem);
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
    const item = activeData.item as unknown as PeopleCardItem;

    // Resolve the target column: a column id directly, or the column of the
    // card we dropped on
    let targetColumnId: string | null = null;
    if (hasDraggableData(over)) {
      const overData = over.data.current;
      if (overData?.type === "column") {
        targetColumnId = String(over.id);
      } else if (overData?.type === "item") {
        const overItem = overData.item as unknown as PeopleCardItem;
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
    onOpen: (item: PeopleCardItem) => {
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
        <PeopleColumn
          id={UNASSIGNED}
          title={t`Unassigned`}
          items={itemsByColumn.get(UNASSIGNED) ?? []}
          isDisabled={isDisabled}
          sticky
          editor={editor}
          cardHandlers={cardHandlers}
        />
        {workCenters.map((workCenter) => (
          <PeopleColumn
            key={workCenter.id}
            id={workCenter.id}
            title={workCenter.name}
            requiredHours={requiredHoursByWorkCenter[workCenter.id] ?? 0}
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
                <PeopleCard
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
        <PeopleHoursModal
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

export { PeopleBoard };
