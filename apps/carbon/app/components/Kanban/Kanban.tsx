import { ClientOnly } from "@carbon/react";
import type {
  Announcements,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
} from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove } from "@dnd-kit/sortable";
import { useFetchers, useSubmit } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { path } from "~/utils/path";
import { BoardContainer, ColumnCard } from "./components/ColumnCard";
import { ItemCard } from "./components/ItemCard";
import type { Column, DisplaySettings, Item } from "./types";
import { coordinateGetter, hasDraggableData } from "./utils";

type KanbanProps = {
  columns: Column[];
  items: Item[];
} & DisplaySettings;

const Kanban = ({
  columns: initialColumns,
  items: initialItems,
  ...displaySettings
}: KanbanProps) => {
  const submit = useSubmit();
  const [columns, setColumns] = useState<Column[]>(initialColumns);

  const itemsById = new Map<string, Item>(
    initialItems.map((item) => [item.id, item])
  );
  const pendingItems = usePendingItems();

  // merge pending items and existing items
  for (let pendingItem of pendingItems) {
    let item = itemsById.get(pendingItem.id);
    if (item) {
      itemsById.set(pendingItem.id, { ...item, ...pendingItem });
    }
  }

  const items = Array.from(itemsById.values());

  const columnIds = useMemo(() => columns.map((col) => col.id), [columns]);

  const pickedUpItemColumn = useRef<string | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [activeItem, setActiveItem] = useState<Item | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter,
    })
  );

  function getDraggingItemData(itemId: UniqueIdentifier, columnId: string) {
    const itemsInColumn = items.filter((item) => item.columnId === columnId);
    const itemPosition = itemsInColumn.findIndex((item) => item.id === itemId);
    const column = columns.find((col) => col.id === columnId);
    return {
      itemsInColumn,
      itemPosition,
      column,
    };
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      if (!hasDraggableData(active)) return;
      if (active.data.current?.type === "column") {
        const startstringx = columnIds.findIndex((id) => id === active.id);
        const startColumn = columns[startstringx];
        return `Picked up Column ${startColumn?.title} at position: ${
          startstringx + 1
        } of ${columnIds.length}`;
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
        const overstringx = columnIds.findIndex((id) => id === over.id);
        return `Column ${active.data.current.column.title} was moved over ${
          over.data.current.column.title
        } at position ${overstringx + 1} of ${columnIds.length}`;
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
        const overColumnPosition = columnIds.findIndex((id) => id === over.id);

        return `Column ${
          active.data.current.column.title
        } was dropped into position ${overColumnPosition + 1} of ${
          columnIds.length
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
    },
  };

  return (
    <DndContext
      accessibility={{
        announcements,
      }}
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
    >
      <BoardContainer>
        <SortableContext items={columnIds}>
          {columns.map((col) => (
            <ColumnCard
              key={col.id}
              column={col}
              items={items.filter((item) => item.columnId === col.id)}
              {...displaySettings}
            />
          ))}
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
                  {...displaySettings}
                />
              )}
              {activeItem && (
                <ItemCard item={activeItem} isOverlay {...displaySettings} />
              )}
            </DragOverlay>,
            document.body
          )
        }
      </ClientOnly>
    </DndContext>
  );

  function onDragStart(event: DragStartEvent) {
    if (!hasDraggableData(event.active)) return;
    const data = event.active.data.current;
    if (data?.type === "column") {
      setActiveColumn(data.column);
      return;
    }

    if (data?.type === "item") {
      setActiveItem(data.item);
      return;
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveColumn(null);
    setActiveItem(null);

    const { active, over } = event;

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (!hasDraggableData(active)) return;

    const activeData = active.data.current;

    if (activeId === overId) return;

    const isActiveAColumn = activeData?.type === "column";
    if (!isActiveAColumn) return;

    setColumns((columns) => {
      const activeColumnIndex = columns.findIndex((col) => col.id === activeId);
      const overColumnIndex = columns.findIndex((col) => col.id === overId);

      return arrayMove(columns, activeColumnIndex, overColumnIndex);
    });
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
    const overColumn =
      overData?.type === "item"
        ? columns.find((col) => col.id === overData.item.columnId)
        : overData?.column;

    const isActiveAItem = activeData?.type === "item";
    const isOverAItem = overData?.type === "item";

    if (!isActiveAItem) return;
    // only allow drop if column type array includes item's column type
    console.log(overColumn?.type, activeData?.item.columnType);
    if (!overColumn?.type.includes(activeData?.item.columnType)) return;

    // Im dropping a Item over another Item
    if (isActiveAItem && isOverAItem) {
      const activeItem = itemsById.get(activeId.toString());
      const overItem = itemsById.get(overId.toString());

      if (activeItem && overItem && activeItem.columnId !== overItem.columnId) {
        // TODO: submit form update to columnId and priority
        return;
      }

      // TODO: submit form update to priority
      return;
    }

    const isOverAColumn = overData?.type === "column";

    // Im dropping a Item over a column
    if (isActiveAItem && isOverAColumn) {
      const activeItem = itemsById.get(activeId.toString());
      const columnId = overId as string;
      if (activeItem) {
        // TODO: submit form update to columnId and priority
      }
    }
  }
};

function usePendingItems() {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.updateScheduledOperation;
    })
    .map((fetcher) => {
      let columnId = String(fetcher.formData.get("columnId"));
      let id = String(fetcher.formData.get("id"));
      let priority = Number(fetcher.formData.get("priority"));
      let item: { id: string; priority: number; columnId: string } = {
        id,
        priority,
        columnId,
      };
      return item;
    });
}

export default Kanban;
