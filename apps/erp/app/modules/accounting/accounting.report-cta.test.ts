// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { applyReportCta } from "./accounting.service";
import { selectReportCompanyIds } from "./accounting.utils";
import type { ChartPeriodSeries } from "./types";
import { NET_INCOME_ACCOUNT_ID, UNPOSTED_CTA_ACCOUNT_ID } from "./types";

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
    currencyCode: null,
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
    ctaJournalBalances: {},
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

// A CTA journal on the elimination entity posted `posted` per bucket:
// Cr the CTA account, Dr the offset account. Cash is unchanged.
function postedChart(posted: [number, number]): ChartPeriodSeries[] {
  return [
    ...chart().map((row) =>
      row.id === "custom-cta"
        ? account("custom-cta", "reserves", "Equity", posted)
        : row
    ),
    account("cta-offset", "reserves", "Equity", [-posted[0], -posted[1]])
  ];
}

// What the CTA journals posted per bucket: Cr the CTA account, Dr the offset.
function ctaJournals(posted: [number, number]) {
  return {
    "2026-07": { "custom-cta": posted[0], "cta-offset": -posted[0] },
    "2026-08": { "custom-cta": posted[1], "cta-offset": -posted[1] }
  };
}

describe("applyReportCta with a posted CTA", () => {
  it("shows the posted CTA once and hides the offset when it is fully posted", () => {
    const { data, error } = applyReportCta(
      base({
        accounts: postedChart([40, 20]),
        ctaJournalBalances: ctaJournals([40, 20])
      })
    );
    expect(error).toBeNull();
    expect(translated(data, "custom-cta")).toEqual([40, 20]);
    expect(data?.some((row) => row.id === "cta-offset")).toBe(false);
    expect(data?.some((row) => row.id === UNPOSTED_CTA_ACCOUNT_ID)).toBe(false);
    expect(translated(data, "equity")).toEqual([160, 80]);
    expect(translated(data, "balance-sheet")).toEqual([0, 0]);
  });

  it("shows the unposted rest on its own line", () => {
    // Report CTA 40 / 20 against 30 posted in both buckets: 10 / −10 unposted.
    const { data } = applyReportCta(
      base({
        accounts: postedChart([30, 30]),
        ctaJournalBalances: ctaJournals([30, 30])
      })
    );
    expect(translated(data, "custom-cta")).toEqual([30, 30]);
    expect(translated(data, UNPOSTED_CTA_ACCOUNT_ID)).toEqual([10, -10]);
    expect(translated(data, "reserves")).toEqual([40, 20]);
    expect(translated(data, "balance-sheet")).toEqual([0, 0]);
  });

  it("shows only the unposted rest in a bucket before the first posting", () => {
    // Nothing posted by July's end; 20 posted in August.
    const accounts = [
      ...chart().map((row) =>
        row.id === "custom-cta"
          ? account("custom-cta", "reserves", "Equity", [0, 20])
          : row
      ),
      account("cta-offset", "reserves", "Equity", [0, -20])
    ];
    const { data } = applyReportCta(
      base({
        accounts,
        ctaJournalBalances: {
          "2026-07": {},
          "2026-08": { "custom-cta": 20, "cta-offset": -20 }
        }
      })
    );
    expect(translated(data, "custom-cta")).toEqual([0, 20]);
    expect(translated(data, UNPOSTED_CTA_ACCOUNT_ID)).toEqual([40, 0]);
    expect(data?.some((row) => row.id === "cta-offset")).toBe(false);
    expect(translated(data, "balance-sheet")).toEqual([0, 0]);
  });

  it("keeps a manual entry on the offset account visible", () => {
    // 5 posted to the offset account by a manual journal, beside the CTA.
    const accounts = postedChart([40, 20]).map((row) =>
      row.id === "cta-offset"
        ? account("cta-offset", "reserves", "Equity", [-40 + 5, -20 + 5])
        : row.id === "cash"
          ? account("cash", "assets", "Asset", [165, 85])
          : row
    );
    const { data } = applyReportCta(
      base({ accounts, ctaJournalBalances: ctaJournals([40, 20]) })
    );
    expect(translated(data, "cta-offset")).toEqual([5, 5]);
    expect(translated(data, "custom-cta")).toEqual([40, 20]);
  });

  it("behaves as before, keeping the offset row, when nothing is posted", () => {
    const withOffset = applyReportCta(
      base({
        accounts: [
          ...chart(),
          account("cta-offset", "reserves", "Equity", [0, 0])
        ]
      })
    );
    expect(translated(withOffset.data, "custom-cta")).toEqual([40, 20]);
    expect(withOffset.data?.some((row) => row.id === "cta-offset")).toBe(true);
    expect(translated(withOffset.data, "balance-sheet")).toEqual([0, 0]);
  });

  it("never changes its input", () => {
    const accounts = postedChart([30, 30]);
    const before = structuredClone(accounts);
    applyReportCta(
      base({ accounts, ctaJournalBalances: ctaJournals([30, 30]) })
    );
    expect(accounts).toEqual(before);
  });
});
