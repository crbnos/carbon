// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAYPOINT_DISTANCE,
  editorWaypointsToMotion,
  motionToEditorWaypoints,
  motionToWaypoints,
  waypointsToMotion
} from "./path-editing";
import { expectVectorClose } from "./test-utils";
import type { Motion, Vec3 } from "./types";

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

describe("editor waypoints", () => {
  const halfTurnZ: [number, number, number, number] = [0, 0, 1, 0];

  it("round-trips through the editor and keeps unturned paths linear / L", () => {
    const seated: Vec3 = [1, 2, 3];
    expect(
      editorWaypointsToMotion(
        [
          { position: [1, 2, 53], rotation: [0, 0, 0, 1] },
          { position: seated, rotation: [0, 0, 0, 1] }
        ],
        seated
      ).type
    ).toBe("linear");
    expect(
      editorWaypointsToMotion(
        [
          { position: [1, 52, 53], rotation: [0, 0, 0, 1] },
          { position: [1, 2, 53], rotation: [0, 0, 0, 1] },
          { position: seated, rotation: [0, 0, 0, 1] }
        ],
        seated
      ).type
    ).toBe("L");

    const turned = [
      { position: [1, 2, 53] as Vec3, rotation: halfTurnZ },
      {
        position: seated,
        rotation: [0, 0, 0, 1] as [number, number, number, number]
      }
    ];
    const motion = editorWaypointsToMotion(turned, seated);
    expect(motion.type).toBe("waypoints");
    const back = motionToEditorWaypoints(motion, seated);
    expect(back.length).toBe(2);
    expectVectorClose(back[0]?.position ?? [], [1, 2, 53]);
    expectVectorClose(back[0]?.rotation ?? [], halfTurnZ);
    expectVectorClose(back[1]?.position ?? [], seated);
  });

  it("keeps a turn stored as a non-unit quaternion", () => {
    const seated: Vec3 = [0, 0, 0];
    expect(
      editorWaypointsToMotion(
        [
          { position: [0, 0, 50], rotation: [0.1, 0, 0, 1.5] },
          { position: seated, rotation: [0, 0, 0, 1] }
        ],
        seated
      ).type
    ).toBe("waypoints");
  });
});
