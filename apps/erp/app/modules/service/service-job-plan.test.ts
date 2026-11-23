// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { journalReference } from "@carbon/database";
import { describe, expect, it } from "vitest";
import {
  buildCoverageReclassLines,
  buildServiceTimeCostGroups,
  MISSING_WARRANTY_EXPENSE_ACCOUNT,
  serviceCoverageAccount
} from "./service-job-plan";

const defaults = {
  costOfServiceAccount: "cos",
  costOfGoodsSoldAccount: "cogs",
  warrantyExpenseAccount: "warranty",
  retainedEarningsAccount: "re"
};

const pairs = (lines: { accountId: string; amount: number }[]) =>
  lines.map((line) => [line.accountId, line.amount]);

describe("serviceCoverageAccount", () => {
  it("posts Billable and Contract to Cost of Service, Warranty to warranty", () => {
    expect(serviceCoverageAccount(defaults, "Billable", "Posted")).toBe("cos");
    expect(serviceCoverageAccount(defaults, "Contract", "Posted")).toBe("cos");
    expect(serviceCoverageAccount(defaults, "Warranty", "Posted")).toBe(
      "warranty"
    );
  });

  it("falls back to COGS when Cost of Service is empty", () => {
    expect(
      serviceCoverageAccount(
        { ...defaults, costOfServiceAccount: null },
        "Billable",
        "Posted"
      )
    ).toBe("cogs");
  });

  it("refuses an empty warranty account, even before the cutover", () => {
    expect(() =>
      serviceCoverageAccount(
        { ...defaults, warrantyExpenseAccount: null },
        "Warranty",
        "Provisional"
      )
    ).toThrow(MISSING_WARRANTY_EXPENSE_ACCOUNT);
  });
});

describe("buildServiceTimeCostGroups", () => {
  const accounts = {
    coverageAccountId: "cos",
    laborAbsorptionAccountId: "absorb",
    dimensions: [{ dimensionId: "location", valueId: "depot" }]
  };

  it("posts hours × cost per entry, keyed by the entry", () => {
    const groups = buildServiceTimeCostGroups({
      ...accounts,
      entries: [{ id: "t1", hours: 1.5, unitCost: 40 }]
    });
    expect(
      groups.map((group) => [group.reference, group.accountId, group.amount])
    ).toEqual([
      [journalReference.to.serviceJobTime("t1"), "cos", 60],
      [journalReference.to.serviceJobTime("t1"), "absorb", -60]
    ]);
    expect(groups.every((group) => group.dimensions.length === 1)).toBe(true);
  });

  it("writes nothing for an entry that costs nothing", () => {
    expect(
      buildServiceTimeCostGroups({
        ...accounts,
        entries: [{ id: "t1", hours: 0, unitCost: 40 }]
      })
    ).toEqual([]);
  });

  it("writes one pair per entry, each with its own reference", () => {
    const groups = buildServiceTimeCostGroups({
      ...accounts,
      entries: [
        { id: "t1", hours: 1, unitCost: 40 },
        { id: "t2", hours: 2, unitCost: 55 }
      ]
    });
    expect(
      groups.map((group) => [group.reference, group.accountId, group.amount])
    ).toEqual([
      [journalReference.to.serviceJobTime("t1"), "cos", 40],
      [journalReference.to.serviceJobTime("t1"), "absorb", -40],
      [journalReference.to.serviceJobTime("t2"), "cos", 110],
      [journalReference.to.serviceJobTime("t2"), "absorb", -110]
    ]);
    expect(groups.reduce((sum, group) => sum + group.amount, 0)).toBe(0);
  });
});

describe("buildCoverageReclassLines", () => {
  it("moves the parts cost from the old coverage account to the new one", () => {
    expect(
      pairs(
        buildCoverageReclassLines({
          from: { coverage: "Warranty", accountId: "warranty" },
          to: { coverage: "Billable", accountId: "cos" },
          partsCost: 70
        })
      )
    ).toEqual([
      ["cos", 70],
      ["warranty", -70]
    ]);
  });

  it("writes nothing with no parts cost or one account", () => {
    expect(
      buildCoverageReclassLines({
        from: { coverage: "Warranty", accountId: "warranty" },
        to: { coverage: "Billable", accountId: "cos" },
        partsCost: 0
      })
    ).toEqual([]);
    expect(
      buildCoverageReclassLines({
        from: { coverage: "Contract", accountId: "cos" },
        to: { coverage: "Billable", accountId: "cos" },
        partsCost: 70
      })
    ).toEqual([]);
  });
});
