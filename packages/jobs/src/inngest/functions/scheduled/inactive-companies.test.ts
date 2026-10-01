// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

// The weekly run, Sunday 2026-10-04 21:00 UTC.
const clock = { now, today: "2026-10-04" };

describe("splitByWarning", () => {
  const split = (warnings: Record<string, Warning>, limit = 100) => {
    const { toWarn, toDelete } = splitByWarning({
      inactive: [company("a"), company("b"), company("c")],
      warnings: new Map(Object.entries(warnings)),
      clock,
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

  it("deletes on the date the email named", () => {
    // Warned a few minutes into last Sunday's run: the email said 2026-10-04.
    const warning = {
      warnedAt: "2026-09-27T21:04:00Z",
      deleteAfter: "2026-10-04"
    };
    expect(split({ a: warning }).toDelete).toEqual(["a"]);
  });

  it("never deletes before the date the email named", () => {
    // A retry after UTC midnight named Monday, so Sunday's run waits.
    const warning = {
      warnedAt: "2026-09-28T00:10:00Z",
      deleteAfter: "2026-10-05"
    };
    expect(split({ a: warning })).toEqual({
      toWarn: ["b", "c"],
      toDelete: []
    });
  });

  it("warns again instead of deleting when the warning has expired", () => {
    const warning = {
      warnedAt: "2026-08-01T21:00:00Z",
      deleteAfter: "2026-08-08"
    };
    expect(split({ a: warning })).toEqual({
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
  it("needs a live warning whose named date has arrived", () => {
    expect(isDueForDeletion(undefined, clock)).toBe(false);
    expect(isDueForDeletion({ failedAt: "2026-09-01T00:00:00Z" }, clock)).toBe(
      false
    );
    expect(isDueForDeletion({ warnedAt: "2026-09-27T21:04:00Z" }, clock)).toBe(
      false
    );
    expect(
      isDueForDeletion(
        { warnedAt: "2026-09-27T21:04:00Z", deleteAfter: "2026-10-04" },
        clock
      )
    ).toBe(true);
  });
});
