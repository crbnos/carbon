// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  gaugeCalibrationStatusFromDates,
  issueTrendAxis,
  receiptLotIssueType,
  requiredActionIdList,
  samplingRuleForPlanType,
  scarForSupplier
} from "./quality.utils";

describe("receiptLotIssueType", () => {
  it("prefers a supplier or receiving type over the first", () => {
    expect(
      receiptLotIssueType([
        { id: "1", name: "Customer Complaint" },
        { id: "2", name: "Design Error" },
        { id: "3", name: "Supplier Issue" }
      ])?.id
    ).toBe("3");
  });

  it("falls back to the first type, and to none", () => {
    expect(
      receiptLotIssueType([
        { id: "1", name: "Customer Complaint" },
        { id: "2", name: "Design Error" }
      ])?.id
    ).toBe("1");
    expect(receiptLotIssueType([])).toBeUndefined();
    expect(receiptLotIssueType(null)).toBeUndefined();
  });
});

describe("requiredActionIdList", () => {
  it.each([
    [["a", "b"]],
    ['["a","b"]'],
    ["{a,b}"],
    ["a, b"],
    ['{"a","b"}'],
    [["a", "b", "a"]]
  ])("reads %j as the ids in order", (value) => {
    expect(requiredActionIdList(value)).toEqual(["a", "b"]);
  });

  it("reads an empty value as no ids", () => {
    expect(requiredActionIdList("")).toEqual([]);
    expect(requiredActionIdList("{}")).toEqual([]);
    expect(requiredActionIdList([])).toEqual([]);
  });

  it("refuses a JSON list that does not parse", () => {
    expect(requiredActionIdList('["a"')).toBeNull();
  });
});

describe("samplingRuleForPlanType", () => {
  const sent = {
    samplingSampleSize: 5,
    samplingPercentage: 20,
    samplingAql: 2.5,
    samplingInspectionLevel: "S2",
    samplingSeverity: "Tightened"
  } as const;

  it("keeps only the values the plan type uses", () => {
    expect(
      samplingRuleForPlanType({ samplingPlanType: "First", ...sent })
    ).toEqual({
      samplingPlanType: "First",
      samplingSampleSize: 5,
      samplingPercentage: null,
      samplingAql: null,
      samplingInspectionLevel: null,
      samplingSeverity: null
    });
    expect(
      samplingRuleForPlanType({ samplingPlanType: "AQL", ...sent })
    ).toEqual({
      samplingPlanType: "AQL",
      samplingSampleSize: null,
      samplingPercentage: null,
      samplingAql: 2.5,
      samplingInspectionLevel: "S2",
      samplingSeverity: "Tightened"
    });
  });

  it("clears every value without a plan type", () => {
    expect(
      samplingRuleForPlanType({ samplingPlanType: null, ...sent })
    ).toEqual({
      samplingPlanType: null,
      samplingSampleSize: null,
      samplingPercentage: null,
      samplingAql: null,
      samplingInspectionLevel: null,
      samplingSeverity: null
    });
  });

  it("stores a value left out as null", () => {
    expect(samplingRuleForPlanType({ samplingPlanType: "AQL" })).toEqual({
      samplingPlanType: "AQL",
      samplingSampleSize: null,
      samplingPercentage: null,
      samplingAql: null,
      samplingInspectionLevel: null,
      samplingSeverity: null
    });
  });
});

// Rows as the SCAR loader reads them: whole rows, internal columns included.
const issue = {
  nonConformanceId: "NCR000012",
  name: "Wall thickness under minimum",
  status: "In Progress" as const,
  description: "Tank quarantined; MRB to decide use-as-is",
  assignee: "user_1",
  companyId: "co_1"
};
const company = {
  name: "Acme Fabrication",
  logoLight: null,
  logoDark: "https://cdn/dark.png",
  taxId: "TAX-1"
};
const supplier = {
  name: "Tank Works",
  taxId: "TAX-2",
  accountManagerId: "user_2"
};
const task = {
  id: "task_1",
  name: "Root cause",
  status: "Pending" as const,
  supplierId: "sup_1",
  notes: { type: "doc" },
  assignee: "user_1",
  dueDate: "2026-12-01",
  linearIssue: { url: "https://linear.app/x" }
};

describe("scarForSupplier", () => {
  it("sends the issue's number, name and status and the supplier's tasks, never its internal fields", () => {
    expect(
      scarForSupplier({ issue, company, supplier, actionTasks: [task] })
    ).toEqual({
      issue: {
        nonConformanceId: "NCR000012",
        name: "Wall thickness under minimum",
        status: "In Progress"
      },
      company: {
        name: "Acme Fabrication",
        logoLight: null,
        logoDark: "https://cdn/dark.png"
      },
      supplier: { name: "Tank Works" },
      actionTasks: [
        {
          id: "task_1",
          name: "Root cause",
          status: "Pending",
          supplierId: "sup_1",
          notes: { type: "doc" }
        }
      ]
    });
  });
});

describe("gaugeCalibrationStatusFromDates", () => {
  const today = parseDate("2026-11-24");

  it.each([
    [{}, "Pending"],
    [{ lastCalibrationDate: "2026-05-24" }, "Pending"],
    [{ nextCalibrationDate: "2026-12-01" }, "Pending"],
    [
      { lastCalibrationDate: "2026-05-24", nextCalibrationDate: "2026-11-24" },
      "In-Calibration"
    ],
    [
      { lastCalibrationDate: "2026-05-23", nextCalibrationDate: "2026-11-23" },
      "Out-of-Calibration"
    ]
  ] as const)("%o is %s", (dates, status) => {
    expect(gaugeCalibrationStatusFromDates(dates, today)).toBe(status);
  });
});

describe("issueTrendAxis", () => {
  it("reaches the target when every week is below it", () => {
    expect(
      issueTrendAxis(
        [
          { opened: 1, closed: 0 },
          { opened: 0, closed: 1 }
        ],
        20
      )
    ).toEqual({
      niceMin: 0,
      niceMax: 20,
      ticks: [0, 5, 10, 15, 20],
      showCounts: true
    });
  });

  it("reaches the busiest week when it is above the target", () => {
    expect(issueTrendAxis([{ opened: 23, closed: 4 }], 20)).toEqual({
      niceMin: 0,
      niceMax: 25,
      ticks: [0, 5, 10, 15, 20, 25],
      showCounts: false
    });
  });

  it.each([0, null, undefined])(
    "fits the weeks alone when the target is %s",
    (target) => {
      expect(issueTrendAxis([{ opened: 3, closed: 1 }], target)).toEqual({
        niceMin: 0,
        niceMax: 3,
        ticks: [0, 1, 2, 3],
        showCounts: false
      });
    }
  );

  it("prints no counts on a chart with no issues", () => {
    expect(issueTrendAxis([{ opened: 0, closed: 0 }], 20).showCounts).toBe(
      false
    );
  });

  it("prints counts while the busiest week is at most a quarter of the axis", () => {
    expect(issueTrendAxis([{ opened: 5, closed: 2 }], 20).showCounts).toBe(
      true
    );
    expect(issueTrendAxis([{ opened: 6, closed: 2 }], 20).showCounts).toBe(
      false
    );
  });

  it("fits the weeks when the legend hides the target", () => {
    expect(
      issueTrendAxis([{ opened: 1, closed: 1 }], 20, new Set(["target"]))
    ).toEqual({ niceMin: 0, niceMax: 1, ticks: [0, 1], showCounts: false });
  });

  it("leaves a hidden series out of the busiest week", () => {
    const weeks = [{ opened: 23, closed: 4 }];
    expect(issueTrendAxis(weeks, 0, new Set(["opened"])).niceMax).toBe(4);
    expect(issueTrendAxis(weeks, 0, new Set(["closed"])).niceMax).toBe(25);
    expect(
      issueTrendAxis(weeks, 20, new Set(["opened", "target"])).niceMax
    ).toBe(4);
  });
});
