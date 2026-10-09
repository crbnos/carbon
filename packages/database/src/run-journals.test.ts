// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The run journal builders shared by the ERP's run posters
// (accounting.server.ts) and the enable's legacy backfill (legacy/runs.ts),
// against the lines `postDepreciationRun`, `postDisposal` and
// `postRevenueRecognitionRun` write.

import { describe, expect, it } from "vitest";
import {
  buildDeferredTaxJournals,
  buildDepreciationJournals,
  buildDisposalJournal,
  buildRecognitionJournals,
  type DepreciationRunLine,
  deferredTaxSettings,
  type RecognitionScheduleRow,
  type RecognitionSources,
  recognitionAccountWithoutClass
} from "./run-journals.ts";

function runLine(overrides: Partial<DepreciationRunLine>): DepreciationRunLine {
  return {
    id: "line-1",
    monthEnd: "2026-10-31",
    amount: 100,
    taxAmount: null,
    assetReadableId: "FA-1",
    locationId: "loc-1",
    fixedAssetClassId: "class-1",
    depreciationExpenseAccountId: "expense",
    accumulatedDepreciationAccountId: "accumulated",
    ...overrides
  };
}

const lineShape = (
  lines: { accountId: string; amount: number; description: string }[]
) =>
  lines.map(({ accountId, amount, description }) => ({
    accountId,
    amount,
    description
  }));

describe("buildDepreciationJournals", () => {
  it("writes one journal per line with a book amount", () => {
    const built = buildDepreciationJournals([
      runLine({}),
      runLine({ id: "line-2", amount: 0, taxAmount: 40 })
    ]);
    expect(built).toHaveLength(1);
    const [journal] = built as [(typeof built)[number]];
    expect(journal).toMatchObject({
      lineId: "line-1",
      monthEnd: "2026-10-31",
      description: "Depreciation: FA-1",
      sourceType: "Asset Depreciation"
    });
    expect(lineShape(journal.lines)).toEqual([
      {
        accountId: "expense",
        amount: 100,
        description: "Depreciation Expense"
      },
      {
        accountId: "accumulated",
        amount: -100,
        description: "Accumulated Depreciation"
      }
    ]);
    expect(journal.lines[0]!.dimensions).toEqual({
      Location: "loc-1",
      FixedAssetClass: "class-1"
    });
  });
});

describe("deferredTaxSettings", () => {
  it("is null unless tax depreciation is on with a rate and both accounts", () => {
    const on = {
      enabled: true,
      taxRate: 25,
      dtlAccountId: "dtl",
      dtExpenseAccountId: "dt-expense"
    };
    expect(deferredTaxSettings(on)).toEqual({
      taxRate: 25,
      dtlAccountId: "dtl",
      dtExpenseAccountId: "dt-expense"
    });
    expect(deferredTaxSettings({ ...on, enabled: false })).toBeNull();
    expect(deferredTaxSettings({ ...on, taxRate: 0 })).toBeNull();
    expect(deferredTaxSettings({ ...on, dtlAccountId: null })).toBeNull();
    expect(deferredTaxSettings({ ...on, dtExpenseAccountId: null })).toBeNull();
  });
});

describe("buildDeferredTaxJournals", () => {
  const settings = {
    taxRate: 25,
    dtlAccountId: "dtl",
    dtExpenseAccountId: "dt-expense"
  };

  it("writes none with tax depreciation off", () => {
    expect(
      buildDeferredTaxJournals({
        runReadableId: "DEP-1",
        lines: [runLine({ taxAmount: 150 })],
        settings: null
      })
    ).toEqual([]);
  });

  it("books the month's temporary difference per month", () => {
    const built = buildDeferredTaxJournals({
      runReadableId: "DEP-1",
      lines: [
        runLine({ taxAmount: 150 }),
        runLine({ id: "line-2", amount: 50, taxAmount: 50 }),
        runLine({ id: "line-3", monthEnd: "2026-11-30", taxAmount: 60 })
      ],
      settings
    });
    expect(
      built.map(({ lineIds, monthEnd }) => ({ lineIds, monthEnd }))
    ).toEqual([
      { lineIds: ["line-1", "line-2"], monthEnd: "2026-10-31" },
      { lineIds: ["line-3"], monthEnd: "2026-11-30" }
    ]);
    // Tax ahead of book by 50 at 25%: a liability of 12.5.
    expect(built[0]).toMatchObject({
      description: "Deferred Tax: Depreciation DEP-1",
      sourceType: "Asset Depreciation"
    });
    expect(lineShape(built[0]!.lines)).toEqual([
      {
        accountId: "dt-expense",
        amount: 12.5,
        description: "Deferred Tax Expense"
      },
      {
        accountId: "dtl",
        amount: 12.5,
        description: "Deferred Tax Liability"
      }
    ]);
    // Book ahead of tax by 40: the liability unwinds by 10.
    expect(lineShape(built[1]!.lines)).toEqual([
      { accountId: "dtl", amount: -10, description: "Deferred Tax Liability" },
      {
        accountId: "dt-expense",
        amount: -10,
        description: "Deferred Tax Benefit"
      }
    ]);
  });

  it("counts a missing tax amount as 0", () => {
    const [journal] = buildDeferredTaxJournals({
      runReadableId: "DEP-1",
      lines: [runLine({})],
      settings
    });
    expect(lineShape(journal!.lines)).toEqual([
      { accountId: "dtl", amount: -25, description: "Deferred Tax Liability" },
      {
        accountId: "dt-expense",
        amount: -25,
        description: "Deferred Tax Benefit"
      }
    ]);
  });

  it("keeps a month above the minimum with no group above it, with no lines", () => {
    // Two groups of 0.008 each: 0.016 in total, neither above 0.01.
    const built = buildDeferredTaxJournals({
      runReadableId: "DEP-1",
      lines: [
        runLine({ amount: 0, taxAmount: 0.032 }),
        runLine({
          id: "line-2",
          locationId: "loc-2",
          amount: 0,
          taxAmount: 0.032
        })
      ],
      settings
    });
    expect(built).toHaveLength(1);
    expect(built[0]!.lines).toEqual([]);
    expect(built[0]!.lineIds).toEqual(["line-1", "line-2"]);
  });

  it("books nothing at or below the minimum", () => {
    expect(
      buildDeferredTaxJournals({
        runReadableId: "DEP-1",
        lines: [runLine({ amount: 0, taxAmount: 0.04 })],
        settings
      })
    ).toEqual([]);
  });
});

describe("buildDisposalJournal", () => {
  it("clears accumulated depreciation and books the net book value as a loss", () => {
    const journal = buildDisposalJournal({
      assetReadableId: "FA-2",
      disposalMethod: "Scrapping",
      disposalDate: "2026-10-05",
      acquisitionCost: 600,
      accumulatedDepreciation: 150,
      locationId: null,
      fixedAssetClassId: "class-1",
      assetAccountId: "asset",
      accumulatedDepreciationAccountId: "accumulated",
      lossOnDisposalAccountId: "loss"
    });
    expect(journal).toMatchObject({
      description: "Asset Disposal: FA-2 (Scrapping)",
      postingDate: "2026-10-05",
      sourceType: "Asset Disposal",
      netBookValue: 450
    });
    expect(lineShape(journal.lines)).toEqual([
      {
        accountId: "accumulated",
        amount: 150,
        description: "Clear accumulated depreciation"
      },
      {
        accountId: "loss",
        amount: 450,
        description: "Loss on disposal (scrap)"
      },
      { accountId: "asset", amount: -600, description: "Remove asset at cost" }
    ]);
    expect(journal.lines[0]!.dimensions).toEqual({
      Location: null,
      FixedAssetClass: "class-1"
    });
  });
});

describe("buildRecognitionJournals", () => {
  function row(
    overrides: Partial<RecognitionScheduleRow>
  ): RecognitionScheduleRow {
    return {
      scheduleId: "row-1",
      postingDate: "2026-10-31",
      type: "Deferral",
      amount: 100,
      debitAccountId: "deferred",
      creditAccountId: "sales",
      salesInvoiceLineId: "inv-line-1",
      rentalAgreementLineId: null,
      customerContractLineId: null,
      rentalLeaseScheduleLineId: null,
      ...overrides
    };
  }
  const sources: RecognitionSources = {
    invoiceLines: new Map([
      [
        "inv-line-1",
        {
          invoiceId: "inv-1",
          customerId: "cust-1",
          itemId: null,
          locationId: null
        }
      ]
    ]),
    rentalLines: new Map([
      [
        "rental-line-1",
        {
          rentalAgreementId: "ra-1",
          customerId: "cust-2",
          itemId: "item-2",
          locationId: "loc-2"
        }
      ]
    ]),
    contractLines: new Map([
      [
        "contract-line-1",
        {
          customerContractId: "cc-1",
          customerId: "cust-3",
          itemId: "item-3",
          projectId: "proj-3"
        }
      ]
    ])
  };
  const classById = new Map([
    ["deferred", "Liability" as const],
    ["sales", "Revenue" as const],
    ["unbilled", "Asset" as const]
  ]);
  const build = (rows: RecognitionScheduleRow[], runPeriodEnd = "2026-10-31") =>
    buildRecognitionJournals({
      runReadableId: "RR-1",
      runPeriodEnd,
      rows,
      sources,
      classById
    });

  it("writes one journal per month, a negative row reversing its legs", () => {
    const { journals, runJournal } = build([
      row({}),
      row({ scheduleId: "row-2", amount: -40 }),
      row({ scheduleId: "row-3", amount: 0 }),
      row({ scheduleId: "row-4", postingDate: "2026-11-30" })
    ]);
    expect(
      journals.map(({ postingDate, scheduleIds }) => ({
        postingDate,
        scheduleIds
      }))
    ).toEqual([
      { postingDate: "2026-10-31", scheduleIds: ["row-1", "row-2", "row-3"] },
      { postingDate: "2026-11-30", scheduleIds: ["row-4"] }
    ]);
    expect(runJournal).toBe(journals[0]);
    expect(journals[0]).toMatchObject({
      description: "Revenue Recognition RR-1",
      sourceType: "Revenue Recognition"
    });
    expect(lineShape(journals[0]!.lines)).toEqual([
      {
        accountId: "deferred",
        amount: -100,
        description: "Deferred revenue released"
      },
      { accountId: "sales", amount: 100, description: "Revenue recognized" },
      {
        accountId: "deferred",
        amount: 40,
        description: "Deferred revenue released"
      },
      { accountId: "sales", amount: -40, description: "Revenue recognized" }
    ]);
    expect(journals[0]!.lines[0]).toMatchObject({
      documentType: "Invoice",
      documentId: "inv-1",
      dimensions: { Customer: "cust-1" }
    });
  });

  it("orders the journals by date and names the latest when none is the run's own", () => {
    const { journals, runJournal } = build(
      [
        row({ postingDate: "2026-11-30" }),
        row({ scheduleId: "row-2", postingDate: "2026-09-30" })
      ],
      "2026-12-31"
    );
    expect(journals.map((journal) => journal.postingDate)).toEqual([
      "2026-09-30",
      "2026-11-30"
    ]);
    expect(runJournal).toBe(journals[1]);
  });

  it("keeps a date whose rows have no amount, with no lines", () => {
    const { journals } = build([row({ amount: 0 })]);
    expect(journals).toHaveLength(1);
    expect(journals[0]!.lines).toEqual([]);
    expect(journals[0]!.scheduleIds).toEqual(["row-1"]);
  });

  it("references the rental agreement, else the contract, with their dimensions", () => {
    const { journals } = build([
      row({
        scheduleId: "rental",
        type: "Interest",
        debitAccountId: "unbilled",
        salesInvoiceLineId: null,
        rentalAgreementLineId: "rental-line-1",
        rentalLeaseScheduleLineId: "lease-1"
      }),
      row({
        scheduleId: "contract",
        type: "Accrual",
        debitAccountId: "unbilled",
        salesInvoiceLineId: null,
        customerContractLineId: "contract-line-1"
      })
    ]);
    const [journal] = journals as [(typeof journals)[number]];
    expect(journal.contractScheduleIds).toEqual(["contract"]);
    expect(journal.leaseScheduleLineIds).toEqual(["lease-1"]);
    expect(
      journal.lines.map(
        ({ description, documentType, documentId, dimensions }) => ({
          description,
          documentType,
          documentId,
          dimensions
        })
      )
    ).toEqual([
      {
        description: "Net investment interest",
        documentType: "Rental Agreement",
        documentId: "ra-1",
        dimensions: {
          Customer: "cust-2",
          Item: "item-2",
          Location: "loc-2",
          Project: null
        }
      },
      {
        description: "Lease interest income",
        documentType: "Rental Agreement",
        documentId: "ra-1",
        dimensions: {
          Customer: "cust-2",
          Item: "item-2",
          Location: "loc-2",
          Project: null
        }
      },
      {
        description: "Contract asset accrued",
        documentType: "Contract",
        documentId: "cc-1",
        dimensions: {
          Customer: "cust-3",
          Item: "item-3",
          Location: null,
          Project: "proj-3"
        }
      },
      {
        description: "Revenue recognized",
        documentType: "Contract",
        documentId: "cc-1",
        dimensions: {
          Customer: "cust-3",
          Item: "item-3",
          Location: null,
          Project: "proj-3"
        }
      }
    ]);
  });

  it("refuses an account with no class", () => {
    expect(() => build([row({ creditAccountId: "unknown" })])).toThrow(
      "Account unknown on the revenue schedule has no class"
    );
    expect(
      recognitionAccountWithoutClass(
        [row({}), row({ debitAccountId: "a" }), row({ creditAccountId: "b" })],
        classById
      )
    ).toBe("a");
  });
});
