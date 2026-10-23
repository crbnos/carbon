// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildExpenseReversal,
  buildServiceEstimate,
  canMoveServiceOrder,
  canMoveVisit,
  canOverrideCoverage,
  canReverseCharge,
  summarizeWork,
  rollUpOrderStatus,
  serviceChargeReversalValidator,
  serviceTemplateIdentifier,
  warrantyStatus,
  worstServiceOrderStatus
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

  it("keeps a Draft order Draft with no live visit", () => {
    expect(rollUpOrderStatus({ status: "Draft" }, [])).toBe("Draft");
    expect(
      rollUpOrderStatus({ status: "Draft" }, [{ status: "Cancelled" }])
    ).toBe("Draft");
  });

  it("never returns a released order to Draft", () => {
    expect(rollUpOrderStatus({ status: "Planned" }, [])).toBe("Planned");
    expect(rollUpOrderStatus({ status: "Scheduled" }, [])).toBe("Planned");
    expect(
      rollUpOrderStatus({ status: "Scheduled" }, [{ status: "Cancelled" }])
    ).toBe("Planned");
    expect(
      rollUpOrderStatus({ status: "Planned" }, [{ status: "Scheduled" }])
    ).toBe("Scheduled");
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
  it("plans a Draft order, and only a Draft order", () => {
    expect(canMoveServiceOrder("Draft", "Planned")).toBe(true);
    for (const from of ["Planned", "Scheduled", "In Progress"] as const) {
      expect(canMoveServiceOrder(from, "Planned")).toBe(false);
    }
  });

  it("lets an open order go on hold, complete or cancel", () => {
    for (const from of [
      "Draft",
      "Planned",
      "Scheduled",
      "In Progress"
    ] as const) {
      expect(canMoveServiceOrder(from, "On Hold")).toBe(true);
      expect(canMoveServiceOrder(from, "Completed")).toBe(true);
      expect(canMoveServiceOrder(from, "Cancelled")).toBe(true);
      expect(canMoveServiceOrder(from, "Closed")).toBe(false);
    }
  });

  it("resumes an order on hold, and closes or reopens a completed one", () => {
    expect(canMoveServiceOrder("On Hold", "Planned")).toBe(true);
    expect(canMoveServiceOrder("On Hold", "Completed")).toBe(false);
    expect(canMoveServiceOrder("Completed", "Closed")).toBe(true);
    expect(canMoveServiceOrder("Completed", "Planned")).toBe(true);
    expect(canMoveServiceOrder("Completed", "Cancelled")).toBe(false);
  });

  it("never moves a closed or cancelled order", () => {
    for (const to of [
      "Planned",
      "On Hold",
      "Completed",
      "Closed",
      "Cancelled"
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

describe("canReverseCharge", () => {
  const reversed = new Set(["old"]);

  it("allows an open time or expense charge, billed or not", () => {
    expect(
      canReverseCharge(
        { id: "a", reversalOfId: null, documentType: "Timesheet" },
        reversed
      )
    ).toBe(true);
    expect(
      canReverseCharge(
        { id: "a", reversalOfId: null, documentType: "Project Expense" },
        reversed
      )
    ).toBe(true);
  });

  it("refuses a part, a reversal and a charge already reversed", () => {
    expect(
      canReverseCharge(
        { id: "a", reversalOfId: null, documentType: "Project Issue" },
        reversed
      )
    ).toBe(false);
    expect(
      canReverseCharge(
        { id: "a", reversalOfId: null, documentType: null },
        reversed
      )
    ).toBe(false);
    expect(
      canReverseCharge(
        { id: "r", reversalOfId: "a", documentType: "Timesheet" },
        reversed
      )
    ).toBe(false);
    expect(
      canReverseCharge(
        { id: "old", reversalOfId: null, documentType: "Project Expense" },
        reversed
      )
    ).toBe(false);
  });
});

describe("serviceChargeReversalValidator", () => {
  it("needs a charge and a reason that is not blank", () => {
    expect(
      serviceChargeReversalValidator.safeParse({
        projectLedgerId: "pl1",
        reason: "Logged on the wrong order"
      }).success
    ).toBe(true);
    expect(
      serviceChargeReversalValidator.safeParse({
        projectLedgerId: "pl1",
        reason: "   "
      }).success
    ).toBe(false);
    expect(
      serviceChargeReversalValidator.safeParse({
        projectLedgerId: "",
        reason: "Wrong order"
      }).success
    ).toBe(false);
  });
});

describe("buildExpenseReversal", () => {
  it("negates the amount and keeps the node, visit, employee and date", () => {
    expect(
      buildExpenseReversal(
        {
          id: "pjx1",
          companyId: "c1",
          projectId: "p1",
          projectElementId: "e1",
          serviceVisitId: "v1",
          employeeId: "tech",
          entryDate: "2026-10-05",
          description: "Mileage",
          amount: "40.5"
        },
        { reason: "Charged twice", userId: "manager" }
      )
    ).toEqual({
      companyId: "c1",
      projectId: "p1",
      projectElementId: "e1",
      serviceVisitId: "v1",
      employeeId: "tech",
      entryDate: "2026-10-05",
      description: "Mileage",
      amount: -40.5,
      reversalOfId: "pjx1",
      reversalReason: "Charged twice",
      createdBy: "manager"
    });
  });
});

describe("canMoveVisit", () => {
  it("walks a visit from scheduled to completed", () => {
    expect(canMoveVisit("Scheduled", "Traveling")).toBe(true);
    expect(canMoveVisit("Scheduled", "On Site")).toBe(true);
    expect(canMoveVisit("Traveling", "On Site")).toBe(true);
    expect(canMoveVisit("On Site", "Completed")).toBe(true);
    expect(canMoveVisit("Scheduled", "Completed")).toBe(false);
    expect(canMoveVisit("Traveling", "Scheduled")).toBe(false);
  });

  it("cancels an open visit only", () => {
    expect(canMoveVisit("On Site", "Cancelled")).toBe(true);
    expect(canMoveVisit("Completed", "Cancelled")).toBe(false);
    expect(canMoveVisit("Cancelled", "Scheduled")).toBe(false);
  });
});

describe("buildServiceEstimate", () => {
  const nodes = [
    {
      id: "engine",
      parentId: null,
      sortOrder: 1,
      readableId: "SVC1-1",
      name: "Engine",
      fixedPrice: null
    },
    {
      id: "cylinders",
      parentId: "engine",
      sortOrder: 1,
      readableId: "SVC1-2",
      name: "Cylinders",
      fixedPrice: 500
    },
    {
      id: "boring",
      parentId: "cylinders",
      sortOrder: 1,
      readableId: "SVC1-3",
      name: "Boring",
      fixedPrice: null
    },
    {
      id: "transmission",
      parentId: null,
      sortOrder: 2,
      readableId: "SVC1-4",
      name: "Transmission",
      fixedPrice: null
    }
  ];

  it("prices labor, materials and costs at sale prices, in tree order", () => {
    const estimate = buildServiceEstimate({
      nodes,
      labor: [{ projectElementId: "engine", description: "Mechanic", hours: 2 }],
      materials: [
        {
          projectElementId: "transmission",
          description: "TR-200 Gear set",
          quantity: 3,
          unitOfMeasure: "EA",
          unitPrice: 12.5
        }
      ],
      costs: [
        { projectElementId: "transmission", description: "Freight", amount: 40 }
      ],
      laborPrice: 95,
      laborUnit: "HR"
    });

    expect(estimate.nodes.map((node) => node.name)).toEqual([
      "Engine",
      "Cylinders",
      "Transmission"
    ]);
    expect(estimate.nodes[0]!.total).toBe(190);
    expect(estimate.nodes[2]!.lines.map((line) => line.amount)).toEqual([
      37.5, 40
    ]);
    expect(estimate.total).toBe(767.5);
  });

  it("gives a fixed-price node one line and leaves its subtree out", () => {
    const estimate = buildServiceEstimate({
      nodes,
      labor: [{ projectElementId: "boring", description: "Mechanic", hours: 4 }],
      materials: [],
      costs: [],
      laborPrice: 95,
      laborUnit: "HR"
    });
    const cylinders = estimate.nodes.find((node) => node.id === "cylinders")!;
    expect(cylinders.isFixedPrice).toBe(true);
    expect(cylinders.lines).toEqual([
      {
        description: "Cylinders",
        quantity: null,
        unitOfMeasure: null,
        unitPrice: null,
        amount: 500
      }
    ]);
    expect(estimate.nodes.some((node) => node.id === "boring")).toBe(false);
    expect(estimate.total).toBe(500);
  });

  it("adds 0 for a line with no price", () => {
    const estimate = buildServiceEstimate({
      nodes: [nodes[3]!],
      labor: [
        { projectElementId: "transmission", description: "Mechanic", hours: 1 }
      ],
      materials: [],
      costs: [],
      laborPrice: null,
      laborUnit: "HR"
    });
    expect(estimate.nodes[0]!.lines[0]!.unitPrice).toBeNull();
    expect(estimate.total).toBe(0);
  });
});

describe("serviceTemplateIdentifier", () => {
  it("takes TPL- and the first 6 characters after the prefix, in capitals", () => {
    expect(serviceTemplateIdentifier("prj_4f9a2cXyZ")).toBe("TPL-4F9A2C");
  });
});


describe("worstServiceOrderStatus", () => {
  it("puts On Hold first, then the least advanced open status", () => {
    expect(worstServiceOrderStatus(["Completed", "On Hold", "Draft"])).toBe(
      "On Hold"
    );
    expect(worstServiceOrderStatus(["Completed", "In Progress", "Draft"])).toBe(
      "Draft"
    );
    expect(
      worstServiceOrderStatus(["Scheduled", "Planned", "In Progress"])
    ).toBe("Planned");
    expect(worstServiceOrderStatus(["Closed", "Completed"])).toBe("Completed");
    expect(worstServiceOrderStatus(["Cancelled", "Closed"])).toBe("Closed");
    expect(worstServiceOrderStatus([])).toBeNull();
  });
});
