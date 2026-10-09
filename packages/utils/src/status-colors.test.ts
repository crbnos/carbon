// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { statusColorMaps } from "./status-colors";

const maps = statusColorMaps as Record<string, Record<string, string>>;

describe("return order status colors", () => {
  it("matches the RMA status badges", () => {
    expect(maps.salesReturnOrder).toEqual({
      Draft: "gray",
      "To Receive": "blue",
      Completed: "green",
      Cancelled: "red"
    });
  });

  it("matches the supplier return status badges", () => {
    expect(maps.purchaseReturnOrder).toEqual({
      Draft: "gray",
      "To Ship": "blue",
      Completed: "green",
      Cancelled: "red"
    });
  });
});

describe("project status colors", () => {
  it("registers the project lifecycle for the docs status widget", () => {
    expect(maps.project).toEqual({
      Draft: "gray",
      Released: "blue",
      "On Hold": "orange",
      "Technically Complete": "green",
      Closed: "gray"
    });
  });
});

describe("field service status colors", () => {
  it("registers the service order lifecycle", () => {
    expect(maps.serviceOrder).toEqual({
      Draft: "gray",
      Scheduled: "blue",
      "In Progress": "yellow",
      "On Hold": "orange",
      Completed: "green",
      Closed: "gray",
      Cancelled: "red"
    });
  });

  it("registers the visit and customer asset statuses", () => {
    expect(maps.serviceVisit).toEqual({
      Scheduled: "blue",
      Traveling: "yellow",
      "On Site": "yellow",
      Completed: "green",
      Cancelled: "red"
    });
    expect(maps.customerAsset).toEqual({
      "In Service": "green",
      "At Depot": "orange",
      Returned: "gray"
    });
  });

  it("registers the billable item statuses", () => {
    expect(maps.billableItem).toEqual({
      Unbilled: "blue",
      "On Hold": "orange",
      Billed: "green",
      "Written Off": "gray"
    });
  });
});
