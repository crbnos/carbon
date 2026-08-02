import { getLogger } from "@carbon/logger";
import { ClientOnly, toast } from "@carbon/react";
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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetchers, useSubmit } from "react-router";
import { path } from "~/utils/path";
import { BoardContainer, ColumnCard } from "./components/ColumnCard";
import { JobCard } from "./components/JobCard";
import { KanbanProvider } from "./context/KanbanContext";
import type { Column, DisplaySettings, JobItem, Progress } from "./types";
import { hasDraggableData } from "./utils";

const logger = getLogger("erp", "datekanban");

type DateKanbanProps = {
  columns: Column[];
  items: JobItem[];
  progressByItemId: Record<string, Progress>;
  tags: { name: string }[];
} & DisplaySettings;

// Sentinel columns whose drop command intentionally clears the job's due date
// (server sets dueDate = null). Their existing null-producing semantics are
// preserved by this fix.
const SENTINEL_COLUMN_IDS = ["unscheduled", "next-week", "next-month"];

// Immutable snapshot captured when a drag begins. Every preview projection and
// the final drop commit derive from this, never from an intermediate hover.
type DragOrigin = {
  item: JobItem;
  columnId: string; // display bucket at drag start
  dueDate: string | null; // exact persisted due date, or null
  priority: number; // fractional priority at drag start
  slotIndex: number; // logical position among the bucket's other jobs
};

// Gesture-local preview of the active job's placement. Updated on drag-over with
// zero network requests; cleared on drop/cancel.
type DragDraft = { id: string; columnId: string; priority: number };

function usePendingItems() {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.scheduleDatesUpdate;
    })
    .map((fetcher) => {
      const optimisticColumnId = fetcher.formData.get("optimisticColumnId");
      let columnId = optimisticColumnId
        ? String(optimisticColumnId)
        : String(fetcher.formData.get("columnId"));
      let id = String(fetcher.formData.get("id"));
      let priority = Number(fetcher.formData.get("priority"));
      let item: { id: string; priority: number; columnId: string } = {
        id,
        priority,
        columnId
      };
      return item;
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
  progressByItemId,
  tags,
  ...displaySettings
}: DateKanbanProps) => {
  const submit = useSubmit();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // For date-based kanban, always use the column order from props (don't persist)
  const [columnOrder, setColumnOrder] = useState<string[]>(
    columns.map((col) => col.id)
  );

  // Update column order when columns change (e.g., navigating to a different week/month)
  useEffect(() => {
    setColumnOrder(columns.map((col) => col.id));
  }, [columns]);

  // Immutable origin snapshot for the in-flight gesture (drag-start → drop/cancel).
  const originRef = useRef<DragOrigin | null>(null);
  // Gesture-local preview; a drag-over updates this WITHOUT any network request.
  const [draft, setDraft] = useState<DragDraft | null>(null);
  const [activeItem, setActiveItem] = useState<JobItem | null>(null);

  // Base optimistic projection: loader items merged with in-flight drop commits
  // (their per-job fetchers), independent of the current gesture draft.
  const itemsById = new Map<string, JobItem>(
    initialItems.map((item) => [item.id, item])
  );

  const pendingItems = usePendingItems();
  useDateUpdateFailureToast();

  // Merge pending items and existing items for optimistic updates
  for (let pendingItem of pendingItems) {
    let item = itemsById.get(pendingItem.id);
    if (item) {
      itemsById.set(pendingItem.id, { ...item, ...pendingItem });
    }
  }

  // Neighbor math (priority, slot, before/after) reads the base projection so it
  // is path-independent and never sees the active job's own moving preview.
  const baseItems = Array.from(itemsById.values()).sort(
    (a, b) => a.priority - b.priority
  );

  // Rendered items layer the gesture-local draft on top of the base projection so
  // the card follows the pointer/keyboard without persisting anything.
  const renderById = new Map(itemsById);
  if (draft) {
    const active = renderById.get(draft.id);
    if (active) {
      renderById.set(draft.id, {
        ...active,
        columnId: draft.columnId,
        priority: draft.priority
      });
    }
  }
  const items = Array.from(renderById.values()).sort(
    (a, b) => a.priority - b.priority
  );

  const columnIdSet = new Set(columns.map((col) => col.id));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  // Derive the display bucket + fractional priority for a drop/preview target.
  // Returns null for a null/missing/self/stale target. Neighbor math excludes the
  // active job and reads the drag-start priority, so a direct and a circuitous
  // drag ending on the same target produce the same command.
  function computePlacement(
    over: DragOverEvent["over"]
  ): { columnId: string; priority: number } | null {
    const origin = originRef.current;
    if (!over || !origin) return null;

    const overId = over.id.toString();
    if (overId === origin.item.id) return null; // self target

    const overData = over.data.current;

    // Column background / empty column: retain the drag-start priority.
    if (overData?.type === "column") {
      if (!columnIdSet.has(overId)) return null; // stale target
      return { columnId: overId, priority: origin.priority };
    }

    // Card target.
    if (overData?.type === "item") {
      const overItem = itemsById.get(overId);
      if (!overItem) return null; // stale target
      const columnId = overItem.columnId;

      const columnItems = baseItems.filter(
        (item) => item.columnId === columnId && item.id !== origin.item.id
      );

      const movingWithinBucket = columnId === origin.columnId;
      const movingUp = origin.priority > overItem.priority;

      let priorityBefore = 0;
      let priorityAfter = 0;

      if (!movingWithinBucket || movingUp) {
        // Upward within a bucket, or any cross-bucket move: place BEFORE target.
        priorityAfter = overItem.priority;
        const predecessors = columnItems.filter(
          (item) => item.priority < priorityAfter
        );
        priorityBefore = predecessors.length
          ? predecessors[predecessors.length - 1].priority
          : 0;
      } else {
        // Downward within a bucket: place AFTER target.
        priorityBefore = overItem.priority;
        priorityAfter =
          columnItems.find((item) => item.priority > priorityBefore)
            ?.priority ?? priorityBefore + 1;
      }

      return { columnId, priority: (priorityBefore + priorityAfter) / 2 };
    }

    return null;
  }

  function onDragStart(event: DragStartEvent) {
    if (!hasDraggableData(event.active)) return;
    const data = event.active.data.current;

    // Only handle item dragging, not column dragging (dates are fixed)
    if (data?.type !== "item") return;

    const item = data.item as JobItem;
    const columnOthers = baseItems.filter(
      (other) => other.columnId === item.columnId && other.id !== item.id
    );

    originRef.current = {
      item,
      columnId: item.columnId,
      dueDate: item.dueDate ?? null,
      priority: item.priority,
      slotIndex: columnOthers.filter((other) => other.priority < item.priority)
        .length
    };
    setDraft(null);
    setActiveItem(item);
  }

  // Drag-over is preview-only: update gesture-local state, never submit. A
  // null/missing/invalid/stale/self target restores the origin projection rather
  // than retaining an earlier valid hover.
  function onDragOver(event: DragOverEvent) {
    const origin = originRef.current;
    if (!origin) return;
    const placement = computePlacement(event.over);
    setDraft(placement ? { id: origin.item.id, ...placement } : null);
  }

  // Drag-end is the single commit boundary. Recompute from the FINAL target and
  // submit at most one request, only when the placement differs from the origin.
  function onDragEnd(event: DragEndEvent) {
    const origin = originRef.current;
    setDraft(null);
    setActiveItem(null);
    originRef.current = null;
    if (!origin) return;

    // Cancel / outside / invalid / stale / self all resolve to no placement.
    const placement = computePlacement(event.over);
    if (!placement) return;

    // Returning to the original logical slot in the same bucket is a no-op even
    // if the recomputed fractional priority differs.
    if (placement.columnId === origin.columnId) {
      const others = baseItems.filter(
        (item) =>
          item.columnId === origin.columnId && item.id !== origin.item.id
      );
      const newSlotIndex = others.filter(
        (item) => item.priority < placement.priority
      ).length;
      if (newSlotIndex === origin.slotIndex) return;
    }

    // Display bucket and persistence command are distinct. A same-bucket reorder
    // persists the job's exact original due date (or its source sentinel), so the
    // due date is never rewritten to the bucket's first day.
    const isSentinel = SENTINEL_COLUMN_IDS.includes(placement.columnId);
    const persistedColumnId =
      !isSentinel && placement.columnId === origin.columnId
        ? (origin.dueDate ?? origin.columnId)
        : placement.columnId;

    const payload: Record<string, string | number> = {
      id: origin.item.id,
      columnId: persistedColumnId,
      priority: placement.priority
    };
    // Diverge the optimistic display bucket from the persistence command only
    // when they actually differ (same-bucket reorder), matching the inline
    // due-date editor's payload shape.
    if (placement.columnId !== persistedColumnId) {
      payload.optimisticColumnId = placement.columnId;
    }

    submit(payload, {
      method: "post",
      action: path.to.scheduleDatesUpdate,
      navigate: false,
      fetcherKey: `job:${origin.item.id}`
    });
  }

  // Escape / cancellation restores the origin and submits nothing.
  function onDragCancel() {
    setDraft(null);
    setActiveItem(null);
    originRef.current = null;
  }

  const columnsMap = new Map(columns.map((col) => [col.id, col]));

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
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragCancel={onDragCancel}
      >
        <BoardContainer>
          {columnOrder.map((colId) => {
            const col = columnsMap.get(colId);
            if (!col) return null;
            return (
              <ColumnCard
                key={col.id}
                column={col}
                items={items.filter((item) => item.columnId === col.id)}
                progressByItemId={progressByItemId}
                isDateView={true}
                disableColumnDrag={true}
                CardComponent={JobCard as any}
              />
            );
          })}
        </BoardContainer>

        <ClientOnly fallback={null}>
          {() =>
            createPortal(
              <DragOverlay>
                {activeItem && (
                  <JobCard
                    item={{
                      ...activeItem,
                      status: progressByItemId[activeItem.id]?.active
                        ? "In Progress"
                        : activeItem.status,
                      employeeIds: progressByItemId[activeItem.id]?.employees
                        ? Array.from(progressByItemId[activeItem.id].employees!)
                        : undefined,
                      progress: progressByItemId[activeItem.id]?.progress ?? 0
                    }}
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
    </KanbanProvider>
  );
};

export { DateKanban };
