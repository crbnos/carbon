// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { TreeBox } from "./tree-layout";
import {
  TREE_FIT_MAX_ZOOM,
  TREE_READABLE_ZOOM,
  treeViewport
} from "./tree-viewport";

function box(id: string, x: number, y: number, height: number): TreeBox {
  return {
    id,
    ownerId: id === "box:root" ? null : id,
    cardIds: [],
    collapsedCount: null,
    hiddenCount: 0,
    x,
    y,
    width: 272,
    height
  };
}

describe("treeViewport", () => {
  it("returns null while the container has no size", () => {
    expect(treeViewport([box("box:root", 0, 0, 200)], 0, 600)).toBeNull();
    expect(treeViewport([box("box:root", 0, 0, 200)], 800, 0)).toBeNull();
  });

  it("returns null for a tree with no box", () => {
    expect(treeViewport([], 800, 600)).toBeNull();
  });

  it("never enlarges a small tree past 100 %", () => {
    const viewport = treeViewport([box("box:root", 0, 0, 200)], 1200, 800);
    expect(viewport?.zoom).toBe(TREE_FIT_MAX_ZOOM);
  });

  it("centres a small tree in the container", () => {
    const viewport = treeViewport([box("box:root", 0, 0, 200)], 1200, 800);
    // The box is 272 × 200 at zoom 1, so its centre sits at the container's.
    expect(viewport?.x).toBe(600 - 136);
    expect(viewport?.y).toBe(400 - 100);
  });

  it("fits a whole tree that stays readable", () => {
    const boxes = [box("box:root", 0, 0, 400), box("box:a", 400, 0, 400)];
    const viewport = treeViewport(boxes, 1100, 700);
    expect(viewport?.zoom).toBeGreaterThanOrEqual(TREE_READABLE_ZOOM);
    expect(viewport?.zoom).toBeLessThanOrEqual(TREE_FIT_MAX_ZOOM);
  });

  it("fits the top box when the whole tree would be a speck", () => {
    const boxes = [
      box("box:root", 0, 2000, 1400),
      box("box:a", 400, 0, 5000),
      box("box:b", 4000, 0, 5000)
    ];
    const viewport = treeViewport(boxes, 1100, 700);
    expect(viewport?.zoom).toBeGreaterThanOrEqual(TREE_READABLE_ZOOM);
    // The top box's left edge is on screen.
    const left = (viewport?.x ?? 0) + 0 * (viewport?.zoom ?? 1);
    expect(left).toBeGreaterThanOrEqual(0);
    const top = (viewport?.y ?? 0) + 2000 * (viewport?.zoom ?? 1);
    expect(top).toBeGreaterThanOrEqual(0);
  });
});
