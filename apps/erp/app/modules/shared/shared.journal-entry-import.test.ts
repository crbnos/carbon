// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type JournalEntryImportLookups,
  planJournalEntryImport,
  readJournalEntryRow
} from "./journal-entry-import";

const record = (overrides: Record<string, string> = {}) => ({
  journalReference: "GJ-1",
  postingDate: "2026-03-31",
  accountNumber: "1000",
  debit: "250.00",
  credit: "",
  description: "",
  journalDescription: "",
  status: "Draft",
  ...overrides
});

// GJ-1: rent paid from the bank. GJ-2: a cash sale.
const file = (): Record<string, string>[] => [
  record({ accountNumber: "6100", debit: "250", description: "March rent" }),
  record({ accountNumber: "1000", debit: "", credit: "250" }),
  record({
    journalReference: "GJ-2",
    postingDate: "2026-04-02",
    accountNumber: "1000",
    debit: "99.5"
  }),
  record({
    journalReference: "GJ-2",
    postingDate: "2026-04-02",
    accountNumber: "4000",
    debit: "",
    credit: "99.5",
    journalDescription: "Counter sale"
  })
];

const lookups = (
  overrides: Partial<JournalEntryImportLookups> = {}
): JournalEntryImportLookups => ({
  accountIdByNumber: new Map([
    ["1000", "acc-bank"],
    ["4000", "acc-sales"],
    ["6100", "acc-rent"]
  ]),
  dimensions: new Map([["dim-region", { name: "Region" }]]),
  dimensionValueIds: new Map([
    [
      "dim-region",
      new Map([
        ["north", ["dv-north"]],
        ["south", ["dv-south-1", "dv-south-2"]]
      ])
    ]
  ]),
  periods: [
    { startDate: "2026-03-01", endDate: "2026-03-31", closeStatus: "Open" },
    { startDate: "2026-04-01", endDate: "2026-04-30", closeStatus: "Open" }
  ],
  hasCutover: true,
  importedReferences: new Map(),
  ...overrides
});

describe("readJournalEntryRow", () => {
  it("reads a debit line", () => {
    expect(
      readJournalEntryRow(record({ description: " Rent ", status: "Posted" }))
    ).toEqual({
      row: {
        reference: "GJ-1",
        postingDate: "2026-03-31",
        accountNumber: "1000",
        debit: 250,
        credit: 0,
        description: "Rent",
        journalDescription: "",
        status: "Posted",
        dimensions: []
      }
    });
  });

  it("reads a blank status as a Draft, as a new manual entry starts", () => {
    const read = readJournalEntryRow(record({ status: "" }));
    expect("row" in read && read.row.status).toBe("Draft");
  });

  it.each([["31/03/2026"], ["2026-02-30"], [""]])(
    "refuses the posting date %s",
    (postingDate) => {
      expect(readJournalEntryRow(record({ postingDate }))).toEqual({
        error: "Posting Date must be a date as YYYY-MM-DD"
      });
    }
  );

  it.each([
    ["both a debit and a credit", { debit: "10", credit: "10" }],
    ["neither", { debit: "", credit: "0" }]
  ])("refuses a line with %s", (_, amounts) => {
    expect(readJournalEntryRow(record(amounts))).toEqual({
      error: "Each line must have either a debit or credit amount"
    });
  });

  it("refuses a negative amount and an amount with a comma", () => {
    expect(readJournalEntryRow(record({ debit: "-250" }))).toEqual({
      error: "Debit must be a number of 0 or more"
    });
    expect(
      "error" in readJournalEntryRow(record({ debit: "", credit: "1,250.00" }))
    ).toBe(true);
  });

  it("tags nothing for a dimension chosen with no value", () => {
    expect(readJournalEntryRow(record({ dimension1: "dim-region" }))).toEqual({
      row: expect.objectContaining({ dimensions: [] })
    });
  });

  it("refuses a dimension value with no dimension", () => {
    expect(readJournalEntryRow(record({ dimension2Value: "North" }))).toEqual({
      error:
        "Dimension 2 Value has no dimension. Choose the dimension for Dimension 2"
    });
  });
});

describe("planJournalEntryImport", () => {
  it("groups rows by reference into balanced journals, in file order", () => {
    expect(planJournalEntryImport(file(), lookups())).toEqual({
      journals: [
        {
          reference: "GJ-1",
          rows: [0, 1],
          postingDate: "2026-03-31",
          // No Journal Description: the reference names the journal.
          description: "GJ-1",
          status: "Draft",
          lines: [
            {
              accountId: "acc-rent",
              description: "March rent",
              debit: 250,
              credit: 0,
              dimensions: []
            },
            {
              accountId: "acc-bank",
              description: undefined,
              debit: 0,
              credit: 250,
              dimensions: []
            }
          ]
        },
        {
          reference: "GJ-2",
          rows: [2, 3],
          postingDate: "2026-04-02",
          description: "Counter sale",
          status: "Draft",
          lines: [
            {
              accountId: "acc-bank",
              description: undefined,
              debit: 99.5,
              credit: 0,
              dimensions: []
            },
            {
              accountId: "acc-sales",
              description: undefined,
              debit: 0,
              credit: 99.5,
              dimensions: []
            }
          ]
        }
      ],
      errors: [],
      skipped: []
    });
  });

  it("refuses an unbalanced journal whole and imports the others", () => {
    const rows = file();
    rows[3] = { ...rows[3]!, credit: "95.5" };
    const plan = planJournalEntryImport(rows, lookups());
    expect(plan.journals.map((j) => j.reference)).toEqual(["GJ-1"]);
    expect(plan.errors).toEqual([
      {
        row: 2,
        reason: "Journal GJ-2 does not balance: debits 99.5, credits 95.5"
      },
      {
        row: 3,
        reason: "Journal GJ-2 does not balance: debits 99.5, credits 95.5"
      }
    ]);
  });

  it("refuses an unknown account on its row and holds back the rest of its journal", () => {
    const rows = file();
    rows[0] = { ...rows[0]!, accountNumber: "6999" };
    const plan = planJournalEntryImport(rows, lookups());
    expect(plan.journals.map((j) => j.reference)).toEqual(["GJ-2"]);
    expect(plan.errors).toEqual([
      {
        row: 0,
        reason: 'Account "6999" was not found in the chart of accounts'
      },
      {
        row: 1,
        reason: "Not imported: another row of journal GJ-1 needs fixing"
      }
    ]);
  });

  it("refuses a journal dated in a Closed period with the period message", () => {
    const plan = planJournalEntryImport(
      file(),
      lookups({
        periods: [
          {
            startDate: "2026-03-01",
            endDate: "2026-03-31",
            closeStatus: "Closed"
          }
        ]
      })
    );
    expect(plan.journals.map((j) => j.reference)).toEqual(["GJ-2"]);
    expect(plan.errors.map((e) => e.reason)).toEqual([
      "Journal GJ-1: Accounting period is closed. Reopen it before posting.",
      "Journal GJ-1: Accounting period is closed. Reopen it before posting."
    ]);
  });

  it("imports into a Locked period, as a manual journal posts there", () => {
    const plan = planJournalEntryImport(
      file().map((row) => ({ ...row, status: "Posted" })),
      lookups({
        periods: [
          {
            startDate: "2026-03-01",
            endDate: "2026-03-31",
            closeStatus: "Locked"
          }
        ]
      })
    );
    expect(plan.journals.map((j) => j.reference)).toEqual(["GJ-1", "GJ-2"]);
    expect(plan.errors).toEqual([]);
  });

  it("refuses a Posted journal before the accounting cutover, not a Draft", () => {
    const rows = file();
    rows[2] = { ...rows[2]!, status: "Posted" };
    rows[3] = { ...rows[3]!, status: "Posted" };
    const plan = planJournalEntryImport(rows, lookups({ hasCutover: false }));
    expect(plan.journals.map((j) => j.reference)).toEqual(["GJ-1"]);
    expect(plan.errors.map((e) => e.row)).toEqual([2, 3]);
  });

  it("refuses a journal whose rows disagree on the posting date", () => {
    const rows = file();
    rows[1] = { ...rows[1]!, postingDate: "2026-03-30" };
    expect(planJournalEntryImport(rows, lookups()).errors).toEqual([
      { row: 0, reason: "Journal GJ-1 has rows with different posting dates" },
      { row: 1, reason: "Journal GJ-1 has rows with different posting dates" }
    ]);
  });

  it("skips a reference a previous import wrote", () => {
    const plan = planJournalEntryImport(
      file(),
      lookups({ importedReferences: new Map([["GJ-1", "JE000042"]]) })
    );
    expect(plan.journals.map((j) => j.reference)).toEqual(["GJ-2"]);
    expect(plan.skipped).toEqual([
      { row: 0, reason: "Journal GJ-1 was imported before as JE000042" },
      { row: 1, reason: "Journal GJ-1 was imported before as JE000042" }
    ]);
  });

  it("tags a line with a dimension value found by name", () => {
    const rows = file();
    rows[0] = {
      ...rows[0]!,
      dimension1: "dim-region",
      dimension1Value: " NORTH "
    };
    const plan = planJournalEntryImport(rows, lookups());
    expect(plan.journals[0]?.lines[0]?.dimensions).toEqual([
      { dimensionId: "dim-region", valueId: "dv-north" }
    ]);
  });

  it.each([
    ["West", 'Region "West" was not found'],
    ["South", 'Region "South" matches more than one value']
  ])("refuses the dimension value %s", (value, reason) => {
    const rows = file();
    rows[0] = { ...rows[0]!, dimension1: "dim-region", dimension1Value: value };
    expect(planJournalEntryImport(rows, lookups()).errors[0]).toEqual({
      row: 0,
      reason
    });
  });
});
