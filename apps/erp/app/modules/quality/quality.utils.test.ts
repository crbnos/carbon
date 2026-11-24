// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  issueTrendAxis,
  receiptLotIssueType,
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
});
