// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  drawFromStripes,
  splitAcrossStripes,
  stripesForDemand,
  trackedEntityStripe
} from "./stock-stripes";

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

  it("a draw that may go negative takes the rest from the last stripe", () => {
    expect(
      drawFromStripes(20, [
        { stripe: "prj_1", quantity: 6 },
        { stripe: null, quantity: 8 }
      ])
    ).toEqual([
      { stripe: "prj_1", quantity: 6 },
      { stripe: null, quantity: 14 }
    ]);
    // Nothing on hand: the whole quantity comes from common stock.
    expect(drawFromStripes(3, [{ stripe: null, quantity: 0 }])).toEqual([
      { stripe: null, quantity: 3 }
    ]);
  });

  it("a tracked entity sits in the stripe of its largest net on-hand", () => {
    const rows = [
      { trackedEntityId: "lot", projectId: null, quantity: 5 },
      { trackedEntityId: "lot", projectId: null, quantity: -5 },
      { trackedEntityId: "lot", projectId: "prj_1", quantity: 5 },
      { trackedEntityId: "other", projectId: "prj_2", quantity: 9 }
    ];
    expect(trackedEntityStripe(rows, "lot")).toEqual("prj_1");
    expect(trackedEntityStripe(rows, "missing")).toBeNull();
  });
});
