import type {
  Active,
  ClientRect,
  Collision,
  CollisionDetection,
  DroppableContainer
} from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import { hasDraggableData, kanbanCollisionDetection } from "./utils";

type Target = {
  id: string;
  type: "item" | "column";
  rect: ClientRect;
};

const rect = (
  left: number,
  top: number,
  width: number,
  height: number
): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height
});

function targetContainer(target: Target): DroppableContainer {
  return {
    id: target.id,
    key: target.id,
    disabled: false,
    data: { current: { type: target.type } },
    node: { current: null },
    rect: { current: target.rect }
  };
}

function detect(
  activeType: "item" | "column",
  collisionRect: ClientRect,
  targets: readonly Target[]
): Collision[] {
  const active = {
    id: "active",
    data: { current: { type: activeType } },
    rect: {
      current: { initial: collisionRect, translated: collisionRect }
    }
  } as Active;
  const droppableContainers = targets.map(targetContainer);
  const droppableRects = new Map(
    targets.map((target) => [target.id, target.rect])
  );

  return (kanbanCollisionDetection as CollisionDetection)({
    active,
    collisionRect,
    droppableRects,
    droppableContainers,
    pointerCoordinates: null
  });
}

describe("Kanban drag utilities", () => {
  it("accepts the actual lowercase drag metadata", () => {
    expect(
      hasDraggableData({
        id: "item-1",
        data: { current: { type: "item", item: {} } }
      } as any)
    ).toBe(true);
    expect(
      hasDraggableData({
        id: "column-1",
        data: { current: { type: "column", column: {} } }
      } as any)
    ).toBe(true);
    expect(
      hasDraggableData({
        id: "column-1",
        data: { current: { type: "Column", column: {} } }
      } as any)
    ).toBe(false);
  });

  it("prefers an intersecting card over its parent column", () => {
    const collisions = detect("item", rect(50, 50, 40, 40), [
      { id: "column-a", type: "column", rect: rect(0, 0, 200, 200) },
      { id: "item-a", type: "item", rect: rect(40, 40, 60, 60) }
    ]);

    expect(collisions.map(({ id }) => id)).toEqual(["item-a"]);
  });

  it("falls back to an intersecting empty column", () => {
    const collisions = detect("item", rect(250, 50, 40, 40), [
      { id: "column-empty", type: "column", rect: rect(200, 0, 200, 200) }
    ]);

    expect(collisions.map(({ id }) => id)).toEqual(["column-empty"]);
  });

  it("uses a populated column for an intersecting background drop", () => {
    const collisions = detect("item", rect(10, 10, 20, 20), [
      { id: "column-a", type: "column", rect: rect(0, 0, 200, 200) },
      { id: "item-a", type: "item", rect: rect(100, 100, 50, 50) }
    ]);

    expect(collisions.map(({ id }) => id)).toEqual(["column-a"]);
  });

  it("returns no collision outside all targets", () => {
    expect(
      detect("item", rect(500, 500, 40, 40), [
        { id: "column-a", type: "column", rect: rect(0, 0, 200, 200) },
        { id: "item-a", type: "item", rect: rect(40, 40, 60, 60) }
      ])
    ).toEqual([]);
  });

  it("excludes the active card from item collisions", () => {
    const collisions = detect("item", rect(50, 50, 40, 40), [
      { id: "active", type: "item", rect: rect(40, 40, 60, 60) },
      { id: "sibling", type: "item", rect: rect(300, 40, 60, 60) }
    ]);

    expect(collisions).toEqual([]);
  });

  it("does not choose a nearby sibling for a no-motion drag", () => {
    const collisions = detect("item", rect(50, 50, 40, 40), [
      { id: "active", type: "item", rect: rect(50, 50, 40, 40) },
      { id: "sibling", type: "item", rect: rect(95, 50, 40, 40) },
      { id: "column-a", type: "column", rect: rect(0, 0, 200, 200) }
    ]);

    expect(collisions.map(({ id }) => id)).toEqual(["column-a"]);
  });

  it("does not choose the nearest column for an outside column drag", () => {
    expect(
      detect("column", rect(500, 500, 40, 40), [
        { id: "column-a", type: "column", rect: rect(0, 0, 200, 200) },
        { id: "column-b", type: "column", rect: rect(250, 0, 200, 200) }
      ])
    ).toEqual([]);
  });

  it("keeps column dragging over a real column working", () => {
    const collisions = detect("column", rect(250, 50, 40, 40), [
      { id: "column-a", type: "column", rect: rect(0, 0, 200, 200) },
      { id: "column-b", type: "column", rect: rect(200, 0, 200, 200) },
      { id: "item-b", type: "item", rect: rect(220, 40, 80, 80) }
    ]);

    expect(collisions.map(({ id }) => id)).toEqual(["column-b"]);
  });
});
