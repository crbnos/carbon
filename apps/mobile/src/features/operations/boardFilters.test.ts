// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard, WorkCenterColumn } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  type BoardFilters,
  columnsWithResults,
  EMPTY_FILTERS,
  filterColumns,
  filterOperations,
  toggleFilter,
  UNASSIGNED
} from "./boardFilters";

const op = (
  id: string,
  tags?: string[],
  rest?: { columnType?: string; assignee?: string | null }
) => ({ id, tags, ...rest }) as unknown as OperationCard;
const col = (id: string) => ({ id, title: id }) as WorkCenterColumn;
/** Every test names only the lists it cares about; the rest stay empty. */
const picked = (some: Partial<BoardFilters>): BoardFilters => ({
  ...EMPTY_FILTERS,
  ...some
});

describe("toggleFilter", () => {
  it("adds and removes without mutating", () => {
    const base = EMPTY_FILTERS;
    const added = toggleFilter(base, "tags", "urgent");
    expect(added.tags).toEqual(["urgent"]);
    // EMPTY_FILTERS is module state shared by every caller; mutating it would
    // leak one operator's filter into the next screen that reads it.
    expect(base.tags).toEqual([]);
    expect(toggleFilter(added, "tags", "urgent").tags).toEqual([]);
  });

  it("leaves the other list alone", () => {
    const withWc = toggleFilter(EMPTY_FILTERS, "workCenterIds", "wc1");
    const both = toggleFilter(withWc, "tags", "rush");
    expect(both.workCenterIds).toEqual(["wc1"]);
    expect(both.tags).toEqual(["rush"]);
  });
});

describe("filterOperations", () => {
  it("is everything when no tag is chosen", () => {
    const all = [op("a", ["x"]), op("b"), op("c", [])];
    expect(filterOperations(all, EMPTY_FILTERS)).toHaveLength(3);
  });

  it("matches ANY chosen tag, not all of them", () => {
    // Web's filter is an `in` test. Requiring every tag would make choosing a
    // second tag narrow the board to nothing, which reads as a broken filter.
    const all = [op("a", ["rush"]), op("b", ["rework"]), op("c", ["other"])];
    const chosen = picked({ tags: ["rush", "rework"] });
    expect(filterOperations(all, chosen).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("drops an operation with no tags once a tag is chosen", () => {
    const all = [op("a", ["rush"]), op("b"), op("c", [])];
    const chosen = picked({ tags: ["rush"] });
    expect(filterOperations(all, chosen).map((o) => o.id)).toEqual(["a"]);
  });

  it("matches a process by the card's columnType", () => {
    // The board's columns are work centres and their TYPE is the process, so
    // the process id arrives under `columnType`. Reading `processId` instead
    // finds nothing and silently empties the board.
    const all = [
      op("a", [], { columnType: "p1" }),
      op("b", [], { columnType: "p2" })
    ];
    const chosen = picked({ processIds: ["p1"] });
    expect(filterOperations(all, chosen).map((o) => o.id)).toEqual(["a"]);
  });

  it("drops an operation with no process once a process is chosen", () => {
    const all = [op("a", [], { columnType: "p1" }), op("b")];
    const chosen = picked({ processIds: ["p1"] });
    expect(filterOperations(all, chosen).map((o) => o.id)).toEqual(["a"]);
  });

  it("matches an assignee", () => {
    const all = [
      op("a", [], { assignee: "u1" }),
      op("b", [], { assignee: "u2" })
    ];
    const chosen = picked({ assignees: ["u1"] });
    expect(filterOperations(all, chosen).map((o) => o.id)).toEqual(["a"]);
  });

  it("finds unassigned work, which is the question a lead asks", () => {
    const all = [
      op("a", [], { assignee: "u1" }),
      op("b", [], { assignee: null }),
      op("c")
    ];
    const chosen = picked({ assignees: [UNASSIGNED] });
    expect(filterOperations(all, chosen).map((o) => o.id)).toEqual(["b", "c"]);
  });

  it("stacks the filters, so each one narrows the last", () => {
    // Web's filters are AND across keys and OR within one. A card matching
    // the process but not the assignee must not survive.
    const all = [
      op("a", ["rush"], { columnType: "p1", assignee: "u1" }),
      op("b", ["rush"], { columnType: "p1", assignee: "u2" }),
      op("c", ["rush"], { columnType: "p2", assignee: "u1" })
    ];
    const chosen = picked({
      tags: ["rush"],
      processIds: ["p1"],
      assignees: ["u1"]
    });
    expect(filterOperations(all, chosen).map((o) => o.id)).toEqual(["a"]);
  });
});

describe("filterColumns", () => {
  it("is every column when none is chosen", () => {
    const cols = [col("a"), col("b")];
    expect(filterColumns(cols, EMPTY_FILTERS)).toHaveLength(2);
  });

  it("HIDES the others rather than emptying them", () => {
    // An empty column still takes a screen width on a phone, and the point of
    // choosing two work centres is to stop swiping past the other five.
    const cols = [col("a"), col("b"), col("c")];
    const chosen = picked({ workCenterIds: ["a", "c"] });
    expect(filterColumns(cols, chosen).map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("activeFilterCount", () => {
  it("counts every list, so the badge matches what is applied", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(
      activeFilterCount(
        picked({
          workCenterIds: ["a"],
          tags: ["x", "y"],
          processIds: ["p"],
          assignees: ["u"]
        })
      )
    ).toBe(5);
  });
});

describe("columnsWithResults", () => {
  const columns = [{ id: "cnc" }, { id: "assembly" }, { id: "paint" }];
  const searched = [
    { id: "1", columnId: "cnc" },
    { id: "2", columnId: "cnc" }
  ] as OperationCard[];

  it("drops the work centres a search left empty", () => {
    expect(columnsWithResults(columns, searched, "bracket")).toEqual([
      { id: "cnc" }
    ]);
  });

  it("keeps every column when the search is cleared", () => {
    expect(columnsWithResults(columns, [], "")).toEqual(columns);
  });

  it("treats a whitespace-only term as no search", () => {
    expect(columnsWithResults(columns, [], "   ")).toEqual(columns);
  });

  it("shows nothing rather than everything when a search matches nothing", () => {
    expect(columnsWithResults(columns, [], "nope")).toEqual([]);
  });
});
