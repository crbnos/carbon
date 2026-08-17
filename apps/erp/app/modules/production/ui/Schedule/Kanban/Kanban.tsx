import { ClientOnly, cn } from "@carbon/react";
import type {
  Active,
  Announcements,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  Over,
  UniqueIdentifier
} from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { arrayMove, SortableContext } from "@dnd-kit/sortable";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetchers, useSubmit } from "react-router";
import { path } from "~/utils/path";
import { BoardContainer, ColumnCard } from "./components/ColumnCard";
import { ItemCard } from "./components/ItemCard";
import { KanbanProvider } from "./context/KanbanContext";
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
import type { Column, DisplaySettings, Item, Progress } from "./types";
import {
  coordinateGetter,
  hasDraggableData,
  kanbanCollisionDetection
} from "./utils";

type KanbanProps = {
  columns: Column[];
  items: Item[];
  progressByItemId: Record<string, Progress>;
  tags: { name: string }[];
} & DisplaySettings;

const COLUMN_ORDER_KEY = "kanban-column-order";

type OperationDragOrigin = DragOrigin<Item>;

type KanbanDragState = {
  origin: OperationDragOrigin;
  preview: DragPreview | null;
};

const KanbanDragPreviewContext = createContext<KanbanDragState | null>(null);

function PreviewItemCard({
  item,
  isOverlay,
  progressByItemId
}: {
  item: Item;
  isOverlay?: boolean;
  progressByItemId: Record<string, Progress>;
}) {
  const dragState = useContext(KanbanDragPreviewContext);
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
      <ItemCard
        item={item}
        isOverlay={isOverlay}
        progressByItemId={progressByItemId}
      />
    </div>
  );
}

function isOriginItemDrag(active: Active, origin: OperationDragOrigin) {
  return (
    hasDraggableData(active) &&
    active.data.current?.type === "item" &&
    String(active.id) === origin.item.id
  );
}

function resolveDragPlacement(
  origin: OperationDragOrigin,
  over: Over | null,
  items: readonly Item[],
  itemsById: ReadonlyMap<string, Item>,
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

    const destinationColumn = columnsById.get(overItem.columnId);
    if (!destinationColumn?.type.includes(origin.item.columnType)) {
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

    const destinationColumn = columnsById.get(overId);
    if (!destinationColumn?.type.includes(origin.item.columnType)) {
      return null;
    }

    const placement = getColumnPlacement(origin, items, overId);
    return placement ? { ...placement, targetType: "column" } : null;
  }

  return null;
}

const Kanban = ({
  columns,
  items: initialItems,
  progressByItemId,
  tags,
  ...displaySettings
}: KanbanProps) => {
  const submit = useSubmit();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    // Get stored column order from localStorage
    const storedOrder = localStorage.getItem(COLUMN_ORDER_KEY);
    if (storedOrder) {
      const parsedOrder = JSON.parse(storedOrder) as string[];
      // Add any new columns that aren't in stored order
      const newOrder = [...parsedOrder];
      columns.forEach((col) => {
        if (!newOrder.includes(col.id)) {
          newOrder.push(col.id);
        }
      });
      return newOrder;
    }
    return columns.map((col) => col.id);
  });

  // Update localStorage when column order changes
  useEffect(() => {
    localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(columnOrder));
  }, [columnOrder]);

  const itemsById = new Map<string, Item>(
    initialItems.map((item) => [item.id, item])
  );
  const pendingItems = usePendingItems();

  // merge pending items and existing items
  for (const pendingItem of pendingItems) {
    const item = itemsById.get(pendingItem.id);
    if (item) {
      itemsById.set(pendingItem.id, { ...item, ...pendingItem });
    }
  }

  const items = Array.from(itemsById.values()).sort(comparePriorityThenId);
  const columnsById = new Map(columns.map((column) => [column.id, column]));

  const pickedUpItemColumn = useRef<string | null>(null);
  const dragOriginRef = useRef<OperationDragOrigin | null>(null);
  const dragTypeRef = useRef<"item" | "column" | null>(null);
  const [dragState, setDragState] = useState<KanbanDragState | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [activeItem, setActiveItem] = useState<Item | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter
    })
  );

  function getDraggingItemData(itemId: UniqueIdentifier, columnId: string) {
    const itemsInColumn = items.filter((item) => item.columnId === columnId);
    const itemPosition = itemsInColumn.findIndex((item) => item.id === itemId);
    const column = columns.find((col) => col.id === columnId);
    return {
      itemsInColumn,
      itemPosition,
      column
    };
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      if (!hasDraggableData(active)) return;
      if (active.data.current?.type === "column") {
        const startIndex = columnOrder.findIndex((id) => id === active.id);
        const startColumn = columns.find((col) => col.id === active.id);
        return `Picked up Column ${startColumn?.title} at position: ${
          startIndex + 1
        } of ${columnOrder.length}`;
      } else if (active.data.current?.type === "item") {
        pickedUpItemColumn.current = active.data.current.item.columnId;
        const { itemsInColumn, itemPosition, column } = getDraggingItemData(
          active.id,
          pickedUpItemColumn.current
        );
        return `Picked up Item ${active.data.current.item.title} at position: ${
          itemPosition + 1
        } of ${itemsInColumn.length} in column ${column?.title}`;
      }
    },
    onDragOver({ active, over }) {
      if (!hasDraggableData(active) || !hasDraggableData(over)) return;

      if (
        active.data.current?.type === "column" &&
        over.data.current?.type === "column"
      ) {
        const overIndex = columnOrder.findIndex((id) => id === over.id);
        return `Column ${active.data.current.column.title} was moved over ${
          over.data.current.column.title
        } at position ${overIndex + 1} of ${columnOrder.length}`;
      } else if (
        active.data.current?.type === "item" &&
        over.data.current?.type === "item"
      ) {
        const { itemsInColumn, itemPosition, column } = getDraggingItemData(
          over.id,
          over.data.current.item.columnId
        );
        if (over.data.current.item.columnId !== pickedUpItemColumn.current) {
          return `Item ${
            active.data.current.item.title
          } was moved over column ${column?.title} in position ${
            itemPosition + 1
          } of ${itemsInColumn.length}`;
        }
        return `Item was moved over position ${itemPosition + 1} of ${
          itemsInColumn.length
        } in column ${column?.title}`;
      }
    },
    onDragEnd({ active, over }) {
      if (!hasDraggableData(active) || !hasDraggableData(over)) {
        pickedUpItemColumn.current = null;
        return;
      }
      if (
        active.data.current?.type === "column" &&
        over.data.current?.type === "column"
      ) {
        const overColumnPosition = columnOrder.findIndex(
          (id) => id === over.id
        );

        return `Column ${
          active.data.current.column.title
        } was dropped into position ${overColumnPosition + 1} of ${
          columnOrder.length
        }`;
      } else if (
        active.data.current?.type === "item" &&
        over.data.current?.type === "item"
      ) {
        const { itemsInColumn, itemPosition, column } = getDraggingItemData(
          over.id,
          over.data.current.item.columnId
        );
        if (over.data.current.item.columnId !== pickedUpItemColumn.current) {
          return `Item was dropped into column ${column?.title} in position ${
            itemPosition + 1
          } of ${itemsInColumn.length}`;
        }
        return `Item was dropped into position ${itemPosition + 1} of ${
          itemsInColumn.length
        } in column ${column?.title}`;
      }
      pickedUpItemColumn.current = null;
    },
    onDragCancel({ active }) {
      pickedUpItemColumn.current = null;
      if (!hasDraggableData(active)) return;
      return `Dragging ${active.data.current?.type} cancelled.`;
    }
  };

  return (
    <KanbanProvider
      displaySettings={displaySettings}
      selectedGroup={selectedGroup}
      setSelectedGroup={setSelectedGroup}
      tags={tags}
    >
      <KanbanDragPreviewContext.Provider value={dragState}>
        <DndContext
          accessibility={{
            announcements
          }}
          sensors={sensors}
          collisionDetection={kanbanCollisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragCancel={onDragCancel}
        >
          <BoardContainer>
            <SortableContext items={columnOrder}>
              {columnOrder.map((colId) => {
                const col = columns.find((c) => c.id === colId);
                if (!col) return null;
                return (
                  <ColumnCard
                    key={col.id}
                    column={col}
                    items={items.filter((item) => item.columnId === col.id)}
                    progressByItemId={progressByItemId}
                    CardComponent={PreviewItemCard}
                  />
                );
              })}
            </SortableContext>
          </BoardContainer>

          <ClientOnly fallback={null}>
            {() =>
              createPortal(
                <DragOverlay>
                  {activeColumn && (
                    <ColumnCard
                      isOverlay
                      column={activeColumn}
                      items={items.filter(
                        (item) => item.columnId === activeColumn.id
                      )}
                      progressByItemId={progressByItemId}
                    />
                  )}
                  {activeItem && (
                    <ItemCard
                      // @ts-expect-error TS2322 - TODO: fix type
                      item={{
                        ...activeItem,
                        status: progressByItemId[activeItem.id]?.active
                          ? "In Progress"
                          : activeItem.status,
                        employeeIds: progressByItemId[activeItem.id]?.employees
                          ? Array.from(
                              progressByItemId[activeItem.id].employees!
                            )
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
      </KanbanDragPreviewContext.Provider>
    </KanbanProvider>
  );

  function clearDragState() {
    pickedUpItemColumn.current = null;
    dragOriginRef.current = null;
    dragTypeRef.current = null;
    setDragState(null);
    setActiveItem(null);
    setActiveColumn(null);
  }

  function onDragStart(event: DragStartEvent) {
    if (!hasDraggableData(event.active)) {
      clearDragState();
      return;
    }

    const data = event.active.data.current;
    if (data?.type === "column") {
      clearDragState();
      dragTypeRef.current = "column";
      setActiveColumn(data.column);
      return;
    }

    if (data?.type === "item") {
      clearDragState();
      const activeItem = itemsById.get(String(event.active.id));
      const origin = activeItem ? createDragOrigin(items, activeItem) : null;

      if (!origin) return;

      dragOriginRef.current = origin;
      dragTypeRef.current = "item";
      pickedUpItemColumn.current = data.item.columnId;
      setDragState({ origin, preview: null });
      setActiveItem(data.item);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const origin = dragOriginRef.current;
    const { active, over } = event;
    const activeData = hasDraggableData(active)
      ? active.data.current
      : undefined;

    if (
      !dragTypeRef.current ||
      !hasDraggableData(active) ||
      !over ||
      !hasDraggableData(over)
    ) {
      clearDragState();
      return;
    }

    if (
      dragTypeRef.current === "column" &&
      activeData?.type === "column" &&
      over.data.current?.type === "column"
    ) {
      const activeId = active.id;
      const overId = over.id;
      if (activeId !== overId) {
        const activeColumnIndex = columnOrder.findIndex(
          (id) => id === activeId
        );
        const overColumnIndex = columnOrder.findIndex((id) => id === overId);

        if (activeColumnIndex >= 0 && overColumnIndex >= 0) {
          setColumnOrder(
            arrayMove(columnOrder, activeColumnIndex, overColumnIndex)
          );
        }
      }
      clearDragState();
      return;
    }

    if (
      dragTypeRef.current === "item" &&
      activeData?.type === "item" &&
      origin &&
      isOriginItemDrag(active, origin)
    ) {
      const placement = resolveDragPlacement(
        origin,
        over,
        items,
        itemsById,
        columnsById
      );

      if (placement && !isSamePlacement(origin.placement, placement)) {
        submit(
          {
            id: origin.item.id,
            columnId: placement.columnId,
            priority: placement.priority
          },
          {
            method: "post",
            action: path.to.scheduleOperationUpdate,
            navigate: false,
            flushSync: true,
            fetcherKey: `item:${origin.item.id}`
          }
        );
      }
    }

    clearDragState();
  }

  function onDragOver(event: DragOverEvent) {
    const origin = dragOriginRef.current;
    if (!origin || !isOriginItemDrag(event.active, origin)) return;

    const placement = resolveDragPlacement(
      origin,
      event.over,
      items,
      itemsById,
      columnsById
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

  function onDragCancel() {
    clearDragState();
  }
};

function usePendingItems() {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.scheduleOperationUpdate;
    })
    .map((fetcher) => {
      let columnId = String(fetcher.formData.get("columnId"));
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

export default Kanban;
