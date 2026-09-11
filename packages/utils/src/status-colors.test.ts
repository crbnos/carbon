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
