// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  AccountDefaultsRow,
  AccountImportContext,
  ChartAccount
} from "@carbon/database/account-import";
import { encodeCsv } from "@carbon/files/csv";
import { describe, expect, it } from "vitest";
import {
  CHART_CSV_COLUMNS,
  chartTemplate,
  defaultAccountsTemplate,
  normalizeAccountClass,
  normalizeAccountType,
  parseChartCsv,
  parseDefaultsCsv
} from "./account-import-csv";

describe("parseChartCsv", () => {
  it("reads Carbon's own columns", () => {
    const csv = [
      "Number,Name,Class,Type,Group",
      "1200,Accounts Receivable,Asset,Accounts Receivable,Current Assets",
      "4000,Product Sales,revenue,,Revenue"
    ].join("\n");
    expect(parseChartCsv(csv)).toEqual({
      errors: null,
      rows: [
        {
          line: 2,
          number: "1200",
          name: "Accounts Receivable",
          class: "Asset",
          accountType: "Accounts Receivable",
          group: "Current Assets"
        },
        {
          line: 3,
          number: "4000",
          name: "Product Sales",
          class: "Revenue",
          accountType: null,
          group: "Revenue"
        }
      ]
    });
  });

  it("reads an export's column names and a type in the class column", () => {
    const csv = [
      "Account Number,Account Name,Account Type,Detail Type,Parent Grouping",
      "1010,Operating Bank,Bank,Checking,Cash",
      "2000,Trade Payables,Accounts Payable (A/P),,Current Liabilities"
    ].join("\n");
    expect(parseChartCsv(csv).rows).toEqual([
      {
        line: 2,
        number: "1010",
        name: "Operating Bank",
        class: "Asset",
        accountType: "Bank",
        group: "Cash"
      },
      {
        line: 3,
        number: "2000",
        name: "Trade Payables",
        class: "Liability",
        accountType: "Accounts Payable",
        group: "Current Liabilities"
      }
    ]);
  });

  it("leaves out inactive accounts", () => {
    const csv = [
      "Code,Name,Category,Group,Status",
      "1010,Bank,Asset,Cash,Active",
      "1020,Old Bank,Asset,Cash,Inactive"
    ].join("\n");
    expect(parseChartCsv(csv).rows?.map((row) => row.number)).toEqual(["1010"]);
  });

  it("skips blank and comma-only rows, and names the real line", () => {
    const csv = [
      "Number,Name,Class,Group",
      "1010,Bank,Asset,Cash",
      ",,,",
      "",
      "1020,,Asset,Cash"
    ].join("\n");
    expect(parseChartCsv(csv).errors).toEqual([
      { code: "missing-name", line: 5 }
    ]);
  });

  it("uses the first of two columns with the same header", () => {
    const csv = ["Number,Name,Group,Group", "1010,Bank,Cash,Other"].join("\n");
    expect(parseChartCsv(csv).rows?.[0]?.group).toBe("Cash");
  });

  it("refuses an empty file and a file with only a header", () => {
    expect(parseChartCsv("").errors).toEqual([{ code: "empty-file" }]);
    expect(parseChartCsv("Number,Name,Group").errors).toEqual([
      { code: "empty-file" }
    ]);
  });

  it("names the columns it cannot find", () => {
    expect(parseChartCsv("Number,Description\n1,Cash").errors).toEqual([
      { code: "missing-columns", columns: ["Group"] }
    ]);
  });

  it("reports every bad row with its line", () => {
    const csv = [
      "Number,Name,Class,Group",
      ",Cash,Asset,Cash",
      "1100,,Asset,",
      "1200,Receivables,Furniture,Current Assets"
    ].join("\n");
    expect(parseChartCsv(csv).errors).toEqual([
      { code: "missing-number", line: 2 },
      { code: "missing-name", line: 3 },
      { code: "missing-group", line: 3 },
      { code: "invalid-class", line: 4, value: "Furniture" }
    ]);
  });
});

describe("parseDefaultsCsv", () => {
  it("reads the template, a blank number as null", () => {
    const csv = [
      "Key,Default,Current Account,Account Number",
      "receivablesAccount,Receivables,1110 Accounts Receivable,1200",
      "prepaymentAccount,Prepayments,1250 Prepayments,"
    ].join("\n");
    expect(parseDefaultsCsv(csv)).toEqual({
      errors: null,
      rows: [
        { line: 2, key: "receivablesAccount", number: "1200" },
        { line: 3, key: "prepaymentAccount", number: null }
      ]
    });
  });

  it("takes the label when the file has no key column", () => {
    const csv = ["Default,Account Number", "Receivables,1200"].join("\n");
    expect(parseDefaultsCsv(csv).rows).toEqual([
      { line: 2, key: "Receivables", number: "1200" }
    ]);
  });

  it("refuses a file without the account number column", () => {
    expect(parseDefaultsCsv("Key,Number\nreceivablesAccount,1").errors).toEqual(
      [{ code: "missing-columns", columns: ["Account Number"] }]
    );
  });

  it("refuses a row with no key", () => {
    expect(parseDefaultsCsv("Key,Account Number\n,1200").errors).toEqual([
      { code: "missing-key", line: 2 }
    ]);
  });
});

describe("defaultAccountsTemplate", () => {
  const account = (id: string, number: string, name: string): ChartAccount => ({
    id,
    number,
    name,
    class: "Asset",
    accountType: "Other Current Asset",
    incomeBalance: "Balance Sheet",
    parentId: null,
    isGroup: false,
    isSystem: false,
    active: true
  });
  const classAccounts = (accountId: string) => ({
    assetAccountId: accountId,
    accumulatedDepreciationAccountId: accountId,
    depreciationExpenseAccountId: accountId,
    writeOffAccountId: accountId,
    writeDownAccountId: accountId,
    lossOnDisposalAccountId: accountId,
    gainOnDisposalAccountId: accountId
  });
  const ctx: AccountImportContext = {
    chart: [
      account("a1", "1110", "Receivables"),
      account("a2", "1500", "PP&E")
    ],
    companies: [
      { id: "c1", name: "Parent", hasCutover: false },
      { id: "c2", name: "Child", hasCutover: false }
    ],
    defaultsByCompany: {
      c1: { receivablesAccount: "a1" } as AccountDefaultsRow
    },
    fixedAssetClasses: [
      {
        id: "f2",
        companyId: "c2",
        name: "Vehicles",
        accounts: classAccounts("a1")
      },
      {
        id: "f1",
        companyId: "c1",
        name: "Vehicles",
        accounts: classAccounts("a2")
      }
    ],
    usage: {},
    importingCompanyId: "c1"
  };

  it("names the current account of each default, the number left blank", () => {
    const rows = defaultAccountsTemplate(ctx);
    expect(rows.find((row) => row.Key === "receivablesAccount")).toEqual({
      Key: "receivablesAccount",
      Default: "Receivables",
      Required: "Yes",
      "Current Account": "1110 Receivables",
      "Account Number": ""
    });
  });

  it("lists each class name once, with the importing company's accounts", () => {
    const classRows = defaultAccountsTemplate(ctx).filter((row) =>
      row.Key.startsWith("asset-class:")
    );
    expect(classRows).toHaveLength(7);
    expect(classRows[0]).toEqual({
      Key: "asset-class:Vehicles:assetAccountId",
      Default: "Vehicles – Asset",
      Required: "Yes",
      "Current Account": "1500 PP&E",
      "Account Number": ""
    });
  });
});

describe("chartTemplate", () => {
  const account = (
    id: string,
    number: string,
    name: string,
    extra: Partial<ChartAccount> = {}
  ): ChartAccount => ({
    id,
    number,
    name,
    class: "Asset",
    accountType: "Bank",
    incomeBalance: "Balance Sheet",
    parentId: "g1",
    isGroup: false,
    isSystem: false,
    active: true,
    ...extra
  });
  const ctx: AccountImportContext = {
    chart: [
      account("a2", "1110", "Receivables", {
        accountType: "Accounts Receivable"
      }),
      account("g1", "1000", "Current Assets", {
        isGroup: true,
        parentId: null
      }),
      account("a1", "1020", "Checking"),
      account("a3", "1030", "Old Bank", { active: false })
    ],
    companies: [{ id: "c1", name: "Parent", hasCutover: false }],
    defaultsByCompany: {},
    fixedAssetClasses: [],
    usage: {},
    importingCompanyId: "c1"
  };

  it("lists the active accounts by number, under their group", () => {
    expect(chartTemplate(ctx)).toEqual([
      {
        "Account Number": "1020",
        "Account Name": "Checking",
        Class: "Asset",
        Type: "Bank",
        Group: "Current Assets"
      },
      {
        "Account Number": "1110",
        "Account Name": "Receivables",
        Class: "Asset",
        Type: "Accounts Receivable",
        Group: "Current Assets"
      }
    ]);
  });

  it("reads back through the chart parser", () => {
    const csv = encodeCsv(chartTemplate(ctx), {
      fields: [...CHART_CSV_COLUMNS]
    });
    const parsed = parseChartCsv(csv);
    expect(parsed.errors).toBeNull();
    expect(parsed.rows?.map((r) => [r.number, r.class, r.accountType])).toEqual(
      [
        ["1020", "Asset", "Bank"],
        ["1110", "Asset", "Accounts Receivable"]
      ]
    );
  });
});

describe("normalizing a chart export", () => {
  it("reads classes and types in the words exports use", () => {
    expect(normalizeAccountClass("Income")).toBe("Revenue");
    expect(normalizeAccountClass("Liabilities")).toBe("Liability");
    expect(normalizeAccountClass("Bogus")).toBeNull();
    expect(normalizeAccountType("accounts receivable (a/r)")).toBe(
      "Accounts Receivable"
    );
    expect(normalizeAccountType("Bank")).toBe("Bank");
    expect(normalizeAccountType("Bogus")).toBeNull();
  });
});
