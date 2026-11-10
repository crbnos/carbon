// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type AnimationClip,
  AnimationMixer,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3
} from "three";
import { describe, expect, it } from "vitest";
import { buildStepClip } from "./clip";
import { expectVectorClose, makeStep } from "./test-utils";
import type { Motion } from "./types";

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
      buildStepClip(makeStep({ type: "none" }, ["node-a"]), nodesById, {
        pivot: null
      })
    ).toBeNull();
    expect(
      buildStepClip(
        makeStep({ type: "linear", direction: [1, 0, 0], distance: 10 }, []),
        nodesById,
        { pivot: null }
      )
    ).toBeNull();
    expect(
      buildStepClip(
        makeStep({ type: "linear", direction: [1, 0, 0], distance: 10 }, [
          "missing-node"
        ]),
        nodesById,
        { pivot: null }
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
      pivot: null,
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

  it("glides a carried-in unit from beside the build, then inserts", () => {
    const { nodesById } = makeAssembly();
    const motion: Motion = {
      type: "linear",
      direction: [1, 0, 0],
      distance: 10
    };
    const clip = buildStepClip(makeStep(motion, ["node-a"]), nodesById, {
      pivot: null,
      duration: 2,
      holdSeconds: 0.5,
      glide: { offset: [0, 100, 0], seconds: 1.2 }
    });
    if (!clip) throw new Error("expected clip");
    expect(clip.duration).toBeCloseTo(1.2 + 2 + 0.5);

    const [positionTrack] = clip.tracks;
    if (!positionTrack) throw new Error("expected tracks");
    const values = [...positionTrack.values];
    const times = [...positionTrack.times];
    // Seated world [6,2,3] + offset [0,100,0] → parent-local [1,102,3]
    expectVectorClose(values.slice(0, 3), [1, 102, 3]);
    // Glide ends at the linear insertion start: world [-4,2,3] → local [-9,2,3]
    const glideEnd = times.findIndex((time) => Math.abs(time - 1.2) < 1e-5);
    expect(glideEnd).toBeGreaterThan(0);
    expectVectorClose(values.slice(glideEnd * 3, glideEnd * 3 + 3), [-9, 2, 3]);
    // Still ends seated, with the hold
    expectVectorClose(values.slice(-6, -3), [1, 2, 3]);
    expect(times[times.length - 2]).toBeCloseTo(3.2);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(
        times[i - 1] ?? Number.POSITIVE_INFINITY
      );
    }
  });

  it("glides a none-motion carry-in step straight to the seat", () => {
    const { nodesById } = makeAssembly();
    const clip = buildStepClip(
      makeStep({ type: "none" }, ["node-a"]),
      nodesById,
      {
        pivot: null,
        holdSeconds: 0,
        glide: { offset: [50, 0, 0], seconds: 1.2 }
      }
    );
    if (!clip) throw new Error("expected clip");
    expect(clip.duration).toBeCloseTo(1.2);
    const [positionTrack] = clip.tracks;
    if (!positionTrack) throw new Error("expected tracks");
    const values = [...positionTrack.values];
    expectVectorClose(values.slice(0, 3), [51, 2, 3]);
    expectVectorClose(values.slice(-3), [1, 2, 3]);
  });

  it("glides only the carried unit; the step's own parts wait at their start", () => {
    const { nodesById } = makeAssembly();
    const motion: Motion = {
      type: "linear",
      direction: [1, 0, 0],
      distance: 10
    };
    const clip = buildStepClip(makeStep(motion, ["node-a"]), nodesById, {
      pivot: null,
      duration: 2,
      holdSeconds: 0,
      glide: { offset: [0, 100, 0], seconds: 1.2, nodeIds: ["other"] }
    });
    if (!clip) throw new Error("expected clip");
    const [positionTrack] = clip.tracks;
    if (!positionTrack) throw new Error("expected tracks");
    const values = [...positionTrack.values];
    const times = [...positionTrack.times];
    // Not carried: sits at its insertion start (local [-9,2,3]) through the glide.
    expectVectorClose(values.slice(0, 3), [-9, 2, 3]);
    const glideEnd = times.findIndex((time) => Math.abs(time - 1.2) < 1e-5);
    expectVectorClose(values.slice(glideEnd * 3, glideEnd * 3 + 3), [-9, 2, 3]);
    expectVectorClose(values.slice(-3), [1, 2, 3]);
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
    const clip = buildStepClip(step, nodesById, {
      pivot: null,
      holdSeconds: 0
    });
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
      { pivot: null, holdSeconds: 0 }
    );
    const long = buildStepClip(
      makeStep({ type: "linear", direction: [1, 0, 0], distance: 6000 }, [
        "node-a"
      ]),
      nodesById,
      { pivot: null, holdSeconds: 0 }
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
      pivot: null,
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

describe("buildStepClip with sub-assembly units", () => {
  function makeParts() {
    const root = new Group();
    const own = new Object3D();
    own.position.set(0, 0, 0);
    const unitA = new Object3D();
    unitA.position.set(100, 0, 0);
    const unitB = new Object3D();
    unitB.position.set(200, 0, 0);
    root.add(own, unitA, unitB);
    root.updateMatrixWorld(true);
    return {
      own,
      unitA,
      unitB,
      nodesById: new Map<string, Object3D>([
        ["own", own],
        ["unit-a", unitA],
        ["unit-b", unitB]
      ])
    };
  }
  const drop: Motion = { type: "linear", direction: [0, 0, -1], distance: 10 };
  const trackFor = (clip: AnimationClip, node: Object3D) => {
    const track = clip.tracks.find(
      (candidate) => candidate.name === `${node.uuid}.position`
    );
    if (!track) throw new Error("expected a track");
    return { times: [...track.times], values: [...track.values] };
  };
  const valueAt = (
    track: { times: number[]; values: number[] },
    time: number
  ) => {
    const index = track.times.findIndex((t) => Math.abs(t - time) < 1e-6);
    expect(index).toBeGreaterThanOrEqual(0);
    return track.values.slice(index * 3, index * 3 + 3);
  };

  it("flies the unit in first; the step's own part waits, then inserts", () => {
    const { own, unitA, nodesById } = makeParts();
    const clip = buildStepClip(makeStep(drop, ["own"]), nodesById, {
      pivot: null,
      duration: 2,
      holdSeconds: 0.5,
      units: [{ nodeIds: ["unit-a"], motion: drop, seconds: 1, pivot: null }]
    });
    if (!clip) throw new Error("expected clip");
    expect(clip.duration).toBeCloseTo(1 + 2 + 0.5);

    const unit = trackFor(clip, unitA);
    expectVectorClose(unit.values.slice(0, 3), [100, 0, 10]);
    expectVectorClose(valueAt(unit, 1), [100, 0, 0]);
    expectVectorClose(unit.values.slice(-3), [100, 0, 0]);
    expect(unit.times[unit.times.length - 1]).toBeCloseTo(3.5);

    const part = trackFor(clip, own);
    // Waits at its insertion start until the unit has seated…
    expectVectorClose(part.values.slice(0, 3), [0, 0, 10]);
    expectVectorClose(valueAt(part, 1), [0, 0, 10]);
    // …then inserts and holds.
    expectVectorClose(valueAt(part, 3), [0, 0, 0]);
  });

  it("plays several units one after another", () => {
    const { unitB, nodesById } = makeParts();
    const clip = buildStepClip(makeStep({ type: "none" }, []), nodesById, {
      pivot: null,
      holdSeconds: 0,
      units: [
        { nodeIds: ["unit-a"], motion: drop, seconds: 1, pivot: null },
        { nodeIds: ["unit-b"], motion: drop, seconds: 1.5, pivot: null }
      ]
    });
    if (!clip) throw new Error("expected clip");
    expect(clip.duration).toBeCloseTo(2.5);
    const second = trackFor(clip, unitB);
    expectVectorClose(valueAt(second, 1), [200, 0, 10]);
    expectVectorClose(second.values.slice(-3), [200, 0, 0]);
  });

  it("turns a unit about the pivot it is given", () => {
    const { unitA, nodesById } = makeParts();
    const halfTurn: Motion = {
      type: "waypoints",
      waypoints: [
        { offset: [0, 0, 0], rotation: [0, 0, 1, 0] },
        { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
      ]
    };
    const clip = buildStepClip(makeStep({ type: "none" }, []), nodesById, {
      pivot: null,
      holdSeconds: 0,
      units: [
        { nodeIds: ["unit-a"], motion: halfTurn, seconds: 1, pivot: [0, 0, 0] }
      ]
    });
    if (!clip) throw new Error("expected clip");
    // 180° about the origin swings the unit from +X to -X.
    expectVectorClose(trackFor(clip, unitA).values.slice(0, 3), [-100, 0, 0]);
  });

  it("moves a node listed in two units with the first one only", () => {
    const { unitA, nodesById } = makeParts();
    const clip = buildStepClip(makeStep({ type: "none" }, []), nodesById, {
      pivot: null,
      holdSeconds: 0,
      units: [
        { nodeIds: ["unit-a"], motion: drop, seconds: 1, pivot: null },
        {
          nodeIds: ["unit-a", "unit-b"],
          motion: drop,
          seconds: 1,
          pivot: null
        }
      ]
    });
    if (!clip) throw new Error("expected clip");
    const tracks = clip.tracks.filter(
      (track) => track.name === `${unitA.uuid}.position`
    );
    expect(tracks).toHaveLength(1);
    // Seated by the end of the first unit's second, not delayed into the second's.
    expectVectorClose(valueAt(trackFor(clip, unitA), 1), [100, 0, 0]);
  });

  it("builds a clip for a unit joining at a step with no parts of its own", () => {
    const { nodesById } = makeParts();
    expect(
      buildStepClip(makeStep({ type: "none" }, []), nodesById, {
        pivot: null,
        units: [{ nodeIds: ["unit-a"], motion: drop, seconds: 1, pivot: null }]
      })
    ).not.toBeNull();
    // A unit with no path of its own adds nothing.
    expect(
      buildStepClip(makeStep({ type: "none" }, []), nodesById, {
        pivot: null,
        units: [
          {
            nodeIds: ["unit-a"],
            motion: { type: "none" },
            seconds: 0,
            pivot: null
          }
        ]
      })
    ).toBeNull();
  });
});

describe("buildStepClip with a turning waypoints path", () => {
  // Three 180° legs about Z, turning in place about the origin.
  const threeHalfTurns: Motion = {
    type: "waypoints",
    waypoints: [
      { offset: [0, 0, 0], rotation: [0, 0, -1, 0] },
      { offset: [0, 0, 0], rotation: [0, 0, 0, -1] },
      { offset: [0, 0, 0], rotation: [0, 0, 1, 0] },
      { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
    ]
  };
  // A first leg that only shifts, then a half turn in place: the turn's
  // keyframes are far closer together in time than the shift's.
  const shiftThenTurn: Motion = {
    type: "waypoints",
    waypoints: [
      { offset: [0, 0, 400], rotation: [0, 0, 1, 0] },
      { offset: [0, 0, 0], rotation: [0, 0, 1, 0] },
      { offset: [0, 0, 0], rotation: [0, 0, 0, 1] }
    ]
  };

  it.each([
    ["three half turns", threeHalfTurns],
    ["a shift, then a half turn", shiftThenTurn]
  ])("keeps a part 100 mm from the pivot on its arc (%s)", (_, motion) => {
    const root = new Group();
    const part = new Object3D();
    part.position.set(100, 0, 0);
    root.add(part);
    root.updateMatrixWorld(true);
    const clip = buildStepClip(
      makeStep(motion, ["part"]),
      new Map([["part", part]]),
      { pivot: [0, 0, 0], holdSeconds: 0 }
    );
    const track = clip?.tracks.find(
      (candidate) => candidate.name === `${part.uuid}.position`
    );
    if (!track) throw new Error("expected a position track");
    // The track moves in a straight line between keys: each chord's midpoint
    // must stay near the arc, not cut inside it.
    const values = [...track.values];
    for (let i = 0; i + 1 < track.times.length; i++) {
      const [ax = 0, ay = 0] = values.slice(i * 3, i * 3 + 2);
      const [bx = 0, by = 0] = values.slice((i + 1) * 3, (i + 1) * 3 + 2);
      expect(Math.hypot((ax + bx) / 2, (ay + by) / 2)).toBeGreaterThan(99);
    }
  });
});
