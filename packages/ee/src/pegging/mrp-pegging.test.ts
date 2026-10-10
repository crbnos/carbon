// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  applyMemberMoves,
  type ComputedPeg,
  diffPegs,
  type ExistingPeg,
  type MemberPosition,
  type PegDemand,
  type PegSupply,
  pegGroupSegment,
  proposeMemberMoves,
  splitGroupedJobDemand
} from "./mrp-pegging";

function demand(
  projectId: string,
  quantity: number,
  overrides: Partial<PegDemand> = {}
): PegDemand {
  return {
    projectId,
    projectElementId: `${projectId}-el`,
    priority: 100,
    sourceType: "Project Material",
    sourceId: `${projectId}-pem`,
    needDate: "2026-11-02",
    quantity,
    ...overrides
  };
}

const plannedOrder: PegSupply = {
  supplyType: "Planning Action",
  supplyId: "pa-1",
  ownerProjectId: null,
  availableDate: "2026-10-26",
  quantity: 60
};

/** A computed peg stored as a current Soft row. */
function stored(peg: ComputedPeg, id: string): ExistingPeg {
  return {
    id,
    supplyType: peg.supplyType,
    supplyId: peg.supplyId,
    projectId: peg.projectId,
    projectElementId: peg.projectElementId,
    demandSourceType: peg.demandSourceType,
    demandSourceId: peg.demandSourceId,
    quantity: peg.quantity,
    state: "Soft"
  };
}

const quantities = (pegs: ComputedPeg[]) =>
  pegs.map((peg) => [peg.projectId, peg.quantity]);

describe("pegGroupSegment", () => {
  it("pegs one grouped planned order of 60 to demands of 20, 30 and 10", () => {
    const result = pegGroupSegment({
      demands: [
        demand("P-101", 20, { needDate: "2026-11-02" }),
        demand("P-102", 30, { needDate: "2026-11-09" }),
        demand("P-103", 10, { needDate: "2026-11-16" })
      ],
      supplies: [plannedOrder],
      existing: [],
      priorityRule: "Earliest Need"
    });

    expect(quantities(result.pegs)).toEqual([
      ["P-101", 20],
      ["P-102", 30],
      ["P-103", 10]
    ]);
    expect(result.pegs[0]).toMatchObject({
      supplyType: "Planning Action",
      supplyId: "pa-1",
      projectElementId: "P-101-el",
      demandSourceType: "Project Material",
      demandSourceId: "P-101-pem",
      needDate: "2026-11-02"
    });
    expect(result.shortages).toEqual([]);
    expect(result.excess).toEqual([]);
  });

  it("supersedes only the changed peg when P-103's demand drops to 5", () => {
    const run = (p103: number) =>
      pegGroupSegment({
        demands: [
          demand("P-101", 20, { needDate: "2026-11-02" }),
          demand("P-102", 30, { needDate: "2026-11-09" }),
          demand("P-103", p103, { needDate: "2026-11-16" })
        ],
        supplies: [plannedOrder],
        existing: [],
        priorityRule: "Earliest Need"
      });
    const current = run(10).pegs.map((peg, index) =>
      stored(peg, `peg-${index}`)
    );
    const next = run(5);

    const diff = diffPegs(current, next.pegs);
    expect(diff.keepIds).toEqual(["peg-0", "peg-1"]);
    expect(diff.supersedeIds).toEqual(["peg-2"]);
    expect(quantities(diff.inserts)).toEqual([["P-103", 5]]);
    expect(next.excess).toEqual([
      { supplyType: "Planning Action", supplyId: "pa-1", quantity: 5 }
    ]);
  });

  it("leaves a Hard peg fixed when its demand drops below it", () => {
    const hard: ExistingPeg = {
      id: "peg-hard",
      supplyType: "Purchase Order Line",
      supplyId: "pol-1",
      projectId: "P-101",
      demandSourceType: "Project Material",
      demandSourceId: "P-101-pem",
      quantity: 20,
      state: "Hard"
    };
    const result = pegGroupSegment({
      demands: [demand("P-101", 15)],
      // The receipt put the 20 into P-101's own stripe.
      supplies: [
        {
          supplyType: "Stock",
          supplyId: "P-101",
          ownerProjectId: "P-101",
          availableDate: "2026-10-10",
          quantity: 20
        }
      ],
      existing: [hard],
      priorityRule: "Earliest Need"
    });

    expect(result.pegs).toEqual([]);
    expect(result.shortages).toEqual([]);
    expect(diffPegs([hard], result.pegs)).toEqual({
      keepIds: [],
      supersedeIds: [],
      inserts: []
    });
  });

  it("reports a Manual peg whose demand is gone", () => {
    const manual: ExistingPeg = {
      id: "peg-manual",
      supplyType: "Planning Action",
      supplyId: "pa-1",
      projectId: "P-102",
      demandSourceType: "Project Material",
      demandSourceId: "P-102-pem",
      quantity: 12,
      state: "Manual"
    };
    const result = pegGroupSegment({
      demands: [demand("P-101", 20)],
      supplies: [plannedOrder],
      existing: [manual],
      priorityRule: "Earliest Need"
    });

    expect(result.manualWithoutDemand).toEqual([manual]);
    // The Manual peg still holds its 12 of the order.
    expect(quantities(result.pegs)).toEqual([["P-101", 20]]);
    expect(result.excess).toEqual([
      { supplyType: "Planning Action", supplyId: "pa-1", quantity: 28 }
    ]);
  });

  it("covers a member's demand with its own stock first", () => {
    const result = pegGroupSegment({
      demands: [demand("P-101", 20)],
      supplies: [
        {
          supplyType: "Stock",
          supplyId: "P-101",
          ownerProjectId: "P-101",
          availableDate: "2026-10-10",
          quantity: 8
        },
        plannedOrder
      ],
      existing: [],
      priorityRule: "Earliest Need"
    });

    expect(quantities(result.pegs)).toEqual([["P-101", 12]]);
  });

  it("pegs by project priority before need date under Project Priority", () => {
    const result = pegGroupSegment({
      demands: [
        demand("P-early", 40, { priority: 5, needDate: "2026-10-26" }),
        demand("P-first", 40, { priority: 1, needDate: "2026-11-30" })
      ],
      supplies: [plannedOrder],
      existing: [],
      priorityRule: "Project Priority"
    });

    expect(quantities(result.pegs)).toEqual([
      ["P-first", 40],
      ["P-early", 20]
    ]);
    expect(result.shortages).toMatchObject([
      { projectId: "P-early", quantity: 20 }
    ]);
  });
});

describe("splitGroupedJobDemand", () => {
  it("splits a component demand of 10 over job pegs of 2 and 1", () => {
    const jobPeg = (id: string, projectId: string, quantity: number) =>
      ({
        id,
        supplyType: "Job",
        supplyId: "job-1",
        projectId,
        projectElementId: `${projectId}-el`,
        demandSourceType: "Project Material",
        demandSourceId: `${projectId}-pem`,
        quantity,
        state: "Soft"
      }) satisfies ExistingPeg;

    const parts = splitGroupedJobDemand(
      [
        demand("", 10, {
          projectElementId: null,
          sourceType: "Job Material",
          sourceId: "job-1",
          parentSupply: { supplyType: "Job", supplyId: "job-1" }
        })
      ],
      [jobPeg("peg-a", "P-101", 2), jobPeg("peg-b", "P-102", 1)]
    );

    expect(
      parts.map((part) => [part.projectId, part.quantity, part.parentPegKey])
    ).toEqual([
      ["P-101", 6.66667, "peg-a"],
      ["P-102", 3.33333, "peg-b"]
    ]);
    expect(parts[0]?.projectElementId).toBe("P-101-el");
    expect(parts.reduce((sum, part) => sum + part.quantity, 0)).toBeCloseTo(
      10,
      10
    );
  });
});

describe("pegging performance", () => {
  // The spec's risk: pegging a large group must stay a small part of the
  // 0.3–0.5 s company run.
  it("pegs 1 000 members and 20 000 demands in less than 500 ms", () => {
    const members = Array.from({ length: 1000 }, (_, i) => `P-${i}`);
    const demands: PegDemand[] = [];
    for (let i = 0; i < 20_000; i++) {
      const projectId = members[i % members.length]!;
      demands.push(
        demand(projectId, 1 + (i % 7), {
          sourceId: `pem-${i}`,
          priority: i % 10,
          needDate: `2026-${String(10 + (i % 3)).padStart(2, "0")}-${String(
            1 + (i % 28)
          ).padStart(2, "0")}`
        })
      );
    }
    const supplies: PegSupply[] = [
      ...members.map((projectId) => ({
        supplyType: "Stock" as const,
        supplyId: projectId,
        ownerProjectId: projectId,
        availableDate: "2026-10-01",
        quantity: 3
      })),
      ...Array.from({ length: 2000 }, (_, i) => ({
        supplyType: "Purchase Order Line" as const,
        supplyId: `pol-${i}`,
        ownerProjectId: null,
        availableDate: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
        quantity: 25
      }))
    ];

    const started = performance.now();
    const result = pegGroupSegment({
      demands,
      supplies,
      existing: [],
      priorityRule: "Earliest Need"
    });
    diffPegs([], result.pegs);
    const elapsed = performance.now() - started;

    expect(result.pegs.length).toBeGreaterThan(10_000);
    expect(elapsed).toBeLessThan(500);
  });
});

// The spec's sibling-excess case: a member short by 4, a sibling with 6.
describe("proposeMemberMoves", () => {
  const today = "2026-10-12";
  const short: MemberPosition = {
    projectId: "p-101",
    priority: 100,
    stock: 0,
    supplies: [],
    demands: [{ needDate: "2026-10-19", quantity: 4 }]
  };

  it("transfers 4 from a sibling with 6 excess and no demand in the horizon", () => {
    const moves = proposeMemberMoves({
      members: [
        short,
        {
          projectId: "p-102",
          priority: 100,
          stock: 6,
          supplies: [],
          demands: []
        }
      ],
      horizonEndDate: "2027-03-31",
      leadTimeDays: 5,
      today
    });
    expect(moves).toEqual([
      {
        type: "Transfer",
        fromProjectId: "p-102",
        toProjectId: "p-101",
        quantity: 4,
        needDate: "2026-10-19",
        paybackDueDate: null
      }
    ]);
  });

  it("borrows 4 when the sibling needs its stock in 3 weeks, paid back a lead time before", () => {
    const moves = proposeMemberMoves({
      members: [
        short,
        {
          projectId: "p-102",
          priority: 100,
          stock: 6,
          supplies: [],
          demands: [{ needDate: "2026-11-02", quantity: 6 }]
        }
      ],
      horizonEndDate: "2027-03-31",
      leadTimeDays: 5,
      today
    });
    expect(moves).toEqual([
      {
        type: "Borrow",
        fromProjectId: "p-102",
        toProjectId: "p-101",
        quantity: 4,
        needDate: "2026-10-19",
        // 3 weeks from today, less the 5-day lead time
        paybackDueDate: "2026-10-28"
      }
    ]);
  });

  it("transfers the permanent excess first, never pays back before today, and lends nothing a sibling needs first", () => {
    const moves = proposeMemberMoves({
      members: [
        short,
        {
          projectId: "p-102",
          priority: 100,
          stock: 3,
          supplies: [],
          demands: [{ needDate: "2026-10-26", quantity: 2 }]
        },
        {
          projectId: "p-103",
          priority: 100,
          stock: 5,
          supplies: [],
          demands: [{ needDate: "2026-10-13", quantity: 5 }]
        }
      ],
      horizonEndDate: "2027-03-31",
      leadTimeDays: 30,
      today
    });
    expect(
      moves.map((move) => [
        move.type,
        move.fromProjectId,
        move.quantity,
        move.paybackDueDate
      ])
    ).toEqual([
      ["Transfer", "p-102", 1, null],
      ["Borrow", "p-102", 2, today]
    ]);
  });

  it("moves the stock in the peg input, so the group total stays the same", () => {
    const input = applyMemberMoves(
      {
        planningGroupId: "plg-1",
        itemId: "item-1",
        locationId: "loc-1",
        demands: [],
        supplies: [
          {
            supplyType: "Stock",
            supplyId: "p-102",
            ownerProjectId: "p-102",
            availableDate: today,
            quantity: 6
          },
          plannedOrder
        ]
      },
      [
        {
          type: "Transfer",
          fromProjectId: "p-102",
          toProjectId: "p-101",
          quantity: 4,
          needDate: "2026-10-19",
          paybackDueDate: null
        }
      ],
      today
    );
    expect(
      input.supplies.map((supply) => [
        supply.supplyType,
        supply.ownerProjectId,
        supply.quantity
      ])
    ).toEqual([
      ["Planning Action", null, 60],
      ["Stock", "p-102", 2],
      ["Stock", "p-101", 4]
    ]);
  });
});
