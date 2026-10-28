// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { growWidths } from "./useGrowOnlyColumnWidths";

describe("growWidths", () => {
  it("keeps the widest width each column has had", () => {
    const first = growWidths(new Map(), [
      ["customer", 240],
      ["status", 140]
    ]);
    expect(first).toEqual(
      new Map([
        ["customer", 240],
        ["status", 140]
      ])
    );
    // The wide customer scrolled out: the column keeps 240; status grew.
    expect(
      growWidths(first!, [
        ["customer", 120],
        ["status", 190]
      ])
    ).toEqual(
      new Map([
        ["customer", 240],
        ["status", 190]
      ])
    );
  });

  it("answers null when no column grew, so nothing re-renders", () => {
    const widths = new Map([["customer", 240]]);
    expect(growWidths(widths, [["customer", 200]])).toBeNull();
    expect(growWidths(widths, [["customer", 240]])).toBeNull();
  });
});
