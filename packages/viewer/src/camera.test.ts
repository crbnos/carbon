import { describe, expect, it } from "vitest";
import {
  computeStepCameraPose,
  computeStepCameras,
  fitFraming
} from "./camera";
import { indexAssemblyGraph } from "./graph";
import type { AssemblyGraph, AssemblyGraphNode, Motion, Vec3 } from "./types";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const NONE: Motion = { type: "none" };

function leaf(nodeId: string, min: Vec3, max: Vec3): AssemblyGraphNode {
  return {
    nodeId,
    name: nodeId,
    isAssembly: false,
    geometryHash: nodeId,
    transform: IDENTITY,
    bbox: { min, max },
    volume: 1000,
    color: [0.5, 0.5, 0.5, 1],
    children: []
  };
}

// partA sits small at the origin. partB is a wide wall standing between the
// origin and the +Y viewpoints (the Z-up candidate rings lead with +Y), so it
// genuinely blocks partA's default sight line — which lets us prove that
// excluding it (as a future part) matters.
const graph: AssemblyGraph = {
  version: 1,
  unit: "mm",
  sourceUnit: "mm",
  componentCount: 2,
  root: {
    nodeId: "root",
    name: "Assembly",
    isAssembly: true,
    geometryHash: null,
    transform: IDENTITY,
    bbox: { min: [-50, -5, -50], max: [50, 60, 50] },
    volume: null,
    color: null,
    children: [
      leaf("partA", [-5, -5, -5], [5, 5, 5]),
      leaf("partB", [-50, 40, -50], [50, 60, 50])
    ]
  }
};

const index = indexAssemblyGraph(graph);

/** Local slab test mirroring the module's, for asserting the sight line. */
function blocked(
  eye: Vec3,
  look: Vec3,
  box: { min: Vec3; max: Vec3 }
): boolean {
  const axes: [number, number, number, number][] = [
    [eye[0], look[0], box.min[0], box.max[0]],
    [eye[1], look[1], box.min[1], box.max[1]],
    [eye[2], look[2], box.min[2], box.max[2]]
  ];
  let tMin = 0;
  let tMax = 0.98;
  for (const [o, e, boxMin, boxMax] of axes) {
    const delta = e - o;
    if (Math.abs(delta) < 1e-9) {
      if (o < boxMin || o > boxMax) return false;
      continue;
    }
    let tNear = (boxMin - o) / delta;
    let tFar = (boxMax - o) / delta;
    if (tNear > tFar) [tNear, tFar] = [tFar, tNear];
    tMin = Math.max(tMin, tNear);
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) return false;
  }
  return true;
}

describe("computeStepCameraPose", () => {
  it("returns a standing pose that frames the subject", () => {
    const pose = computeStepCameraPose(index, ["partA"], NONE, []);
    expect(pose).not.toBeNull();
    expect(pose?.fov).toBe(45);
    // target is the assembly center nudged toward the part
    expect(pose?.target[1]).toBeGreaterThan(0);
    expect(pose?.target[1]).toBeLessThan(28);
  });

  it("returns null for degenerate geometry", () => {
    expect(computeStepCameraPose(index, ["missing"], NONE, [])).toBeNull();
  });
});

describe("computeStepCameras", () => {
  const groups = [
    { componentNodeIds: ["partA"], motion: NONE },
    { componentNodeIds: ["partB"], motion: NONE }
  ];
  const cameras = computeStepCameras(groups, index);

  it("produces one pose per group", () => {
    expect(cameras).toHaveLength(2);
    expect(cameras[0]).not.toBeNull();
    expect(cameras[1]).not.toBeNull();
  });

  it("ignores not-yet-animated (future) parts when framing an earlier step", () => {
    // Step 0's occluders must be empty — partB installs later, so it must not
    // push the camera. The baked pose therefore equals the no-occluder pose.
    expect(cameras[0]).toEqual(
      computeStepCameraPose(index, ["partA"], NONE, [])
    );
    // And this is not vacuous: partB genuinely blocks partA's default view, so
    // if it were wrongly treated as an occluder the pose would change.
    expect(
      computeStepCameraPose(index, ["partA"], NONE, ["partB"])
    ).not.toEqual(cameras[0]);
  });

  it("gives a step an unobstructed view over already-animated parts", () => {
    // Step 1 installs partB; partA is already seated and could occlude. The
    // chosen eye must keep a clear sight line to partB.
    const pose = cameras[1];
    expect(pose).not.toBeNull();
    if (!pose) return;
    const partBCenter: Vec3 = [0, 50, 0];
    const partA = index.nodesById.get("partA");
    expect(partA).toBeDefined();
    if (!partA) return;
    expect(blocked(pose.position, partBCenter, partA.bbox)).toBe(false);
  });

  it("ignores components no step installs — they are never on the canvas", () => {
    // Same layout plus a stray wall assigned to NO group. Never-installed
    // components render like future ones (not present), so the stray wall
    // must not push the camera either.
    const strayGraph: AssemblyGraph = {
      ...graph,
      componentCount: 3,
      root: {
        ...graph.root,
        children: [
          ...graph.root.children,
          leaf("stray", [-50, 40, -50], [50, 60, 50])
        ]
      }
    };
    const strayIndex = indexAssemblyGraph(strayGraph);
    const strayCameras = computeStepCameras(
      [{ componentNodeIds: ["partA"], motion: NONE }],
      strayIndex
    );
    expect(strayCameras[0]).toEqual(
      computeStepCameraPose(strayIndex, ["partA"], NONE, [])
    );
    // Not vacuous: treated as an occluder, the stray wall would change the pose
    expect(
      computeStepCameraPose(strayIndex, ["partA"], NONE, ["stray"])
    ).not.toEqual(strayCameras[0]);
  });
});

describe("fitFraming", () => {
  const tanH = Math.tan((30 * Math.PI) / 180); // wide-ish frustum for readable numbers
  const tanV = Math.tan((22.5 * Math.PI) / 180);
  const margin = 0.85;

  /** Every point inside the margin frustum for the fitted pan/distance? */
  function contained(
    points: Vec3[],
    fit: { pan: [number, number]; distance: number }
  ): boolean {
    return points.every(([x, y, v]) => {
      const depth = fit.distance - v;
      return (
        depth > 0 &&
        Math.abs(x - fit.pan[0]) <= margin * tanH * depth + 1e-9 &&
        Math.abs(y - fit.pan[1]) <= margin * tanV * depth + 1e-9
      );
    });
  }

  it("keeps a centered action untouched", () => {
    const points: Vec3[] = [
      [-5, -5, 0],
      [5, 5, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.pan).toEqual([0, 0]);
    expect(fit.distance).toBe(100);
    expect(contained(points, fit)).toBe(true);
  });

  it("pans minimally toward an off-center action instead of zooming", () => {
    // Far right of the frustum at distance 100: half-width = .85*tanH*100 ≈ 49
    const points: Vec3[] = [
      [60, 0, 0],
      [70, 0, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.distance).toBe(100); // no zoom — pan suffices
    expect(fit.pan[0]).toBeGreaterThan(0);
    expect(contained(points, fit)).toBe(true);
    // Minimal: the nearest constraint edge, not the action center
    expect(fit.pan[0]).toBeCloseTo(70 - margin * tanH * 100, 5);
  });

  it("grows the distance only when the action cannot fit", () => {
    // Spread wider than the frustum can hold at the standing distance
    // (needs ~306 units of eye distance; fits under the 4× cap)
    const points: Vec3[] = [
      [-150, 0, 0],
      [150, 0, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.distance).toBeGreaterThan(100);
    expect(contained(points, fit)).toBe(true);
  });

  it("caps the zoom-out at 4× the standing distance", () => {
    // Impossible spread — capping preserves context instead of zooming to a dot
    const points: Vec3[] = [
      [-1000, 0, 0],
      [1000, 0, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.distance).toBe(400);
  });

  it("accounts for point depth (closer points need more room)", () => {
    // Same lateral offset, but one point sits far toward the eye where the
    // frustum is narrower
    const points: Vec3[] = [
      [40, 0, 60],
      [40, 0, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(contained(points, fit)).toBe(true);
  });

  it("never returns a point behind the eye", () => {
    const points: Vec3[] = [[0, 0, 150]]; // beyond the standing distance
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.distance).toBeGreaterThan(150);
    expect(contained(points, fit)).toBe(true);
  });
});
