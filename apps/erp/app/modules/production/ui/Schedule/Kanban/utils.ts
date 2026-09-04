import type {
  Active,
  CollisionDetection,
  DataRef,
  DroppableContainer,
  KeyboardCoordinateGetter,
  Over
} from "@dnd-kit/core";
import {
  closestCorners,
  getFirstCollision,
  KeyboardCode,
  rectIntersection
} from "@dnd-kit/core";
import type { DraggableData } from "./types";

const directions: string[] = [
  KeyboardCode.Down,
  KeyboardCode.Right,
  KeyboardCode.Up,
  KeyboardCode.Left
];

function containersOfType(
  containers: readonly DroppableContainer[],
  type: "item" | "column"
) {
  return containers.filter(
    (container) => container.data.current?.type === type
  );
}

/**
 * Use actual rectangle intersections for pointer/touch drops. Cards are
 * checked first so a card nested inside a column wins; columns are only a
 * fallback for empty-column and background drops. Keyboard movement keeps its
 * directional nearest-target coordinate getter below.
 */
export const kanbanCollisionDetection: CollisionDetection = (args) => {
  const droppableContainers = args.droppableContainers.filter(
    (container) => !container.disabled && container.id !== args.active.id
  );
  const activeType = args.active.data.current?.type;

  if (activeType === "item") {
    const itemCollisions = rectIntersection({
      ...args,
      droppableContainers: containersOfType(droppableContainers, "item")
    });
    if (itemCollisions.length > 0) return itemCollisions;

    return rectIntersection({
      ...args,
      droppableContainers: containersOfType(droppableContainers, "column")
    });
  }

  if (activeType === "column") {
    return rectIntersection({
      ...args,
      droppableContainers: containersOfType(droppableContainers, "column")
    });
  }

  return rectIntersection({ ...args, droppableContainers });
};

export const coordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { active, droppableRects, droppableContainers, collisionRect } }
) => {
  if (directions.includes(event.code)) {
    event.preventDefault();

    if (!active || !collisionRect) {
      return;
    }

    const filteredContainers: DroppableContainer[] = [];

    droppableContainers.getEnabled().forEach((entry) => {
      if (!entry || entry?.disabled) {
        return;
      }

      const rect = droppableRects.get(entry.id);

      if (!rect) {
        return;
      }

      const data = entry.data.current;

      if (data) {
        const { type, children } = data;

        if (type === "column" && children?.length > 0) {
          if (active.data.current?.type !== "column") {
            return;
          }
        }
      }

      switch (event.code) {
        case KeyboardCode.Down:
          if (active.data.current?.type === "column") {
            return;
          }
          if (collisionRect.top < rect.top) {
            // find all droppable areas below
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Up:
          if (active.data.current?.type === "column") {
            return;
          }
          if (collisionRect.top > rect.top) {
            // find all droppable areas above
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Left:
          if (collisionRect.left >= rect.left + rect.width) {
            // find all droppable areas to left
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Right:
          // find all droppable areas to right
          if (collisionRect.left + collisionRect.width <= rect.left) {
            filteredContainers.push(entry);
          }
          break;
      }
    });
    const collisions = closestCorners({
      active,
      collisionRect: collisionRect,
      droppableRects,
      droppableContainers: filteredContainers,
      pointerCoordinates: null
    });
    const closestId = getFirstCollision(collisions, "id");

    if (closestId != null) {
      const newDroppable = droppableContainers.get(closestId);
      const newNode = newDroppable?.node.current;
      const newRect = newDroppable?.rect.current;

      if (newNode && newRect) {
        return {
          x: newRect.left,
          y: newRect.top
        };
      }
    }
  }

  return undefined;
};

export function hasDraggableData<T extends Active | Over>(
  entry: T | null | undefined
): entry is T & {
  data: DataRef<DraggableData>;
} {
  if (!entry) {
    return false;
  }

  const data = entry.data.current;

  if (data?.type === "column" || data?.type === "item") {
    return true;
  }

  return false;
}
