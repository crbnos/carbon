import { getLogger } from "@carbon/logger";
import { ClientOnly, cn, toast } from "@carbon/react";
import type {
  Active,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  Over
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
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { useFetchers, useSubmit } from "react-router";
import { path } from "~/utils/path";
import { BoardContainer, ColumnCard } from "./components/ColumnCard";
import { JobCard } from "./components/JobCard";
import { KanbanProvider } from "./context/KanbanContext";
import { getDateOnly, getPendingDueDate } from "./date-utils";
import {
  comparePriorityThenId,
  createDragOrigin,
  type DragOrigin,
  type DragPreview,
  getColumnPlacement,
  getItemPlacement,
  isSamePlacement,
  isSamePreview,
  resolveInsertionMarker
} from "./placement";
import type { Column, DisplaySettings, JobItem, Progress } from "./types";
import { hasDraggableData, kanbanCollisionDetection } from "./utils";

const logger = getLogger("erp", "datekanban");

type DateKanbanProps = {
  columns: Column[];
  items: JobItem[];
  locationId: string;
  progressByItemId: Record<string, Progress>;
  tags: { name: string }[];
} & DisplaySettings;

type DateDragOrigin = DragOrigin<JobItem> & {
  dueDate: string | null | undefined;
};

type DateDragState = {
  origin: DateDragOrigin;
  preview: DragPreview | null;
};

const DateDragPreviewContext = createContext<DateDragState | null>(null);

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

function isOriginItemDrag(active: Active, origin: DateDragOrigin) {
  return (
    hasDraggableData(active) &&
    active.data.current?.type === "item" &&
    String(active.id) === origin.item.id
  );
}

function resolveDragPlacement(
  origin: DateDragOrigin,
  over: Over | null,
  items: readonly JobItem[],
  itemsById: ReadonlyMap<string, JobItem>,
  columnsById: ReadonlyMap<string, Column>
): DragPreview | null {
  if (
    !over ||
    over.disabled ||
    !hasDraggableData(over) ||
    !itemsById.has(origin.item.id)
  ) {
    return null;
  }

  const overId = String(over.id);
  if (overId === origin.item.id) {
    return { ...origin.placement, targetType: "item" };
  }

  const overData = over.data.current;
  if (overData?.type === "item") {
    const overItem = itemsById.get(overId);
    if (
      !overItem ||
      overData.item.id !== overId ||
      overData.item.columnId !== overItem.columnId ||
      !columnsById.has(overItem.columnId)
    ) {
      return null;
    }

    const placement = getItemPlacement(
      origin,
      items,
      overItem.columnId,
      overItem.id
    );
    return placement ? { ...placement, targetType: "item" } : null;
  }

  if (overData?.type === "column") {
    if (
      overData.column.id !== overId ||
      !columnsById.has(overId) ||
      overId === origin.placement.columnId
    ) {
      return null;
    }

    const placement = getColumnPlacement(origin, items, overId);
    return placement ? { ...placement, targetType: "column" } : null;
  }

  return null;
}

function usePendingItems(locationId: string) {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  type PendingProjection = {
    id: string;
    priority: number;
    columnId: string;
    dueDate: string | null | undefined;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return (
        fetcher.formAction === path.to.scheduleDatesUpdate &&
        fetcher.formData?.get("locationId") === locationId
      );
    })
    .map((fetcher): PendingProjection => {
      const persistenceColumnId = fetcher.formData.get("columnId");
      const optimisticColumnId = fetcher.formData.get("optimisticColumnId");
      const columnId =
        typeof optimisticColumnId === "string" && optimisticColumnId.length > 0
          ? optimisticColumnId
          : typeof persistenceColumnId === "string"
            ? persistenceColumnId
            : "";
      const id = fetcher.formData.get("id");
      const priority = Number(fetcher.formData.get("priority"));

      return {
        id: typeof id === "string" ? id : "",
        priority,
        columnId,
        dueDate:
          typeof persistenceColumnId === "string"
            ? getPendingDueDate(persistenceColumnId)
            : undefined
      };
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
      if (fetcher.formAction !== path.to.scheduleDatesUpdate) continue;
      const key = fetcher.key;

      if (fetcher.state === "submitting") {
        toastedKeys.current.delete(key);
        continue;
      }

      const data = fetcher.data as
        | { success: boolean; message?: string }
        | undefined;

      if (data?.success === false && !toastedKeys.current.has(key)) {
        toastedKeys.current.add(key);
        // Surface a friendly, translated message; log the raw server detail.
        if (data.message)
          logger.error("Reschedule failed", { error: data.message });
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
  const [columnOrder, setColumnOrder] = useState<string[]>(
    columns.map((col) => col.id)
  );

  // Update column order when columns change (e.g., navigating to a different week/month)
  useEffect(() => {
    setColumnOrder(columns.map((col) => col.id));
  }, [columns]);

  const itemsById = new Map<string, JobItem>(
    initialItems.map((item) => [item.id, item])
  );

  const pendingItems = usePendingItems(locationId);
  useDateUpdateFailureToast();

  // Merge pending items and existing items for optimistic updates
  for (const pendingItem of pendingItems) {
    const item = itemsById.get(pendingItem.id);
    if (item) {
      itemsById.set(pendingItem.id, { ...item, ...pendingItem });
    }
  }

  const baseItems = Array.from(itemsById.values()).sort(comparePriorityThenId);
  const columnsMap = new Map(columns.map((column) => [column.id, column]));
  const dragOriginRef = useRef<DateDragOrigin | null>(null);
  const [dragState, setDragState] = useState<DateDragState | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  function clearDragState() {
    dragOriginRef.current = null;
    setDragState(null);
  }

  function onDragStart(event: DragStartEvent) {
    if (
      !hasDraggableData(event.active) ||
      event.active.data.current?.type !== "item"
    ) {
      clearDragState();
      return;
    }

    const activeItem = itemsById.get(String(event.active.id));
    if (!activeItem || !columnsMap.has(activeItem.columnId)) {
      clearDragState();
      return;
    }

    const placementOrigin = createDragOrigin(baseItems, activeItem);
    if (!placementOrigin) {
      clearDragState();
      return;
    }

    const origin: DateDragOrigin = {
      ...placementOrigin,
      dueDate:
        activeItem.dueDate === undefined
          ? undefined
          : getDateOnly(activeItem.dueDate)
    };
    dragOriginRef.current = origin;
    setDragState({ origin, preview: null });
  }

  function onDragOver(event: DragOverEvent) {
    const origin = dragOriginRef.current;
    if (!origin) return;

    if (!isOriginItemDrag(event.active, origin)) {
      setDragState((current) =>
        current?.origin === origin && isSamePreview(current.preview, null)
          ? current
          : { origin, preview: null }
      );
      return;
    }

    const placement = resolveDragPlacement(
      origin,
      event.over,
      baseItems,
      itemsById,
      columnsMap
    );
    const preview =
      placement && !isSamePlacement(origin.placement, placement)
        ? placement
        : null;

    setDragState((current) =>
      current?.origin === origin && isSamePreview(current.preview, preview)
        ? current
        : { origin, preview }
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const origin = dragOriginRef.current;
    const placement =
      origin && isOriginItemDrag(event.active, origin)
        ? resolveDragPlacement(
            origin,
            event.over,
            baseItems,
            itemsById,
            columnsMap
          )
        : null;

    if (
      origin &&
      origin.dueDate !== undefined &&
      placement &&
      !isSamePlacement(origin.placement, placement)
    ) {
      const isSameDisplayBucket =
        placement.columnId === origin.placement.columnId;
      submit(
        {
          id: origin.item.id,
          locationId,
          columnId: isSameDisplayBucket
            ? (origin.dueDate ?? origin.placement.columnId)
            : placement.columnId,
          optimisticColumnId: placement.columnId,
          priority: placement.priority
        },
        {
          method: "post",
          action: path.to.scheduleDatesUpdate,
          navigate: false,
          flushSync: true,
          fetcherKey: `job:${origin.item.id}`
        }
      );
    }

    clearDragState();
  }

  function onDragCancel() {
    clearDragState();
  }

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
