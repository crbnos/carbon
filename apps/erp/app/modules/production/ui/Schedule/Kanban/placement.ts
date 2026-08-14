export type PrioritizedItem = {
  id: string;
  columnId: string;
  priority: number;
};

export type LogicalSlot = {
  index: number;
  previousItemId: string | null;
  nextItemId: string | null;
};

export type DragPlacement = {
  columnId: string;
  priority: number;
  slot: LogicalSlot;
};

export type DragOrigin<T extends PrioritizedItem> = {
  item: T;
  placement: DragPlacement;
};

export type DragPreview = DragPlacement & {
  targetType: "item" | "column";
};

export type InsertionMarker = {
  itemId: string;
  position: "before" | "after";
};

export function comparePriorityThenId<T extends PrioritizedItem>(
  a: T,
  b: T
): number {
  const aPriority = Number.isFinite(a.priority)
    ? a.priority
    : Number.POSITIVE_INFINITY;
  const bPriority = Number.isFinite(b.priority)
    ? b.priority
    : Number.POSITIVE_INFINITY;

  if (aPriority !== bPriority) return aPriority - bPriority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function getItemsInColumn<T extends PrioritizedItem>(
  items: readonly T[],
  columnId: string,
  activeItemId?: string
): T[] {
  return items
    .filter(
      (item) =>
        item.columnId === columnId &&
        (activeItemId === undefined || item.id !== activeItemId)
    )
    .sort(comparePriorityThenId);
}

export function getLogicalSlot<T extends PrioritizedItem>(
  items: readonly T[],
  requestedIndex: number
): LogicalSlot {
  const index = Math.max(0, Math.min(requestedIndex, items.length));
  return {
    index,
    previousItemId: items[index - 1]?.id ?? null,
    nextItemId: items[index]?.id ?? null
  };
}

export function createDragOrigin<T extends PrioritizedItem>(
  items: readonly T[],
  activeItem: T
): DragOrigin<T> | null {
  if (!Number.isFinite(activeItem.priority)) return null;

  const sourceItems = getItemsInColumn(items, activeItem.columnId);
  const activeIndex = sourceItems.findIndex(
    (item) => item.id === activeItem.id
  );
  if (activeIndex < 0) return null;

  const sourceItemsWithoutActive = getItemsInColumn(
    items,
    activeItem.columnId,
    activeItem.id
  );

  return {
    item: { ...activeItem },
    placement: {
      columnId: activeItem.columnId,
      priority: activeItem.priority,
      slot: getLogicalSlot(sourceItemsWithoutActive, activeIndex)
    }
  };
}

export function getInsertionIndex<T extends PrioritizedItem>(
  destinationItems: readonly T[],
  targetItemId: string,
  sameColumn: boolean,
  originSlotIndex: number
): number | null {
  const targetIndex = destinationItems.findIndex(
    (item) => item.id === targetItemId
  );
  if (targetIndex < 0) return null;

  return sameColumn && targetIndex >= originSlotIndex
    ? targetIndex + 1
    : targetIndex;
}

export function calculateFractionalPriority(
  previousPriority: number | undefined,
  nextPriority: number | undefined
): number | null {
  if (previousPriority !== undefined && !Number.isFinite(previousPriority)) {
    return null;
  }
  if (nextPriority !== undefined && !Number.isFinite(nextPriority)) {
    return null;
  }

  let candidate: number;
  if (previousPriority === undefined && nextPriority !== undefined) {
    candidate = nextPriority - 1;
  } else if (previousPriority !== undefined && nextPriority === undefined) {
    candidate = previousPriority + 1;
  } else if (previousPriority !== undefined && nextPriority !== undefined) {
    candidate = previousPriority / 2 + nextPriority / 2;
  } else {
    return null;
  }

  if (!Number.isFinite(candidate)) return null;
  if (previousPriority !== undefined && !(candidate > previousPriority)) {
    return null;
  }
  if (nextPriority !== undefined && !(candidate < nextPriority)) {
    return null;
  }

  return candidate;
}

export function getItemPlacement<T extends PrioritizedItem>(
  origin: DragOrigin<T>,
  items: readonly T[],
  destinationColumnId: string,
  targetItemId: string
): DragPlacement | null {
  const destinationItems = getItemsInColumn(
    items,
    destinationColumnId,
    origin.item.id
  );
  const sameColumn = origin.placement.columnId === destinationColumnId;
  const insertionIndex = getInsertionIndex(
    destinationItems,
    targetItemId,
    sameColumn,
    origin.placement.slot.index
  );
  if (insertionIndex === null) return null;

  const priority = calculateFractionalPriority(
    destinationItems[insertionIndex - 1]?.priority,
    destinationItems[insertionIndex]?.priority
  );
  if (priority === null) return null;

  return {
    columnId: destinationColumnId,
    priority,
    slot: getLogicalSlot(destinationItems, insertionIndex)
  };
}

export function getColumnPlacement<T extends PrioritizedItem>(
  origin: DragOrigin<T>,
  items: readonly T[],
  destinationColumnId: string
): DragPlacement | null {
  if (origin.placement.columnId === destinationColumnId) return null;
  if (!Number.isFinite(origin.placement.priority)) return null;

  const destinationItems = getItemsInColumn(
    items,
    destinationColumnId,
    origin.item.id
  );

  // A background drop has no exact card slot. Use the origin priority only if
  // it will not create another visible duplicate in the selected position.
  if (
    destinationItems.some((item) => item.priority === origin.placement.priority)
  ) {
    return null;
  }

  const insertionIndex = destinationItems.findIndex(
    (item) => item.priority > origin.placement.priority
  );
  const resolvedIndex =
    insertionIndex < 0 ? destinationItems.length : insertionIndex;

  return {
    columnId: destinationColumnId,
    priority: origin.placement.priority,
    slot: getLogicalSlot(destinationItems, resolvedIndex)
  };
}

export function isSamePlacement(
  origin: DragPlacement,
  placement: DragPlacement
): boolean {
  return (
    origin.columnId === placement.columnId &&
    origin.slot.previousItemId === placement.slot.previousItemId &&
    origin.slot.nextItemId === placement.slot.nextItemId
  );
}

export function isSamePreview(
  previous: DragPreview | null,
  next: DragPreview | null
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.targetType === next.targetType &&
    previous.columnId === next.columnId &&
    previous.priority === next.priority &&
    isSamePlacement(previous, next)
  );
}

export function resolveInsertionMarker(
  slot: LogicalSlot
): InsertionMarker | null {
  if (slot.nextItemId) {
    return { itemId: slot.nextItemId, position: "before" };
  }
  if (slot.previousItemId) {
    return { itemId: slot.previousItemId, position: "after" };
  }
  return null;
}
