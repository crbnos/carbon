// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { IDENTITY_QUAT, sameOrientation } from "./quat";

describe("sameOrientation", () => {
  it("treats q and -q as the same rotation", () => {
    expect(sameOrientation([0, 0, 1, 0], [0, 0, -1, 0])).toBe(true);
    expect(sameOrientation(IDENTITY_QUAT, [0, 0, 0, -1])).toBe(true);
  });

  it("compares rotations, not raw tuples", () => {
    // A non-unit tuple whose raw dot with identity is 1.5: a turn of ~7.6°.
    expect(sameOrientation([0.1, 0, 0, 1.5], IDENTITY_QUAT)).toBe(false);
    // The same rotation scaled is still the same rotation.
    expect(sameOrientation([0, 0, 0, 2], IDENTITY_QUAT)).toBe(true);
    expect(sameOrientation([0, 0, 2, 0], [0, 0, 1, 0])).toBe(true);
  });

  it("matches nothing for a zero quaternion", () => {
    expect(sameOrientation([0, 0, 0, 0], IDENTITY_QUAT)).toBe(false);
  });

  it("tells a quarter turn apart", () => {
    const quarterZ: [number, number, number, number] = [
      0,
      0,
      Math.SQRT1_2,
      Math.SQRT1_2
    ];
    expect(sameOrientation(quarterZ, IDENTITY_QUAT)).toBe(false);
  });
});
