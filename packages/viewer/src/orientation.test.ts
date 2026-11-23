// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  describeOrientation,
  isOrientation,
  resolveOrientations,
  turnOrientation
} from "./orientation";
import { IDENTITY_QUAT, sameOrientation } from "./quat";
import type { AssemblyStep, Quat, Vec3 } from "./types";

type Row = Pick<
  AssemblyStep,
  | "id"
  | "componentNodeIds"
  | "parentStepId"
  | "usedInStepId"
  | "isSubAssembly"
  | "orientation"
>;

const step = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  componentNodeIds: [id],
  ...extra
});

// 180° about X: the build upside down.
const FLIPPED: Quat = [1, 0, 0, 0];

const benchUpOfModelTop = (q: Quat): Vec3 =>
  new Vector3(0, 0, 1)
    .applyQuaternion(new Quaternion(...q))
    .toArray()
    .map((n) => Math.round(n * 1e6) / 1e6 + 0) as Vec3;

describe("resolveOrientations", () => {
  it("carries a turn forward through its build", () => {
    const resolved = resolveOrientations([
      step("base"),
      step("flip", { orientation: FLIPPED }),
      step("cover")
    ]);
    expect(resolved.map((r) => r.sourceStepId)).toEqual([null, "flip", "flip"]);
    expect(resolved[0]?.orientation).toEqual(IDENTITY_QUAT);
    expect(resolved[2]?.orientation).toEqual(FLIPPED);
  });

  it("starts a sub-assembly upright, even after the main build flips", () => {
    const resolved = resolveOrientations([
      step("flip", { orientation: FLIPPED }),
      step("member", { parentStepId: "unit" }),
      step("unit", { isSubAssembly: true, componentNodeIds: [] }),
      step("after")
    ]);
    expect(resolved[1]).toEqual({
      orientation: IDENTITY_QUAT,
      sourceStepId: null
    });
    // The header joins the main build, so it plays in the main build's turn.
    expect(resolved[2]?.sourceStepId).toBe("flip");
    expect(resolved[3]?.sourceStepId).toBe("flip");
  });

  it("keeps a sub-assembly's turn out of the main build", () => {
    const resolved = resolveOrientations([
      step("first", { parentStepId: "unit", orientation: FLIPPED }),
      step("second", { parentStepId: "unit" }),
      step("unit", { isSubAssembly: true, componentNodeIds: [] }),
      step("main")
    ]);
    expect(resolved[1]?.sourceStepId).toBe("first");
    expect(resolved[3]).toEqual({
      orientation: IDENTITY_QUAT,
      sourceStepId: null
    });
  });

  it("ignores a malformed stored value", () => {
    const resolved = resolveOrientations([
      step("bad", { orientation: [0, 0, 0, 2] })
    ]);
    expect(resolved[0]?.sourceStepId).toBeNull();
  });
});

describe("turnOrientation", () => {
  // Camera in front of the build (CAD front is -Y), level with it.
  const front = { position: [0, -10, 0] as Vec3, target: [0, 0, 0] as Vec3 };

  it("tipping forward rolls the top toward the viewer", () => {
    const tipped = turnOrientation(IDENTITY_QUAT, "tipForward", front);
    expect(benchUpOfModelTop(tipped)).toEqual([0, -1, 0]);
  });

  it("tipping back rolls the top away from the viewer", () => {
    const tipped = turnOrientation(IDENTITY_QUAT, "tipBack", front);
    expect(benchUpOfModelTop(tipped)).toEqual([0, 1, 0]);
  });

  it("two tips forward turn the build upside down", () => {
    const once = turnOrientation(IDENTITY_QUAT, "tipForward", front);
    const twice = turnOrientation(once, "tipForward", front);
    expect(benchUpOfModelTop(twice)).toEqual([0, 0, -1]);
  });

  it("a turn and its opposite cancel out", () => {
    const left = turnOrientation(IDENTITY_QUAT, "spinLeft", front);
    const back = turnOrientation(left, "spinRight", front);
    expect(sameOrientation(back, IDENTITY_QUAT)).toBe(true);
  });

  it("spinning right moves the front to the viewer's right", () => {
    // From the front, the viewer's right is +X.
    const turned = turnOrientation(IDENTITY_QUAT, "spinRight", front);
    const frontFace = new Vector3(0, -1, 0)
      .applyQuaternion(new Quaternion(...turned))
      .toArray()
      .map((n) => Math.round(n * 1e6) / 1e6 + 0);
    expect(frontFace).toEqual([1, 0, 0]);
  });

  it("tips toward a camera at the side, not the CAD front", () => {
    const side = { position: [10, 0, 5] as Vec3, target: [0, 0, 0] as Vec3 };
    const tipped = turnOrientation(IDENTITY_QUAT, "tipForward", side);
    expect(benchUpOfModelTop(tipped)).toEqual([1, 0, 0]);
  });

  it("tips toward the viewer of an already flipped build", () => {
    const tipped = turnOrientation(FLIPPED, "tipForward", front);
    // What faces up now (the model's underside) rolls toward the viewer, so
    // the model's top, facing the bench, rolls away from it.
    expect(benchUpOfModelTop(tipped)).toEqual([0, 1, 0]);
  });
});

describe("turnOrientation from a slanted view", () => {
  // A typical editor view: front-right, above the bench.
  const slanted = { position: [6, -10, 7] as Vec3, target: [0, 0, 0] as Vec3 };

  it("tips about the nearest square axis, so the result is a clean 90°", () => {
    const tipped = turnOrientation(IDENTITY_QUAT, "tipForward", slanted);
    // The camera is mostly in front (-Y), so the top rolls toward -Y.
    expect(benchUpOfModelTop(tipped)).toEqual([0, -1, 0]);
  });

  it("flips upside down in one turn", () => {
    const flipped = turnOrientation(IDENTITY_QUAT, "flip", slanted);
    expect(benchUpOfModelTop(flipped)).toEqual([0, 0, -1]);
    expect(describeOrientation(flipped)).toBe("upsideDown");
  });

  it("two tips equal one flip", () => {
    const once = turnOrientation(IDENTITY_QUAT, "tipForward", slanted);
    const twice = turnOrientation(once, "tipForward", slanted);
    const flipped = turnOrientation(IDENTITY_QUAT, "flip", slanted);
    expect(sameOrientation(twice, flipped)).toBe(true);
  });
});

describe("describeOrientation", () => {
  it("names the pose by where the top points", () => {
    expect(describeOrientation(IDENTITY_QUAT)).toBe("upright");
    expect(describeOrientation(FLIPPED)).toBe("upsideDown");
    const side = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI / 2
    );
    expect(describeOrientation([side.x, side.y, side.z, side.w])).toBe(
      "onSide"
    );
  });
});

describe("turnOrientation snapping", () => {
  const front = { position: [0, -100, 0] as Vec3, target: [0, 0, 0] as Vec3 };
  const aboutZ = (angle: number): Quat => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);
    return [q.x, q.y, q.z, q.w];
  };

  it("always returns a real rotation, even from a 45° start", () => {
    const turned = turnOrientation(aboutZ(Math.PI / 4), "spinRight", front);
    expect(isOrientation(turned)).toBe(true);
    expect(benchUpOfModelTop(turned)).toEqual([0, 0, 1]);
  });

  it("lands a nearly right-angle start exactly on a right angle", () => {
    const turned = turnOrientation(
      aboutZ(Math.PI / 2 + Math.PI / 180),
      "spinLeft",
      front
    );
    expect(sameOrientation(turned, IDENTITY_QUAT)).toBe(true);
  });
});

describe("isOrientation", () => {
  it("accepts a unit quaternion and rejects the rest", () => {
    expect(isOrientation([0, 0, 0, 1])).toBe(true);
    expect(isOrientation([0, 0, 0, 2])).toBe(false);
    expect(isOrientation([1, 2, 3])).toBe(false);
    expect(isOrientation(null)).toBe(false);
  });
});
