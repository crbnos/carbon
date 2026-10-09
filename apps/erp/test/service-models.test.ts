// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  canMoveServiceOrder,
  canOverrideCoverage,
  summarizeWork,
  rollUpOrderStatus,
  warrantyStatus
} from "~/modules/service/service.models";

describe("rollUpOrderStatus", () => {
  it("keeps a status the user set", () => {
    for (const status of [
      "On Hold",
      "Completed",
      "Closed",
      "Cancelled"
    ] as const) {
      expect(rollUpOrderStatus({ status }, [{ status: "On Site" }])).toBe(
        status
      );
    }
  });

  it("gives In Progress for a visit on its way or on site, or a completed visit with work left", () => {
    expect(
      rollUpOrderStatus({ status: "Scheduled" }, [
        { status: "Scheduled" },
        { status: "Traveling" }
      ])
    ).toBe("In Progress");
    expect(
      rollUpOrderStatus({ status: "Scheduled" }, [{ status: "On Site" }])
    ).toBe("In Progress");
    expect(
      rollUpOrderStatus({ status: "In Progress" }, [{ status: "Completed" }])
    ).toBe("In Progress");
    expect(
      rollUpOrderStatus({ status: "In Progress", workComplete: true }, [
        { status: "Completed" }
      ])
    ).toBe("Completed");
  });

  it("gives Scheduled for a scheduled visit with none started", () => {
    expect(
      rollUpOrderStatus({ status: "Draft" }, [
        { status: "Scheduled" },
        { status: "Cancelled" }
      ])
    ).toBe("Scheduled");
  });

  it("gives Draft with no live visit", () => {
    expect(rollUpOrderStatus({ status: "Scheduled" }, [])).toBe("Draft");
    expect(
      rollUpOrderStatus({ status: "Scheduled" }, [{ status: "Cancelled" }])
    ).toBe("Draft");
  });
});

describe("warrantyStatus", () => {
  const asset = {
    laborWarrantyEndDate: "2027-01-31",
    partsWarrantyEndDate: "2028-01-31"
  };
  it("reads the labor, then the parts end date", () => {
    expect(warrantyStatus(asset, "2027-01-31")).toBe("In warranty");
    expect(warrantyStatus(asset, "2027-02-01")).toBe("Labor ended");
    expect(warrantyStatus(asset, "2028-02-01")).toBe("Expired");
    expect(
      warrantyStatus(
        { laborWarrantyEndDate: null, partsWarrantyEndDate: null },
        "2027-01-01"
      )
    ).toBe("Expired");
  });
});

describe("canMoveServiceOrder", () => {
  it("lets an open order go on hold, complete or cancel", () => {
    for (const from of ["Draft", "Scheduled", "In Progress"] as const) {
      expect(canMoveServiceOrder(from, "On Hold")).toBe(true);
      expect(canMoveServiceOrder(from, "Completed")).toBe(true);
      expect(canMoveServiceOrder(from, "Cancelled")).toBe(true);
      expect(canMoveServiceOrder(from, "Closed")).toBe(false);
    }
  });

  it("resumes an order on hold, and closes or reopens a completed one", () => {
    expect(canMoveServiceOrder("On Hold", "Draft")).toBe(true);
    expect(canMoveServiceOrder("On Hold", "Completed")).toBe(false);
    expect(canMoveServiceOrder("Completed", "Closed")).toBe(true);
    expect(canMoveServiceOrder("Completed", "Draft")).toBe(true);
    expect(canMoveServiceOrder("Completed", "Cancelled")).toBe(false);
  });

  it("never moves a closed or cancelled order", () => {
    for (const to of [
      "On Hold",
      "Completed",
      "Closed",
      "Cancelled",
      "Draft"
    ] as const) {
      expect(canMoveServiceOrder("Closed", to)).toBe(false);
      expect(canMoveServiceOrder("Cancelled", to)).toBe(false);
    }
  });
});

describe("summarizeWork", () => {
  const elements = [
    { id: "root", parentId: null },
    { id: "pump", parentId: "root" },
    { id: "seal", parentId: "pump" }
  ];

  it("rolls hours, part cost, cost and billable amounts up the tree", () => {
    const totals = summarizeWork(
      elements,
      [
        {
          projectElementId: "seal",
          costType: "Labor",
          quantity: 2,
          amount: 170,
          coverage: "Warranty"
        },
        {
          projectElementId: "pump",
          costType: "Material",
          quantity: 1,
          amount: 40,
          coverage: "Billable"
        }
      ],
      [
        { projectElementId: "seal", amount: 0, status: "Unbilled" },
        { projectElementId: "pump", amount: 65, status: "Unbilled" },
        { projectElementId: "pump", amount: 30, status: "Written Off" }
      ]
    );
    expect(totals.get("seal")).toEqual({
      hours: 2,
      partCost: 0,
      cost: 170,
      billable: 0,
      coverages: ["Warranty"]
    });
    expect(totals.get("root")).toEqual({
      hours: 2,
      partCost: 40,
      cost: 210,
      billable: 65,
      coverages: ["Warranty", "Billable"]
    });
  });

  it("drops a coverage whose charges a reclass netted to zero", () => {
    const totals = summarizeWork(
      elements,
      [
        {
          projectElementId: "seal",
          costType: "Labor",
          quantity: 1,
          amount: 120,
          coverage: "Warranty"
        },
        {
          projectElementId: "seal",
          costType: "Labor",
          quantity: -1,
          amount: -120,
          coverage: "Warranty"
        },
        {
          projectElementId: "seal",
          costType: "Labor",
          quantity: 1,
          amount: 120,
          coverage: "Billable"
        }
      ],
      []
    );
    expect(totals.get("seal")?.coverages).toEqual(["Billable"]);
    expect(totals.get("seal")?.hours).toBe(1);
  });
});

describe("canOverrideCoverage", () => {
  it("allows an open, unbilled original charge only", () => {
    const reversed = new Set(["old"]);
    expect(
      canOverrideCoverage({ id: "a", reversalOfId: null }, reversed, "Unbilled")
    ).toBe(true);
    expect(
      canOverrideCoverage({ id: "a", reversalOfId: null }, reversed, null)
    ).toBe(true);
    expect(
      canOverrideCoverage({ id: "a", reversalOfId: null }, reversed, "Billed")
    ).toBe(false);
    expect(
      canOverrideCoverage({ id: "old", reversalOfId: null }, reversed, null)
    ).toBe(false);
    expect(
      canOverrideCoverage({ id: "r", reversalOfId: "a" }, reversed, null)
    ).toBe(false);
  });
});
