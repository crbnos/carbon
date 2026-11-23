// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { visibleUnderFilter } from "./filter";
import type { GanttEvent } from "./types";

const event = (
  id: string,
  message: string,
  overrides: {
    parentId?: string;
    isPartial?: boolean;
    items?: GanttEvent[];
  } = {}
): GanttEvent =>
  ({
    id,
    parentId: overrides.parentId,
    children: [],
    hasChildren: false,
    level: overrides.parentId ? 1 : 0,
    data: {
      message,
      isPartial: overrides.isPartial ?? false,
      items: overrides.items
    }
  }) as unknown as GanttEvent;

// A compact board: the plant, a lathe running J1 (in process) and J2, a mill running J3.
const board = [
  event("root", "Plant"),
  event("lane:lathe", "Lathe", {
    parentId: "root",
    items: [event("j1", "J1", { isPartial: true }), event("j2", "J2")]
  }),
  event("lane:mill", "Mill", { parentId: "root", items: [event("j3", "J3")] })
];
const shown = (text: string, wipOnly = false) => {
  const { rows, bars } = visibleUnderFilter(board, { text, wipOnly });
  return { rows: [...rows].sort(), bars: [...bars].sort() };
};

describe("visibleUnderFilter", () => {
  it("shows everything with no filter", () => {
    expect(shown("")).toEqual({
      rows: ["lane:lathe", "lane:mill", "root"],
      bars: ["j1", "j2", "j3"]
    });
  });

  it("shows a job's lane with only that job lit", () => {
    expect(shown("J2")).toEqual({ rows: ["lane:lathe", "root"], bars: ["j2"] });
  });

  it("finds a station's in-process work by the station's name", () => {
    expect(shown("Lathe", true)).toEqual({
      rows: ["lane:lathe", "root"],
      bars: ["j1"]
    });
  });

  it("shows the plant's lanes, all lit, when the search names the plant", () => {
    expect(shown("Plant")).toEqual({
      rows: ["lane:lathe", "lane:mill", "root"],
      bars: ["j1", "j2", "j3"]
    });
  });

  it("shows nothing when nothing matches", () => {
    expect(shown("Mill", true)).toEqual({ rows: [], bars: [] });
  });
});
