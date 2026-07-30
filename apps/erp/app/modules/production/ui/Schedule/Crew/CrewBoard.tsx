import {
  Badge,
  Button,
  ClientOnly,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ScrollArea,
  ScrollBar,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger
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
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuEllipsisVertical, LuTriangleAlert, LuUserX } from "react-icons/lu";
import { useFetchers, useSubmit } from "react-router";
import { EmployeeAvatar } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { BoardContainer } from "../Kanban/components/ColumnCard";
import { hasDraggableData } from "../Kanban/utils";

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
};

type CrewCardItem = {
  employee: CrewEmployee;
  assignment: CrewAssignment | null;
  isAbsent: boolean;
  absenceId: string | null;
  missingAbilities: string[];
};

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
      workCenterId: String(fetcher.formData.get("workCenterId") ?? "")
    }));
}

function CrewCard({
  item,
  isOverlay,
  isDisabled,
  onMarkAbsent,
  onClearAbsence,
  onRemove,
  onEditNote
}: {
  item: CrewCardItem;
  isOverlay?: boolean;
  isDisabled?: boolean;
  onMarkAbsent: (employeeId: string) => void;
  onClearAbsence: (absenceId: string) => void;
  onRemove: (assignmentId: string) => void;
  onEditNote: (assignment: CrewAssignment) => void;
}) {
  const { t } = useLingui();
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: item.employee.id,
    data: { type: "item", item },
    disabled: isDisabled || item.isAbsent
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform)
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2",
        !isDisabled && !item.isAbsent && "cursor-grab",
        isDragging && !isOverlay && "opacity-30",
        isOverlay && "ring-2 ring-primary",
        item.isAbsent && "opacity-50"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <EmployeeAvatar employeeId={item.employee.id} size="xs" />
        {item.isAbsent && (
          <Badge variant="secondary">
            <Trans>Absent</Trans>
          </Badge>
        )}
        {item.missingAbilities.length > 0 && !item.isAbsent && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-amber-500 flex-shrink-0">
                <LuTriangleAlert />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t`Missing:`} {item.missingAbilities.join(", ")}
            </TooltipContent>
          </Tooltip>
        )}
        {item.assignment?.note && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-xs text-muted-foreground">
                {item.assignment.note}
              </span>
            </TooltipTrigger>
            <TooltipContent>{item.assignment.note}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {!isDisabled && !isOverlay && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`Options`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
              size="sm"
              onPointerDown={(e) => e.stopPropagation()}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent onPointerDown={(e) => e.stopPropagation()}>
            {item.isAbsent ? (
              <DropdownMenuItem
                onClick={() => item.absenceId && onClearAbsence(item.absenceId)}
              >
                <Trans>Clear absence</Trans>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onMarkAbsent(item.employee.id)}>
                <LuUserX className="mr-2" />
                <Trans>Mark absent today</Trans>
              </DropdownMenuItem>
            )}
            {item.assignment && (
              <>
                <DropdownMenuItem
                  onClick={() =>
                    item.assignment && onRemove(item.assignment.id)
                  }
                >
                  <Trans>Remove from station</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => item.assignment && onEditNote(item.assignment)}
                >
                  <Trans>Note</Trans>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function CrewColumn({
  id,
  title,
  items,
  isDisabled,
  sticky = false,
  cardHandlers
}: {
  id: string;
  title: string;
  items: CrewCardItem[];
  isDisabled: boolean;
  sticky?: boolean;
  cardHandlers: {
    onMarkAbsent: (employeeId: string) => void;
    onClearAbsence: (absenceId: string) => void;
    onRemove: (assignmentId: string) => void;
    onEditNote: (assignment: CrewAssignment) => void;
  };
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
  const itemIds = useMemo(() => items.map((item) => item.employee.id), [items]);
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
                key={item.employee.id}
                item={item}
                isDisabled={isDisabled}
                {...cardHandlers}
              />
            ))}
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
  employees,
  workCenters,
  assignments,
  absences,
  requiredAbilities,
  employeeAbilities
}: CrewBoardProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const submit = useSubmit();
  const isDisabled = !permissions.can("update", "production");

  const [activeItem, setActiveItem] = useState<CrewCardItem | null>(null);
  const [noteAssignment, setNoteAssignment] = useState<CrewAssignment | null>(
    null
  );
  const [noteDraft, setNoteDraft] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const pendingMoves = usePendingMoves();

  // employeeId -> workCenterId (optimistic over loader data)
  const assignmentByEmployee = useMemo(() => {
    const map = new Map<string, CrewAssignment>();
    for (const assignment of assignments) {
      map.set(assignment.employeeId, assignment);
    }
    for (const move of pendingMoves) {
      if (move.intent === "assign") {
        const existing = map.get(move.employeeId);
        map.set(move.employeeId, {
          id: existing?.id ?? `pending:${move.employeeId}`,
          workCenterId: move.workCenterId,
          employeeId: move.employeeId,
          shiftId,
          note: existing?.note ?? null,
          date
        });
      } else {
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
    const presentAbsentees: CrewCardItem[] = [];
    for (const employee of employees) {
      const absence = absenceByEmployee.get(employee.id) ?? null;
      const assignment = assignmentByEmployee.get(employee.id) ?? null;
      const item: CrewCardItem = {
        employee,
        assignment,
        isAbsent: absence !== null,
        absenceId: absence?.id ?? null,
        missingAbilities: assignment
          ? missingAbilitiesFor(employee.id, assignment.workCenterId)
          : []
      };
      // Absent people always sit (grayed) at the bottom of Unassigned — their
      // assignment row survives so clearing the absence restores the station.
      if (item.isAbsent) {
        presentAbsentees.push(item);
      } else if (assignment && map.has(assignment.workCenterId)) {
        map.get(assignment.workCenterId)!.push(item);
      } else {
        map.get(UNASSIGNED)!.push(item);
      }
    }
    map.get(UNASSIGNED)!.push(...presentAbsentees);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    employees,
    workCenters,
    assignmentByEmployee,
    absenceByEmployee,
    requiredByWorkCenter,
    qualifiedAbilitiesByEmployee
  ]);

  const submitIntent = (payload: Record<string, string>) => {
    submit(payload, {
      method: "post",
      action: path.to.scheduleCrewUpdate,
      navigate: false,
      fetcherKey: `crew:${payload.employeeId ?? payload.id ?? "board"}`
    });
  };

  function onDragStart(event: DragStartEvent) {
    if (!hasDraggableData(event.active)) return;
    const data = event.active.data.current;
    if (data?.type === "item") {
      setActiveItem(data.item as unknown as CrewCardItem);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveItem(null);
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

    submitIntent({
      intent: "assign",
      employeeId: item.employee.id,
      workCenterId: targetColumnId,
      locationId,
      date,
      ...(shiftId ? { shiftId } : {})
    });
  }

  const cardHandlers = {
    onMarkAbsent: (employeeId: string) =>
      submitIntent({
        intent: "absent",
        employeeId,
        date,
        ...(shiftId ? { shiftId } : {})
      }),
    onClearAbsence: (absenceId: string) =>
      submitIntent({ intent: "clear-absence", id: absenceId }),
    onRemove: (assignmentId: string) =>
      submitIntent({ intent: "unassign", id: assignmentId }),
    onEditNote: (assignment: CrewAssignment) => {
      setNoteAssignment(assignment);
      setNoteDraft(assignment.note ?? "");
    }
  };

  return (
    <DndContext
      sensors={sensors}
      // the Unassigned column is position: sticky, so droppable rects must be
      // re-measured while dragging (cached rects drift when the board scrolls)
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <BoardContainer>
        <CrewColumn
          id={UNASSIGNED}
          title={t`Unassigned`}
          items={itemsByColumn.get(UNASSIGNED) ?? []}
          isDisabled={isDisabled}
          sticky
          cardHandlers={cardHandlers}
        />
        {workCenters.map((workCenter) => (
          <CrewColumn
            key={workCenter.id}
            id={workCenter.id}
            title={workCenter.name}
            items={itemsByColumn.get(workCenter.id) ?? []}
            isDisabled={isDisabled}
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

      {noteAssignment && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setNoteAssignment(null);
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Note</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setNoteAssignment(null)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                onClick={() => {
                  submitIntent({
                    intent: "note",
                    id: noteAssignment.id,
                    employeeId: noteAssignment.employeeId,
                    note: noteDraft
                  });
                  setNoteAssignment(null);
                }}
              >
                <Trans>Save</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </DndContext>
  );
};

export { CrewBoard };
