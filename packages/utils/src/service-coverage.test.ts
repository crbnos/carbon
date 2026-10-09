// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { resolveCoverage } from "./service-coverage";

const fieldVisit = {
  orderType: "Field Visit" as const,
  laborWarrantyEndDate: null,
  partsWarrantyEndDate: null,
  componentPartsWarrantyEndDate: null,
  hasCoverageContract: false
};

describe("resolveCoverage", () => {
  it("bills time after the labor warranty ends", () => {
    expect(
      resolveCoverage({
        ...fieldVisit,
        chargeType: "Time",
        serviceDate: "2028-02-01",
        laborWarrantyEndDate: "2027-11-01",
        partsWarrantyEndDate: "2028-11-01"
      })
    ).toBe("Billable");
  });

  it("covers a part inside the parts warranty", () => {
    expect(
      resolveCoverage({
        ...fieldVisit,
        chargeType: "Part",
        serviceDate: "2028-02-01",
        laborWarrantyEndDate: "2027-11-01",
        partsWarrantyEndDate: "2028-11-01"
      })
    ).toBe("Warranty");
  });

  it("puts time outside warranty on the coverage contract", () => {
    expect(
      resolveCoverage({
        ...fieldVisit,
        chargeType: "Time",
        serviceDate: "2028-02-01",
        laborWarrantyEndDate: "2027-11-01",
        partsWarrantyEndDate: "2028-11-01",
        hasCoverageContract: true
      })
    ).toBe("Contract");
  });

  it("covers a part under the installed component's own warranty", () => {
    expect(
      resolveCoverage({
        ...fieldVisit,
        chargeType: "Part",
        serviceDate: "2029-01-10",
        laborWarrantyEndDate: "2027-11-01",
        partsWarrantyEndDate: "2028-11-01",
        componentPartsWarrantyEndDate: "2029-06-01"
      })
    ).toBe("Warranty");
  });

  it("never covers an expense by warranty", () => {
    expect(
      resolveCoverage({
        ...fieldVisit,
        chargeType: "Expense",
        serviceDate: "2027-06-01",
        laborWarrantyEndDate: "2027-11-01",
        partsWarrantyEndDate: "2028-11-01"
      })
    ).toBe("Billable");
  });

  it("capitalizes every Refurbishment charge", () => {
    expect(
      resolveCoverage({
        ...fieldVisit,
        orderType: "Refurbishment",
        chargeType: "Time",
        serviceDate: "2027-06-01",
        laborWarrantyEndDate: "2027-11-01",
        hasCoverageContract: true
      })
    ).toBe("Capitalized");
  });
});
