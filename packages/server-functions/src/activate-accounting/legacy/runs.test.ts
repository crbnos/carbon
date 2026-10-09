// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The run journal builders the enable uses for legacy runs (runs.ts), against
// the lines `postDepreciationRun`, `postDisposal` and
// `postRevenueRecognitionRun` write.

import { describe, expect, it } from "vitest";
import {
  buildDeferredTaxJournals,
  buildDepreciationJournals,
  buildDisposalJournal,
  buildRecognitionJournals,
  type DepreciationRunLineRow,
  type RecognitionRow
} from "./runs";

function runLine(
  overrides: Partial<DepreciationRunLineRow>
): DepreciationRunLineRow {
  return {
    id: "line-1",
    depreciationRunId: "run-1",
    runReadableId: "DEP-1",
    monthEnd: "2026-10-31",
    amount: 100,
    taxAmount: null,
    journalId: null,
    deferredTaxJournalId: null,
    assetReadableId: "FA-1",
    locationId: "loc-1",
    fixedAssetClassId: "class-1",
    depreciationExpenseAccountId: "expense",
    accumulatedDepreciationAccountId: "accumulated",
    ...overrides
  };
}

const lineShape = (
  lines: {
    accountId?: string | null;
    amount?: number;
    description?: string | null;
  }[]
) =>
  lines.map(({ accountId, amount, description }) => ({
    accountId,
    amount,
    description
  }));

describe("buildDepreciationJournals", () => {
  it("writes one journal per line with a book amount and no journal", () => {
    const built = buildDepreciationJournals([
      runLine({}),
      runLine({ id: "line-2", amount: 0, taxAmount: 40 }),
      runLine({ id: "line-3", journalId: "kept" })
    ]);
    expect(built).toHaveLength(1);
    const [{ journal, attach }] = built as [(typeof built)[number]];
    expect(attach).toEqual({ runId: "run-1", lineIds: ["line-1"] });
    expect(journal).toMatchObject({
      description: "Depreciation: FA-1",
      postingDate: "2026-10-31",
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

describe("buildDeferredTaxJournals", () => {
  const settings = {
    taxRate: 25,
    dtlAccountId: "dtl",
    dtExpenseAccountId: "dt-expense"
  };

  it("writes none with tax depreciation off, or for a month built without it", () => {
    expect(
      buildDeferredTaxJournals([runLine({ taxAmount: 150 })], null)
    ).toEqual([]);
    expect(buildDeferredTaxJournals([runLine({})], settings)).toEqual([]);
  });

  it("books the month's temporary difference per run and month", () => {
    const built = buildDeferredTaxJournals(
      [
        runLine({ taxAmount: 150 }),
        runLine({ id: "line-2", amount: 50, taxAmount: 50 }),
        runLine({ id: "line-3", monthEnd: "2026-11-30", taxAmount: 60 })
      ],
      settings
    );
    expect(built.map(({ attach }) => attach)).toEqual([
      { runId: "run-1", lineIds: ["line-1", "line-2"] },
      { runId: "run-1", lineIds: ["line-3"] }
    ]);
    // Tax ahead of book by 50 at 25%: a liability of 12.5.
    expect(built[0]!.journal).toMatchObject({
      description: "Deferred Tax: Depreciation DEP-1",
      postingDate: "2026-10-31",
      sourceType: "Asset Depreciation"
    });
    expect(lineShape(built[0]!.journal.lines)).toEqual([
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
    expect(lineShape(built[1]!.journal.lines)).toEqual([
      { accountId: "dtl", amount: -10, description: "Deferred Tax Liability" },
      {
        accountId: "dt-expense",
        amount: -10,
        description: "Deferred Tax Benefit"
      }
    ]);
  });
});

describe("buildDisposalJournal", () => {
  it("clears accumulated depreciation and books the net book value as a loss", () => {
    const journal = buildDisposalJournal({
      id: "disposal-1",
      assetReadableId: "FA-2",
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
      sourceType: "Asset Disposal"
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
  });
});

describe("buildRecognitionJournals", () => {
  function row(overrides: Partial<RecognitionRow>): RecognitionRow {
    return {
      scheduleId: "row-1",
      runId: "run-1",
      runReadableId: "RR-1",
      runPeriodEnd: "2026-10-31",
      scheduledDate: "2026-10-31",
      type: "Deferral",
      amount: 100,
      debitAccountId: "deferred",
      creditAccountId: "sales",
      isContractRow: false,
      rentalLeaseScheduleLineId: null,
      document: { documentType: "Invoice", documentId: "inv-1" },
      dimensions: { Customer: "cust-1" },
      ...overrides
    };
  }
  const classes = new Map([
    ["deferred", "Liability" as const],
    ["sales", "Revenue" as const]
  ]);

  it("writes one journal per run and month, a negative row reversing its legs", () => {
    const built = buildRecognitionJournals(
      [
        row({}),
        row({ scheduleId: "row-2", amount: -40 }),
        row({ scheduleId: "row-3", amount: 0 }),
        row({ scheduleId: "row-4", scheduledDate: "2026-11-15" })
      ],
      classes
    );
    expect(built.map(({ attach }) => attach)).toEqual([
      {
        runId: "run-1",
        runPeriodEnd: "2026-10-31",
        monthEnd: "2026-10-31",
        scheduleIds: ["row-1", "row-2", "row-3"]
      },
      {
        runId: "run-1",
        runPeriodEnd: "2026-10-31",
        monthEnd: "2026-11-30",
        scheduleIds: ["row-4"]
      }
    ]);
    expect(built[0]!.journal).toMatchObject({
      description: "Revenue Recognition RR-1",
      postingDate: "2026-10-31",
      sourceType: "Revenue Recognition"
    });
    expect(lineShape(built[0]!.journal.lines)).toEqual([
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
    expect(built[0]!.journal.lines[0]).toMatchObject({
      documentType: "Invoice",
      documentId: "inv-1",
      dimensions: { Customer: "cust-1" }
    });
  });

  it("refuses an account with no class", () => {
    expect(() =>
      buildRecognitionJournals([row({ creditAccountId: "unknown" })], classes)
    ).toThrow("Account unknown on the revenue schedule has no class");
  });
});
