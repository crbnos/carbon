// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildCoverageReclassLines,
  buildServiceJobCompletionLines,
  MISSING_WARRANTY_EXPENSE_ACCOUNT,
  serviceCoverageAccount
} from "./service-job-plan";

const defaults = {
  costOfServiceAccount: "cos",
  costOfGoodsSoldAccount: "cogs",
  warrantyExpenseAccount: "warranty",
  retainedEarningsAccount: "re"
};

const absorption = { accountId: "absorb", accountDefaultRole: null };

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

describe("buildServiceJobCompletionLines", () => {
  it("writes one pair per labor item at hours × cost", () => {
    const { lines, total } = buildServiceJobCompletionLines({
      coverage: "Billable",
      coverageAccountId: "cos",
      laborAbsorption: absorption,
      time: [
        {
          laborItemId: "bench",
          laborItemName: "Bench",
          hours: 1,
          unitCost: 40
        },
        {
          laborItemId: "bench",
          laborItemName: "Bench",
          hours: 0.5,
          unitCost: 40
        },
        { laborItemId: "field", laborItemName: "Field", hours: 2, unitCost: 55 }
      ]
    });
    expect(pairs(lines)).toEqual([
      ["cos", 60],
      ["absorb", -60],
      ["cos", 110],
      ["absorb", -110]
    ]);
    expect(total).toBe(170);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(0);
  });

  it("writes nothing when the time costs nothing", () => {
    const { lines, total } = buildServiceJobCompletionLines({
      coverage: "Warranty",
      coverageAccountId: "warranty",
      laborAbsorption: absorption,
      time: [
        { laborItemId: "bench", laborItemName: "Bench", hours: 0, unitCost: 40 }
      ]
    });
    expect(lines).toEqual([]);
    expect(total).toBe(0);
  });

  it("keeps a Provisional stand-in's role on the absorption line", () => {
    const { lines } = buildServiceJobCompletionLines({
      coverage: "Billable",
      coverageAccountId: "cos",
      laborAbsorption: {
        accountId: "re",
        accountDefaultRole: "laborAbsorptionAccount"
      },
      time: [
        { laborItemId: "bench", laborItemName: "Bench", hours: 1, unitCost: 40 }
      ]
    });
    expect(lines.map((line) => line.accountDefaultRole)).toEqual([
      null,
      "laborAbsorptionAccount"
    ]);
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
