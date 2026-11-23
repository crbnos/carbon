// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { receiptLotIssueType, scarForSupplier } from "./quality.utils";

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
