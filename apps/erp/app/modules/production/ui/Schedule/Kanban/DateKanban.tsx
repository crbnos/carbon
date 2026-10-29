// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { ClientOnly, cn, toast } from "@carbon/react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent
} from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useLingui } from "@lingui/react/macro";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { useFetchers, useSubmit } from "react-router";
import { path } from "~/utils/path";
import { BoardContainer, ColumnCard } from "./components/ColumnCard";
import { JobCard } from "./components/JobCard";
import { type KanbanMoveTo, KanbanProvider } from "./context/KanbanContext";
import {
  type BoardDragEvent,
  createDateDragOrigin,
  type DateSubmission,
  type DatesDragState,
  datePlacementSubmission,
  mergePendingDateMoves,
  pendingDateMoves,
  reduceDatesDrag
} from "./drag-lifecycle";
import {
  comparePriorityThenId,
  getColumnPlacement,
  resolveInsertionMarker
} from "./placement";
import type { Column, DisplaySettings, JobItem, Progress } from "./types";
import { kanbanCollisionDetection } from "./utils";

// Module constants: a new options object makes a new sensor, and with it new
// listeners for every draggable on every render.
const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates
};

const logger = getLogger("erp", "datekanban");

type DateKanbanProps = {
  columns: Column[];
  items: JobItem[];
  locationId: string;
  progressByItemId: Record<string, Progress>;
  tags: { name: string }[];
} & DisplaySettings;

const DateDragPreviewContext = createContext<DatesDragState>(null);

type DatePreviewJobCardProps = {
  item: JobItem;
  locationId: string;
  isOverlay?: boolean;
  progressByItemId: Record<string, Progress>;
};

function DatePreviewJobCard({
  item,
  locationId,
  isOverlay,
  progressByItemId
}: DatePreviewJobCardProps) {
  const dragState = useContext(DateDragPreviewContext);
  const preview = dragState?.preview;
  const marker =
    preview?.targetType === "item" && preview.columnId === item.columnId
      ? resolveInsertionMarker(preview.slot)
      : null;
  const showBefore = marker?.itemId === item.id && marker.position === "before";
  const showAfter = marker?.itemId === item.id && marker.position === "after";

  return (
    <div className="relative max-w-[330px]">
      {(showBefore || showAfter) && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-2 z-20 h-0.5 rounded-full bg-primary",
            showBefore ? "-top-1" : "-bottom-1"
          )}
        />
      )}
      <JobCard
        item={item}
        locationId={locationId}
        isOverlay={isOverlay}
        progressByItemId={progressByItemId}
      />
    </div>
  );
}

function usePendingItems(locationId: string) {
  return pendingDateMoves(useFetchers(), {
    action: path.to.priorityDatesUpdate,
    locationId
  });
}

// Surface reschedule failures. useFetchers() returns only in-flight fetchers in
// this React Router version, so the action result is read during the post-submit
// "loading" (revalidation) phase — comparing fetcher.state to "idle" is not
// possible here. Dedup per fetcher.key and reset while "submitting" so a later
// failure re-toasts.
function useDateUpdateFailureToast() {
  const { t } = useLingui();
  const fetchers = useFetchers();
  const toastedKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const fetcher of fetchers) {
      if (fetcher.formAction !== path.to.priorityDatesUpdate) continue;
      const key = fetcher.key;

      if (fetcher.state === "submitting") {
        toastedKeys.current.delete(key);
        continue;
      }

      const data = fetcher.data as
        | { error?: { message?: string } | null; fieldErrors?: unknown }
        | undefined;
      const failed = !!data?.error || !!data?.fieldErrors;

      if (failed && !toastedKeys.current.has(key)) {
        toastedKeys.current.add(key);
        // Surface a friendly, translated message; log the raw server detail.
        if (data?.error?.message)
          logger.error("Reschedule failed", { error: data.error.message });
        toast.error(t`Couldn't reschedule the job. Please try again.`);
      }
    }
  }, [fetchers, t]);
}

const DateKanban = ({
  columns,
  items: initialItems,
  locationId,
  progressByItemId,
  tags,
  ...displaySettings
}: DateKanbanProps) => {
  const submit = useSubmit();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const DateCardComponent = useCallback(
    (props: Omit<DatePreviewJobCardProps, "locationId">) => (
      <DatePreviewJobCard {...props} locationId={locationId} />
    ),
    [locationId]
  );

  // For date-based kanban, always use the column order from props (don't persist)
  const columnOrder = useMemo(() => columns.map((col) => col.id), [columns]);

  const pendingItems = usePendingItems(locationId);
  useDateUpdateFailureToast();

  // Merge pending items and existing items for optimistic updates
  const itemsById = mergePendingDateMoves(initialItems, pendingItems);

  const baseItems = Array.from(itemsById.values()).sort(comparePriorityThenId);
  const columnsMap = new Map(columns.map((column) => [column.id, column]));
  // A ref, not state: dnd-kit can fire the next event before a re-render.
  const dragRef = useRef<DatesDragState>(null);
  const [dragState, setDragState] = useState<DatesDragState>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)
  );

  function dispatchDrag(event: BoardDragEvent) {
    const { state, submission } = reduceDatesDrag(dragRef.current, event, {
      items: baseItems,
      itemsById,
      columnsById: columnsMap,
      locationId
    });
    if (submission) submitDate(submission);
    dragRef.current = state;
    setDragState(state);
  }

  function onDragStart(event: DragStartEvent) {
    dispatchDrag({ type: "start", active: event.active });
  }

  function onDragOver(event: DragOverEvent) {
    dispatchDrag({ type: "over", active: event.active, over: event.over });
  }

  function onDragEnd(event: DragEndEvent) {
    dispatchDrag({ type: "end", active: event.active, over: event.over });
  }

  function onDragCancel() {
    dispatchDrag({ type: "cancel" });
  }

  function submitDate(submission: DateSubmission) {
    submit(submission, {
      method: "post",
      action: path.to.priorityDatesUpdate,
      navigate: false,
      flushSync: true,
      fetcherKey: `job:${submission.id}`
    });
  }

  // Phones: "Move to" on a card makes the same move as dropping it on that
  // column's background.
  const moveTo: KanbanMoveTo = {
    targetsFor: (itemId) => {
      const item = itemsById.get(itemId);
      if (!item || item.dueDate === undefined) return [];
      return columnOrder.flatMap((columnId) => {
        const column = columnsMap.get(columnId);
        return column && column.id !== item.columnId
          ? [{ id: column.id, title: column.title }]
          : [];
      });
    },
    onMove: (itemId, columnId) => {
      const activeItem = itemsById.get(itemId);
      const origin = activeItem
        ? createDateDragOrigin(baseItems, activeItem)
        : null;
      if (!origin) return;
      const placement = getColumnPlacement(origin, baseItems, columnId);
      const submission = placement
        ? datePlacementSubmission(origin, placement, locationId)
        : null;
      if (submission) submitDate(submission);
    }
  };

  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
  }, []);

  return (
    <KanbanProvider
      displaySettings={displaySettings}
      selectedGroup={selectedGroup}
      setSelectedGroup={setSelectedGroup}
      tags={tags}
      columnIds={columns.map((col) => col.id)}
      moveTo={moveTo}
    >
      <DateDragPreviewContext.Provider value={dragState}>
        <DndContext
          sensors={sensors}
          collisionDetection={kanbanCollisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragCancel={onDragCancel}
        >
          <BoardContainer>
            {columnOrder.map((colId) => {
              const col = columnsMap.get(colId);
              if (!col) return null;
              const columnItems = baseItems.filter(
                (item) => item.columnId === col.id
              );
              const showColumnPreview =
                dragState?.preview?.targetType === "column" &&
                dragState.preview.columnId === col.id;

              return (
                <div key={col.id} className="relative flex flex-shrink-0">
                  <ColumnCard
                    column={col}
                    items={columnItems}
                    progressByItemId={progressByItemId}
                    isDateView={true}
                    disableColumnDrag={true}
                    CardComponent={DateCardComponent}
                  />
                  {showColumnPreview && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-1 z-20 ring-2 ring-inset ring-primary"
                    />
                  )}
                </div>
              );
            })}
          </BoardContainer>

          <ClientOnly fallback={null}>
            {() =>
              createPortal(
                <DragOverlay>
                  {dragState && (
                    <JobCard
                      item={{
                        ...dragState.origin.item,
                        status: progressByItemId[dragState.origin.item.id]
                          ?.active
                          ? "In Progress"
                          : dragState.origin.item.status,
                        employeeIds: progressByItemId[dragState.origin.item.id]
                          ?.employees
                          ? Array.from(
                              progressByItemId[dragState.origin.item.id]
                                .employees!
                            )
                          : undefined,
                        progress:
                          progressByItemId[dragState.origin.item.id]
                            ?.progress ?? 0
                      }}
                      locationId={locationId}
                      isOverlay
                      progressByItemId={progressByItemId}
                    />
                  )}
                </DragOverlay>,
                document.body
              )
            }
          </ClientOnly>
        </DndContext>
      </DateDragPreviewContext.Provider>
    </KanbanProvider>
  );
};

export { DateKanban };
