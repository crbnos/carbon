// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildServiceEstimate,
  canMoveServiceOrder,
  canMoveVisit,
  canOverrideCoverage,
  summarizeWork,
  rollUpOrderStatus,
  serviceTemplateIdentifier,
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

