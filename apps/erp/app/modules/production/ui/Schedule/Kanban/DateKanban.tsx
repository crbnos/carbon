import { getLogger } from "@carbon/logger";
import { ClientOnly, toast } from "@carbon/react";
import type { DragOverEvent, DragStartEvent } from "@dnd-kit/core";
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

  const items = Array.from(itemsById.values()).sort(
    (a, b) => a.priority - b.priority
  );

  const [activeItem, setActiveItem] = useState<JobItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  function onDragStart(event: DragStartEvent) {
    if (!hasDraggableData(event.active)) return;
    const data = event.active.data.current;

    // Only handle item dragging, not column dragging (dates are fixed)
    if (data?.type === "item") {
      setActiveItem(data.item as JobItem);
      return;
    }
  }

  function onDragEnd() {
    setActiveItem(null);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    if (!hasDraggableData(active) || !hasDraggableData(over)) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    const isActiveAnItem = activeData?.type === "item";
    const isOverAnItem = overData?.type === "item";

    if (!isActiveAnItem) return;

    const activeItem = itemsById.get(activeId.toString());
    const overItem = itemsById.get(overId.toString());

    // Dropping a job over another job
    if (isActiveAnItem && isOverAnItem && activeItem && overItem) {
      // Calculate priority
      let priorityBefore = 0;
      let priorityAfter = 0;

      if (
        activeItem.priority > overItem.priority ||
        activeItem.columnId !== overItem.columnId
      ) {
        priorityAfter = overItem.priority;

        for (let i = items.length - 1; i >= 0; i--) {
          const item = items[i];
          if (
            item.columnId === overItem.columnId &&
            item.priority < priorityAfter
          ) {
            priorityBefore = item.priority ?? 0;
            break;
          }
        }
      } else {
        priorityBefore = overItem.priority;
        priorityAfter =
          items.find(
            (item) =>
              item.columnId === overItem.columnId &&
              item.priority > priorityBefore
          )?.priority ?? priorityBefore + 1;
      }

      const newPriority = (priorityBefore + priorityAfter) / 2;

      // Submit update when moving to a different column (date)
      if (activeItem.columnId !== overItem.columnId) {
        submit(
          {
            id: activeItem.id,
            columnId: overItem.columnId,
            priority: newPriority
          },
          {
            method: "post",
            action: path.to.scheduleDatesUpdate,
            navigate: false,
            fetcherKey: `job:${activeItem.id}`
          }
        );
        return;
      }

      // Update priority within the same column
      if (activeItem && overItem) {
        submit(
          {
            id: activeItem.id,
            columnId: activeItem.columnId,
            priority: newPriority
          },
          {
            method: "post",
            action: path.to.scheduleDatesUpdate,
            navigate: false,
            fetcherKey: `job:${activeItem.id}`
          }
        );
      }
    }

    const isOverAColumn = overData?.type === "column";

    // Dropping a job over a column
    if (isActiveAnItem && isOverAColumn && activeItem) {
      const newColumnId = overId as string;

      if (activeItem.columnId !== newColumnId) {
        submit(
          {
            id: activeItem.id,
            columnId: newColumnId,
            priority: activeItem.priority
          },
          {
            method: "post",
            action: path.to.scheduleDatesUpdate,
            navigate: false,
            fetcherKey: `job:${activeItem.id}`
          }
        );
      }
    }
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
