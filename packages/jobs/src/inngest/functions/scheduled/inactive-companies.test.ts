import { describe, expect, it } from "vitest";
import {
  type CompanyCandidate,
  isDueForDeletion,
  selectInactiveCompanies,
  splitByWarning,
  type Warning
} from "./inactive-companies";

const now = Date.parse("2026-10-04T21:00:00Z");
const old = "2026-09-01T00:00:00Z";

const company = (
  id: string,
  overrides: Partial<CompanyCandidate> = {}
): CompanyCandidate => ({
  id,
  name: id,
  createdAt: old,
  companyGroupId: `group-${id}`,
  ...overrides
});

const select = (
  companies: CompanyCandidate[],
  opts: Partial<Parameters<typeof selectInactiveCompanies>[0]> = {}
) =>
  selectInactiveCompanies({
    companies,
    planCompanyIds: new Set(),
    protectedCompanyIds: new Set(),
    protectedGroupIds: new Set(),
    now,
    limit: 100,
    ...opts
  }).map((c) => c.id);

describe("selectInactiveCompanies", () => {
  it("selects a planless company older than a week", () => {
    expect(select([company("a")])).toEqual(["a"]);
  });

  it("keeps a company created within the last week", () => {
    expect(
      select([company("a", { createdAt: "2026-09-30T00:00:00Z" })])
    ).toEqual([]);
  });

  it("keeps a company with a plan row, whatever its status", () => {
    expect(select([company("a")], { planCompanyIds: new Set(["a"]) })).toEqual(
      []
    );
  });

  it("keeps a planless company whose group has a paying company", () => {
    const companies = [
      company("paying", { companyGroupId: "g" }),
      company("second", { companyGroupId: "g" })
    ];
    expect(select(companies, { planCompanyIds: new Set(["paying"]) })).toEqual(
      []
    );
  });

  it("keeps bypassed companies and protected groups", () => {
    const companies = [
      company("bypassed"),
      company("carbon-owned", { companyGroupId: "internal" }),
      company("trial")
    ];
    expect(
      select(companies, {
        protectedCompanyIds: new Set(["bypassed"]),
        protectedGroupIds: new Set(["internal"])
      })
    ).toEqual(["trial"]);
  });

  it("returns the oldest first, capped at the limit", () => {
    const companies = [
      company("newer", { createdAt: "2026-09-10T00:00:00Z" }),
      company("oldest", { createdAt: "2026-08-01T00:00:00Z" }),
      company("middle", { createdAt: "2026-09-05T00:00:00Z" })
    ];
    expect(select(companies, { limit: 2 })).toEqual(["oldest", "middle"]);
  });
});

describe("splitByWarning", () => {
  const split = (warnings: Record<string, Warning>, limit = 100) => {
    const { toWarn, toDelete } = splitByWarning({
      inactive: [company("a"), company("b"), company("c")],
      warnings: new Map(Object.entries(warnings)),
      now,
      limit
    });
    return {
      toWarn: toWarn.map((c) => c.id),
      toDelete: toDelete.map((c) => c.id)
    };
  };

  it("warns a company before it can ever be deleted", () => {
    expect(split({})).toEqual({ toWarn: ["a", "b", "c"], toDelete: [] });
  });

  it("deletes at the next weekly run after the warning, not a week late", () => {
    // Warned a few minutes into last week's run, which started exactly 7 days ago.
    expect(split({ a: { warnedAt: "2026-09-27T21:04:00Z" } }).toDelete).toEqual(
      ["a"]
    );
  });

  it("waits while the warning is recent", () => {
    expect(split({ a: { warnedAt: "2026-10-01T12:00:00Z" } })).toEqual({
      toWarn: ["b", "c"],
      toDelete: []
    });
  });

  it("warns again instead of deleting when the warning has expired", () => {
    expect(split({ a: { warnedAt: "2026-08-01T21:00:00Z" } })).toEqual({
      toWarn: ["a", "b", "c"],
      toDelete: []
    });
  });

  it("puts a company whose last send failed behind the others", () => {
    const failed = { failedAt: "2026-09-27T21:04:00Z" };
    expect(split({ a: failed }, 2).toWarn).toEqual(["b", "c"]);
  });

  it("caps both lists", () => {
    expect(split({}, 2).toWarn).toEqual(["a", "b"]);
  });
});

describe("isDueForDeletion", () => {
  it("needs a live warning at least six days old", () => {
    expect(isDueForDeletion(undefined, now)).toBe(false);
    expect(isDueForDeletion({ failedAt: "2026-09-01T00:00:00Z" }, now)).toBe(
      false
    );
    expect(isDueForDeletion({ warnedAt: "2026-10-01T00:00:00Z" }, now)).toBe(
      false
    );
    expect(isDueForDeletion({ warnedAt: "2026-09-27T21:04:00Z" }, now)).toBe(
      true
    );
    expect(isDueForDeletion({ warnedAt: "2026-08-01T00:00:00Z" }, now)).toBe(
      false
    );
  });
});
