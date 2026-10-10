// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  coverJobMovements,
  type JobMovement,
  planLegacyJobCosts,
  type StoredJobCost
} from "./movement-cost";

const DAY = "2026-10-02";

function movement(
  kind: JobMovement["kind"],
  itemId: string,
  quantity: number,
  createdAt: string,
  postingDate = DAY
): JobMovement {
  return {
    key: `${kind}:${itemId}:${createdAt}`,
    kind,
    jobId: "job-1",
    itemId,
    quantity,
    postingDate,
    createdAt,
    documentLineId: kind === "Consumption" ? "op-1" : null,
    locationId: "loc-1",
    trackedEntityIds: []
  };
}

/** Covers the movements and plans them, each missing quantity at
 *  `unitCost` of its item. */
function plan({
  movements,
  stored = [],
  journaledDays = new Set(),
  unitCost = new Map()
}: {
  movements: JobMovement[];
  stored?: StoredJobCost[];
  journaledDays?: ReadonlySet<string>;
  unitCost?: ReadonlyMap<string, number>;
}) {
  const covered = coverJobMovements({ movements, stored });
  return planLegacyJobCosts({
    covered,
    journaledDays,
    missingCostByKey: new Map(
      covered.map(({ movement, missingQuantity }) => [
        movement.key,
        missingQuantity * (unitCost.get(movement.itemId) ?? 0)
      ])
    )
  });
}

describe("coverJobMovements", () => {
  it("orders by time, issues before the completion of the same instant", () => {
    const covered = coverJobMovements({
      movements: [
        movement("Output", "assy", 1, "2026-10-02T10:00:00.000000Z"),
        movement("Consumption", "bolt", -4, "2026-10-02T10:00:00.000000Z"),
        movement("Consumption", "part", -2, "2026-10-02T09:00:00.000000Z")
      ],
      stored: [
        {
          kind: "Consumption",
          jobId: "job-1",
          itemId: "part",
          quantity: -1,
          cost: -10
        }
      ]
    });
    expect(
      covered.map((cover) => [
        cover.movement.itemId,
        cover.coveredQuantity,
        cover.coveredCost,
        cover.missingQuantity
      ])
    ).toEqual([
      ["part", 1, 10, 1],
      ["bolt", 0, 0, 4],
      ["assy", 0, 0, 1]
    ]);
  });
});

describe("planLegacyJobCosts", () => {
  it("costs an issue at its missing cost and gives the completion the job's material cost", () => {
    const planned = plan({
      movements: [
        movement("Output", "assy", 1, "2026-10-02T10:00:00.000000Z"),
        movement("Consumption", "part", -2, "2026-10-02T09:00:00.000000Z"),
        movement("Consumption", "bolt", -4, "2026-10-02T10:00:00.000000Z")
      ],
      unitCost: new Map([
        ["part", 9],
        ["bolt", 0.5]
      ])
    });
    // In time order; the bolts issued in the completion's transaction count.
    expect(
      planned.map((row) => [
        row.movement.itemId,
        row.missingQuantity,
        row.missingCost,
        row.journal
      ])
    ).toEqual([
      ["part", 2, 18, { quantity: 2, cost: 18 }],
      ["bolt", 4, 2, { quantity: 4, cost: 2 }],
      ["assy", 1, 20, { quantity: 1, cost: 20 }]
    ]);
  });

  it("journals a stored row whose day lost its journal, and leaves a journaled day alone", () => {
    const planned = plan({
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
      unitCost: new Map([["part", 9]])
    });
    expect(
      planned.map((row) => [row.missingQuantity, row.missingCost, row.journal])
    ).toEqual([
      // Covered at the stored 10 a part, journal gone: the whole pair.
      [0, 0, { quantity: 2, cost: 20 }],
      // 2 covered and journaled; 1 missing, at 9: a pair for that one.
      [1, 9, { quantity: 1, cost: 9 }]
    ]);
  });

  it("writes the pair of an issue and a return at zero, so each gets its journal", () => {
    const planned = plan({
      movements: [
        movement("Consumption", "free", -1, "2026-10-02T09:00:00.000000Z"),
        movement("Consumption", "free", 1, "2026-10-02T09:30:00.000000Z")
      ]
    });
    expect(planned.map((row) => row.journal)).toEqual([
      { quantity: 1, cost: 0 },
      { quantity: 1, cost: 0 }
    ]);
  });

  it("receives a completion with no material cost at zero, with a pair at zero", () => {
    const planned = plan({
      movements: [
        movement("Output", "assy", 1, "2026-10-02T10:00:00.000000Z"),
        movement(
          "Output",
          "assy",
          1,
          "2026-10-03T10:00:00.000000Z",
          "2026-10-03"
        )
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
      journaledDays: new Set([`Output:job-1:${DAY}`])
    });
    // The first completion stored its layer and kept its journal; the second
    // finds nothing in WIP and is received at zero.
    expect(
      planned.map((row) => [row.missingQuantity, row.missingCost, row.journal])
    ).toEqual([
      [0, 0, null],
      [1, 0, { quantity: 1, cost: 0 }]
    ]);
  });

  it("refuses a missing quantity it was given no cost for", () => {
    const covered = coverJobMovements({
      movements: [
        movement("Consumption", "part", -1, "2026-10-02T09:00:00.000000Z")
      ],
      stored: []
    });
    expect(() =>
      planLegacyJobCosts({
        covered,
        journaledDays: new Set(),
        missingCostByKey: new Map()
      })
    ).toThrow("was not computed");
  });
});
