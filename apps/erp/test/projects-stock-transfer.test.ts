// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  glossaryEntries: () => [],
  terms: {}
}));

import {
  governmentFurnishedRefusal,
  isBorrowOverdue,
  projectStockTransferValidator,
  toStockOwner
} from "../app/modules/projects/projects.models";

const gfp = {
  id: "p1",
  identifier: "GFP",
  name: "Government program",
  customerId: "c1",
  governmentFurnished: true
};

describe("projectStockTransferValidator", () => {
  it("accepts a Transfer from common stock to a project", () => {
    const result = projectStockTransferValidator.safeParse({
      type: "Transfer",
      fromProjectId: "common",
      toProjectId: "p2",
      locationId: "loc",
      reason: "Kit the build"
    });
    expect(result.success).toBe(true);
    expect(toStockOwner("common")).toBeNull();
  });

  it("refuses a Borrow from common stock or without a due date", () => {
    const fromCommon = projectStockTransferValidator.safeParse({
      type: "Borrow",
      fromProjectId: "common",
      toProjectId: "p2",
      locationId: "loc",
      reason: "Short",
      paybackDueDate: "2026-11-01"
    });
    expect(fromCommon.success).toBe(false);

    const noDueDate = projectStockTransferValidator.safeParse({
      type: "Borrow",
      fromProjectId: "p1",
      toProjectId: "p2",
      locationId: "loc",
      reason: "Short"
    });
    expect(noDueDate.success).toBe(false);
  });

  it("needs only the borrow and a reason for a Payback", () => {
    const result = projectStockTransferValidator.safeParse({
      type: "Payback",
      settlesBorrowId: "pbw_1",
      reason: "Stock arrived"
    });
    expect(result.success).toBe(true);
  });
});

describe("governmentFurnishedRefusal", () => {
  it("refuses common stock and another customer's project", () => {
    expect(governmentFurnishedRefusal(gfp, null)).toContain("GFP");
    expect(
      governmentFurnishedRefusal(gfp, {
        ...gfp,
        id: "p2",
        customerId: "c2",
        governmentFurnished: false
      })
    ).not.toBeNull();
  });

  it("allows a project of the same customer and any ordinary owner", () => {
    expect(
      governmentFurnishedRefusal(gfp, {
        ...gfp,
        id: "p2",
        governmentFurnished: false
      })
    ).toBeNull();
    expect(
      governmentFurnishedRefusal({ ...gfp, governmentFurnished: false }, null)
    ).toBeNull();
  });
});

describe("isBorrowOverdue", () => {
  it("is overdue only while open and past its due date", () => {
    const borrow = { status: "Open" as const, paybackDueDate: "2026-10-01" };
    expect(isBorrowOverdue(borrow, "2026-10-02")).toBe(true);
    expect(isBorrowOverdue(borrow, "2026-10-01")).toBe(false);
    expect(
      isBorrowOverdue({ ...borrow, status: "Paid Back" }, "2026-10-02")
    ).toBe(false);
  });
});
