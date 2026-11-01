// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { applyReportCta } from "./accounting.service";
import { selectReportCompanyIds } from "./accounting.utils";
import type { ChartPeriodSeries } from "./types";
import { NET_INCOME_ACCOUNT_ID } from "./types";

const keys = ["2026-07", "2026-08"];

function account(
  id: string,
  parentId: string | null,
  accountClass: ChartPeriodSeries["class"],
  amounts: [number, number],
  extra: Partial<ChartPeriodSeries> = {}
): ChartPeriodSeries {
  return {
    id,
    parentId,
    class: accountClass,
    name: id,
    number: null,
    active: true,
    companyGroupId: "group",
    isGroup: false,
    isSystem: false,
    incomeBalance: "Balance Sheet",
    accountType: "Equity - No Close",
    consolidatedRate: "Current",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: "user",
    updatedAt: null,
    updatedBy: null,
    customFields: {},
    tags: null,
    periods: Object.fromEntries(
      keys.map((key, index) => [
        key,
        {
          balanceAtDate: 0,
          netChange: 0,
          translatedBalance: amounts[index] ?? 0,
          translatedNetChange: amounts[index] ?? 0
        }
      ])
    ),
    ...extra
  };
}

// Translated cash 160 / 80 against translated income 120 / 60 leaves a CTA of
// 40 / 20 to close the balance sheet. `booked` is CTA already posted to the
// account, which the report adds to rather than replaces.
function chart(booked = 0): ChartPeriodSeries[] {
  return [
    account("balance-sheet", null, "Asset", [40, 20], {
      isGroup: true,
      isSystem: true
    }),
    account("assets", "balance-sheet", "Asset", [160 + booked, 80 + booked], {
      isGroup: true
    }),
    account("cash", "assets", "Asset", [160 + booked, 80 + booked]),
    account("equity", "balance-sheet", "Equity", [120, 60], { isGroup: true }),
    account("reserves", "equity", "Equity", [0, 0], { isGroup: true }),
    account("custom-cta", "reserves", "Equity", [booked, booked]),
    account("other-cta", "reserves", "Equity", [0, 0]),
    account(NET_INCOME_ACCOUNT_ID, "equity", "Equity", [120, 60]),
    account("income-statement", null, "Revenue", [120, 60], {
      incomeBalance: "Income Statement",
      isGroup: true,
      isSystem: true
    }),
    account("sales", "income-statement", "Revenue", [150, 75], {
      incomeBalance: "Income Statement"
    }),
    account("expense", "income-statement", "Expense", [30, 15], {
      incomeBalance: "Income Statement"
    })
  ];
}

function base(overrides: Partial<Parameters<typeof applyReportCta>[0]> = {}) {
  return {
    accounts: chart(),
    bucketKeys: keys,
    ctaByBucket: { "2026-07": 40, "2026-08": 20 },
    companyGroupId: "group",
    ctaAccountId: "custom-cta",
    ...overrides
  };
}

function translated(rows: ChartPeriodSeries[] | null, id: string) {
  const row = rows?.find((r) => r.id === id);
  return keys.map((key) => row?.periods[key]?.translatedBalance);
}

function withCta(change: Partial<ChartPeriodSeries>) {
  return chart().map((row) =>
    row.id === "custom-cta" ? { ...row, ...change } : row
  );
}

describe("applyReportCta", () => {
  it("posts the CTA to the configured account and rolls it up so the balance sheet closes", () => {
    const { data, error } = applyReportCta(base());
    expect(error).toBeNull();
    expect(translated(data, "custom-cta")).toEqual([40, 20]);
    expect(translated(data, "other-cta")).toEqual([0, 0]);
    expect(translated(data, "reserves")).toEqual([40, 20]);
    expect(translated(data, "equity")).toEqual([160, 80]);
    expect(translated(data, "balance-sheet")).toEqual([0, 0]);
  });

  it("adds the report CTA on top of CTA already booked to the account", () => {
    const { data } = applyReportCta(base({ accounts: chart(10) }));
    expect(translated(data, "custom-cta")).toEqual([50, 30]);
    expect(translated(data, "equity")).toEqual([170, 90]);
    expect(translated(data, "balance-sheet")).toEqual([0, 0]);
  });

  it("fills an untranslated net income from the translated income statement", () => {
    // Sales 150 − expense 30 = 120; the raw 80 stays as it was.
    const accounts = chart().map((row) =>
      row.id === NET_INCOME_ACCOUNT_ID
        ? {
            ...row,
            periods: Object.fromEntries(
              keys.map((key) => [key, { netChange: 80, balanceAtDate: 80 }])
            )
          }
        : row
    );
    const { data } = applyReportCta(base({ accounts }));
    const income = data?.find((row) => row.id === NET_INCOME_ACCOUNT_ID);
    expect(income?.periods["2026-07"]).toEqual({
      netChange: 80,
      balanceAtDate: 80,
      translatedBalance: 120,
      translatedNetChange: 120
    });
    expect(translated(data, "balance-sheet")).toEqual([0, 0]);
  });

  it("leaves the input chart untouched and gives the same answer twice", () => {
    const accounts = chart();
    const original = structuredClone(accounts);
    const first = applyReportCta(base({ accounts }));
    const second = applyReportCta(base({ accounts }));
    expect(accounts).toEqual(original);
    expect(second).toEqual(first);
  });

  it.each([
    ["missing from the chart", base({ ctaAccountId: "missing" })],
    ["inactive", base({ accounts: withCta({ active: false }) })],
    ["a group account", base({ accounts: withCta({ isGroup: true }) })],
    ["not Equity", base({ accounts: withCta({ class: "Revenue" }) })],
    [
      "on the income statement",
      base({ accounts: withCta({ incomeBalance: "Income Statement" }) })
    ],
    [
      "in another company group",
      base({ accounts: withCta({ companyGroupId: "other-group" }) })
    ],
    [
      "missing a period cell",
      base({
        accounts: withCta({
          periods: { "2026-07": chart()[5]!.periods["2026-07"]! }
        })
      })
    ],
    ["given no CTA for a period", base({ ctaByBucket: { "2026-07": 40 } })],
    [
      "given a non-finite CTA",
      base({ ctaByBucket: { "2026-07": 40, "2026-08": Number.NaN } })
    ]
  ])("refuses the whole report when the CTA account is %s", (_label, args) => {
    const result = applyReportCta(args);
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe("selectReportCompanyIds", () => {
  const group = ["parent", "child"];

  it.each([
    ["every company for all", "all", ["parent", "child"]],
    ["the named company", "child", ["child"]],
    ["the user's own company with no selection", null, ["parent"]]
  ])("selects %s", (_label, param, expected) => {
    expect(selectReportCompanyIds(param, group, "parent")).toEqual(expected);
  });

  it("refuses a company outside the group", () => {
    expect(selectReportCompanyIds("unrelated", group, "parent")).toBeNull();
  });

  it("refuses all when the group has no companies", () => {
    expect(selectReportCompanyIds("all", [], "parent")).toBeNull();
  });
});
