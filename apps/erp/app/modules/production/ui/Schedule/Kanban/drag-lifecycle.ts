// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The drag state machines behind the Operations and Dates boards. A board
// keeps the state in a ref (dnd-kit can fire the next event before React
// re-renders) and applies the effect a reducer returns.

import type { Active, Over } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { getDateOnly, getPendingDueDate } from "./date-utils";
import {
  calculateFractionalPriority,
  createDragOrigin,
  type DragOrigin,
  type DragPlacement,
  type DragPreview,
  getColumnPlacement,
  getInsertionIndex,
  getItemPlacement,
  getItemsInColumn,
  getLogicalSlot,
  isSamePlacement,
  isSamePreview,
  planColumnReorder
} from "./placement";
import type { Column, Item, JobItem } from "./types";
import { isBatchItem } from "./types";
import { hasDraggableData } from "./utils";

export type BoardDragEvent =
  | { type: "start"; active: Active }
  | { type: "over"; active: Active; over: Over | null }
  | { type: "end"; active: Active; over: Over | null }
  | { type: "cancel" };

function isOriginItemDrag(active: Active, origin: DragOrigin<Item>) {
  return (
    hasDraggableData(active) &&
    active.data.current?.type === "item" &&
    String(active.id) === origin.item.id
  );
}

// ---------------------------------------------------------------------------
// Operations board
// ---------------------------------------------------------------------------

export type OperationDragOrigin = DragOrigin<Item>;

export type OperationItemDrag = {
  type: "item";
  origin: OperationDragOrigin;
  preview: DragPreview | null;
};

export type OperationsDragState = OperationItemDrag | { type: "column" } | null;

export type OperationsBoard = {
  items: readonly Item[];
  itemsById: ReadonlyMap<string, Item>;
  columnsById: ReadonlyMap<string, Column>;
  columnOrder: string[];
};

export type DragCommit = {
  columnId: string;
  updates: { id: string; priority: number }[];
};

export type OperationsDragEffect =
  | { type: "reorderColumns"; columnOrder: string[] }
  | { type: "commit"; origin: OperationDragOrigin; commit: DragCommit };

/**
 * Hover only moves the preview; only the end event writes, and it resolves the
 * drop from its own `over`, never from the last hover. Every end and cancel
 * leaves no live drag, so a repeated end callback writes nothing.
 */
export function reduceOperationsDrag(
  state: OperationsDragState,
  event: BoardDragEvent,
  board: OperationsBoard
): { state: OperationsDragState; effect: OperationsDragEffect | null } {
  switch (event.type) {
    case "start": {
      if (!hasDraggableData(event.active)) return { state: null, effect: null };
      const data = event.active.data.current;
      if (data?.type === "column") {
        return { state: { type: "column" }, effect: null };
      }
      const activeItem = board.itemsById.get(String(event.active.id));
      const origin = activeItem
        ? createDragOrigin(board.items, activeItem)
        : null;
      return {
        state: origin ? { type: "item", origin, preview: null } : null,
        effect: null
      };
    }
    case "over": {
      if (
        state?.type !== "item" ||
        !isOriginItemDrag(event.active, state.origin)
      ) {
        return { state, effect: null };
      }
      const placement = resolveOperationPlacement(
        state.origin,
        event.over,
        board
      );
      const preview =
        placement && !isSamePlacement(state.origin.placement, placement)
          ? placement
          : null;
      return {
        state: isSamePreview(state.preview, preview)
          ? state
          : { ...state, preview },
        effect: null
      };
    }
    case "end": {
      const { active, over } = event;
      if (
        !state ||
        !hasDraggableData(active) ||
        !over ||
        !hasDraggableData(over)
      ) {
        return { state: null, effect: null };
      }
      const activeData = active.data.current;
      if (
        state.type === "column" &&
        activeData?.type === "column" &&
        over.data.current?.type === "column"
      ) {
        const from = board.columnOrder.findIndex((id) => id === active.id);
        const to = board.columnOrder.findIndex((id) => id === over.id);
        return {
          state: null,
          effect:
            active.id !== over.id && from >= 0 && to >= 0
              ? {
                  type: "reorderColumns",
                  columnOrder: arrayMove(board.columnOrder, from, to)
                }
              : null
        };
      }
      if (
        state.type === "item" &&
        activeData?.type === "item" &&
        isOriginItemDrag(active, state.origin)
      ) {
        const commit = resolveOperationCommit(state.origin, over, board);
        if (commit) {
          return {
            state: null,
            effect: { type: "commit", origin: state.origin, commit }
          };
        }
      }
      return { state: null, effect: null };
    }
    case "cancel":
      return { state: null, effect: null };
  }
}

function resolveOperationPlacement(
  origin: OperationDragOrigin,
  over: Over | null,
  { items, itemsById, columnsById }: OperationsBoard
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

    // Compute the slot directly rather than via getItemPlacement so the
    // insertion marker still renders when the two neighbors share a priority
    // (no fractional gap) — the drop renumbers the column, so the preview must
    // not disappear just because the fast-path priority is unavailable.
    const destinationColumnId = overItem.columnId;
    const destinationItems = getItemsInColumn(
      items,
      destinationColumnId,
      origin.item.id
    );
    const sameColumn = origin.placement.columnId === destinationColumnId;
    const insertionIndex = getInsertionIndex(
      destinationItems,
      overItem.id,
      sameColumn,
      origin.placement.slot.index
    );
    if (insertionIndex === null) return null;

    const fractionalPriority = calculateFractionalPriority(
      destinationItems[insertionIndex - 1]?.priority,
      destinationItems[insertionIndex]?.priority
    );
    // The marker only needs the slot; the priority just has to be stable per
    // slot so isSamePreview can dedupe. Fall back to the previous neighbor's
    // priority (or the drag-start priority at the top of the column).
    const priority =
      fractionalPriority ??
      destinationItems[insertionIndex - 1]?.priority ??
      origin.placement.priority;

    return {
      columnId: destinationColumnId,
      priority,
      slot: getLogicalSlot(destinationItems, insertionIndex),
      targetType: "item"
    };
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

/**
 * Resolves the priority writes a drop should persist. Unlike the hover
 * preview (which gives up when the two neighbors have no numeric gap), this
 * never abandons a valid drop over a priority collision: it falls back to
 * renumbering the destination column so a fully equal-priority column — every
 * op still at the default `1` because the scheduler has not sequenced them —
 * can still be reordered. A no-op drop (dropped back in place,
 * invalid/incompatible target) returns null.
 */
function resolveOperationCommit(
  origin: OperationDragOrigin,
  over: Over | null,
  { items, itemsById, columnsById }: OperationsBoard
): DragCommit | null {
  if (
    !over ||
    over.disabled ||
    !hasDraggableData(over) ||
    !itemsById.has(origin.item.id)
  ) {
    return null;
  }

  const overId = String(over.id);
  if (overId === origin.item.id) return null;

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

    const destinationColumnId = overItem.columnId;
    const destinationItems = getItemsInColumn(
      items,
      destinationColumnId,
      origin.item.id
    );
    const sameColumn = origin.placement.columnId === destinationColumnId;
    const insertionIndex = getInsertionIndex(
      destinationItems,
      overItem.id,
      sameColumn,
      origin.placement.slot.index
    );
    if (insertionIndex === null) return null;

    const slot = getLogicalSlot(destinationItems, insertionIndex);
    if (
      isSamePlacement(origin.placement, {
        columnId: destinationColumnId,
        priority: origin.placement.priority,
        slot
      })
    ) {
      return null;
    }

    const fractionalPriority = calculateFractionalPriority(
      destinationItems[insertionIndex - 1]?.priority,
      destinationItems[insertionIndex]?.priority
    );
    const updates =
      fractionalPriority === null
        ? planColumnReorder(origin, items, destinationColumnId, insertionIndex)
        : [{ id: origin.item.id, priority: fractionalPriority }];

    return updates.length ? { columnId: destinationColumnId, updates } : null;
  }

  if (overData?.type === "column") {
    if (overData.column.id !== overId) return null;
    return resolveColumnCommit(origin, items, columnsById, overId);
  }

  return null;
}

/**
 * The priority writes for dropping a card on a column's background (it lands
 * at the column's end). Shared by the drop and by the phone "Move to" menu.
 */
export function resolveColumnCommit(
  origin: OperationDragOrigin,
  items: readonly Item[],
  columnsById: ReadonlyMap<string, Column>,
  columnId: string
): DragCommit | null {
  if (!columnsById.has(columnId) || columnId === origin.placement.columnId) {
    return null;
  }

  const destinationColumn = columnsById.get(columnId);
  if (!destinationColumn?.type.includes(origin.item.columnType)) {
    return null;
  }

  const placement = getColumnPlacement(origin, items, columnId);
  if (placement) {
    return {
      columnId,
      updates: [{ id: origin.item.id, priority: placement.priority }]
    };
  }

  // A background/empty-column drop whose origin priority collides with an
  // existing card — renumber, appending the dragged op to the column's end.
  const destinationItems = getItemsInColumn(items, columnId, origin.item.id);
  const updates = planColumnReorder(
    origin,
    items,
    columnId,
    destinationItems.length
  );
  return updates.length ? { columnId, updates } : null;
}

export type CommitSubmission = {
  action: "operation" | "batching";
  payload: Record<string, string | number>;
  fetcherKey: string;
  flushSync: boolean;
};

/** The requests that persist a resolved move, in the order they are sent. */
export function planCommitSubmissions(
  origin: OperationDragOrigin,
  commit: DragCommit,
  itemsById: ReadonlyMap<string, Item>
): CommitSubmission[] {
  if (
    isBatchItem(origin.item) &&
    commit.columnId !== origin.placement.columnId
  ) {
    // A batch dropped on a DIFFERENT work center reassigns the whole batch
    // (the server fn writes the work center to every member) and reschedules;
    // the priority renumber is left to the resulting replan wave.
    return [
      {
        action: "batching",
        payload: {
          intent: "update",
          batchId: origin.item.batchId,
          workCenterId: commit.columnId
        },
        fetcherKey: `item:${origin.item.id}`,
        flushSync: true
      }
    ];
  }

  // Within-column reorder (or a non-batch cross-column move). Each renumbered
  // card writes through its own endpoint: an operation writes its priority
  // (+ work center), a batch card writes every member's priority so
  // min(member) lands at the batch's new dispatch slot.
  const flushSync = commit.updates.length === 1;
  const isBatchCard = (id: string) => {
    const target = itemsById.get(id);
    return !!target && isBatchItem(target);
  };
  const submissions: CommitSubmission[] = [];
  // Several operations renumbered by one drop go in ONE request. One request
  // per card meant one page reload per card, and the board stuttered for
  // seconds after the drop.
  const operationUpdates = commit.updates.filter(
    (update) => !isBatchCard(update.id)
  );
  if (operationUpdates.length > 1) {
    submissions.push({
      action: "operation",
      payload: {
        columnId: commit.columnId,
        updates: JSON.stringify(operationUpdates)
      },
      // Not the card's own key: a later move of that card would replace this
      // fetcher and drop the other cards' pending order.
      fetcherKey: `reorder:${commit.columnId}`,
      flushSync: false
    });
  }
  for (const update of commit.updates) {
    const target = itemsById.get(update.id);
    if (operationUpdates.length > 1 && !isBatchCard(update.id)) continue;
    if (target && isBatchItem(target)) {
      submissions.push({
        action: "batching",
        payload: {
          intent: "reprioritize",
          batchId: target.batchId,
          priority: update.priority
        },
        fetcherKey: `item:${update.id}`,
        flushSync
      });
    } else {
      submissions.push({
        action: "operation",
        payload: {
          id: update.id,
          columnId: commit.columnId,
          priority: update.priority
        },
        fetcherKey: `item:${update.id}`,
        flushSync
      });
    }
  }
  return submissions;
}

// ---------------------------------------------------------------------------
// Dates board
// ---------------------------------------------------------------------------

export type DateDragOrigin = DragOrigin<JobItem> & {
  dueDate: string | null | undefined;
};

export type DatesDragState = {
  origin: DateDragOrigin;
  preview: DragPreview | null;
} | null;

export type DatesBoard = {
  items: readonly JobItem[];
  itemsById: ReadonlyMap<string, JobItem>;
  columnsById: ReadonlyMap<string, Column>;
  locationId: string;
};

export type DateSubmission = {
  id: string;
  locationId: string;
  columnId: string;
  optimisticColumnId: string;
  priority: number;
};

/** Same lifecycle as the Operations board, writing one job's due date. */
export function reduceDatesDrag(
  state: DatesDragState,
  event: BoardDragEvent,
  board: DatesBoard
): { state: DatesDragState; submission: DateSubmission | null } {
  switch (event.type) {
    case "start": {
      if (
        !hasDraggableData(event.active) ||
        event.active.data.current?.type !== "item"
      ) {
        return { state: null, submission: null };
      }
      const activeItem = board.itemsById.get(String(event.active.id));
      if (!activeItem || !board.columnsById.has(activeItem.columnId)) {
        return { state: null, submission: null };
      }
      const origin = createDateDragOrigin(board.items, activeItem);
      return {
        state: origin ? { origin, preview: null } : null,
        submission: null
      };
    }
    case "over": {
      if (!state) return { state, submission: null };
      const placement = isOriginItemDrag(event.active, state.origin)
        ? resolveDatePlacement(state.origin, event.over, board)
        : null;
      const preview =
        placement && !isSamePlacement(state.origin.placement, placement)
          ? placement
          : null;
      return {
        state: isSamePreview(state.preview, preview)
          ? state
          : { ...state, preview },
        submission: null
      };
    }
    case "end": {
      const placement =
        state && isOriginItemDrag(event.active, state.origin)
          ? resolveDatePlacement(state.origin, event.over, board)
          : null;
      return {
        state: null,
        submission:
          state && placement
            ? datePlacementSubmission(state.origin, placement, board.locationId)
            : null
      };
    }
    case "cancel":
      return { state: null, submission: null };
  }
}

export function createDateDragOrigin(
  items: readonly JobItem[],
  activeItem: JobItem
): DateDragOrigin | null {
  const placementOrigin = createDragOrigin(items, activeItem);
  if (!placementOrigin) return null;
  return {
    ...placementOrigin,
    dueDate:
      activeItem.dueDate === undefined
        ? undefined
        : getDateOnly(activeItem.dueDate)
  };
}

/**
 * A reorder inside the same display bucket keeps the job's exact persisted
 * date (a week column stands for seven dates); a move to another bucket takes
 * that bucket's date. A job whose date is unknown is never written.
 */
export function datePlacementSubmission(
  origin: DateDragOrigin,
  placement: DragPlacement,
  locationId: string
): DateSubmission | null {
  if (
    origin.dueDate === undefined ||
    isSamePlacement(origin.placement, placement)
  ) {
    return null;
  }
  const isSameDisplayBucket = placement.columnId === origin.placement.columnId;
  return {
    id: origin.item.id,
    locationId,
    columnId: isSameDisplayBucket
      ? (origin.dueDate ?? origin.placement.columnId)
      : placement.columnId,
    optimisticColumnId: placement.columnId,
    priority: placement.priority
  };
}

function resolveDatePlacement(
  origin: DateDragOrigin,
  over: Over | null,
  { items, itemsById, columnsById }: DatesBoard
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

export type PendingDateMove = {
  id: string;
  priority: number;
  columnId: string;
  dueDate: string | null | undefined;
};

/**
 * In-flight due-date writes for this board's location, as the item fields they
 * will produce: the card shows in its optimistic column and carries the date
 * the server will persist.
 */
export function pendingDateMoves(
  fetchers: readonly { formAction?: string; formData?: FormData }[],
  { action, locationId }: { action: string; locationId: string }
): PendingDateMove[] {
  return fetchers.flatMap((fetcher) => {
    const formData = fetcher.formData;
    if (
      fetcher.formAction !== action ||
      !formData ||
      formData.get("locationId") !== locationId
    ) {
      return [];
    }
    const persistenceColumnId = formData.get("columnId");
    const optimisticColumnId = formData.get("optimisticColumnId");
    const columnId =
      typeof optimisticColumnId === "string" && optimisticColumnId.length > 0
        ? optimisticColumnId
        : typeof persistenceColumnId === "string"
          ? persistenceColumnId
          : "";
    const id = formData.get("id");
    return [
      {
        id: typeof id === "string" ? id : "",
        priority: Number(formData.get("priority")),
        columnId,
        dueDate:
          typeof persistenceColumnId === "string"
            ? getPendingDueDate(persistenceColumnId)
            : undefined
      }
    ];
  });
}

export function mergePendingDateMoves(
  items: readonly JobItem[],
  pending: readonly PendingDateMove[]
): Map<string, JobItem> {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  for (const move of pending) {
    const item = itemsById.get(move.id);
    if (item) itemsById.set(move.id, { ...item, ...move });
  }
  return itemsById;
}
