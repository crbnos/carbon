// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { tierCeilings } from "./models";

const rule = (lowerBoundAmount: number, enabled = true) => ({
  lowerBoundAmount,
  enabled
});

describe("tierCeilings", () => {
  it("ends each tier at the next tier's floor, and the top tier nowhere", () => {
    const ceiling = tierCeilings([rule(0), rule(500), rule(2000)]);
    expect([ceiling(0), ceiling(500), ceiling(2000)]).toEqual([
      500,
      2000,
      null
    ]);
  });

  it("ends no tier at a disabled rule, which matches nothing", () => {
    const ceiling = tierCeilings([rule(0), rule(500), rule(2000, false)]);
    expect([ceiling(500), ceiling(2000)]).toEqual([null, null]);
  });
});
