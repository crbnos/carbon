// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type {
  BuildSourceNode,
  BuildTraceRow
} from "~/modules/projects/projects.models";
import {
  netBuildComponents,
  planElementsFromSource
} from "~/modules/projects/projects.models";

function node(
  key: string,
  parentKey: string | null,
  replenishment: "Make" | "Buy"
): BuildSourceNode {
  return {
    key,
    parentKey,
    itemId: `item-${key}`,
    name: key,
    replenishment
  };
}

/** A make method: 2 Make to Order children and 30 bought materials. */
const makeMethod: BuildSourceNode[] = [
  node("sub-a", null, "Make"),
  node("sub-b", null, "Make"),
  ...Array.from({ length: 30 }, (_, i) => node(`buy-${i}`, null, "Buy"))
];

/** Three levels: two sub-assemblies, each with a made and a bought child. */
const deepMethod: BuildSourceNode[] = [
  node("a", null, "Make"),
  node("b", null, "Make"),
  node("a1", "a", "Make"),
  node("a2", "a", "Buy"),
  node("b1", "b", "Make"),
  node("b1x", "b1", "Make")
];

function plan(
  nodes: BuildSourceNode[],
  overrides: Partial<Parameters<typeof planElementsFromSource>[0]> = {}
) {
  let next = 0;
  return planElementsFromSource({
    nodes,
    parentId: "root",
    depth: 2,
    includeBought: false,
    makeId: () => `pje_${++next}`,
    startSequence: 10,
    identifier: "SNS",
    defaultStateId: "unstarted",
    ...overrides
  });
}

describe("planElementsFromSource", () => {
  it("keeps the 2 made children under the root and drops the bought ones", () => {
    const rows = plan(makeMethod);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.name)).toEqual(["sub-a", "sub-b"]);
    expect(rows.every((row) => row.parentId === "root")).toBe(true);
    expect(rows.map((row) => row.readableId)).toEqual(["SNS-10", "SNS-11"]);
    expect(
      rows.every(
        (row) =>
          row.type === "System" &&
          row.isChargeable &&
          row.stateId === "unstarted"
      )
    ).toBe(true);
  });

  it("keeps the bought children with includeBought on", () => {
    expect(plan(makeMethod, { includeBought: true })).toHaveLength(32);
  });

  it("keeps only the first level at depth 1", () => {
    const rows = plan(deepMethod, { depth: 1, includeBought: true });
    expect(rows.map((row) => row.name)).toEqual(["a", "b"]);
  });

  it("puts every parent before its children", () => {
    const rows = plan(deepMethod, { depth: 3 });
    expect(rows.map((row) => row.name)).toEqual(["a", "b", "a1", "b1", "b1x"]);
    const seen = new Set<string>(["root"]);
    for (const row of rows) {
      expect(seen.has(row.parentId!)).toBe(true);
      seen.add(row.id);
    }
  });
});

/**
 * The engine serial SN-0001: the factory consumed transmission TR-100 into
 * it. A service order then installed TR-200 on the Transmission node (a
 * Service activity, input TR-200, output SN-0001) and removed TR-100.
 */
describe("netBuildComponents", () => {
  const trace = (
    activity: string,
    component: string,
    status = "Consumed"
  ): BuildTraceRow => ({
    sourceEntityId: "SN-0001",
    trackedActivityId: activity,
    id: component,
    status
  });
  const typeOf = new Map([
    ["make", "Consume"],
    ["service", "Service"],
    ["undo", "Unconsume"]
  ]);
  const components = (args: Partial<Parameters<typeof netBuildComponents>[0]>) =>
    netBuildComponents({
      consumed: [],
      given: [],
      typeOf,
      removed: new Set(),
      ...args
    }).map((pair) => pair.component);

  it("counts a part a service order installed, like a consumed one", () => {
    expect(
      components({
        consumed: [trace("make", "TR-100"), trace("service", "TR-200")]
      })
    ).toEqual(["TR-100", "TR-200"]);
  });

  it("drops the component a later service order removed from the asset", () => {
    expect(
      components({
        consumed: [trace("make", "TR-100"), trace("service", "TR-200")],
        removed: new Set(["SN-0001 TR-100"])
      })
    ).toEqual(["TR-200"]);
  });

  it("still nets an Unconsume and drops a scrapped part", () => {
    expect(
      components({
        consumed: [
          trace("make", "TR-100"),
          trace("make", "PUMP-1", "Scrapped")
        ],
        given: [trace("undo", "TR-100")]
      })
    ).toEqual([]);
  });

  it("ignores an activity of another type", () => {
    typeOf.set("split", "Split");
    expect(components({ consumed: [trace("split", "TR-100")] })).toEqual([]);
  });
});
