// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  mapRemoteTrialBalance,
  parseQboTrialBalance,
  parseReportAmount,
  parseXeroTrialBalance,
  type QboTrialBalanceResponse,
  type RemoteTrialBalanceRow,
  splitXeroAccountLabel,
  type XeroReportCell,
  type XeroTrialBalanceResponse
} from "./trial-balance";

function xeroCells(
  accountId: string | null,
  values: [string, string, string, string, string]
): XeroReportCell[] {
  return values.map((value) => ({
    Value: value,
    Attributes: accountId ? [{ Value: accountId, Id: "account" }] : undefined
  }));
}

// Shaped like Xero's documented example (Reports/TrialBalance): a header row,
// one Section per account class, a Retained Earnings row carrying extra
// fromDate/toDate attributes, and a trailing Section holding the Total.
// Columns deliberately reordered against the docs to prove they are found
// by title, not position.
const XERO_FIXTURE: XeroTrialBalanceResponse = {
  Reports: [
    {
      ReportName: "Trial Balance",
      ReportType: "TrialBalance",
      Rows: [
        {
          RowType: "Header",
          Cells: [
            { Value: "Account" },
            { Value: "Debit" },
            { Value: "Credit" },
            { Value: "YTD Credit" },
            { Value: "YTD Debit" }
          ]
        },
        {
          RowType: "Section",
          Title: "Revenue",
          Rows: [
            {
              RowType: "Row",
              Cells: xeroCells("acc-sales", [
                "Sales (400)",
                "",
                "200.00",
                "1020.22",
                ""
              ])
            }
          ]
        },
        {
          RowType: "Section",
          Title: "Expenses",
          Rows: [
            {
              RowType: "Row",
              Cells: xeroCells("acc-rent", [
                "Rent (469)",
                "40.00",
                "",
                "",
                "480.00"
              ])
            }
          ]
        },
        {
          RowType: "Section",
          Title: "Assets",
          Rows: [
            {
              RowType: "Row",
              Cells: xeroCells("acc-bank", [
                "Business Bank (090)",
                "0.00",
                "",
                "",
                "1,340.22"
              ])
            },
            {
              // An overdrawn asset shows its balance in the credit column.
              RowType: "Row",
              Cells: xeroCells("acc-clearing", [
                "Card Clearing (8002)",
                "",
                "",
                "100.00",
                ""
              ])
            }
          ]
        },
        {
          RowType: "Section",
          Title: "Equity",
          Rows: [
            {
              RowType: "Row",
              Cells: [
                {
                  Value: "Retained Earnings (320)",
                  Attributes: [
                    { Value: "acc-re", Id: "account" },
                    { Value: "", Id: "fromDate" },
                    { Value: "12/31/2025", Id: "toDate" }
                  ]
                },
                { Value: "" },
                { Value: "" },
                { Value: "700.00" },
                { Value: "" }
              ]
            },
            {
              // A computed line with no account attribute.
              RowType: "Row",
              Cells: xeroCells(null, [
                "Unrealised Currency Gains",
                "",
                "",
                "",
                "0.00"
              ])
            }
          ]
        },
        {
          RowType: "Section",
          Title: "",
          Rows: [
            {
              RowType: "SummaryRow",
              Cells: [
                { Value: "Total" },
                { Value: "40.00" },
                { Value: "200.00" },
                { Value: "1820.22" },
                { Value: "1820.22" }
              ]
            }
          ]
        }
      ]
    }
  ]
};

describe("parseReportAmount", () => {
  it("reads blanks as zero, separators and accounting negatives", () => {
    expect(parseReportAmount("")).toBe(0);
    expect(parseReportAmount(undefined)).toBe(0);
    expect(parseReportAmount("1,234.50")).toBe(1234.5);
    expect(parseReportAmount("(12.30)")).toBe(-12.3);
    expect(parseReportAmount("-5")).toBe(-5);
  });

  it("refuses an unreadable value rather than reading it as zero", () => {
    expect(() => parseReportAmount("abc")).toThrow(/Unreadable/);
  });
});

describe("splitXeroAccountLabel", () => {
  it("splits the trailing code off the name", () => {
    expect(splitXeroAccountLabel("Sales (400)")).toEqual({
      name: "Sales",
      code: "400"
    });
    expect(splitXeroAccountLabel("Retained Earnings")).toEqual({
      name: "Retained Earnings",
      code: null
    });
  });
});

describe("parseXeroTrialBalance", () => {
  it("reads YTD Debit − YTD Credit per account, found by header title", () => {
    const rows = parseXeroTrialBalance(XERO_FIXTURE);

    expect(rows).toEqual([
      {
        externalId: "acc-sales",
        code: "400",
        name: "Sales",
        debitSigned: -1020.22
      },
      { externalId: "acc-rent", code: "469", name: "Rent", debitSigned: 480 },
      {
        externalId: "acc-bank",
        code: "090",
        name: "Business Bank",
        debitSigned: 1340.22
      },
      {
        externalId: "acc-clearing",
        code: "8002",
        name: "Card Clearing",
        debitSigned: -100
      },
      {
        externalId: "acc-re",
        code: "320",
        name: "Retained Earnings",
        debitSigned: -700
      },
      {
        externalId: null,
        code: null,
        name: "Unrealised Currency Gains",
        debitSigned: 0
      }
    ]);

    // The YTD columns are the balanced pair.
    const net = rows.reduce((sum, row) => sum + row.debitSigned, 0);
    expect(Math.abs(net)).toBeLessThan(1e-9);
  });

  it("refuses a report without YTD columns", () => {
    expect(() =>
      parseXeroTrialBalance({
        Reports: [
          {
            Rows: [
              {
                RowType: "Header",
                Cells: [{ Value: "Account" }, { Value: "Debit" }]
              }
            ]
          }
        ]
      })
    ).toThrow(/YTD/);
  });

  it("refuses a response with no report", () => {
    expect(() => parseXeroTrialBalance({ Reports: [] })).toThrow();
  });
});

// Shaped like QBO's TrialBalance report: an Account column plus Debit and
// Credit Money columns, Data rows nested inside Sections, a Section Summary,
// and the GrandTotal section.
const QBO_FIXTURE: QboTrialBalanceResponse = {
  Header: { ReportName: "TrialBalance", EndPeriod: "2026-09-30" },
  Columns: {
    Column: [
      { ColTitle: "", ColType: "Account" },
      { ColTitle: "Debit", ColType: "Money" },
      { ColTitle: "Credit", ColType: "Money" }
    ]
  },
  Rows: {
    Row: [
      {
        type: "Data",
        ColData: [
          { value: "Checking", id: "35" },
          { value: "1201.00" },
          { value: "" }
        ]
      },
      {
        type: "Section",
        Header: {
          ColData: [
            { value: "Utilities", id: "24" },
            { value: "" },
            { value: "" }
          ]
        },
        Rows: {
          Row: [
            {
              type: "Data",
              ColData: [
                { value: "Utilities:Gas and Electric", id: "76" },
                { value: "200.00" },
                { value: "" }
              ]
            },
            {
              type: "Data",
              ColData: [
                { value: "Utilities:Telephone", id: "77" },
                { value: "74.36" },
                { value: "" }
              ]
            }
          ]
        },
        Summary: {
          ColData: [
            { value: "Total Utilities" },
            { value: "274.36" },
            { value: "" }
          ]
        }
      },
      {
        type: "Data",
        ColData: [
          { value: "Accounts Payable (A/P)", id: "33" },
          { value: "" },
          { value: "1,475.36" }
        ]
      },
      {
        type: "Data",
        ColData: [
          { value: "Opening Balance Adjustment" },
          { value: "" },
          { value: "0.00" }
        ]
      },
      {
        type: "Section",
        group: "GrandTotal",
        Summary: {
          ColData: [
            { value: "TOTAL" },
            { value: "1475.36" },
            { value: "1475.36" }
          ]
        }
      }
    ]
  }
};

describe("parseQboTrialBalance", () => {
  it("walks nested rows and skips section headers, summaries and the grand total", () => {
    expect(parseQboTrialBalance(QBO_FIXTURE)).toEqual([
      { externalId: "35", code: null, name: "Checking", debitSigned: 1201 },
      {
        externalId: "76",
        code: null,
        name: "Utilities:Gas and Electric",
        debitSigned: 200
      },
      {
        externalId: "77",
        code: null,
        name: "Utilities:Telephone",
        debitSigned: 74.36
      },
      {
        externalId: "33",
        code: null,
        name: "Accounts Payable (A/P)",
        debitSigned: -1475.36
      },
      {
        externalId: null,
        code: null,
        name: "Opening Balance Adjustment",
        debitSigned: 0
      }
    ]);
  });

  it("finds Debit and Credit by title when the columns are reordered", () => {
    const rows = parseQboTrialBalance({
      Columns: {
        Column: [
          { ColTitle: "" },
          { ColTitle: "Credit" },
          { ColTitle: "Debit" }
        ]
      },
      Rows: {
        Row: [
          {
            ColData: [
              { value: "Sales", id: "1" },
              { value: "50" },
              { value: "" }
            ]
          }
        ]
      }
    });
    expect(rows[0]?.debitSigned).toBe(-50);
  });

  it("refuses a report without Debit and Credit columns", () => {
    expect(() =>
      parseQboTrialBalance({ Columns: { Column: [{ ColTitle: "Amount" }] } })
    ).toThrow(/Debit and Credit/);
  });
});

describe("mapRemoteTrialBalance", () => {
  const accounts = [
    { id: "a-bank", number: "1000", isGroup: false, active: true },
    { id: "a-ar", number: "1100", isGroup: false, active: true },
    { id: "a-sales", number: "4000", isGroup: false, active: true },
    { id: "a-sales-2", number: "4010", isGroup: false, active: true },
    { id: "a-re", number: "3200", isGroup: false, active: true },
    { id: "a-rent", number: "6100", isGroup: false, active: true },
    { id: "a-old", number: "6200", isGroup: false, active: false },
    { id: "a-group", number: "6000", isGroup: true, active: true },
    { id: "a-dup-1", number: "7000", isGroup: false, active: true },
    { id: "a-dup-2", number: "7000", isGroup: false, active: true }
  ];

  const row = (
    externalId: string | null,
    code: string | null,
    name: string,
    debitSigned: number
  ): RemoteTrialBalanceRow => ({ externalId, code, name, debitSigned });

  it("resolves by mapping, then mapped code, then account number", () => {
    const result = mapRemoteTrialBalance(
      [
        row("x-bank", "090", "Bank", 1500),
        row(null, "200", "Receivables", 250),
        row("x-unknown", "6100", "Rent", 75.5),
        row("x-re", "320", "Retained Earnings", -1825.5)
      ],
      [
        { accountId: "a-bank", externalId: "x-bank", externalCode: "090" },
        { accountId: "a-ar", externalId: "x-ar", externalCode: "200" },
        { accountId: "a-re", externalId: "x-re", externalCode: "320" }
      ],
      accounts
    );

    expect(result.lines).toEqual([
      { accountId: "a-bank", debit: 1500, credit: 0 },
      { accountId: "a-ar", debit: 250, credit: 0 },
      { accountId: "a-rent", debit: 75.5, credit: 0 },
      { accountId: "a-re", debit: 0, credit: 1825.5 }
    ]);
    expect(result.unmapped).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("sums several remote accounts that land on one Carbon account", () => {
    const result = mapRemoteTrialBalance(
      [
        row("x-s1", "400", "Product Sales", -100.1),
        row("x-s2", "410", "Service Sales", -200.2),
        row("x-s3", "420", "Refunds", 50.05)
      ],
      [
        { accountId: "a-sales", externalId: "x-s1", externalCode: "400" },
        { accountId: "a-sales", externalId: "x-s2", externalCode: "410" },
        { accountId: "a-sales", externalId: "x-s3", externalCode: "420" }
      ],
      accounts
    );

    expect(result.lines).toEqual([
      { accountId: "a-sales", debit: 0, credit: 250.25 }
    ]);
  });

  it("drops a Carbon account whose remote rows net to zero", () => {
    const result = mapRemoteTrialBalance(
      [row("x-s1", null, "A", 10), row("x-s2", null, "B", -10)],
      [
        { accountId: "a-sales", externalId: "x-s1", externalCode: null },
        { accountId: "a-sales", externalId: "x-s2", externalCode: null }
      ],
      accounts
    );
    expect(result.lines).toEqual([]);
  });

  it("does not guess when one remote account maps to several Carbon accounts", () => {
    const result = mapRemoteTrialBalance(
      [row("x-sales", "400", "Sales", -500)],
      [
        { accountId: "a-sales", externalId: "x-sales", externalCode: "400" },
        { accountId: "a-sales-2", externalId: "x-sales", externalCode: "400" }
      ],
      accounts
    );

    expect(result.lines).toEqual([]);
    expect(result.ambiguous).toEqual([
      {
        externalId: "x-sales",
        code: "400",
        name: "Sales",
        amount: -500,
        accountIds: ["a-sales", "a-sales-2"]
      }
    ]);
  });

  it("treats a duplicated Carbon account number as ambiguous", () => {
    const result = mapRemoteTrialBalance(
      [row("x-7", "7000", "Other", 12)],
      [],
      accounts
    );
    expect(result.ambiguous[0]?.accountIds).toEqual(["a-dup-1", "a-dup-2"]);
  });

  it("returns what it cannot place as unmapped, skipping zero balances", () => {
    const result = mapRemoteTrialBalance(
      [
        row("x-none", "999", "Suspense", 42),
        row(null, null, "Unrealised Currency Gains", -3),
        row("x-zero", "998", "Empty", 0),
        // Inactive and group accounts are not targets, by mapping or number.
        row("x-old", "6200", "Old Expense", 9),
        row(null, "6000", "Expense Group", 8)
      ],
      [{ accountId: "a-old", externalId: "x-old", externalCode: "6200" }],
      accounts
    );

    expect(result.lines).toEqual([]);
    expect(result.unmapped).toEqual([
      { externalId: "x-none", code: "999", name: "Suspense", amount: 42 },
      {
        externalId: null,
        code: null,
        name: "Unrealised Currency Gains",
        amount: -3
      },
      { externalId: "x-old", code: "6200", name: "Old Expense", amount: 9 },
      { externalId: null, code: "6000", name: "Expense Group", amount: 8 }
    ]);
  });

  it("rounds once, after summing", () => {
    const result = mapRemoteTrialBalance(
      [row("x-a", null, "A", 0.1), row("x-b", null, "B", 0.2)],
      [
        { accountId: "a-bank", externalId: "x-a", externalCode: null },
        { accountId: "a-bank", externalId: "x-b", externalCode: null }
      ],
      accounts
    );
    expect(result.lines).toEqual([
      { accountId: "a-bank", debit: 0.3, credit: 0 }
    ]);
  });
});
