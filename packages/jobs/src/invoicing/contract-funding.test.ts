// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildFundingNotices, type FundingLine } from "./contract-funding";

const USD = { code: "USD", decimalPlaces: 2 };

function line(overrides: Partial<FundingLine> = {}): FundingLine {
  return {
    id: "line-1",
    customerContractId: "con-1",
    contractReadableId: "CON-0001",
    lineNumber: 1,
    fundedCost: 100_000,
    noticePercent: 0.75,
    noticeWindowDays: 60,
    thresholdNoticeFundedCost: null,
    runOutNoticeFundedCost: null,
    salesPersonId: "user-sales",
    projectOwnerId: "user-owner",
    createdBy: "user-creator",
    ...overrides
  };
}

// Incurred 60,000.00 and 27,000.00 in the last 90 days (300.00 a day).
const funding = new Map([["line-1", { incurred: 60_000, recentCost: 27_000 }]]);
const noPlan = new Map([
  ["line-1", { plan: 0, committed: 0, actual: 60_000, override: null }]
]);

describe("buildFundingNotices", () => {
  it("gives one threshold notice at 75 % of funded cost", () => {
    const notices = buildFundingNotices(
      [line()],
      funding,
      noPlan,
      "2026-03-01",
      USD
    );
    expect(notices.map((notice) => notice.kind)).toEqual(["threshold"]);
    expect(notices[0]).toMatchObject({
      customerContractId: "con-1",
      customerContractLineId: "line-1",
      fundedCost: 100_000,
      title: "CON-0001 line 1: 75% of funded cost",
      userIds: ["user-sales", "user-owner"]
    });
    expect(notices[0]!.body).toContain("Funded cost $100,000.00");
    expect(notices[0]!.body).toContain(
      "expected in the next 60 days $18,000.00"
    );
  });

  it("gives none when the threshold notice went out for this funded cost", () => {
    expect(
      buildFundingNotices(
        [line({ thresholdNoticeFundedCost: 100_000 })],
        funding,
        noPlan,
        "2026-03-01",
        USD
      )
    ).toEqual([]);
  });

  it("gives a notice with no users when the only owner is system", () => {
    const notices = buildFundingNotices(
      [
        line({
          salesPersonId: null,
          projectOwnerId: null,
          createdBy: "system"
        })
      ],
      funding,
      noPlan,
      "2026-03-01",
      USD
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.userIds).toEqual([]);
  });
});
