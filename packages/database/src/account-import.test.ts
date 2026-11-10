// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type AccountDefaultsRow,
  type AccountImportContext,
  type AccountType,
  type AccountUsage,
  assetClassKey,
  assetClassLabel,
  type ChartAccount,
  type ChartImportRow,
  type DefaultImportRow,
  FIXED_ASSET_CLASS_COLUMNS,
  incomeBalanceOf,
  isApplicable,
  planAccountImport,
  requiredRoles
} from "./account-import";
import { ACCOUNT_DEFAULT_COLUMNS } from "./accounting-cutover/shared";

const group = (
  id: string,
  name: string,
  cls: ChartAccount["class"],
  incomeBalance: ChartAccount["incomeBalance"],
  parentId: string | null,
  isSystem = false
): ChartAccount => ({
  id,
  number: null,
  name,
  class: cls,
  accountType: null,
  incomeBalance,
  parentId,
  isGroup: true,
  isSystem,
  active: true
});

const leaf = (
  number: string,
  name: string,
  cls: NonNullable<ChartAccount["class"]>,
  parentId: string,
  accountType: AccountType,
  active = true
): ChartAccount => ({
  id: `a${number}`,
  number,
  name,
  class: cls,
  accountType,
  incomeBalance: incomeBalanceOf(cls),
  parentId,
  isGroup: false,
  isSystem: false,
  active
});

/** Carbon's chart before the import. */
const CHART: ChartAccount[] = [
  group("bs", "Balance Sheet", null, "Balance Sheet", null, true),
  group("is", "Income Statement", null, "Income Statement", null, true),
  group("ca", "Current Assets", "Asset", "Balance Sheet", "bs"),
  group("fa", "Fixed Assets", "Asset", "Balance Sheet", "bs"),
  group("eq", "Equity", "Equity", "Balance Sheet", "bs"),
  group("rev", "Revenue", "Revenue", "Income Statement", "is"),
  group("exp", "Expenses", "Expense", "Income Statement", "is"),
  leaf("1010", "Bank - Cash", "Asset", "ca", "Bank"),
  leaf("1110", "Receivables", "Asset", "ca", "Accounts Receivable"),
  leaf("1310", "Raw Materials", "Asset", "ca", "Inventory"),
  leaf("1320", "Finished Goods", "Asset", "ca", "Inventory"),
  leaf("1500", "Buildings", "Asset", "fa", "Fixed Asset"),
  leaf(
    "1510",
    "Accumulated Depreciation",
    "Asset",
    "fa",
    "Accumulated Depreciation"
  ),
  leaf("1900", "Petty Cash", "Asset", "ca", "Cash"),
  leaf("3400", "Migration Clearing", "Equity", "eq", "Equity - No Close"),
  leaf("3900", "Retained Earnings", "Equity", "eq", "Retained Earnings"),
  leaf("4010", "Sales", "Revenue", "rev", "Income"),
  leaf("4050", "Shipping Revenue", "Revenue", "rev", "Income"),
  leaf("4090", "Old Sales", "Revenue", "rev", "Income", false),
  leaf("4140", "Gain on Disposal", "Revenue", "rev", "Other Income"),
  leaf("6310", "Depreciation Expense", "Expense", "exp", "Expense"),
  leaf("6320", "Loss on Disposal", "Expense", "exp", "Other Expense")
];

function defaults(): AccountDefaultsRow {
  const row = Object.fromEntries(
    ACCOUNT_DEFAULT_COLUMNS.map((c) => [c, null])
  ) as AccountDefaultsRow;
  row.salesAccount = "a4010";
  row.salesShippingRevenueAccount = "a4050";
  row.receivablesAccount = "a1110";
  row.bankCashAccount = "a1010";
  row.bankLocalCurrencyAccount = "a1010";
  row.rawMaterialsAccount = "a1310";
  row.finishedGoodsAccount = "a1320";
  row.retainedEarningsAccount = "a3900";
  row.migrationClearingAccount = "a3400";
  return row;
}

function context(
  overrides: {
    usage?: Record<string, Partial<AccountUsage>>;
    cutover?: boolean;
  } = {}
): AccountImportContext {
  return {
    chart: CHART,
    companies: [
      { id: "c1", name: "One", hasCutover: overrides.cutover ?? false },
      { id: "c2", name: "Two", hasCutover: false }
    ],
    defaultsByCompany: { c1: defaults(), c2: defaults() },
    fixedAssetClasses: ["c1", "c2"].map((companyId) => ({
      id: `fac-${companyId}`,
      companyId,
      name: "Buildings",
      accounts: {
        assetAccountId: "a1500",
        accumulatedDepreciationAccountId: "a1510",
        depreciationExpenseAccountId: "a6310",
        writeOffAccountId: "a6320",
        writeDownAccountId: "a6320",
        lossOnDisposalAccountId: "a6320",
        gainOnDisposalAccountId: "a4140"
      }
    })),
    usage: Object.fromEntries(
      Object.entries(overrides.usage ?? {}).map(([id, u]) => [
        id,
        { movableReferencesByCompany: {}, historyReferences: 0, ...u }
      ])
    ),
    importingCompanyId: "c1"
  };
}

/** The customer's chart of accounts. */
function customerChart(): ChartImportRow[] {
  const rows: [string, string, AccountType, string][] = [
    ["10000", "Checking", "Bank", "Cash & Bank"],
    ["11000", "Accounts Receivable", "Accounts Receivable", "Current Assets"],
    ["12000", "Inventory", "Inventory", "Current Assets"],
    ["15000", "Buildings", "Fixed Asset", "Fixed Assets"],
    [
      "15100",
      "Accumulated Depreciation",
      "Accumulated Depreciation",
      "Fixed Assets"
    ],
    ["30000", "Opening Balance Equity", "Equity - No Close", "Equity"],
    ["39000", "Retained Earnings", "Retained Earnings", "Equity"],
    ["40000", "Product Sales", "Income", "Revenue"],
    ["60000", "Depreciation", "Expense", "Operating Expenses"],
    ["70000", "Other Expense", "Other Expense", "Operating Expenses"]
  ];
  return rows.map(([number, name, accountType, group], i) => ({
    line: i + 2,
    number,
    name,
    class: null,
    accountType,
    group
  }));
}

const NUMBER_BY_ROLE: Record<string, string> = {
  salesAccount: "40000",
  salesShippingRevenueAccount: "40000",
  receivablesAccount: "11000",
  bankCashAccount: "10000",
  bankLocalCurrencyAccount: "10000",
  rawMaterialsAccount: "12000",
  finishedGoodsAccount: "12000",
  retainedEarningsAccount: "39000",
  migrationClearingAccount: "30000"
};

const NUMBER_BY_ASSET_COLUMN: Record<string, string> = {
  assetAccountId: "15000",
  accumulatedDepreciationAccountId: "15100",
  depreciationExpenseAccountId: "60000",
  writeOffAccountId: "70000",
  writeDownAccountId: "70000",
  lossOnDisposalAccountId: "70000",
  gainOnDisposalAccountId: "40000"
};

/** A complete default accounts file: every role and class account. */
function defaultsFile(
  overrides: Record<string, string | null> = {}
): DefaultImportRow[] {
  const rows: DefaultImportRow[] = [];
  let line = 2;
  for (const role of ACCOUNT_DEFAULT_COLUMNS) {
    rows.push({
      line: line++,
      key: role,
      number:
        role in overrides ? overrides[role]! : (NUMBER_BY_ROLE[role] ?? "70000")
    });
  }
  for (const column of FIXED_ASSET_CLASS_COLUMNS) {
    const k = assetClassKey("Buildings", column);
    rows.push({
      line: line++,
      key: k,
      number: k in overrides ? overrides[k]! : NUMBER_BY_ASSET_COLUMN[column]!
    });
  }
  return rows;
}

const NONE = { targets: {} };
const lineOf = (rows: ChartImportRow[], number: string) =>
  rows.find((r) => r.number === number)!.line;

describe("planAccountImport", () => {
  it("updates the accounts behind the defaults and deletes the rest", () => {
    const chart = customerChart();
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.errors).toEqual([]);
    expect(plan.replacements).toEqual([]);
    expect(isApplicable(plan)).toBe(true);
    const claimed = Object.fromEntries(
      plan.claims.map((c) => [
        chart.find((r) => r.line === c.line)!.number,
        c.accountId
      ])
    );
    expect(claimed).toEqual({
      "10000": "a1010",
      "11000": "a1110",
      "12000": "a1310",
      "15000": "a1500",
      "15100": "a1510",
      "30000": "a3400",
      "39000": "a3900",
      "40000": "a4010",
      "60000": "a6310",
      "70000": "a6320"
    });
    expect(plan.merges).toEqual([
      { sourceId: "a1320", targetLine: lineOf(chart, "12000") },
      { sourceId: "a4050", targetLine: lineOf(chart, "40000") },
      { sourceId: "a4140", targetLine: lineOf(chart, "40000") }
    ]);
    // A merged account is not a plain delete.
    expect(plan.deletes.sort()).toEqual(["a1900", "a4090"]);
    expect(plan.creates).toEqual([]);
    // A kept account takes the customer number and name.
    expect(plan.updates.find((u) => u.accountId === "a3900")).toMatchObject({
      number: "39000",
      name: "Retained Earnings"
    });
  });

  it("sets every default of every company from the file", () => {
    const chart = customerChart();
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.roleMoves).toHaveLength(ACCOUNT_DEFAULT_COLUMNS.length);
    expect(plan.roleMoves).toContainEqual({
      role: "receivablesAccount",
      toLine: lineOf(chart, "11000")
    });
    expect(plan.assetClassMoves.map((m) => m.classId)).toEqual([
      "fac-c1",
      "fac-c2"
    ]);
    expect(plan.assetClassMoves[1]?.toLines.assetAccountId).toBe(
      lineOf(chart, "15000")
    );
  });

  it("a Carbon account behind two defaults becomes the first one's account", () => {
    const chart = [
      ...customerChart(),
      {
        line: 50,
        number: "10010",
        name: "Payroll Checking",
        class: "Asset" as const,
        accountType: "Bank" as const,
        group: "Cash & Bank"
      }
    ];
    const plan = planAccountImport(
      chart,
      defaultsFile({ bankLocalCurrencyAccount: "10010" }),
      context(),
      NONE
    );
    expect(plan.errors).toEqual([]);
    expect(plan.claims).toContainEqual({
      line: lineOf(chart, "10000"),
      accountId: "a1010"
    });
    expect(plan.creates.map((c) => c.number)).toEqual(["10010"]);
    expect(plan.roleMoves).toContainEqual({
      role: "bankLocalCurrencyAccount",
      toLine: 50
    });
  });

  it("a Carbon account whose number is in the chart is kept", () => {
    const chart = [
      ...customerChart(),
      {
        line: 50,
        number: "1900",
        name: "Petty Cash",
        class: "Asset" as const,
        accountType: "Cash" as const,
        group: "Cash & Bank"
      }
    ];
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.claims).toContainEqual({ line: 50, accountId: "a1900" });
    expect(plan.deletes).not.toContain("a1900");
    expect(plan.creates).toEqual([]);
  });

  it("an unclaimed account still in use needs a replacement", () => {
    const plan = planAccountImport(
      customerChart(),
      defaultsFile(),
      context({ usage: { a1900: { movableReferencesByCompany: { c2: 3 } } } }),
      NONE
    );
    expect(plan.replacements).toEqual([
      { accountId: "a1900", companyIds: ["c2"], targetLine: null }
    ]);
    expect(plan.deletes).not.toContain("a1900");
    expect(isApplicable(plan)).toBe(false);
  });

  it("a picked target merges it, and the review counts the moved records", () => {
    const chart = customerChart();
    const plan = planAccountImport(
      chart,
      defaultsFile(),
      context({ usage: { a1900: { movableReferencesByCompany: { c2: 3 } } } }),
      { targets: { a1900: lineOf(chart, "10000") } }
    );
    // The pick stays on the list, so the review can show and change it.
    expect(plan.replacements).toEqual([
      {
        accountId: "a1900",
        companyIds: ["c2"],
        targetLine: lineOf(chart, "10000")
      }
    ]);
    expect(isApplicable(plan)).toBe(true);
    expect(plan.merges).toContainEqual({
      sourceId: "a1900",
      targetLine: lineOf(chart, "10000")
    });
    expect(plan.companies).toEqual([
      { companyId: "c2", repointedReferences: 3 }
    ]);
  });

  it("refuses a target line that is not in the chart", () => {
    const plan = planAccountImport(
      customerChart(),
      defaultsFile(),
      context({ usage: { a1900: { movableReferencesByCompany: { c1: 1 } } } }),
      { targets: { a1900: 999 } }
    );
    expect(plan.errors).toContainEqual({
      code: "target-not-in-chart",
      accountId: "a1900",
      line: 999
    });
  });

  it("refuses to delete an account with posted history", () => {
    const plan = planAccountImport(
      customerChart(),
      defaultsFile(),
      context({ usage: { a4050: { historyReferences: 2 } } }),
      NONE
    );
    expect(plan.errors).toContainEqual({
      code: "account-has-history",
      accountId: "a4050"
    });
  });

  it("refuses once any company of the group has activated accounting", () => {
    const plan = planAccountImport(
      customerChart(),
      defaultsFile(),
      context({ cutover: true }),
      NONE
    );
    expect(plan.errors).toEqual([
      { code: "accounting-activated", companyId: "c1" }
    ]);
    expect(plan.updates).toEqual([]);
  });

  it("refuses duplicate numbers and names in the chart", () => {
    const chart = customerChart();
    chart[1] = { ...chart[1]!, number: "10000" };
    chart[2] = { ...chart[2]!, name: "Checking" };
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "duplicate-number",
      line: chart[1]!.line,
      firstLine: chart[0]!.line,
      value: "10000"
    });
    expect(plan.errors).toContainEqual({
      code: "duplicate-name",
      line: chart[2]!.line,
      firstLine: chart[0]!.line,
      value: "Checking"
    });
  });

  it("refuses a default whose number is not in the chart", () => {
    const plan = planAccountImport(
      customerChart(),
      defaultsFile({ receivablesAccount: "99999" }),
      context(),
      NONE
    );
    expect(plan.errors).toContainEqual(
      expect.objectContaining({ code: "default-not-in-chart", value: "99999" })
    );
    expect(plan.errors.some((e) => e.code === "default-missing")).toBe(false);
  });

  it("refuses a required default left blank, and allows a fallback one", () => {
    expect(requiredRoles()).not.toContain("scrapAccount");
    const plan = planAccountImport(
      customerChart(),
      defaultsFile({ receivablesAccount: null, scrapAccount: null }),
      context(),
      NONE
    );
    expect(plan.errors).toEqual([
      { code: "default-missing", key: "receivablesAccount" }
    ]);
    expect(plan.roleMoves).toContainEqual({
      role: "scrapAccount",
      toLine: null
    });
  });

  it("refuses a missing fixed asset class account", () => {
    const rows = defaultsFile().filter(
      (r) => r.key !== assetClassKey("Buildings", "assetAccountId")
    );
    const plan = planAccountImport(customerChart(), rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "default-missing",
      key: assetClassKey("Buildings", "assetAccountId")
    });
  });

  it("reads a default by its label, and refuses an unknown one", () => {
    const rows = defaultsFile().map((r) =>
      r.key === "receivablesAccount" ? { ...r, key: "Receivables" } : r
    );
    rows.push({ line: 999, key: "Not A Default", number: "10000" });
    const plan = planAccountImport(customerChart(), rows, context(), NONE);
    expect(plan.errors).toEqual([
      { code: "unknown-default", line: 999, value: "Not A Default" }
    ]);
  });

  it("creates a chart row nobody claimed, and needs its class", () => {
    const chart = [
      ...customerChart(),
      {
        line: 50,
        number: "80000",
        name: "Interest",
        class: null,
        accountType: "Other Expense" as const,
        group: "Operating Expenses"
      },
      {
        line: 51,
        number: "81000",
        name: "Mystery",
        class: null,
        accountType: null,
        group: "Operating Expenses"
      }
    ];
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.creates).toContainEqual(
      expect.objectContaining({
        line: 50,
        class: "Expense",
        accountType: "Other Expense"
      })
    );
    expect(plan.errors).toContainEqual({ code: "missing-class", line: 51 });
  });

  it("creates new groups, and refuses a row under a group of another class", () => {
    const chart = customerChart();
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.groupCreates).toEqual([
      { name: "Cash & Bank", class: "Asset" },
      { name: "Operating Expenses", class: "Expense" }
    ]);
    chart[7] = { ...chart[7]!, group: "Balance Sheet" };
    const bad = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(bad.errors).toContainEqual({
      code: "group-class-mismatch",
      line: chart[7]!.line,
      group: "Balance Sheet"
    });
  });

  it("Migration Clearing must land on an Equity account", () => {
    const chart = customerChart();
    const plan = planAccountImport(
      chart,
      defaultsFile({ migrationClearingAccount: "70000" }),
      context(),
      NONE
    );
    expect(plan.errors).toContainEqual({
      code: "migration-clearing-not-equity",
      line: lineOf(chart, "70000")
    });
  });

  it("reactivates a kept account that was inactive", () => {
    const chart = [
      ...customerChart(),
      {
        line: 50,
        number: "4090",
        name: "Old Sales",
        class: "Revenue" as const,
        accountType: "Income" as const,
        group: "Revenue"
      }
    ];
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.updates).toContainEqual(
      expect.objectContaining({ accountId: "a4090", number: "4090" })
    );
  });

  it("refuses a duplicate default key", () => {
    const rows = defaultsFile();
    rows.push({ line: 999, key: "receivablesAccount", number: "11000" });
    const plan = planAccountImport(customerChart(), rows, context(), NONE);
    expect(plan.errors).toEqual([
      {
        code: "duplicate-default",
        line: 999,
        firstLine: rows.find((r) => r.key === "receivablesAccount")!.line,
        key: "receivablesAccount"
      }
    ]);
  });

  it("reads a fixed asset class account by its label", () => {
    const k = assetClassKey("Buildings", "assetAccountId");
    const rows = defaultsFile().map((r) =>
      r.key === k
        ? { ...r, key: assetClassLabel("Buildings", "assetAccountId") }
        : r
    );
    const plan = planAccountImport(customerChart(), rows, context(), NONE);
    expect(plan.errors).toEqual([]);
  });

  it("keeps a claimed account's type when the row gives none", () => {
    const chart = customerChart().map((r) =>
      r.number === "10000" ? { ...r, accountType: null } : r
    );
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.errors).toEqual([]);
    // 1010 is Asset / Bank: the class comes from it, and so does the type.
    expect(plan.updates.find((u) => u.accountId === "a1010")).toMatchObject({
      class: "Asset",
      accountType: "Bank"
    });
  });

  it("resets the type when the row moves a claimed account to another class", () => {
    const chart = customerChart().map((r) =>
      r.number === "10000"
        ? {
            ...r,
            class: "Liability" as const,
            accountType: null,
            group: "Liabilities"
          }
        : r
    );
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.updates.find((u) => u.accountId === "a1010")).toMatchObject({
      class: "Liability",
      accountType: "Other Current Liability"
    });
  });

  it("leaves an unchanged account out of the updates", () => {
    const chart: ChartImportRow[] = [
      ...customerChart(),
      {
        line: 50,
        number: "1900",
        name: "Petty Cash",
        class: "Asset",
        accountType: "Cash",
        group: "Current Assets"
      }
    ];
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.claims).toContainEqual({ line: 50, accountId: "a1900" });
    expect(plan.updates.map((u) => u.accountId)).not.toContain("a1900");
  });

  it("refuses a row whose type belongs to another class", () => {
    const chart = customerChart().map((r) =>
      r.number === "60000"
        ? { ...r, class: "Asset" as const, group: "Current Assets" }
        : r
    );
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "class-type-mismatch",
      line: lineOf(chart, "60000"),
      class: "Asset",
      accountType: "Expense"
    });
  });

  it("refuses a row under an existing group of another class", () => {
    const chart = customerChart().map((r) =>
      r.number === "15000" ? { ...r, group: "Current Assets" } : r
    );
    expect(
      planAccountImport(chart, defaultsFile(), context(), NONE).errors
    ).toEqual([]);
    const liability = customerChart().map((r) =>
      r.number === "11000"
        ? {
            ...r,
            class: "Liability" as const,
            accountType: "Accounts Payable" as const
          }
        : r
    );
    expect(
      planAccountImport(liability, defaultsFile(), context(), NONE).errors
    ).toContainEqual({
      code: "group-class-mismatch",
      line: lineOf(liability, "11000"),
      group: "Current Assets"
    });
  });

  it("refuses a new group that would hold two classes", () => {
    const chart: ChartImportRow[] = [
      ...customerChart(),
      {
        line: 50,
        number: "20000",
        name: "Payables",
        class: "Liability",
        accountType: "Accounts Payable",
        group: "Cash & Bank"
      }
    ];
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "group-class-mismatch",
      line: 50,
      group: "Cash & Bank"
    });
  });

  it("deletes a leaf with no number", () => {
    const ctx = context();
    ctx.chart = [
      ...CHART,
      {
        ...leaf("0", "Unnumbered", "Asset", "ca", "Cash"),
        id: "a-none",
        number: null
      }
    ];
    const plan = planAccountImport(customerChart(), defaultsFile(), ctx, NONE);
    expect(plan.deletes).toContain("a-none");
  });

  it("a replacement may merge into a created row", () => {
    const chart: ChartImportRow[] = [
      ...customerChart(),
      {
        line: 50,
        number: "10500",
        name: "Undeposited Funds",
        class: "Asset",
        accountType: "Other Current Asset",
        group: "Cash & Bank"
      }
    ];
    const plan = planAccountImport(
      chart,
      defaultsFile(),
      context({ usage: { a1900: { movableReferencesByCompany: { c1: 1 } } } }),
      { targets: { a1900: 50 } }
    );
    expect(plan.creates.map((c) => c.line)).toContain(50);
    expect(plan.merges).toContainEqual({ sourceId: "a1900", targetLine: 50 });
  });

  it("counts the moved records of each company", () => {
    const chart = customerChart();
    const plan = planAccountImport(
      chart,
      defaultsFile(),
      context({
        usage: {
          a4050: { movableReferencesByCompany: { c1: 2, c2: 1 } },
          a1320: { movableReferencesByCompany: { c2: 4 } }
        }
      }),
      NONE
    );
    expect(plan.companies).toEqual([
      { companyId: "c1", repointedReferences: 2 },
      { companyId: "c2", repointedReferences: 5 }
    ]);
  });
});
