// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ClientOnly, cn, toast } from "@carbon/react";
import { withUnorderedLast } from "@carbon/utils";
import type {
  Announcements,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
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
import { SortableContext } from "@dnd-kit/sortable";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { useFetchers, useSubmit } from "react-router";
import { path } from "~/utils/path";
import { BatchItemCard } from "./components/BatchItemCard";
import { BoardContainer, ColumnCard } from "./components/ColumnCard";
import { ItemCard } from "./components/ItemCard";
import type { KanbanMoveTo } from "./context/KanbanContext";
import { KanbanProvider } from "./context/KanbanContext";
import {
  type BoardDragEvent,
  type DragCommit,
  type OperationDragOrigin,
  type OperationItemDrag,
  type OperationsDragState,
  planCommitSubmissions,
  reduceOperationsDrag,
  resolveColumnCommit
} from "./drag-lifecycle";
import {
  comparePriorityThenId,
  createDragOrigin,
  resolveInsertionMarker
} from "./placement";
import type { Column, DisplaySettings, Item, Progress } from "./types";
import { isBatchItem } from "./types";
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

const KanbanDragPreviewContext = createContext<OperationItemDrag | null>(null);

// A new options object makes a new sensor, and with it new listeners for
// every card on every render of the board.
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter };
const NO_ITEMS: Item[] = [];

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
      {isBatchItem(item) ? (
        <BatchItemCard item={item} isOverlay={isOverlay} />
      ) : (
        <ItemCard
          item={item}
          isOverlay={isOverlay}
          progressByItemId={progressByItemId}
        />
      )}
    </div>
  );
}

const Kanban = ({
  columns,
  items: initialItems,
  progressByItemId,
  tags,
  ...displaySettings
}: KanbanProps) => {
  const submit = useSubmit();

  // Surface a failed batch work-center reassignment (drag). The optimistic move
  // snaps back on revalidation, so without this the rejection would be silent —
  // the create/add path toasts via its own fetcher; this covers the drag path
  // (intent="update"), which submits through useSubmit and has no result reader.
  // A fetcher's formData is cleared once it goes idle, so capture the intent
  // while it is still submitting and read the result on idle.
  const batchUpdateFetchers = useFetchers();
  const pendingBatchIntent = useRef<Map<string, string>>(new Map());
  const toastedBatchUpdates = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const f of batchUpdateFetchers) {
      if (f.state !== "idle") {
        const intent = f.formData?.get("intent");
        if (
          f.formAction === path.to.priorityBatchingUpdate &&
          typeof intent === "string"
        ) {
          pendingBatchIntent.current.set(f.key, intent);
        }
        toastedBatchUpdates.current.delete(f.key);
        continue;
      }
      if (pendingBatchIntent.current.get(f.key) !== "update") continue;
      const result = f.data as
        | { error?: { message?: string } | null; fieldErrors?: unknown }
        | undefined;
      if (result === undefined) continue;
      const failed = !!result.error || !!result.fieldErrors;
      if (failed && !toastedBatchUpdates.current.has(f.key)) {
        toastedBatchUpdates.current.add(f.key);
        toast.error(result.error?.message ?? "Failed to move batch");
      }
      pendingBatchIntent.current.delete(f.key);
    }
  }, [batchUpdateFetchers]);

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  // Only the order the user chose is state. The columns come from the loader
  // and change while the board is open (a filter, a work center's first
  // operation): one copied in at mount never showed a column that arrived later.
  const [storedOrder, setStoredOrder] = useState<string[]>(() => {
    const stored = localStorage.getItem(COLUMN_ORDER_KEY);
    return stored ? (JSON.parse(stored) as string[]) : [];
  });
  const columnOrder = useMemo(
    () =>
      withUnorderedLast(
        storedOrder,
        columns.map((col) => col.id)
      ),
    [storedOrder, columns]
  );

  useEffect(() => {
    localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(storedOrder));
  }, [storedOrder]);

  const pendingItems = usePendingItems();
  // The board re-renders on every drag state change. Deriving these once per
  // change of the data keeps each column's item array (and so its cards) the
  // same object across those renders.
  const pendingKey = JSON.stringify(pendingItems);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pendingItems is keyed by value
  const { items, itemsById, itemsByColumn } = useMemo(() => {
    const byId = new Map<string, Item>(
      initialItems.map((item) => [item.id, item])
    );
    // merge pending items and existing items
    for (const pendingItem of pendingItems) {
      const item = byId.get(pendingItem.id);
      if (item) {
        byId.set(pendingItem.id, { ...item, ...pendingItem });
      }
    }
    const sorted = Array.from(byId.values()).sort(comparePriorityThenId);
    const byColumn = new Map<string, Item[]>();
    for (const item of sorted) {
      const column = byColumn.get(item.columnId);
      if (column) column.push(item);
      else byColumn.set(item.columnId, [item]);
    }
    return { items: sorted, itemsById: byId, itemsByColumn: byColumn };
  }, [initialItems, pendingKey]);
  const columnsById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns]
  );

  const pickedUpItemColumn = useRef<string | null>(null);
  // A ref, not state: dnd-kit can fire the next event before a re-render.
  const dragRef = useRef<OperationsDragState>(null);
  const [dragState, setDragState] = useState<OperationItemDrag | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [activeItem, setActiveItem] = useState<Item | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)
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

  const moveTo: KanbanMoveTo = {
    targetsFor: (itemId) => {
      const item = itemsById.get(itemId);
      if (!item) return [];
      return columnOrder.flatMap((columnId) => {
        const column = columnsById.get(columnId);
        return column &&
          column.id !== item.columnId &&
          column.type.includes(item.columnType)
          ? [{ id: column.id, title: column.title }]
          : [];
      });
    },
    onMove: moveToColumn
  };

  return (
    <KanbanProvider
      displaySettings={displaySettings}
      selectedGroup={selectedGroup}
      setSelectedGroup={setSelectedGroup}
      tags={tags}
      moveTo={moveTo}
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
                    items={itemsByColumn.get(col.id) ?? NO_ITEMS}
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
                      items={itemsByColumn.get(activeColumn.id) ?? NO_ITEMS}
                      progressByItemId={progressByItemId}
                    />
                  )}
                  {activeItem &&
                    (isBatchItem(activeItem) ? (
                      <BatchItemCard item={activeItem} isOverlay />
                    ) : (
                      <ItemCard
                        item={{
                          ...activeItem,
                          // @ts-expect-error TS2322 - TODO: fix type
                          status: progressByItemId[activeItem.id]?.active
                            ? "In Progress"
                            : activeItem.status,
                          employeeIds: progressByItemId[activeItem.id]
                            ?.employees
                            ? Array.from(
                                progressByItemId[activeItem.id].employees!
                              )
                            : undefined,
                          progress:
                            progressByItemId[activeItem.id]?.progress ?? 0
                        }}
                        isOverlay
                        progressByItemId={progressByItemId}
                      />
                    ))}
                </DragOverlay>,
                document.body
              )
            }
          </ClientOnly>
        </DndContext>
      </KanbanDragPreviewContext.Provider>
    </KanbanProvider>
  );

  function dispatchDrag(event: BoardDragEvent) {
    const { state, effect } = reduceOperationsDrag(dragRef.current, event, {
      items,
      itemsById,
      columnsById,
      columnOrder
    });
    if (effect?.type === "reorderColumns") setStoredOrder(effect.columnOrder);
    if (effect?.type === "commit") submitCommit(effect.origin, effect.commit);
    dragRef.current = state;
    setDragState(state?.type === "item" ? state : null);
  }

  function clearDragState() {
    pickedUpItemColumn.current = null;
    dispatchDrag({ type: "cancel" });
    setActiveItem(null);
    setActiveColumn(null);
  }

  function onDragStart(event: DragStartEvent) {
    clearDragState();
    dispatchDrag({ type: "start", active: event.active });

    const state = dragRef.current;
    if (!state || !hasDraggableData(event.active)) return;
    const data = event.active.data.current;
    if (state.type === "column" && data?.type === "column") {
      setActiveColumn(data.column);
    }
    if (state.type === "item" && data?.type === "item") {
      pickedUpItemColumn.current = data.item.columnId;
      setActiveItem(data.item);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    dispatchDrag({ type: "end", active: event.active, over: event.over });
    clearDragState();
  }

  // Persists a resolved move: each moved card writes through its own endpoint.
  function submitCommit(origin: OperationDragOrigin, commit: DragCommit) {
    for (const submission of planCommitSubmissions(origin, commit, itemsById)) {
      submit(submission.payload, {
        method: "post",
        action:
          submission.action === "batching"
            ? path.to.priorityBatchingUpdate
            : path.to.priorityOperationUpdate,
        navigate: false,
        flushSync: submission.flushSync,
        fetcherKey: submission.fetcherKey
      });
    }
  }

  // Phones: "Move to" on a card makes the same move as dropping it on that
  // column's background.
  function moveToColumn(itemId: string, columnId: string) {
    const activeItem = itemsById.get(itemId);
    const origin = activeItem ? createDragOrigin(items, activeItem) : null;
    if (!origin) return;
    const commit = resolveColumnCommit(origin, items, columnsById, columnId);
    if (commit) submitCommit(origin, commit);
  }

  function onDragOver(event: DragOverEvent) {
    dispatchDrag({ type: "over", active: event.active, over: event.over });
  }

  function onDragCancel() {
    clearDragState();
  }
};

function usePendingItems() {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  const fetchers = useFetchers();

  const operationMoves = fetchers
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.priorityOperationUpdate;
    })
    .flatMap((fetcher) => {
      const columnId = String(fetcher.formData.get("columnId"));
      const updates = fetcher.formData.get("updates");
      const rows: { id: string; priority: number }[] =
        typeof updates === "string"
          ? JSON.parse(updates)
          : [
              {
                id: String(fetcher.formData.get("id")),
                priority: Number(fetcher.formData.get("priority"))
              }
            ];
      return rows.map(
        (row): { id: string; priority?: number; columnId: string } => ({
          id: row.id,
          priority: row.priority,
          columnId
        })
      );
    });

  // A batch work-center reassignment in flight: keep the batch card in its
  // destination column until the loader revalidates.
  const batchMoves = fetchers
    .filter((fetcher): fetcher is PendingItem => {
      return (
        fetcher.formAction === path.to.priorityBatchingUpdate &&
        fetcher.formData?.get("intent") === "update" &&
        fetcher.formData?.has("workCenterId")
      );
    })
    .map((fetcher) => ({
      id: `batch:${String(fetcher.formData.get("batchId"))}`,
      columnId: String(fetcher.formData.get("workCenterId"))
    }));

  // A within-column batch reorder in flight: the card's board priority is
  // min(member priority), which the reprioritize action sets to a single value,
  // so mirror that value onto the card until the loader revalidates.
  const batchReprioritizes = fetchers
    .filter((fetcher): fetcher is PendingItem => {
      return (
        fetcher.formAction === path.to.priorityBatchingUpdate &&
        fetcher.formData?.get("intent") === "reprioritize" &&
        fetcher.formData?.has("priority")
      );
    })
    .map((fetcher) => ({
      id: `batch:${String(fetcher.formData.get("batchId"))}`,
      priority: Number(fetcher.formData.get("priority"))
    }));

  return [...operationMoves, ...batchMoves, ...batchReprioritizes];
}

export default Kanban;
