// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type JobMovement, planLegacyJobCosts } from "./movement-cost";

const DAY = "2026-10-02";

function movement(
  kind: JobMovement["kind"],
  itemId: string,
  quantity: number,
  createdAt: string,
  postingDate = DAY
): JobMovement {
  return {
    kind,
    jobId: "job-1",
    itemId,
    quantity,
    postingDate,
    createdAt,
    documentLineId: kind === "Consumption" ? "op-1" : null,
    locationId: "loc-1"
  };
}

describe("planLegacyJobCosts", () => {
  it("costs an issue at today's unit cost and gives the completion the job's material cost", () => {
    const planned = planLegacyJobCosts({
      movements: [
        movement("Output", "assy", 1, "2026-10-02T10:00:00.000000Z"),
        movement("Consumption", "part", -2, "2026-10-02T09:00:00.000000Z"),
        movement("Consumption", "bolt", -4, "2026-10-02T10:00:00.000000Z")
      ],
      stored: [],
      journaledDays: new Set(),
      unitCostByItem: new Map([
        ["part", 9],
        ["bolt", 0.5]
      ])
    });
    // In time order; the bolts issued in the completion's transaction count.
    expect(
      planned.map((plan) => [
        plan.movement.itemId,
        plan.missingQuantity,
        plan.missingCost,
        plan.journal
      ])
    ).toEqual([
      ["part", 2, 18, { quantity: 2, cost: 18 }],
      ["bolt", 4, 2, { quantity: 4, cost: 2 }],
      ["assy", 1, 20, { quantity: 1, cost: 20 }]
    ]);
  });

  it("journals a stored row whose day lost its journal, and leaves a journaled day alone", () => {
    const planned = planLegacyJobCosts({
      movements: [
        movement("Consumption", "part", -2, "2026-10-02T09:00:00.000000Z"),
        movement(
          "Consumption",
          "part",
          -3,
          "2026-10-03T09:00:00.000000Z",
          "2026-10-03"
        )
      ],
      stored: [
        {
          kind: "Consumption",
          jobId: "job-1",
          itemId: "part",
          quantity: -4,
          cost: -40
        }
      ],
      journaledDays: new Set([`Consumption:job-1:2026-10-03`]),
      unitCostByItem: new Map([["part", 9]])
    });
    expect(
      planned.map((plan) => [
        plan.missingQuantity,
        plan.missingCost,
        plan.journal
      ])
    ).toEqual([
      // Covered at the stored 10 a part, journal gone: the whole pair.
      [0, 0, { quantity: 2, cost: 20 }],
      // 2 covered and journaled; 1 missing, at 9: a pair for that one.
      [1, 9, { quantity: 1, cost: 9 }]
    ]);
  });

  it("writes a return's pair only when it has a value, and an issue's at zero", () => {
    const planned = planLegacyJobCosts({
      movements: [
        movement("Consumption", "free", -1, "2026-10-02T09:00:00.000000Z"),
        movement("Consumption", "free", 1, "2026-10-02T09:30:00.000000Z")
      ],
      stored: [],
      journaledDays: new Set(),
      unitCostByItem: new Map()
    });
    expect(planned.map((plan) => plan.journal)).toEqual([
      { quantity: 1, cost: 0 },
      null
    ]);
  });

  it("receives a completion with no material cost at zero, with no journal", () => {
    const planned = planLegacyJobCosts({
      movements: [
        movement("Consumption", "part", -2, "2026-10-02T09:00:00.000000Z"),
        movement("Output", "assy", 1, "2026-10-02T10:00:00.000000Z"),
        movement("Output", "assy", 1, "2026-10-02T11:00:00.000000Z")
      ],
      stored: [
        {
          kind: "Output",
          jobId: "job-1",
          itemId: "assy",
          quantity: 1,
          cost: 20
        }
      ],
      journaledDays: new Set([`Output:job-1:${DAY}`]),
      unitCostByItem: new Map([["part", 10]])
    });
    // The first completion stored its layer and took the 20; the second
    // finds nothing left in WIP.
    expect(
      planned
        .filter((plan) => plan.movement.kind === "Output")
        .map((plan) => [plan.missingQuantity, plan.missingCost, plan.journal])
    ).toEqual([
      [0, 0, null],
      [1, 0, null]
    ]);
  });
});
