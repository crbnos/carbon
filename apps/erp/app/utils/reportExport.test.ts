import { describe, expect, it } from "vitest";
import { isReportSourceComplete, resolveReportCompanies } from "./reportExport";

describe("isReportSourceComplete", () => {
  it("accepts source arrays below the PostgREST row cap", () => {
    expect(isReportSourceComplete([], new Array(999))).toBe(true);
  });

  it("rejects null or undefined required sources", () => {
    expect(isReportSourceComplete(null, [])).toBe(false);
    expect(isReportSourceComplete([], undefined)).toBe(false);
  });

  it("rejects an export when any source reaches the PostgREST row cap", () => {
    expect(isReportSourceComplete(new Array(999), new Array(1000))).toBe(false);
  });
});

describe("resolveReportCompanies", () => {
  const companies = [{ id: "company-1" }, { id: "company-2" }];

  it("resolves all companies only from a complete exact-count source", () => {
    expect(
      resolveReportCompanies(
        { data: companies, count: companies.length, error: null },
        "all",
        "company-1"
      )
    ).toEqual({
      companies,
      selectedCompanyIds: ["company-1", "company-2"],
      isComplete: true
    });
  });

  it.each([
    {
      name: "query error",
      source: { data: companies, count: companies.length, error: {} }
    },
    {
      name: "null data",
      source: { data: null, count: 0, error: null }
    },
    {
      name: "missing exact count",
      source: { data: companies, count: null, error: null }
    },
    {
      name: "partial result",
      source: { data: companies, count: companies.length + 1, error: null }
    },
    {
      name: "omitted current company",
      source: { data: [companies[1]], count: 1, error: null }
    },
    {
      name: "row-cap result",
      source: {
        data: new Array(1000).fill({ id: "company" }),
        count: 1000,
        error: null
      }
    }
  ])("fails closed for all-company selection on $name", ({ source }) => {
    const result = resolveReportCompanies(source, "all", "company-1");

    expect(result.isComplete).toBe(false);
    expect(result.selectedCompanyIds).toBeNull();
  });

  it("keeps single-company selection available but marks exports incomplete", () => {
    expect(
      resolveReportCompanies(
        { data: companies, count: companies.length + 1, error: null },
        null,
        "company-1"
      )
    ).toEqual({
      companies,
      selectedCompanyIds: ["company-1"],
      isComplete: false
    });
  });

  it("resolves an explicit company only when it is in the complete source", () => {
    expect(
      resolveReportCompanies(
        { data: companies, count: companies.length, error: null },
        "company-2",
        "company-1"
      ).selectedCompanyIds
    ).toEqual(["company-2"]);
  });

  it("fails closed for an explicit company outside the authorized source", () => {
    expect(
      resolveReportCompanies(
        { data: companies, count: companies.length, error: null },
        "company-other",
        "company-1"
      ).selectedCompanyIds
    ).toBeNull();
  });

  it("fails closed for an explicit company when metadata is incomplete", () => {
    expect(
      resolveReportCompanies(
        { data: companies, count: companies.length + 1, error: null },
        "company-2",
        "company-1"
      ).selectedCompanyIds
    ).toBeNull();
  });
});
