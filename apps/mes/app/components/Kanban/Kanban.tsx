import { ClientOnly } from "@carbon/react";
import type {
  Announcements,
  DragEndEvent,
  DragStartEvent,
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
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BoardContainer, ColumnCard } from "./components/ColumnCard";
import type { Column, DisplaySettings, Item } from "./types";
import { coordinateGetter, hasDraggableData } from "./utils";

interface Progress {
  totalDuration: number;
  progress: number;
  active: boolean;
  employees?: Set<string>;
}

type KanbanProps = {
  columns: Column[];
  items: Item[];
  progressByItemId?: Record<string, Progress>;
} & DisplaySettings;

const COLUMN_ORDER_KEY = "kanban-column-order";

const Kanban = ({
  columns,
  items,
  progressByItemId,
  ...displaySettings
}: KanbanProps) => {
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

  const [activeColumn, setActiveColumn] = useState<Column | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter,
    })
  );

  const announcements: Announcements = {
    onDragStart({ active }) {
      if (!hasDraggableData(active)) return;
      if (active.data.current?.type === "column") {
        const startIndex = columnOrder.findIndex((id) => id === active.id);
        const startColumn = columns.find((col) => col.id === active.id);
        return `Picked up Column ${startColumn?.title} at position: ${
          startIndex + 1
        } of ${columnOrder.length}`;
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
      }
    },
    onDragEnd({ active, over }) {
      if (!hasDraggableData(active) || !hasDraggableData(over)) return;

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
      }
    },
    onDragCancel({ active }) {
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
                {...displaySettings}
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
                  {...displaySettings}
                />
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
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveColumn(null);

    const { active, over } = event;

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (!hasDraggableData(active)) return;

    const activeData = active.data.current;

    if (activeId === overId) return;

    const isActiveAColumn = activeData?.type === "column";
    if (!isActiveAColumn) return;

    setColumnOrder((prevOrder) => {
      const activeColumnIndex = prevOrder.findIndex((id) => id === activeId);
      const overColumnIndex = prevOrder.findIndex((id) => id === overId);

      return arrayMove(prevOrder, activeColumnIndex, overColumnIndex);
    });
  }
};

export default Kanban;
