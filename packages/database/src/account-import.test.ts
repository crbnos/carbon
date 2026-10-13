// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type AccountDefaultsRow,
  type AccountImportContext,
  type AccountUsage,
  assetClassKey,
  type ChartAccount,
  type ChartImportRow,
  type DefaultImportRow,
  FIXED_ASSET_CLASS_COLUMNS,
  normalizeAccountClass,
  normalizeAccountType,
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
  accountType: string,
  active = true
): ChartAccount => ({
  id: `a${number}`,
  number,
  name,
  class: cls,
  accountType,
  incomeBalance:
    cls === "Revenue" || cls === "Expense" ? "Income Statement" : "Balance Sheet",
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
  leaf("1510", "Accumulated Depreciation", "Asset", "fa", "Accumulated Depreciation"),
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
  return [
    ["10000", "Checking", "Asset", "Bank", "Cash & Bank"],
    ["11000", "Accounts Receivable", "Asset", "Accounts Receivable", "Current Assets"],
    ["12000", "Inventory", "Asset", "Inventory", "Current Assets"],
    ["15000", "Buildings", "Asset", "Fixed Asset", "Fixed Assets"],
    ["15100", "Accumulated Depreciation", "Asset", "Accumulated Depreciation", "Fixed Assets"],
    ["30000", "Opening Balance Equity", "Equity", "Equity - No Close", "Equity"],
    ["39000", "Retained Earnings", "Equity", "Retained Earnings", "Equity"],
    ["40000", "Product Sales", "Revenue", "Income", "Revenue"],
    ["60000", "Depreciation", "Expense", "Expense", "Operating Expenses"],
    ["70000", "Other Expense", "Expense", "Other Expense", "Operating Expenses"]
  ].map(([number, name, cls, type, group], i) => ({
    line: i + 2,
    number: number!,
    name: name!,
    class: normalizeAccountClass(cls!),
    accountType: normalizeAccountType(type!),
    group: group!
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
      number: role in overrides ? overrides[role]! : (NUMBER_BY_ROLE[role] ?? "70000")
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
    expect(plan.exceptions).toEqual([]);
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
    expect(plan.deletes.sort()).toEqual(
      ["a1320", "a1900", "a4050", "a4090", "a4140"].sort()
    );
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
    expect(plan.roleMoves).toHaveLength(ACCOUNT_DEFAULT_COLUMNS.length * 2);
    expect(plan.roleMoves).toContainEqual({
      companyId: "c2",
      role: "receivablesAccount",
      toLine: lineOf(chart, "11000")
    });
    expect(plan.assetClassMoves).toContainEqual({
      classId: "fac-c2",
      companyId: "c2",
      column: "assetAccountId",
      toLine: lineOf(chart, "15000")
    });
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
    expect(plan.claims).toContainEqual({ line: lineOf(chart, "10000"), accountId: "a1010" });
    expect(plan.creates.map((c) => c.number)).toEqual(["10010"]);
    expect(plan.roleMoves).toContainEqual({
      companyId: "c1",
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

  it("an unclaimed account still in use needs a target", () => {
    const plan = planAccountImport(
      customerChart(),
      defaultsFile(),
      context({ usage: { a1900: { movableReferencesByCompany: { c2: 3 } } } }),
      NONE
    );
    expect(plan.exceptions).toEqual([
      { code: "account-needs-target", accountId: "a1900", companyIds: ["c2"] }
    ]);
    expect(plan.deletes).not.toContain("a1900");
  });

  it("a picked target merges it, and the review counts the moved records", () => {
    const chart = customerChart();
    const plan = planAccountImport(
      chart,
      defaultsFile(),
      context({ usage: { a1900: { movableReferencesByCompany: { c2: 3 } } } }),
      { targets: { a1900: lineOf(chart, "10000") } }
    );
    expect(plan.exceptions).toEqual([]);
    expect(plan.merges).toContainEqual({
      sourceId: "a1900",
      targetLine: lineOf(chart, "10000")
    });
    expect(plan.companies).toEqual([{ companyId: "c2", repointedReferences: 3 }]);
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
      companyId: "c1",
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
      { line: 50, number: "80000", name: "Interest", class: null, accountType: "Other Expense" as const, group: "Operating Expenses" },
      { line: 51, number: "81000", name: "Mystery", class: null, accountType: null, group: "Operating Expenses" }
    ];
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.creates).toContainEqual(
      expect.objectContaining({ line: 50, class: "Expense", accountType: "Other Expense" })
    );
    expect(plan.errors).toContainEqual({ code: "missing-class", line: 51 });
  });

  it("creates new groups, and refuses a row under a group of the other statement", () => {
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
      { line: 50, number: "4090", name: "Old Sales", class: "Revenue" as const, accountType: "Income" as const, group: "Revenue" }
    ];
    const plan = planAccountImport(chart, defaultsFile(), context(), NONE);
    expect(plan.updates).toContainEqual(
      expect.objectContaining({ accountId: "a4090", number: "4090" })
    );
  });
});

describe("normalizing a chart export", () => {
  it("reads classes and types in the words exports use", () => {
    expect(normalizeAccountClass("Income")).toBe("Revenue");
    expect(normalizeAccountClass("Liabilities")).toBe("Liability");
    expect(normalizeAccountClass("Bogus")).toBeNull();
    expect(normalizeAccountType("accounts receivable (a/r)")).toBe("Accounts Receivable");
    expect(normalizeAccountType("Bank")).toBe("Bank");
    expect(normalizeAccountType("Bogus")).toBeNull();
  });
});
