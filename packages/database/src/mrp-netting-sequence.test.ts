// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  allocateCommonSurplus,
  trueSurplusByPeriod
} from "./mrp-netting-sequence.ts";

describe("trueSurplusByPeriod", () => {
  it("gives on-hand 10 and common demand 2 in week 3 a surplus of 8 in every week", () => {
    expect(trueSurplusByPeriod(10, [0, 0, 0, 2, 0, 0])).toEqual([
      8, 8, 8, 8, 8, 8
    ]);
  });
});

describe("allocateCommonSurplus", () => {
  it("draws 4 of a week-2 project need of 7 when common needs 6 of 10 in week 5", () => {
    const surplusByPeriod = trueSurplusByPeriod(10, [0, 0, 0, 0, 0, 6]);
    expect(
      allocateCommonSurplus({
        surplusByPeriod,
        needs: [{ segmentId: "prj_1", periodIndex: 2, quantity: 7 }]
      })
    ).toEqual({
      draws: [{ segmentId: "prj_1", periodIndex: 2, quantity: 4 }],
      remaining: [{ segmentId: "prj_1", periodIndex: 2, quantity: 3 }]
    });
  });

  it("gives the week-1 segment 5 and the week-2 segment 1 of a surplus of 6", () => {
    expect(
      allocateCommonSurplus({
        surplusByPeriod: [6, 6, 6, 6],
        needs: [
          { segmentId: "prj_a", periodIndex: 2, quantity: 5 },
          { segmentId: "prj_b", periodIndex: 1, quantity: 5 }
        ]
      })
    ).toEqual({
      draws: [
        { segmentId: "prj_b", periodIndex: 1, quantity: 5 },
        { segmentId: "prj_a", periodIndex: 2, quantity: 1 }
      ],
      remaining: [{ segmentId: "prj_a", periodIndex: 2, quantity: 4 }]
    });
  });

  it("draws nothing from a surplus of 0", () => {
    const needs = [{ segmentId: "prj_1", periodIndex: 1, quantity: 3 }];
    expect(
      allocateCommonSurplus({ surplusByPeriod: [0, 0, 0], needs })
    ).toEqual({ draws: [], remaining: needs });
  });

  it("gives the same output for any input order of needs", () => {
    const needs = [
      { segmentId: "prj_b", periodIndex: 3, quantity: 2 },
      { segmentId: "prj_a", periodIndex: 1, quantity: 4 },
      { segmentId: "prj_c", periodIndex: 1, quantity: 3 },
      { segmentId: "prj_a", periodIndex: 3, quantity: 5 }
    ];
    const surplusByPeriod = trueSurplusByPeriod(12, [0, 1, 0, 0, 2]);
    const expected = allocateCommonSurplus({ surplusByPeriod, needs });
    const orders = [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1]
    ];
    for (const order of orders) {
      expect(
        allocateCommonSurplus({
          surplusByPeriod,
          needs: order.map((index) => needs[index]!)
        })
      ).toEqual(expected);
    }
  });
});
