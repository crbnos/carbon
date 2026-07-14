import { describe, expect, it } from "vitest";
import { indexAssemblyGraph } from "./graph";
import type { AssemblyPlan } from "./plan";
import { buildAssemblyStepGroups, planMotionForComponents } from "./plan";
import type { AssemblyGraph, AssemblyGraphNode, Motion, Vec3 } from "./types";

const lift: Motion = {
  type: "linear",
  direction: [0, 0, -1],
  distance: 25
};

const slide: Motion = {
  type: "linear",
  direction: [-1, 0, 0],
  distance: 80
};

const plan: AssemblyPlan = {
  version: 1,
  unit: "mm",
  sequence: ["base", "bolt-1", "bolt-2", "cover"],
  components: {
    base: { motion: { type: "none" } },
    "bolt-1": { motion: lift, confidence: "high" },
    "bolt-2": { motion: lift, confidence: "high" },
    cover: { motion: slide, confidence: "low" }
  },
  warnings: []
};

describe("planMotionForComponents", () => {
  it("uses the component's own motion for a single component", () => {
    expect(planMotionForComponents(plan, ["bolt-1"])).toEqual({
      motion: lift,
      confidence: "high"
    });
  });

  it("uses the shared motion when all components agree", () => {
    expect(planMotionForComponents(plan, ["bolt-1", "bolt-2"])).toEqual({
      motion: lift,
      confidence: "high"
    });
  });

  it("falls back to the first motion with low confidence on disagreement", () => {
    expect(planMotionForComponents(plan, ["bolt-1", "cover"])).toEqual({
      motion: lift,
      confidence: "low"
    });
  });

  it("returns null for unplanned or unknown components", () => {
    expect(planMotionForComponents(plan, ["base"])).toBeNull();
    expect(planMotionForComponents(plan, ["missing"])).toBeNull();
    expect(planMotionForComponents(plan, [])).toBeNull();
    expect(planMotionForComponents(null, ["bolt-1"])).toBeNull();
  });
});

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function graphLeaf(
  nodeId: string,
  bbox: { min: Vec3; max: Vec3 },
  geometryHash = `hash-${nodeId}`
): AssemblyGraphNode {
  return {
    nodeId,
    name: nodeId,
    isAssembly: false,
    geometryHash,
    transform: IDENTITY,
    bbox,
    volume: 1000,
    color: null,
    children: []
  };
}

function graphOf(leaves: AssemblyGraphNode[]): AssemblyGraph {
  return {
    version: 1,
    unit: "mm",
    sourceUnit: "mm",
    componentCount: leaves.length,
    root: {
      nodeId: "root",
      name: "Assembly",
      isAssembly: true,
      geometryHash: null,
      transform: IDENTITY,
      bbox: { min: [-50, -50, 0], max: [50, 50, 40] },
      volume: null,
      color: null,
      children: leaves
    }
  };
}

describe("buildAssemblyStepGroups", () => {
  const graphIndex = indexAssemblyGraph(
    graphOf([
      graphLeaf("base", { min: [-50, -50, 0], max: [50, 50, 10] }),
      graphLeaf(
        "bolt-1",
        { min: [-30, -30, 10], max: [-20, -20, 30] },
        "hash-bolt"
      ),
      graphLeaf(
        "bolt-2",
        { min: [20, 20, 10], max: [30, 30, 30] },
        "hash-bolt"
      ),
      graphLeaf("cover", { min: [-10, -10, 30], max: [10, 10, 40] })
    ])
  );

  it("walks the sequence, merging consecutive identical components with the longest travel", () => {
    const stepPlan: AssemblyPlan = {
      version: 1,
      unit: "mm",
      sequence: ["base", "bolt-1", "bolt-2"],
      components: {
        base: { motion: { type: "none" } },
        "bolt-1": {
          motion: { type: "linear", direction: [0, 0, -1], distance: 20 },
          confidence: "high"
        },
        "bolt-2": {
          motion: { type: "linear", direction: [0, 0, -1], distance: 25 },
          confidence: "high"
        }
      },
      warnings: []
    };

    const groups = buildAssemblyStepGroups(stepPlan, graphIndex);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.componentNodeIds).toEqual(["base"]);
    expect(groups[0]?.motion).toEqual({ type: "none" });
    expect(groups[1]?.componentNodeIds).toEqual(["bolt-1", "bolt-2"]);
    expect(groups[1]?.motion).toEqual({
      type: "linear",
      direction: [0, 0, -1],
      distance: 25
    });
    expect(groups[1]?.confidence).toBe("high");
    expect(groups[1]?.blockedBy).toEqual([]);
  });

  it("drops fabricated motions on flagged components and never synthesizes a fallback for them", () => {
    const fabricated: Motion = {
      type: "linear",
      direction: [1, 0, 0],
      distance: 640
    };
    const stepPlan: AssemblyPlan = {
      version: 1,
      unit: "mm",
      sequence: ["base", "bolt-1", "bolt-2"],
      components: {
        base: { motion: { type: "none" } },
        "bolt-1": {
          motion: fabricated,
          confidence: "low",
          blockedBy: ["base"]
        },
        "bolt-2": {
          motion: fabricated,
          confidence: "low",
          blockedBy: ["cover"]
        }
      },
      warnings: []
    };

    const groups = buildAssemblyStepGroups(stepPlan, graphIndex);

    expect(groups).toHaveLength(2);
    const flagged = groups[1];
    // Identical flagged twins share a step; their blockers merge
    expect(flagged?.componentNodeIds).toEqual(["bolt-1", "bolt-2"]);
    expect(flagged?.motion).toEqual({ type: "none" });
    expect(flagged?.blockedBy).toEqual(["base", "cover"]);
    expect(flagged?.confidence).toBe("low");
  });

  it("keeps flagged and unflagged twins in separate steps", () => {
    const stepPlan: AssemblyPlan = {
      version: 1,
      unit: "mm",
      sequence: ["bolt-1", "bolt-2"],
      components: {
        "bolt-1": {
          motion: { type: "linear", direction: [0, 0, -1], distance: 20 },
          confidence: "high"
        },
        "bolt-2": {
          motion: { type: "linear", direction: [0, 0, -1], distance: 20 },
          confidence: "low",
          blockedBy: ["base"]
        }
      },
      warnings: []
    };

    const groups = buildAssemblyStepGroups(stepPlan, graphIndex);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.blockedBy).toEqual([]);
    expect(groups[1]?.componentNodeIds).toEqual(["bolt-2"]);
    expect(groups[1]?.motion).toEqual({ type: "none" });
  });

  it("folds a v3 unit's members into one named step", () => {
    const stepPlan: AssemblyPlan = {
      version: 3,
      unit: "mm",
      sequence: ["pcb-a", "pcb-b"],
      components: {
        "pcb-a": {
          motion: { type: "linear", direction: [0, 0, 1], distance: 30 },
          confidence: "high",
          groupId: "pcb"
        },
        "pcb-b": {
          motion: { type: "linear", direction: [0, 0, 1], distance: 30 },
          confidence: "high",
          groupId: "pcb"
        }
      },
      groups: {
        pcb: {
          componentNodeIds: ["pcb-a", "pcb-b"],
          motion: { type: "linear", direction: [0, 0, 1], distance: 30 },
          name: "PCB Assembly"
        }
      },
      warnings: []
    };

    const groups = buildAssemblyStepGroups(stepPlan, graphIndex);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.componentNodeIds).toEqual(["pcb-a", "pcb-b"]);
    expect(groups[0]?.name).toBe("PCB Assembly");
  });

  it("synthesizes an AABB fallback for unflagged none-motion components, but never the base", () => {
    const stepPlan: AssemblyPlan = {
      version: 1,
      unit: "mm",
      sequence: ["base", "cover"],
      components: {
        base: { motion: { type: "none" } },
        // Legacy plan: unplanned but not flagged
        cover: { motion: { type: "none" } }
      },
      warnings: []
    };

    const groups = buildAssemblyStepGroups(stepPlan, graphIndex);

    expect(groups[0]?.motion).toEqual({ type: "none" });
    expect(groups[1]?.motion.type).toBe("linear");
    expect(groups[1]?.confidence).toBe("low");
  });
});

describe("buildAssemblyStepGroups v2", () => {
  const graphIndex = indexAssemblyGraph(
    graphOf([
      graphLeaf("rail", { min: [-100, -10, 0], max: [100, 10, 20] }),
      graphLeaf("slider", { min: [-20, -12, 20], max: [20, 12, 40] }),
      graphLeaf("knob", { min: [-5, 12, 25], max: [5, 22, 35] }),
      graphLeaf("logo", { min: [-8, -1, 30], max: [8, 1, 34] })
    ])
  );

  it("keeps subassembly members in one step regardless of geometry", () => {
    const slide: Motion = {
      type: "linear",
      direction: [-1, 0, 0],
      distance: 120
    };
    const v2: AssemblyPlan = {
      version: 2,
      unit: "mm",
      sequence: ["rail", "slider", "knob"],
      components: {
        rail: { motion: { type: "none" }, tier: "base", verified: true },
        slider: {
          motion: slide,
          confidence: "low",
          tier: "group",
          groupId: "g1",
          verified: true
        },
        knob: {
          motion: slide,
          confidence: "low",
          tier: "group",
          groupId: "g1",
          verified: true
        }
      },
      groups: { g1: { componentNodeIds: ["slider", "knob"], motion: slide } },
      warnings: []
    };

    const groups = buildAssemblyStepGroups(v2, graphIndex);

    expect(groups).toHaveLength(2);
    expect(groups[1]?.componentNodeIds).toEqual(["slider", "knob"]);
    expect(groups[1]?.motion).toEqual(slide);
  });

  it("folds rigidly merged components into their host's step", () => {
    const lift: Motion = {
      type: "linear",
      direction: [0, 0, -1],
      distance: 40
    };
    const v2: AssemblyPlan = {
      version: 2,
      unit: "mm",
      sequence: ["rail", "slider"],
      components: {
        rail: { motion: { type: "none" }, tier: "base", verified: true },
        slider: { motion: lift, confidence: "high", verified: true },
        logo: { motion: { type: "none" }, mergedInto: "slider" }
      },
      warnings: []
    };

    const groups = buildAssemblyStepGroups(v2, graphIndex);

    expect(groups).toHaveLength(2);
    expect(groups[1]?.componentNodeIds).toEqual(["slider", "logo"]);
    expect(groups[1]?.motion).toEqual(lift);
  });

  it("treats verification failures as flagged", () => {
    const v2: AssemblyPlan = {
      version: 2,
      unit: "mm",
      sequence: ["rail", "slider"],
      components: {
        rail: { motion: { type: "none" }, tier: "base", verified: true },
        slider: {
          motion: { type: "linear", direction: [0, 0, -1], distance: 40 },
          confidence: "high",
          verified: false,
          blockedBy: ["rail"]
        }
      },
      warnings: []
    };

    const groups = buildAssemblyStepGroups(v2, graphIndex);

    expect(groups[1]?.motion).toEqual({ type: "none" });
    expect(groups[1]?.blockedBy).toEqual(["rail"]);
  });
});

describe("corridor-aware simultaneous steps", () => {
  // Four identical clips sliding along +X into a shared channel, seated
  // one behind another: each clip's insertion corridor sweeps through the
  // others' seats, so simultaneous animation would drive them through
  // each other — every clip takes its own step.
  const inlineSlide: Motion = {
    type: "linear",
    direction: [1, 0, 0],
    distance: 60
  };
  const inlineGraph = indexAssemblyGraph(
    graphOf(
      [0, 1, 2, 3].map((index) =>
        graphLeaf(
          `clip-${index}`,
          {
            min: [index * 20, 0, 0],
            max: [index * 20 + 15, 10, 10]
          },
          "hash-clip"
        )
      )
    )
  );
  const inlinePlan: AssemblyPlan = {
    version: 1,
    unit: "mm",
    sequence: ["clip-0", "clip-1", "clip-2", "clip-3"],
    components: Object.fromEntries(
      [0, 1, 2, 3].map((index) => [
        `clip-${index}`,
        { motion: inlineSlide, confidence: "high" as const }
      ])
    ),
    warnings: []
  };

  it("splits in-line slide-ins into independent steps", () => {
    const groups = buildAssemblyStepGroups(inlinePlan, inlineGraph);
    expect(groups.map((group) => group.componentNodeIds)).toEqual([
      ["clip-0"],
      ["clip-1"],
      ["clip-2"],
      ["clip-3"]
    ]);
  });

  it("keeps side-by-side same-direction components on one simultaneous step", () => {
    // Same four clips, but seated side by side across Y: corridors are
    // parallel and disjoint, simultaneous insertion is collision-free
    const sideGraph = indexAssemblyGraph(
      graphOf(
        [0, 1, 2, 3].map((index) =>
          graphLeaf(
            `clip-${index}`,
            {
              min: [0, index * 20, 0],
              max: [15, index * 20 + 10, 10]
            },
            "hash-clip"
          )
        )
      )
    );
    const groups = buildAssemblyStepGroups(inlinePlan, sideGraph);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.componentNodeIds).toEqual([
      "clip-0",
      "clip-1",
      "clip-2",
      "clip-3"
    ]);
  });

  it("never shares steps without a graph (hash falls back to nodeId)", () => {
    // Pre-existing behavior, unchanged by the corridor gate: with no
    // graph there is no geometryHash, so components can't be identified as
    // identical in the first place
    const groups = buildAssemblyStepGroups(inlinePlan, null);
    expect(groups).toHaveLength(4);
  });
});

describe("buildAssemblyStepGroups floater fold", () => {
  const push: Motion = { type: "linear", direction: [0, 0, -1], distance: 20 };
  // base placed first; "arm" is precedence-forced before "clip" (the neighbor
  // that attaches to it), so it lands detached; "tail" then attaches to clip.
  const foldPlan: AssemblyPlan = {
    version: 3,
    unit: "mm",
    sequence: ["base", "arm", "clip", "tail"],
    components: {
      base: { motion: { type: "none" } },
      arm: { motion: push, confidence: "high" },
      clip: { motion: push, confidence: "high" },
      tail: { motion: push, confidence: "high" }
    },
    contacts: {
      base: ["tail"],
      arm: ["clip"],
      clip: ["arm", "tail"],
      tail: ["clip", "base"]
    },
    warnings: []
  };
  const foldGraph = indexAssemblyGraph(
    graphOf([
      graphLeaf("base", { min: [-50, -50, 0], max: [50, 50, 10] }, "h-base"),
      graphLeaf("arm", { min: [-40, -40, 10], max: [-30, -30, 30] }, "h-arm"),
      graphLeaf("clip", { min: [-32, -32, 10], max: [-22, -22, 30] }, "h-clip"),
      graphLeaf("tail", { min: [10, 10, 10], max: [20, 20, 30] }, "h-tail")
    ])
  );

  it("folds a detached part into the next step that attaches to it", () => {
    const groups = buildAssemblyStepGroups(foldPlan, foldGraph);
    // base, [arm+clip], tail — the orphan arm rides one step with its neighbor
    expect(groups.map((g) => g.componentNodeIds)).toEqual([
      ["base"],
      ["arm", "clip"],
      ["tail"]
    ]);
  });

  it("leaves the sequence untouched when the plan has no contacts", () => {
    const groups = buildAssemblyStepGroups(
      { ...foldPlan, contacts: undefined },
      foldGraph
    );
    expect(groups).toHaveLength(4);
  });
});
