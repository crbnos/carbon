// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  canMoveServiceOrder,
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
