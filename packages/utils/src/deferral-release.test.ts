// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type DeferralRow, releaseDeferral } from "./deferral-release";

const row = (
  id: string,
  periodStart: string,
  amount: number,
  status: DeferralRow["status"] = "Planned"
): DeferralRow => ({ id, periodStart, amount, status });

describe("releaseDeferral", () => {
  it("deletes the latest row and trims the one before it", () => {
    const rows = [
      row("jul", "2026-07-01", 100),
      row("sep", "2026-09-01", 100),
      row("aug", "2026-08-01", 100)
    ];
    expect(releaseDeferral(rows, 150)).toEqual({
      deleteIds: ["sep"],
      reduce: [{ id: "aug", amount: 50 }],
      fromRevenue: 0
    });
  });

  it("takes what the Planned rows cannot cover from revenue, leaving Posted rows alone", () => {
    const rows = [
      row("jul", "2026-07-01", 100, "Posted"),
      row("aug", "2026-08-01", 100),
      row("sep", "2026-09-01", 100)
    ];
    expect(releaseDeferral(rows, 350)).toEqual({
      deleteIds: ["sep", "aug"],
      reduce: [],
      fromRevenue: 150
    });
  });

  it("deletes a row released exactly, with nothing from revenue", () => {
    expect(releaseDeferral([row("sep", "2026-09-01", 140)], 140)).toEqual({
      deleteIds: ["sep"],
      reduce: [],
      fromRevenue: 0
    });
  });

  it("reduces a single larger row", () => {
    expect(releaseDeferral([row("sep", "2026-09-01", 420)], 140)).toEqual({
      deleteIds: [],
      reduce: [{ id: "sep", amount: 280 }],
      fromRevenue: 0
    });
  });

  it("is all revenue when nothing is Planned", () => {
    expect(
      releaseDeferral([row("sep", "2026-09-01", 100, "Posted")], 60)
    ).toEqual({ deleteIds: [], reduce: [], fromRevenue: 60 });
  });

  it("keeps sub-cent amounts at internal scale without float noise", () => {
    const rows = [
      row("aug", "2026-08-01", 33.33333),
      row("sep", "2026-09-01", 33.33334)
    ];
    expect(releaseDeferral(rows, 50)).toEqual({
      deleteIds: ["sep"],
      reduce: [{ id: "aug", amount: 16.66667 }],
      fromRevenue: 0
    });
  });
});
