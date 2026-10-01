// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { clippedBalloonToAnchorLine } from "./balloons";

const rect = { x: 100, y: 0, w: 50, h: 20 };

describe("clippedBalloonToAnchorLine", () => {
  it("runs from just outside the balloon to just short of the anchor", () => {
    // Balloon centred at (0, 10), radius 10; anchor centre (125, 10). Both
    // ends keep a 2px gap.
    expect(clippedBalloonToAnchorLine(0, 10, 10, 125, 10, rect)).toEqual([
      12, 10, 98, 10
    ]);
  });

  it("stops at the edge the line enters through", () => {
    // Approaching from straight above, the line ends at the anchor's top edge.
    const line = clippedBalloonToAnchorLine(125, -100, 10, 125, 10, rect);
    expect(line).not.toBeNull();
    expect(line![3]).toBeCloseTo(-2, 5);
  });

  it("draws nothing when the balloon sits on its anchor", () => {
    expect(clippedBalloonToAnchorLine(125, 10, 10, 125, 10, rect)).toBeNull();
  });
});
