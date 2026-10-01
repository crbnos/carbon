// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { indexAssemblyGraph } from "./graph";
import {
  buildStaging,
  EMPTY_STAGING,
  joinTargets,
  parkedOffsetsAt,
  stagedGroupNodeIds
} from "./staging";
import type {
  AssemblyGraph,
  AssemblyGraphNode,
  AssemblyStep,
  Vec3
} from "./types";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function leaf(nodeId: string, min: Vec3, max: Vec3): AssemblyGraphNode {
  return {
    nodeId,
    name: nodeId,
    isAssembly: false,
    geometryHash: nodeId,
    transform: IDENTITY,
    bbox: { min, max },
    volume: 1,
    color: null,
    children: []
  };
}

// A trailing arm with a front hub (bearing, circlip, disc).
const graph: AssemblyGraph = {
  version: 1,
  unit: "mm",
  sourceUnit: "mm",
  componentCount: 6,
  root: {
    nodeId: "root",
    name: "Trailing arm assembly",
    isAssembly: true,
    geometryHash: null,
    transform: IDENTITY,
    bbox: { min: [0, 0, 0], max: [100, 50, 50] },
    volume: null,
    color: null,
    children: [
      leaf("arm", [0, 0, 0], [100, 50, 50]),
      leaf("hub", [40, 10, 10], [60, 40, 40]),
      leaf("bearing", [45, 15, 15], [55, 35, 35]),
      leaf("circlip", [48, 20, 20], [52, 30, 30]),
      leaf("disc", [30, 0, 0], [70, 50, 50]),
      leaf("bolt", [90, 0, 0], [95, 5, 5])
    ]
  }
};
const index = indexAssemblyGraph(graph);
const DIAGONAL = Math.hypot(100, 50, 50);
const GAP = DIAGONAL * 0.25;

type Step = Pick<
  AssemblyStep,
  "id" | "componentNodeIds" | "joinStepId" | "camera"
>;

function step(
  id: string,
  componentNodeIds: string[],
  joinStepId?: string
): Step {
  return { id, componentNodeIds, joinStepId: joinStepId ?? null, camera: null };
}

// 0 arm (base) · 1 hub · 2 bearing · 3 circlip · 4 disc · 5 join (hub group into arm)
const steps: Step[] = [
  step("s0", ["arm"]),
  step("s1", ["hub"], "s5"),
  step("s2", ["bearing"], "s5"),
  step("s3", ["circlip"], "s5"),
  step("s4", ["disc"], "s5"),
  step("s5", [])
];

describe("buildStaging", () => {
  it("groups the staged steps under their join step", () => {
    const staging = buildStaging(steps, index);
    expect([...staging.joins.keys()]).toEqual([5]);
    const join = staging.joins.get(5);
    expect(join?.nodeIds).toEqual(["hub", "bearing", "circlip", "disc"]);
    // The group's left edge (disc, x=30) lands one gap right of the model.
    expect(join?.offset[0]).toBeCloseTo(100 + GAP - 30);
    expect(join?.offset[1]).toBe(0);
    expect(join?.offset[2]).toBe(0);
    expect([...staging.stagedToJoin]).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5]
    ]);
  });

  it("ignores backwards, base and unknown links", () => {
    const staging = buildStaging(
      [
        step("s0", ["arm"], "s2"), // the base can't be staged
        step("s1", ["hub"], "s0"), // backwards
        step("s2", ["bearing"], "missing"), // unknown id
        step("s3", ["circlip"]),
        step("s4", ["disc"], "s5"),
        step("s5", [])
      ],
      index
    );
    expect([...staging.stagedToJoin]).toEqual([[4, 5]]);
    expect(staging.joins.get(5)?.nodeIds).toEqual(["disc"]);
  });

  it("builds a nested chain in place — neither link counts", () => {
    // s1 → s2 → s3: s2 is both a join target and staged. The ERP refuses this;
    // a row that slips through plays as if nothing were staged.
    const staging = buildStaging(
      [
        step("s0", ["arm"]),
        step("s1", ["hub"], "s2"),
        step("s2", ["bearing"], "s3"),
        step("s3", [])
      ],
      index
    );
    expect(staging).toBe(EMPTY_STAGING);
  });

  it("gives several groups their own non-overlapping lanes", () => {
    const staging = buildStaging(
      [
        step("s0", ["arm"]),
        step("s1", ["hub"], "s2"),
        step("s2", []),
        step("s3", ["bolt"], "s4"),
        step("s4", [])
      ],
      index
    );
    const first = staging.joins.get(2);
    const second = staging.joins.get(4);
    if (!first || !second) throw new Error("expected two joins");
    const firstMax = 60 + first.offset[0];
    const secondMin = 90 + second.offset[0];
    expect(secondMin).toBeCloseTo(firstMax + GAP);
  });

  it("stages beside the model, side-on to a saved camera", () => {
    // The join step's saved view looks straight down X: staging along X would
    // hide the group behind the model, so it goes along Z instead.
    const staging = buildStaging(
      [
        step("s0", ["arm"]),
        step("s1", ["hub"], "s2"),
        {
          ...step("s2", []),
          camera: { position: [500, 25, 25], target: [50, 25, 25], fov: 45 }
        }
      ],
      index
    );
    const offset = staging.joins.get(2)?.offset;
    expect(offset?.[0]).toBe(0);
    expect(offset?.[1]).toBe(0);
    // Hub's near face (z=10) lands one gap past the model's far face (z=50).
    expect(offset?.[2]).toBeCloseTo(50 + GAP - 10);
  });

  it("never stages above or below the model", () => {
    // A camera looking straight down Y is side-on to every horizontal axis.
    const staging = buildStaging(
      [
        step("s0", ["arm"]),
        step("s1", ["hub"], "s2"),
        {
          ...step("s2", []),
          camera: { source: "plan", direction: [0, 1, 0] }
        }
      ],
      index
    );
    expect(staging.joins.get(2)?.offset[1]).toBe(0);
    expect(staging.joins.get(2)?.offset[0]).toBeGreaterThan(0);
  });

  it("is empty without a graph or without links", () => {
    expect(buildStaging(steps, null)).toBe(EMPTY_STAGING);
    expect(
      buildStaging([step("s0", ["arm"]), step("s1", ["hub"])], index)
    ).toBe(EMPTY_STAGING);
  });

  it("skips a join whose parts no longer resolve", () => {
    const staging = buildStaging(
      [step("s0", ["arm"]), step("s1", ["gone"], "s2"), step("s2", [])],
      index
    );
    expect(staging.joins.size).toBe(0);
    expect(staging.stagedToJoin.size).toBe(0);
  });
});

describe("parkedOffsetsAt", () => {
  const staging = buildStaging(steps, index);
  const offset = staging.joins.get(5)?.offset;

  it("parks nothing before the first staged step", () => {
    expect(parkedOffsetsAt(staging, steps, 0).size).toBe(0);
  });

  it("parks the active staged step's own parts and the earlier staged parts", () => {
    expect([...parkedOffsetsAt(staging, steps, 1).keys()]).toEqual(["hub"]);
    const atCirclip = parkedOffsetsAt(staging, steps, 3);
    expect([...atCirclip.keys()]).toEqual(["hub", "bearing", "circlip"]);
    expect(atCirclip.get("bearing")).toEqual(offset);
  });

  it("parks nothing at or after the join step", () => {
    expect(parkedOffsetsAt(staging, steps, 5).size).toBe(0);
  });
});

describe("stagedGroupNodeIds", () => {
  it("returns the carried-in parts for a join step and nothing otherwise", () => {
    expect(stagedGroupNodeIds(steps, "s5")).toEqual([
      "hub",
      "bearing",
      "circlip",
      "disc"
    ]);
    expect(stagedGroupNodeIds(steps, "s2")).toEqual([]);
    expect(stagedGroupNodeIds(steps, "missing")).toEqual([]);
  });
});

describe("joinTargets", () => {
  it("locks the base step", () => {
    expect(joinTargets(steps, "s0")).toEqual({ targets: [], locked: "base" });
  });

  it("locks a join step", () => {
    expect(joinTargets(steps, "s5")).toEqual({ targets: [], locked: "join" });
  });

  it("offers later steps that aren't built aside themselves", () => {
    // s2–s4 are staged (they point at s5), so s1 may only join s5.
    expect(joinTargets(steps, "s1")).toEqual({ targets: ["s5"], locked: null });
    expect(
      joinTargets(
        [
          step("s0", ["arm"]),
          step("s1", ["hub"]),
          step("s2", []),
          step("s3", [])
        ],
        "s1"
      )
    ).toEqual({ targets: ["s2", "s3"], locked: null });
  });

  it("offers nothing for an unknown step", () => {
    expect(joinTargets(steps, "missing")).toEqual({
      targets: [],
      locked: null
    });
  });
});
