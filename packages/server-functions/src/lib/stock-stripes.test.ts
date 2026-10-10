// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { splitAcrossStripes, stripesForDemand } from "./stock-stripes";

describe("stock stripes", () => {
  it("a project demand takes the project's stock, then common stock", () => {
    const stripes = stripesForDemand({
      projectId: "prj_1",
      projectStock: true
    });
    expect(stripes).toEqual(["prj_1", null]);
    expect(
      splitAcrossStripes(10, [
        { stripe: "prj_1", quantity: 6 },
        { stripe: null, quantity: 8 }
      ])
    ).toEqual({
      draws: [
        { stripe: "prj_1", quantity: 6 },
        { stripe: null, quantity: 4 }
      ],
      remaining: 0
    });
  });

  it("a common demand takes common stock only", () => {
    expect(stripesForDemand({ projectId: null, projectStock: false })).toEqual([
      null
    ]);
    // A project without project stock is common demand too.
    expect(
      stripesForDemand({ projectId: "prj_1", projectStock: false })
    ).toEqual([null]);
    expect(splitAcrossStripes(3, [{ stripe: null, quantity: 8 }])).toEqual({
      draws: [{ stripe: null, quantity: 3 }],
      remaining: 0
    });
  });

  it("a demand larger than every stripe returns the rest as remaining", () => {
    expect(
      splitAcrossStripes(20, [
        { stripe: "prj_1", quantity: 6 },
        { stripe: null, quantity: 8 }
      ])
    ).toEqual({
      draws: [
        { stripe: "prj_1", quantity: 6 },
        { stripe: null, quantity: 8 }
      ],
      remaining: 6
    });
  });
});
