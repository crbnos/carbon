// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What the enable adds to the shared run journal builders for legacy runs
// (runs.ts): it skips what already has a journal, skips a month built with
// tax depreciation off, groups by run and refuses an unclassified account
// with a message for the user. The lines themselves are pinned by
// packages/database/src/run-journals.test.ts.

import { describe, expect, it } from "vitest";
import { InvalidInputError } from "../../errors";
import {
  buildLegacyDepreciationJournals,
  buildLegacyRecognitionJournals,
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

const settings = {
  taxRate: 25,
  dtlAccountId: "dtl",
  dtExpenseAccountId: "dt-expense"
};

describe("buildLegacyDepreciationJournals", () => {
  it("writes a book journal for each line with an amount and no journal", () => {
    const { depreciation } = buildLegacyDepreciationJournals(
      [
        runLine({}),
        runLine({ id: "line-2", amount: 0, taxAmount: 40 }),
        runLine({ id: "line-3", journalId: "kept" })
      ],
      null
    );
    expect(depreciation.map(({ attach }) => attach)).toEqual([
      { runId: "run-1", lineIds: ["line-1"] }
    ]);
    expect(depreciation[0]!.journal).toMatchObject({
      description: "Depreciation: FA-1",
      postingDate: "2026-10-31",
      sourceType: "Asset Depreciation"
    });
    expect(depreciation[0]!.journal.lines[0]!.journalLineReference).toEqual(
      expect.any(String)
    );
  });

  it("writes no deferred tax for a month built without tax depreciation", () => {
    expect(
      buildLegacyDepreciationJournals([runLine({})], settings).deferredTax
    ).toEqual([]);
  });

  it("writes a deferred tax journal per run and month with none", () => {
    const { deferredTax } = buildLegacyDepreciationJournals(
      [
        runLine({ taxAmount: 150 }),
        runLine({ id: "line-2", amount: 50, taxAmount: 50 }),
        runLine({ id: "line-3", monthEnd: "2026-11-30", taxAmount: 60 }),
        runLine({
          id: "line-4",
          depreciationRunId: "run-2",
          runReadableId: "DEP-2",
          taxAmount: 300
        }),
        runLine({ id: "line-5", taxAmount: 300, deferredTaxJournalId: "kept" })
      ],
      settings
    );
    expect(
      deferredTax.map(({ journal, attach }) => ({
        description: journal.description,
        postingDate: journal.postingDate,
        ...attach
      }))
    ).toEqual([
      {
        description: "Deferred Tax: Depreciation DEP-1",
        postingDate: "2026-10-31",
        runId: "run-1",
        lineIds: ["line-1", "line-2"]
      },
      {
        description: "Deferred Tax: Depreciation DEP-1",
        postingDate: "2026-11-30",
        runId: "run-1",
        lineIds: ["line-3"]
      },
      {
        description: "Deferred Tax: Depreciation DEP-2",
        postingDate: "2026-10-31",
        runId: "run-2",
        lineIds: ["line-4"]
      }
    ]);
  });
});

describe("buildLegacyRecognitionJournals", () => {
  function row(overrides: Partial<RecognitionRow>): RecognitionRow {
    return {
      scheduleId: "row-1",
      runId: "run-1",
      runReadableId: "RR-1",
      runPeriodEnd: "2026-10-31",
      postingDate: "2026-10-31",
      type: "Deferral",
      amount: 100,
      debitAccountId: "deferred",
      creditAccountId: "sales",
      salesInvoiceLineId: null,
      rentalAgreementLineId: null,
      customerContractLineId: null,
      rentalLeaseScheduleLineId: null,
      ...overrides
    };
  }
  const sources = {
    invoiceLines: new Map(),
    rentalLines: new Map(),
    contractLines: new Map()
  };
  const classes = new Map([
    ["deferred", "Liability" as const],
    ["sales", "Revenue" as const]
  ]);

  it("writes one journal per run and month and marks each run's own", () => {
    const built = buildLegacyRecognitionJournals(
      [
        row({}),
        row({ scheduleId: "row-2", postingDate: "2026-11-30" }),
        row({
          scheduleId: "row-3",
          runId: "run-2",
          runReadableId: "RR-2",
          runPeriodEnd: "2026-12-31",
          rentalLeaseScheduleLineId: "lease-1"
        })
      ],
      sources,
      classes
    );
    expect(
      built.map(({ journal, attach }) => ({
        description: journal.description,
        postingDate: journal.postingDate,
        ...attach
      }))
    ).toEqual([
      {
        description: "Revenue Recognition RR-1",
        postingDate: "2026-10-31",
        runId: "run-1",
        scheduleIds: ["row-1"],
        leaseScheduleLineIds: [],
        isRunJournal: true
      },
      {
        description: "Revenue Recognition RR-1",
        postingDate: "2026-11-30",
        runId: "run-1",
        scheduleIds: ["row-2"],
        leaseScheduleLineIds: [],
        isRunJournal: false
      },
      {
        description: "Revenue Recognition RR-2",
        postingDate: "2026-10-31",
        runId: "run-2",
        scheduleIds: ["row-3"],
        leaseScheduleLineIds: ["lease-1"],
        isRunJournal: true
      }
    ]);
  });

  it("refuses an account with no class, naming where to set it", () => {
    const build = () =>
      buildLegacyRecognitionJournals(
        [row({ creditAccountId: "unknown" })],
        sources,
        classes
      );
    expect(build).toThrow(InvalidInputError);
    expect(build).toThrow(
      "Account unknown on the revenue schedule has no class. Set its class in Accounting → Chart of Accounts."
    );
  });
});
