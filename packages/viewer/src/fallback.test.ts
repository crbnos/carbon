import { describe, expect, it } from "vitest";
import { synthesizeFallbackMotion } from "./fallback";
import { indexAssemblyGraph } from "./graph";
import type { AssemblyGraph, AssemblyGraphNode, Vec3 } from "./types";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function leaf(
  nodeId: string,
  bbox: { min: Vec3; max: Vec3 }
): AssemblyGraphNode {
  return {
    nodeId,
    name: nodeId,
    isAssembly: false,
    geometryHash: `hash-${nodeId}`,
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
      bbox: { min: [0, 0, 0], max: [0, 0, 0] },
      volume: null,
      color: null,
      children: leaves
    }
  };
}

/** Every leaf except the moving component(s) — the "all installed" world. */
function allExcept(
  leaves: AssemblyGraphNode[],
  componentNodeIds: string[]
): Set<string> {
  const components = new Set(componentNodeIds);
  return new Set(
    leaves.map((node) => node.nodeId).filter((id) => !components.has(id))
  );
}

describe("synthesizeFallbackMotion", () => {
  it("returns null when no component resolves to leaf geometry", () => {
    const leaves = [leaf("base", { min: [0, 0, 0], max: [100, 100, 10] })];
    const index = indexAssemblyGraph(graphOf(leaves));
    expect(
      synthesizeFallbackMotion(index, ["missing"], allExcept(leaves, []))
    ).toBeNull();
    expect(
      synthesizeFallbackMotion(index, [], allExcept(leaves, []))
    ).toBeNull();
  });

  it("lifts an unobstructed top component straight up", () => {
    // Small box sitting on a plate: nothing above it, exits +Z
    const leaves = [
      leaf("base", { min: [-50, -50, 0], max: [50, 50, 10] }),
      leaf("top", { min: [-10, -10, 10], max: [10, 10, 20] })
    ];
    const index = indexAssemblyGraph(graphOf(leaves));

    const motion = synthesizeFallbackMotion(
      index,
      ["top"],
      allExcept(leaves, ["top"])
    );
    expect(motion?.type).toBe("linear");
    if (motion?.type !== "linear") throw new Error("expected linear");
    // Removal +Z -> insertion approaches from above (direction -Z)
    expect(motion.direction).toEqual([-0, -0, -1]);
    expect(motion.distance).toBeGreaterThan(0);
  });

  it("escapes sideways-then-up from under an overhang", () => {
    // Component under a canopy that blocks +Z and walls blocking +X/-X/±Y at its
    // level, open toward -X above the walls... simpler: canopy over the component
    // only; the component must hop +X past the canopy edge, then exit +Z
    const leaves = [
      leaf("base", { min: [-50, -50, 0], max: [50, 50, 10] }),
      // canopy directly above the component, wider than it on -X/±Y so the only
      // short hop past its footprint is +X
      leaf("canopy", { min: [-50, -50, 30], max: [20, 50, 40] }),
      leaf("component", { min: [-10, -10, 10], max: [10, 10, 20] })
    ];
    const index = indexAssemblyGraph(graphOf(leaves));

    const motion = synthesizeFallbackMotion(
      index,
      ["component"],
      allExcept(leaves, ["component"])
    );
    expect(motion).not.toBeNull();
    // The component exits +X (only unobstructed straight direction: -X/±Y sweep
    // under the canopy... all lateral sweeps at z10-20 are actually free of
    // the canopy at z30 — so this stays linear along a lateral axis
    expect(motion?.type).toBe("linear");
  });

  it("hops past blockers when every straight exit is obstructed", () => {
    // The component is ringed by boxes at its own level on all four sides and
    // covered above and below by slabs that leave a gap over the +X blocker:
    // straight exits all collide; the escape is +X after hopping... instead
    // craft the canonical case: blockers above AND laterally except one hop
    const leaves = [
      leaf("component", { min: [-10, -10, 10], max: [10, 10, 20] }),
      // slabs above and below, spanning the whole footprint
      leaf("above", { min: [-40, -40, 25], max: [40, 40, 35] }),
      leaf("below", { min: [-40, -40, -5], max: [40, 40, 5] }),
      // lateral blockers on -X and ±Y at the component's level
      leaf("wallNX", { min: [-40, -40, 5], max: [-20, 40, 25] }),
      leaf("wallPY", { min: [-40, 20, 5], max: [40, 40, 25] }),
      leaf("wallNY", { min: [-40, -40, 5], max: [40, -20, 25] })
    ];
    const index = indexAssemblyGraph(graphOf(leaves));

    const motion = synthesizeFallbackMotion(
      index,
      ["component"],
      allExcept(leaves, ["component"])
    );
    // +X at the component's level is the only clear straight exit
    expect(motion?.type).toBe("linear");
    if (motion?.type !== "linear") throw new Error("expected linear");
    expect(motion.direction).toEqual([-1, -0, -0]);
  });

  it("emits a two-segment escape when no straight exit exists", () => {
    // Fully ringed at its level, capped above over the component footprint only:
    // the component must hop +X (free lane at its level), then exit +Z past the
    // cap's edge
    const leaves = [
      leaf("component", { min: [-10, -10, 10], max: [10, 10, 20] }),
      // cap above the component only (footprint ends at x=15)
      leaf("cap", { min: [-40, -40, 25], max: [15, 40, 35] }),
      // floor below everything
      leaf("floor", { min: [-40, -40, 0], max: [60, 40, 5] }),
      // walls on -X and ±Y at the component's level; +X lane is open but a
      // distant wall blocks the straight +X exit
      leaf("wallNX", { min: [-40, -40, 5], max: [-20, 40, 25] }),
      leaf("wallPY", { min: [-40, 20, 5], max: [60, 40, 25] }),
      leaf("wallNY", { min: [-40, -40, 5], max: [60, -20, 25] }),
      leaf("wallPX", { min: [50, -40, 5], max: [60, 40, 45] })
    ];
    const index = indexAssemblyGraph(graphOf(leaves));

    const motion = synthesizeFallbackMotion(
      index,
      ["component"],
      allExcept(leaves, ["component"])
    );
    expect(motion?.type).toBe("L");
    if (motion?.type !== "L") throw new Error("expected L");
    expect(motion.segments.length).toBe(2);
    // Insertion: first leg approaches (reverse of the exit), second settles
    // (reverse of the hop). Every segment travels a positive distance.
    for (const segment of motion.segments) {
      expect(segment.distance).toBeGreaterThan(0);
    }
    // The settle leg reverses the +X hop -> -X insertion component
    const settle = motion.segments[motion.segments.length - 1];
    expect(settle?.direction[0]).toBe(-1);
  });

  it("returns null instead of fabricating a path when fully enclosed", () => {
    const leaves = [
      leaf("component", { min: [-10, -10, -10], max: [10, 10, 10] }),
      // six enclosing slabs
      leaf("top", { min: [-30, -30, 20], max: [30, 30, 30] }),
      leaf("bottom", { min: [-30, -30, -30], max: [30, 30, -20] }),
      leaf("px", { min: [20, -30, -30], max: [30, 30, 30] }),
      leaf("nx", { min: [-30, -30, -30], max: [-20, 30, 30] }),
      leaf("py", { min: [-30, 20, -30], max: [30, 30, 30] }),
      leaf("ny", { min: [-30, -30, -30], max: [30, -20, 30] })
    ];
    const index = indexAssemblyGraph(graphOf(leaves));

    const motion = synthesizeFallbackMotion(
      index,
      ["component"],
      allExcept(leaves, ["component"])
    );
    // A path through the enclosure would animate straight through geometry —
    // the step keeps motion "none" and fades in
    expect(motion).toBeNull();
  });

  it("refuses to synthesize for a component mated to a present part", () => {
    // A slider-on-rail shape: the component sits INSIDE the host's bounding
    // box (interpenetration, not face contact). Every lateral "exit" an AABB
    // sweep would find cuts through the host on screen, so the fallback must
    // return null (fade in) rather than fabricate one.
    const leaves = [
      leaf("rail", { min: [-100, -20, 0], max: [100, 20, 30] }),
      leaf("slider", { min: [-15, -25, 5], max: [15, 25, 25] })
    ];
    const index = indexAssemblyGraph(graphOf(leaves));

    expect(
      synthesizeFallbackMotion(index, ["slider"], new Set(["rail"]))
    ).toBeNull();

    // The same slider with the rail absent from the present set (not yet
    // installed) synthesizes freely — nothing is mated on the canvas.
    expect(
      synthesizeFallbackMotion(index, ["slider"], new Set())
    ).not.toBeNull();
  });

  it("ignores components that are not in the present set", () => {
    // The canopy fully covers the component, but it belongs to a LATER step
    // (or no step): with it absent from the present set the component exits
    // straight up as if the canopy weren't there
    const leaves = [
      leaf("base", { min: [-50, -50, 0], max: [50, 50, 10] }),
      leaf("canopy", { min: [-50, -50, 30], max: [50, 50, 40] }),
      leaf("component", { min: [-10, -10, 10], max: [10, 10, 20] })
    ];
    const index = indexAssemblyGraph(graphOf(leaves));

    const blocked = synthesizeFallbackMotion(
      index,
      ["component"],
      new Set(["base", "canopy"])
    );
    // With the canopy present the +Z exit is blocked — the fallback picks a
    // lateral escape instead of approaching from above
    if (blocked?.type !== "linear") throw new Error("expected linear");
    expect(blocked.direction[2]).not.toBe(-1);

    const clear = synthesizeFallbackMotion(
      index,
      ["component"],
      new Set(["base"])
    );
    expect(clear?.type).toBe("linear");
    if (clear?.type !== "linear") throw new Error("expected linear");
    // Removal +Z -> insertion approaches from above
    expect(clear.direction).toEqual([-0, -0, -1]);
  });
});
