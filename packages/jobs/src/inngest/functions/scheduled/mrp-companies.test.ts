import { describe, expect, it } from "vitest";
import { selectCompaniesForMrp } from "./mrp-companies";

const companies = [
  { id: "c1", name: "Acme" },
  { id: "c2", name: "Globex" },
  { id: "c3", name: "Initech" }
];

describe("selectCompaniesForMrp", () => {
  it("plans for a company with no companyPlan row", () => {
    // The regression: an empty companyPlan table meant MRP ran for nobody.
    expect(selectCompaniesForMrp(companies, [])).toEqual(companies);
  });

  it("plans for every company when there are no plans to consider", () => {
    // null = not Cloud, or the plan lookup failed.
    expect(selectCompaniesForMrp(companies, null)).toEqual(companies);
  });

  it("skips a cancelled company", () => {
    const result = selectCompaniesForMrp(companies, [
      { id: "c2", stripeSubscriptionStatus: "Canceled" }
    ]);
    expect(result.map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("still plans for active, inactive and unknown-status companies", () => {
    const result = selectCompaniesForMrp(companies, [
      { id: "c1", stripeSubscriptionStatus: "Active" },
      { id: "c2", stripeSubscriptionStatus: "Inactive" },
      { id: "c3", stripeSubscriptionStatus: null }
    ]);
    expect(result).toEqual(companies);
  });

  it("ignores a plan row for a company that no longer exists", () => {
    const result = selectCompaniesForMrp(companies, [
      { id: "gone", stripeSubscriptionStatus: "Canceled" }
    ]);
    expect(result).toEqual(companies);
  });

  it("returns nothing when every company is cancelled", () => {
    const result = selectCompaniesForMrp(
      companies,
      companies.map((c) => ({ id: c.id, stripeSubscriptionStatus: "Canceled" }))
    );
    expect(result).toEqual([]);
  });
});
