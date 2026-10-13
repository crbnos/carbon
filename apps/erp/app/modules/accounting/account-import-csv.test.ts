// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { parseAccountImportCsv } from "./account-import-csv";

const HEADER = "Number,Name,Class,Type,Group,Carbon Account,Used For";

describe("parseAccountImportCsv", () => {
  it("reads a valid file", () => {
    const csv = [
      HEADER,
      "1200,Accounts Receivable,Asset,Accounts Receivable,Current Assets,1110,Receivables",
      "4000,Product Sales,revenue,,Revenue,4010; 4050,",
      "6010,Office Supplies,Expense,Expense,Operating Expenses,,"
    ].join("\n");
    expect(parseAccountImportCsv(csv)).toEqual({
      errors: null,
      rows: [
        {
          line: 2,
          number: "1200",
          name: "Accounts Receivable",
          class: "Asset",
          accountType: "Accounts Receivable",
          group: "Current Assets",
          carbonAccounts: ["1110"]
        },
        {
          line: 3,
          number: "4000",
          name: "Product Sales",
          class: "Revenue",
          accountType: null,
          group: "Revenue",
          carbonAccounts: ["4010", "4050"]
        },
        {
          line: 4,
          number: "6010",
          name: "Office Supplies",
          class: "Expense",
          accountType: "Expense",
          group: "Operating Expenses",
          carbonAccounts: []
        }
      ]
    });
  });

  it("refuses an empty file", () => {
    expect(parseAccountImportCsv("")).toEqual({
      rows: null,
      errors: [{ code: "empty-file" }]
    });
  });

  it("refuses a file with only a header", () => {
    expect(parseAccountImportCsv(HEADER)).toEqual({
      rows: null,
      errors: [{ code: "empty-file" }]
    });
  });

  it("names the missing columns", () => {
    expect(parseAccountImportCsv("Number,Name\n1,Cash")).toEqual({
      rows: null,
      errors: [
        {
          code: "missing-columns",
          columns: ["Class", "Group", "Carbon Account"]
        }
      ]
    });
  });

  it("reports every row problem with its line", () => {
    const csv = [
      HEADER,
      ",Cash,Asset,,Current Assets,1010,",
      "1020,,Asset,,Current Assets,,",
      "1030,Petty Cash,Asset,,,,",
      "1040,Bank,Assets,,Current Assets,,"
    ].join("\n");
    expect(parseAccountImportCsv(csv)).toEqual({
      rows: null,
      errors: [
        { code: "missing-number", line: 2 },
        { code: "missing-name", line: 3 },
        { code: "missing-group", line: 4 },
        { code: "invalid-class", line: 5, value: "Assets" }
      ]
    });
  });
});
