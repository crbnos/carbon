import {
  AnimationMixer,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3
} from "three";
import { describe, expect, it } from "vitest";
import { indexAssemblyGraph } from "./graph";
import {
  buildStepClip,
  DEFAULT_WAYPOINT_DISTANCE,
  displayMotionForStep,
  type MotionKeyframes,
  motionDuration,
  motionToKeyframes,
  motionToWaypoints,
  motionTravelDistance,
  naturalizeMotion,
  type Pose,
  resampleEased,
  waypointsToMotion
} from "./motion";
import type { AssemblyStep, Motion, Vec3 } from "./types";

const IDENTITY_POSE: Pose = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1]
};

function positionAt(keyframes: MotionKeyframes, index: number): number[] {
  return keyframes.positions.slice(index * 3, index * 3 + 3);
}

function quaternionAt(keyframes: MotionKeyframes, index: number): number[] {
  return keyframes.quaternions.slice(index * 4, index * 4 + 4);
}

function lastIndex(keyframes: MotionKeyframes): number {
  return keyframes.times.length - 1;
}

function expectVectorClose(actual: number[], expected: number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 6);
  });
}

function expectMonotonicTimes(keyframes: MotionKeyframes) {
  expect(keyframes.times[0]).toBe(0);
  for (let i = 1; i < keyframes.times.length; i++) {
    expect(keyframes.times[i]).toBeGreaterThan(
      keyframes.times[i - 1] ?? Number.POSITIVE_INFINITY
    );
  }
}

function makeStep(motion: Motion, componentNodeIds: string[]): AssemblyStep {
  return {
    id: "step-1",
    title: null,
    instructionText: null,
    componentNodeIds,
    motion,
    camera: null,
    fastener: null
  };
}

describe("motionTravelDistance", () => {
  it("computes travel for each motion type", () => {
    expect(
      motionTravelDistance({
        type: "linear",
        direction: [0, 0, -1],
        distance: 80
      })
    ).toBe(80);
    expect(
      motionTravelDistance({
        type: "L",
        segments: [
          { direction: [1, 0, 0], distance: 60 },
          { direction: [0, 0, -1], distance: 20 }
        ]
      })
    ).toBe(80);
    expect(
      motionTravelDistance({
        type: "helix",
        axis: [0, 0, -1],
        origin: [0, 0, 0],
        pitch: 0.8,
        turns: 6,
        approach: 30
      })
    ).toBeCloseTo(34.8);
    expect(motionTravelDistance({ type: "none" })).toBe(0);
  });
});

describe("motionDuration", () => {
  it("scales with travel distance and clamps to 1-4 s", () => {
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 6 })
    ).toBe(1);
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 120 })
    ).toBeCloseTo(2);
    expect(
      motionDuration({ type: "linear", direction: [0, 0, 1], distance: 6000 })
    ).toBe(4);
    expect(motionDuration({ type: "none" })).toBe(0);
  });
});

describe("motionToKeyframes", () => {
  it("returns null for none motions", () => {
    expect(motionToKeyframes({ type: "none" }, IDENTITY_POSE)).toBeNull();
  });

  it("linear: starts displaced against the insertion direction and ends at the final pose", () => {
    const basePose: Pose = {
      position: [10, 20, 30],
      quaternion: [0, 0, 0, 1]
    };
    const keyframes = motionToKeyframes(
      { type: "linear", direction: [0, 0, -1], distance: 80 },
      basePose,
      { duration: 2 }
    );
    expect(keyframes).not.toBeNull();
    if (!keyframes) return;

    expectMonotonicTimes(keyframes);
    expect(keyframes.times).toEqual([0, 2]);
    expectVectorClose(positionAt(keyframes, 0), [10, 20, 110]);
    expectVectorClose(
      positionAt(keyframes, lastIndex(keyframes)),
      [10, 20, 30]
    );
    expectVectorClose(quaternionAt(keyframes, 0), [0, 0, 0, 1]);
    expectVectorClose(
      quaternionAt(keyframes, lastIndex(keyframes)),
      [0, 0, 0, 1]
    );
  });

  it("linear: normalizes the direction vector", () => {
    const keyframes = motionToKeyframes(
      { type: "linear", direction: [0, 0, -10], distance: 80 },
      IDENTITY_POSE
    );
    if (!keyframes) throw new Error("expected keyframes");
    expectVectorClose(positionAt(keyframes, 0), [0, 0, 80]);
  });

  it("L: walks segments backwards from the final pose with proportional times", () => {
    const keyframes = motionToKeyframes(
      {
        type: "L",
        segments: [
          { direction: [1, 0, 0], distance: 60 },
          { direction: [0, 0, -1], distance: 20 }
        ]
      },
      IDENTITY_POSE,
      { duration: 2 }
    );
    if (!keyframes) throw new Error("expected keyframes");

    expectMonotonicTimes(keyframes);
    expect(keyframes.times.length).toBe(3);
    // 60 of 80 mm in segment 1 → 75% of the duration
    expect(keyframes.times[1]).toBeCloseTo(1.5);
    expect(keyframes.times[2]).toBeCloseTo(2);
    expectVectorClose(positionAt(keyframes, 0), [-60, 0, 20]);
    expectVectorClose(positionAt(keyframes, 1), [0, 0, 20]);
    expectVectorClose(positionAt(keyframes, 2), [0, 0, 0]);
  });

  it("helix: retracts by approach + pitch*turns and ends seated at the final pose", () => {
    const basePose: Pose = {
      position: [10, 20, 5],
      quaternion: [0, 0, 0, 1]
    };
    const motion: Motion = {
      type: "helix",
      axis: [0, 0, -1],
      origin: [10, 20, 5], // through the component center so rotation keeps position
      pitch: 0.8,
      turns: 6,
      approach: 30
    };
    const keyframes = motionToKeyframes(motion, basePose, {
      samplesPerTurn: 4
    });
    if (!keyframes) throw new Error("expected keyframes");

    expectMonotonicTimes(keyframes);
    // 1 approach start + 1 threading start + turns * samplesPerTurn samples
    expect(keyframes.times.length).toBe(2 + 6 * 4);
    expect(keyframes.quaternions.length).toBe((2 + 6 * 4) * 4);

    // Start fully retracted along the axis: approach + pitch*turns = 34.8 mm
    expectVectorClose(positionAt(keyframes, 0), [10, 20, 5 + 34.8]);
    // Threading start: approach consumed, thread advance remaining
    expectVectorClose(positionAt(keyframes, 1), [10, 20, 5 + 4.8]);
    // Seated
    const last = lastIndex(keyframes);
    expectVectorClose(positionAt(keyframes, last), [10, 20, 5]);
    expectVectorClose(quaternionAt(keyframes, last), [0, 0, 0, 1]);

    // Rotation actually happens between thread samples (quarter turns)
    const intermediate = quaternionAt(keyframes, 2);
    const final = quaternionAt(keyframes, last);
    const dot = intermediate.reduce(
      (sum, value, index) => sum + value * (final[index] ?? Number.NaN),
      0
    );
    expect(Math.abs(dot)).toBeLessThan(0.999);
  });

  it("helix: ends exactly at the final pose even when origin is off-axis from the component", () => {
    const basePose: Pose = {
      position: [10, 0, 0],
      quaternion: [0, 0, 0, 1]
    };
    const keyframes = motionToKeyframes(
      {
        type: "helix",
        axis: [0, 0, 1],
        origin: [0, 0, 0],
        pitch: 1,
        turns: 2.5,
        approach: 10
      },
      basePose
    );
    if (!keyframes) throw new Error("expected keyframes");
    const last = lastIndex(keyframes);
    expectVectorClose(positionAt(keyframes, last), [10, 0, 0]);
    expectVectorClose(quaternionAt(keyframes, last), [0, 0, 0, 1]);
    expectMonotonicTimes(keyframes);
  });

  it("path: passes absolute world poses through, scaling t by duration", () => {
    const keyframes = motionToKeyframes(
      {
        type: "path",
        keyframes: [
          { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
          { t: 0.5, position: [0, 50, 50], quaternion: [0, 0, 0, 1] },
          { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
        ]
      },
      IDENTITY_POSE,
      { duration: 2 }
    );
    if (!keyframes) throw new Error("expected keyframes");
    expect(keyframes.times).toEqual([0, 1, 2]);
    expectVectorClose(positionAt(keyframes, 0), [0, 0, 100]);
    expectVectorClose(positionAt(keyframes, 1), [0, 50, 50]);
    expectVectorClose(positionAt(keyframes, 2), [0, 0, 0]);
  });

  it("path: rejects non-monotonic times", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 0.5, position: [0, 0, 50], quaternion: [0, 0, 0, 1] },
            { t: 0.5, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/strictly increasing/);
  });

  it("path: rejects a last keyframe that is not the final pose", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 1, position: [0, 0, 5], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/final pose/);
  });

  it("path: requires t to span 0..1 and at least 2 keyframes", () => {
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [{ t: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }]
        },
        IDENTITY_POSE
      )
    ).toThrow(/at least 2/);
    expect(() =>
      motionToKeyframes(
        {
          type: "path",
          keyframes: [
            { t: 0.1, position: [0, 0, 100], quaternion: [0, 0, 0, 1] },
            { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
          ]
        },
        IDENTITY_POSE
      )
    ).toThrow(/span/);
  });
});

describe("buildStepClip", () => {
  function makeAssembly() {
    const root = new Group();
    const parent = new Group();
    parent.position.set(5, 0, 0);
    root.add(parent);
    const component = new Object3D();
    component.position.set(1, 2, 3);
    component.userData.nodeId = "node-a";
    parent.add(component);
    root.updateMatrixWorld(true);
    return {
      root,
      component,
      parent,
      nodesById: new Map([["node-a", component]])
    };
  }

  it("returns null for none motions and for steps with no resolvable components", () => {
    const { nodesById } = makeAssembly();
    expect(
      buildStepClip(makeStep({ type: "none" }, ["node-a"]), nodesById)
    ).toBeNull();
    expect(
      buildStepClip(
        makeStep({ type: "linear", direction: [1, 0, 0], distance: 10 }, []),
        nodesById
      )
    ).toBeNull();
    expect(
      buildStepClip(
        makeStep({ type: "linear", direction: [1, 0, 0], distance: 10 }, [
          "missing-node"
        ]),
        nodesById
      )
    ).toBeNull();
  });

  it("builds uuid-bound position/quaternion tracks in parent-local space with a seated hold", () => {
    const { component, nodesById } = makeAssembly();
    const step = makeStep(
      { type: "linear", direction: [1, 0, 0], distance: 10 },
      ["node-a"]
    );
    const clip = buildStepClip(step, nodesById, {
      duration: 2,
      holdSeconds: 0.5
    });
    expect(clip).not.toBeNull();
    if (!clip) return;

    expect(clip.name).toBe("step:step-1");
    expect(clip.duration).toBeCloseTo(2.5);
    expect(clip.tracks.length).toBe(2);
    const [positionTrack, quaternionTrack] = clip.tracks;
    if (!positionTrack || !quaternionTrack) throw new Error("expected tracks");
    expect(positionTrack.name).toBe(`${component.uuid}.position`);
    expect(quaternionTrack.name).toBe(`${component.uuid}.quaternion`);

    // World start [6,2,3] - [10,0,0] = [-4,2,3] → parent-local [-9,2,3]
    expectVectorClose([...positionTrack.values.slice(0, 3)], [-9, 2, 3]);
    // Seated keyframe and hold keyframe both equal the component's local pose
    expectVectorClose([...positionTrack.values.slice(-6, -3)], [1, 2, 3]);
    expectVectorClose([...positionTrack.values.slice(-3)], [1, 2, 3]);
    // Hold keyframe extends the timeline
    const times = positionTrack.times;
    expect(times[times.length - 1]).toBeCloseTo(2.5);
    expect(times[times.length - 2]).toBeCloseTo(2);
  });

  it("converts world-space motion into the local space of a rotated parent", () => {
    const root = new Group();
    const parent = new Group();
    parent.rotation.z = Math.PI / 2;
    root.add(parent);
    const component = new Object3D();
    component.userData.nodeId = "node-b";
    parent.add(component);
    root.updateMatrixWorld(true);
    const nodesById = new Map([["node-b", component]]);

    const step = makeStep(
      { type: "linear", direction: [0, 1, 0], distance: 10 },
      ["node-b"]
    );
    const clip = buildStepClip(step, nodesById, { holdSeconds: 0 });
    if (!clip) throw new Error("expected clip");

    const expectedStart = new Vector3(0, -10, 0).applyMatrix4(
      new Matrix4().copy(parent.matrixWorld).invert()
    );
    const [positionTrack, quaternionTrack] = clip.tracks;
    if (!positionTrack || !quaternionTrack) throw new Error("expected tracks");
    expectVectorClose(
      [...positionTrack.values.slice(0, 3)],
      expectedStart.toArray()
    );
    expectVectorClose([...positionTrack.values.slice(-3)], [0, 0, 0]);

    const localQuaternion = new Quaternion().copy(component.quaternion);
    expectVectorClose(
      [...quaternionTrack.values.slice(-4)],
      [
        localQuaternion.x,
        localQuaternion.y,
        localQuaternion.z,
        localQuaternion.w
      ]
    );
  });

  it("clamps the default duration to 1-4 s based on travel distance", () => {
    const { nodesById } = makeAssembly();
    const short = buildStepClip(
      makeStep({ type: "linear", direction: [1, 0, 0], distance: 1 }, [
        "node-a"
      ]),
      nodesById,
      { holdSeconds: 0 }
    );
    const long = buildStepClip(
      makeStep({ type: "linear", direction: [1, 0, 0], distance: 6000 }, [
        "node-a"
      ]),
      nodesById,
      { holdSeconds: 0 }
    );
    expect(short?.duration).toBeCloseTo(1);
    expect(long?.duration).toBeCloseTo(4);
  });

  it("drives nodes through an AnimationMixer via uuid-bound tracks", () => {
    const { root, component, nodesById } = makeAssembly();
    const step = makeStep(
      { type: "linear", direction: [1, 0, 0], distance: 10 },
      ["node-a"]
    );
    const clip = buildStepClip(step, nodesById, {
      duration: 2,
      holdSeconds: 0
    });
    if (!clip) throw new Error("expected clip");

    const mixer = new AnimationMixer(root);
    mixer.clipAction(clip).play();

    mixer.update(0); // t = 0 → displaced start pose (local [-9, 2, 3])
    expect(component.position.x).toBeCloseTo(-9);
    mixer.update(1); // t = 1 → halfway back to seated
    expect(component.position.x).toBeCloseTo(-4);
    expect(component.position.y).toBeCloseTo(2);
    expect(component.position.z).toBeCloseTo(3);
  });
});

describe("resampleEased", () => {
  const straight: MotionKeyframes = {
    times: [0, 2],
    positions: [0, 0, 0, 0, 0, 100],
    quaternions: [0, 0, 0, 1, 0, 0, 0, 1]
  };

  it("preserves both endpoints and the total duration exactly", () => {
    const eased = resampleEased(straight);
    expectVectorClose(positionAt(eased, 0), [0, 0, 0]);
    expectVectorClose(positionAt(eased, lastIndex(eased)), [0, 0, 100]);
    expect(eased.times[0]).toBe(0);
    expect(eased.times[eased.times.length - 1]).toBeCloseTo(2);
    expectMonotonicTimes(eased);
  });

  it("accelerates off the start and decelerates into the seat", () => {
    const eased = resampleEased(straight);
    // 21 samples → index 5 is u=0.25 (time 0.5), index 15 is u=0.75 (time 1.5)
    expect(eased.times.length).toBe(21);
    const early = positionAt(eased, 5)[2] ?? Number.NaN;
    const late = positionAt(eased, 15)[2] ?? Number.NaN;
    // slow start: quarter of the way in time, far less than a quarter of the way
    expect(early).toBeLessThan(10); // easeInOutCubic(0.25)=0.0625 → ~6.25
    // gentle settle: three quarters through time, most of the distance covered
    expect(late).toBeGreaterThan(90); // easeInOutCubic(0.75)=0.9375 → ~93.75
    // symmetric ease keeps the midpoint at the midpoint
    expect(positionAt(eased, 10)[2] ?? Number.NaN).toBeCloseTo(50);
  });

  it("leaves a degenerate path unchanged", () => {
    const single: MotionKeyframes = {
      times: [0],
      positions: [1, 2, 3],
      quaternions: [0, 0, 0, 1]
    };
    expect(resampleEased(single)).toBe(single);
    const zero: MotionKeyframes = {
      times: [0, 0],
      positions: [0, 0, 0, 0, 0, 0],
      quaternions: [0, 0, 0, 1, 0, 0, 0, 1]
    };
    expect(resampleEased(zero)).toBe(zero);
  });
});

describe("naturalizeMotion", () => {
  const lift = {
    type: "linear",
    direction: [0, 0, -1] as [number, number, number],
    distance: 15
  } as const;

  it("floors small-component travel to a readable distance", () => {
    // 20mm bolt in a 1000mm assembly travels at least 2.5x its size
    const result = naturalizeMotion(lift, 20, 1000);
    expect(result.type).toBe("linear");
    if (result.type === "linear") {
      expect(result.distance).toBe(50);
    }
  });

  it("caps a long travel to a few of the part's own body-lengths", () => {
    // 20mm part flying in 500mm → ceiling 3*20 + 5 = 65
    const long = { ...lift, distance: 500 };
    const result = naturalizeMotion(long, 20, 1000);
    if (result.type === "linear") {
      expect(result.distance).toBe(65);
    } else {
      throw new Error("expected linear motion");
    }
  });

  it("caps a large part at the assembly-wide ceiling, not the raw travel", () => {
    // 400mm part (not small), 2000mm travel. Per-part ceiling is 3*400+5=1205,
    // but the assembly cap 0.35*1000=350 governs — nothing flies in from
    // further than a third of the whole assembly, however large the part.
    const long = { ...lift, distance: 2000 };
    const result = naturalizeMotion(long, 400, 1000);
    if (result.type === "linear") {
      expect(result.distance).toBe(350);
    } else {
      throw new Error("expected linear motion");
    }
  });

  it("keeps a large flat part's drop within the assembly (seal fly-out)", () => {
    // The SA BCU seal: 166mm diagonal, 288mm L-travel, 196mm assembly. Without
    // the assembly cap its ceiling is 3*166+5=503, so 288mm passed through and
    // it flew in from 1.5x the whole assembly.
    const seal: Motion = {
      type: "L",
      segments: [
        { direction: [1, 0, 0], distance: 122 },
        { direction: [0, 0, -1], distance: 166 }
      ]
    };
    const result = naturalizeMotion(seal, 166, 196);
    if (result.type !== "L") throw new Error("expected L motion");
    const total = result.segments.reduce(
      (sum, s) => sum + Math.abs(s.distance),
      0
    );
    expect(total).toBeCloseTo(196 * 0.35, 1); // ~68.6mm, a natural drop
  });

  it("leaves an in-band travel unchanged", () => {
    const inBand = { ...lift, distance: 55 }; // within [50, 65] for a 20mm part
    expect(naturalizeMotion(inBand, 20, 1000)).toBe(inBand);
  });

  it("floors then scales L segments proportionally", () => {
    const motion: Motion = {
      type: "L",
      segments: [
        { direction: [1, 0, 0], distance: 6 },
        { direction: [0, 0, -1], distance: 4 }
      ]
    };
    const result = naturalizeMotion(motion, 20, 1000); // total 10 → floor 50
    if (result.type === "L") {
      const total = result.segments.reduce((sum, s) => sum + s.distance, 0);
      expect(total).toBeCloseTo(50);
      expect(
        result.segments[0]!.distance / result.segments[1]!.distance
      ).toBeCloseTo(6 / 4);
    } else {
      throw new Error("expected L motion");
    }
  });

  it("caps an over-long L total to the ceiling", () => {
    const motion: Motion = {
      type: "L",
      segments: [
        { direction: [1, 0, 0], distance: 180 },
        { direction: [0, 0, -1], distance: 120 }
      ]
    };
    const result = naturalizeMotion(motion, 20, 1000); // total 300 → ceiling 65
    if (result.type === "L") {
      const total = result.segments.reduce((sum, s) => sum + s.distance, 0);
      expect(total).toBeCloseTo(65);
      expect(
        result.segments[0]!.distance / result.segments[1]!.distance
      ).toBeCloseTo(180 / 120);
    } else {
      throw new Error("expected L motion");
    }
  });

  it("does not touch none motions", () => {
    const none = { type: "none" } as const;
    expect(naturalizeMotion(none, 20, 1000)).toBe(none);
  });
});

describe("displayMotionForStep", () => {
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const graphIndex = indexAssemblyGraph({
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
      bbox: { min: [-50, -50, 0], max: [50, 50, 20] },
      volume: null,
      color: null,
      children: [
        {
          nodeId: "base",
          name: "base",
          isAssembly: false,
          geometryHash: "hash-base",
          transform: IDENTITY,
          bbox: { min: [-50, -50, 0], max: [50, 50, 10] },
          volume: 1000,
          color: null,
          children: []
        },
        {
          nodeId: "top",
          name: "top",
          isAssembly: false,
          geometryHash: "hash-top",
          transform: IDENTITY,
          bbox: { min: [-10, -10, 10], max: [10, 10, 20] },
          volume: 1000,
          color: null,
          children: []
        }
      ]
    }
  });

  const step = (
    overrides: Partial<
      Pick<AssemblyStep, "motion" | "componentNodeIds" | "flagged">
    >
  ) => ({
    motion: { type: "none" } as Motion,
    componentNodeIds: ["top"],
    ...overrides
  });

  const present = new Set(["base"]);

  it("keeps motion none for flagged steps — no fabricated fallback", () => {
    expect(
      displayMotionForStep(step({ flagged: true }), 1, graphIndex, present)
    ).toEqual({ type: "none" });
  });

  it("synthesizes a fallback for unflagged none-motion steps after the base", () => {
    const motion = displayMotionForStep(step({}), 1, graphIndex, present);
    expect(motion.type).toBe("linear");
  });

  it("keeps the base step still", () => {
    expect(displayMotionForStep(step({}), 0, graphIndex, present)).toEqual({
      type: "none"
    });
  });

  it("passes stored motions through untouched", () => {
    const stored: Motion = {
      type: "linear",
      direction: [0, 0, -1],
      distance: 5
    };
    expect(
      displayMotionForStep(step({ motion: stored }), 1, graphIndex, present)
    ).toBe(stored);
  });

  it("only treats present components as obstacles", () => {
    // "base" fully covers the region above "top"… here instead: a canopy leaf
    // over "top" that is NOT in the present set must not redirect the fallback
    const canopyIndex = indexAssemblyGraph({
      ...graphIndex.graph,
      root: {
        ...graphIndex.graph.root,
        children: [
          ...graphIndex.graph.root.children,
          {
            nodeId: "canopy",
            name: "canopy",
            isAssembly: false,
            geometryHash: "hash-canopy",
            transform: IDENTITY,
            bbox: { min: [-50, -50, 30], max: [50, 50, 40] },
            volume: 1000,
            color: null,
            children: []
          }
        ]
      }
    });
    const motion = displayMotionForStep(step({}), 1, canopyIndex, present);
    // Insertion still approaches from above: the absent canopy doesn't block
    if (motion.type !== "linear") throw new Error("expected linear");
    expect(motion.direction[2]).toBe(-1);
  });
});

describe("motionToWaypoints / waypointsToMotion", () => {
  const seated: Vec3 = [10, 5, -2];

  function expectVec3Close(actual: Vec3, expected: Vec3) {
    actual.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 6);
    });
  }

  it("samples a linear motion to a start + seated waypoint", () => {
    const motion: Motion = {
      type: "linear",
      direction: [0, 1, 0],
      distance: 20
    };
    const waypoints = motionToWaypoints(motion, seated);
    expect(waypoints).toHaveLength(2);
    expectVec3Close(waypoints[0]!, [10, -15, -2]); // seated - dir*distance
    expectVec3Close(waypoints[1]!, seated); // last === seated
  });

  it("round-trips a linear motion exactly", () => {
    const motion: Motion = {
      type: "linear",
      direction: [0, 0, 1],
      distance: 12
    };
    const back = waypointsToMotion(motionToWaypoints(motion, seated), seated);
    expect(back.type).toBe("linear");
    if (back.type === "linear") {
      expectVec3Close(back.direction, [0, 0, 1]);
      expect(back.distance).toBeCloseTo(12, 6);
    }
  });

  it("round-trips an L motion, preserving segment order and directions", () => {
    const motion: Motion = {
      type: "L",
      segments: [
        { direction: [1, 0, 0], distance: 8 },
        { direction: [0, 1, 0], distance: 5 }
      ]
    };
    const back = waypointsToMotion(motionToWaypoints(motion, seated), seated);
    expect(back.type).toBe("L");
    if (back.type === "L") {
      expect(back.segments).toHaveLength(2);
      expectVec3Close(back.segments[0]!.direction, [1, 0, 0]);
      expect(back.segments[0]!.distance).toBeCloseTo(8, 6);
      expectVec3Close(back.segments[1]!.direction, [0, 1, 0]);
      expect(back.segments[1]!.distance).toBeCloseTo(5, 6);
    }
  });

  it("forces the last waypoint to the seated position", () => {
    const back = waypointsToMotion(
      [
        [0, 0, 0],
        [99, 99, 99]
      ],
      seated
    );
    // The seated end is pinned, so travel is start -> seated.
    expect(back.type).toBe("linear");
    if (back.type === "linear") {
      expect(back.distance).toBeCloseTo(
        Math.hypot(seated[0], seated[1], seated[2]),
        6
      );
    }
  });

  it("synthesizes a default straight path for a none motion", () => {
    const waypoints = motionToWaypoints({ type: "none" }, seated);
    expect(waypoints).toHaveLength(2);
    expectVec3Close(waypoints[0]!, [
      seated[0],
      seated[1] + DEFAULT_WAYPOINT_DISTANCE,
      seated[2]
    ]);
    expectVec3Close(waypoints[1]!, seated);
  });

  it("collapses degenerate (coincident) waypoints to none", () => {
    expect(waypointsToMotion([seated, seated], seated)).toEqual({
      type: "none"
    });
  });

  it("drops a zero-length middle segment (3 pts, collinear) to linear", () => {
    const back = waypointsToMotion([[0, 0, 0], [0, 0, 0], seated], seated);
    expect(back.type).toBe("linear");
  });
});
