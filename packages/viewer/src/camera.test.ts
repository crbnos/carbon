// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { fitFraming, frameStepPose, type StepFramingInput } from "./camera";
import type { Vec3 } from "./types";

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

describe("frameStepPose", () => {
  const box = (min: Vec3, max: Vec3) =>
    new Box3(new Vector3(...min), new Vector3(...max));
  const base = (overrides: Partial<StepFramingInput>): StepFramingInput => ({
    buildBox: box([-100, -100, 0], [100, 100, 100]),
    ownBox: box([-10, -10, 100], [10, 10, 120]),
    motion: { type: "linear", direction: [0, 0, -1], distance: 50 },
    pathUnits: [],
    glideStartBox: null,
    occluders: [],
    up: new Vector3(0, 0, 1),
    currentDirection: new Vector3(1, -1, 1).normalize(),
    turned: false,
    planDirection: null,
    fov: 45,
    aspect: 16 / 9,
    ...overrides
  });
  const directionOf = (pose: { position: Vector3; target: Vector3 } | null) => {
    if (!pose) throw new Error("expected a pose");
    return pose.position.clone().sub(pose.target).normalize();
  };

  it("keeps the current direction on a turned build, ignoring the plan's", () => {
    const current = new Vector3(-1, 0.2, -0.4).normalize();
    const pose = frameStepPose(
      base({
        turned: true,
        currentDirection: current,
        planDirection: new Vector3(0, 0, 1)
      })
    );
    expect(directionOf(pose).dot(current)).toBeCloseTo(1, 6);
  });

  it("takes the plan's direction on an upright build", () => {
    const plan = new Vector3(0, -2, 1);
    const pose = frameStepPose(base({ planDirection: plan }));
    expect(directionOf(pose).dot(plan.clone().normalize())).toBeCloseTo(1, 6);
  });

  it("scores a clear side when there is no plan", () => {
    // A wall right in front of the current view: the camera moves off it.
    const current = new Vector3(0, -1, 0.3).normalize();
    const pose = frameStepPose(
      base({
        currentDirection: current,
        occluders: [
          {
            min: new Vector3(-300, -400, -300),
            max: new Vector3(300, -300, 600),
            weight: 1
          }
        ]
      })
    );
    expect(directionOf(pose).dot(current)).toBeLessThan(0.99);
  });

  it("keeps a far unit's start inside the fitted frustum", () => {
    const unitBox = box([60, 60, 0], [90, 90, 30]);
    const input = base({
      pathUnits: [
        {
          box: unitBox,
          motion: { type: "linear", direction: [-1, 0, 0], distance: 900 }
        }
      ]
    });
    const pose = frameStepPose(input);
    if (!pose) throw new Error("expected a pose");
    const forward = pose.target.clone().sub(pose.position).normalize();
    const right = new Vector3().crossVectors(forward, input.up).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    const tanV = Math.tan(((input.fov / 2) * Math.PI) / 180);
    const tanH = tanV * input.aspect;
    // The unit starts 900 mm out along -X.
    const start = unitBox.clone().translate(new Vector3(900, 0, 0));
    for (let i = 0; i < 8; i++) {
      const corner = new Vector3(
        i & 1 ? start.max.x : start.min.x,
        i & 2 ? start.max.y : start.min.y,
        i & 4 ? start.max.z : start.min.z
      ).sub(pose.position);
      const depth = corner.dot(forward);
      expect(depth).toBeGreaterThan(0);
      expect(Math.abs(corner.dot(right))).toBeLessThanOrEqual(tanH * depth);
      expect(Math.abs(corner.dot(up))).toBeLessThanOrEqual(tanV * depth);
    }
  });

  it("frames nothing for an empty build", () => {
    expect(frameStepPose(base({ buildBox: new Box3() }))).toBeNull();
  });
});
