// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  pegMovesForSettledActions,
  planPegTransfer
} from "./peg-transfer-plan";

const peg = (quantity: number, needDate: string | null = "2026-11-10") => ({
  quantity,
  needDate
});

describe("planPegTransfer", () => {
  it("puts each peg on the one supply that covers them all", () => {
    expect(
      planPegTransfer(
        [peg(20), peg(30)],
        [{ supplyId: "job_1", quantity: 50, dueDate: "2026-11-30" }],
        false
      )
    ).toEqual([
      { pegIndex: 0, supplyId: "job_1", quantity: 20 },
      { pegIndex: 1, supplyId: "job_1", quantity: 30 }
    ]);
  });

  it("splits a peg across the jobs a week was ordered as", () => {
    expect(
      planPegTransfer(
        [peg(60)],
        [
          { supplyId: "job_1", quantity: 50, dueDate: "2026-11-30" },
          { supplyId: "job_2", quantity: 50, dueDate: "2026-11-30" }
        ],
        false
      )
    ).toEqual([
      { pegIndex: 0, supplyId: "job_1", quantity: 50 },
      { pegIndex: 0, supplyId: "job_2", quantity: 10 }
    ]);
  });

  it("gives the earliest need the first supply", () => {
    expect(
      planPegTransfer(
        [peg(40, "2026-11-20"), peg(40, "2026-11-05")],
        [
          { supplyId: "job_1", quantity: 40, dueDate: "2026-11-30" },
          { supplyId: "job_2", quantity: 40, dueDate: "2026-11-30" }
        ],
        false
      )
    ).toEqual([
      { pegIndex: 1, supplyId: "job_1", quantity: 40 },
      { pegIndex: 0, supplyId: "job_2", quantity: 40 }
    ]);
  });

  it("leaves what a partial order does not cover on the action", () => {
    // 100 pegged, 50 ordered now: the other 50 wait for the next order
    expect(
      planPegTransfer(
        [peg(60), peg(40)],
        [{ supplyId: "job_1", quantity: 50, dueDate: "2026-11-30" }],
        true
      )
    ).toEqual([
      { pegIndex: 0, supplyId: "job_1", quantity: 50 },
      { pegIndex: 0, supplyId: null, quantity: 10 },
      { pegIndex: 1, supplyId: null, quantity: 40 }
    ]);
  });

  it("puts what is left on the last supply once the action is settled", () => {
    expect(
      planPegTransfer(
        [peg(70)],
        [{ supplyId: "pol_1", quantity: 60, dueDate: "2026-11-30" }],
        false
      )
    ).toEqual([{ pegIndex: 0, supplyId: "pol_1", quantity: 70 }]);
  });

  it("orders a peg with no need date last and skips an empty peg", () => {
    expect(
      planPegTransfer(
        [peg(10, null), peg(0), peg(10, "2026-11-01")],
        [{ supplyId: "job_1", quantity: 10, dueDate: "2026-11-30" }],
        true
      )
    ).toEqual([
      { pegIndex: 2, supplyId: "job_1", quantity: 10 },
      { pegIndex: 0, supplyId: null, quantity: 10 }
    ]);
  });

  it("skips a supply too small to hold 5 places and uses the next one", () => {
    expect(
      planPegTransfer(
        [peg(10)],
        [
          { supplyId: "job_1", quantity: 0.000001, dueDate: "2026-11-30" },
          { supplyId: "job_2", quantity: 10, dueDate: "2026-11-30" }
        ],
        false
      )
    ).toEqual([{ pegIndex: 0, supplyId: "job_2", quantity: 10 }]);
  });

  it("leaves the peg on the action when every supply is too small", () => {
    expect(
      planPegTransfer(
        [peg(10)],
        [{ supplyId: "job_1", quantity: 0.000001, dueDate: "2026-11-30" }],
        true
      )
    ).toEqual([{ pegIndex: 0, supplyId: null, quantity: 10 }]);
  });

  it("moves a peg too small to hold 5 places whole, without losing it", () => {
    expect(
      planPegTransfer(
        [peg(0.000001), peg(5)],
        [{ supplyId: "job_1", quantity: 5, dueDate: "2026-11-30" }],
        false
      )
    ).toEqual([
      { pegIndex: 0, supplyId: "job_1", quantity: 0.000001 },
      { pegIndex: 1, supplyId: "job_1", quantity: 5 }
    ]);
  });

  it("gives the earliest need the earliest due supply, whatever the order placed", () => {
    expect(
      planPegTransfer(
        [peg(40, "2026-11-20"), peg(40, "2026-11-05")],
        [
          { supplyId: "job_late", quantity: 40, dueDate: "2026-12-01" },
          { supplyId: "job_early", quantity: 40, dueDate: "2026-11-10" }
        ],
        false
      )
    ).toEqual([
      { pegIndex: 1, supplyId: "job_early", quantity: 40 },
      { pegIndex: 0, supplyId: "job_late", quantity: 40 }
    ]);
  });

  it("uses a supply with no due date last, and overflows onto it", () => {
    expect(
      planPegTransfer(
        [peg(30)],
        [
          { supplyId: "job_undated", quantity: 10, dueDate: null },
          { supplyId: "job_dated", quantity: 10, dueDate: "2026-11-10" }
        ],
        false
      )
    ).toEqual([
      { pegIndex: 0, supplyId: "job_dated", quantity: 10 },
      { pegIndex: 0, supplyId: "job_undated", quantity: 20 }
    ]);
  });

  it("still moves the peg off a settled action when every supply is too small", () => {
    expect(
      planPegTransfer(
        [peg(10)],
        [{ supplyId: "job_1", quantity: 0.000001, dueDate: "2026-11-30" }],
        false
      )
    ).toEqual([{ pegIndex: 0, supplyId: "job_1", quantity: 10 }]);
  });

  it("keeps decimal quantities exact at 5 places", () => {
    expect(
      planPegTransfer(
        [peg(0.3)],
        [
          { supplyId: "job_1", quantity: 0.1, dueDate: "2026-11-30" },
          { supplyId: "job_2", quantity: 0.2, dueDate: "2026-11-30" }
        ],
        false
      )
    ).toEqual([
      { pegIndex: 0, supplyId: "job_1", quantity: 0.1 },
      { pegIndex: 0, supplyId: "job_2", quantity: 0.2 }
    ]);
  });
});

describe("pegMovesForSettledActions", () => {
  const supply = (supplyId: string) => ({
    supplyId,
    quantity: 10,
    dueDate: "2026-11-30"
  });
  const action = (id: string, planningSegmentId: string, status: string) => ({
    id,
    planningSegmentId,
    status,
    orderIndexes: [1, 2]
  });

  it("moves only a planning group's actions, to the supplies that answered them", () => {
    expect(
      pegMovesForSettledActions(
        [action("a1", "group", "Actioned"), action("a2", "project", "Open")],
        [supply("s0"), supply("s1"), supply("s2")],
        "Job",
        new Set(["group"])
      )
    ).toEqual([
      {
        planningActionId: "a1",
        supplyType: "Job",
        supplies: [supply("s1"), supply("s2")],
        keepRemainder: false
      }
    ]);
  });

  it("keeps the remainder on an action still open", () => {
    expect(
      pegMovesForSettledActions(
        [action("a1", "group", "Open")],
        [supply("s0"), supply("s1"), supply("s2")],
        "Purchase Order Line",
        new Set(["group"])
      )[0]!.keepRemainder
    ).toBe(true);
  });
});
