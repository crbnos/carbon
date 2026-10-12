// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journals of the period runs and the manual scrap: depreciation,
// deferred tax, disposal and revenue recognition. Pure: no database, no
// clock, no random values. Two callers write them:
// - the ERP's posting (`postDepreciationRun`, `postDisposal`,
//   `postRevenueRecognitionRun`, apps/erp/app/modules/accounting/
//   accounting.server.ts): Posted, in the periods the route resolved;
// - the enable's legacy backfill (packages/server-functions/src/
//   activate-accounting/legacy/runs.ts): Provisional, from the stored rows.
// The caller gathers the facts and writes the result. The journal id, the
// entry number, the period, the status, each line's `journalLineReference`
// and the dimension ids are the caller's.
//
// A line's `dimensions` holds its values by entity type, null when it has
// none. The caller writes a row for each value whose dimension the company
// has.

import { type AccountClass, toStoredAmount } from "./ledger.ts";
import { equals } from "./precision.ts";
import type { Database } from "./types.ts";

type Enums = Database["public"]["Enums"];

/**
 * A deferred tax journal, and each line of it, books only an amount above
 * this. The legacy detection (`deferredTaxMonth`, legacy-documents.ts) tests
 * the same amount in SQL.
 */
export const DEFERRED_TAX_MIN_AMOUNT = 0.01;

export type RunLineDimensions = Partial<
  Record<Enums["dimensionEntityType"], string | null>
>;

/** A journal line, with its natural-signed stored amount. */
export type RunJournalLine = {
  accountId: string;
  description: string;
  amount: number;
  documentType?: Enums["journalLineDocumentType"];
  documentId?: string;
  dimensions: RunLineDimensions;
};

export type RunJournal = {
  description: string;
  sourceType: Enums["journalEntrySourceType"];
  /** Can be empty: the ERP still writes the journal (see each builder). */
  lines: RunJournalLine[];
};

type Asset = { locationId: string | null; fixedAssetClassId: string };

function assetDimensions(asset: Asset): RunLineDimensions {
  return {
    Location: asset.locationId,
    FixedAssetClass: asset.fixedAssetClassId
  };
}

// ---------------------------------------------------------------------------
// Depreciation
// ---------------------------------------------------------------------------

/** A depreciation run line, with its asset and the asset's class accounts. */
export type DepreciationRunLine = Asset & {
  id: string;
  /** The line's month, else the run's period end. */
  monthEnd: string;
  amount: number;
  taxAmount: number | null;
  assetReadableId: string;
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
};

export type DepreciationJournal = RunJournal & {
  lineId: string;
  monthEnd: string;
};

/**
 * One journal per line with a book amount: Dr depreciation expense, Cr
 * accumulated depreciation. A line with no book amount (tax only) has none;
 * it still counts toward the month's deferred tax.
 *
 * Quirk: the amount goes through `toStoredAmount` as a debit, so a negative
 * amount stores 0 on the expense line and its magnitude on the accumulated
 * line, an unbalanced journal. The ERP has always written it so.
 */
export function buildDepreciationJournals(
  lines: DepreciationRunLine[]
): DepreciationJournal[] {
  return lines
    .filter((line) => !equals(line.amount, 0))
    .map((line) => ({
      lineId: line.id,
      monthEnd: line.monthEnd,
      description: `Depreciation: ${line.assetReadableId}`,
      sourceType: "Asset Depreciation",
      lines: [
        {
          accountId: line.depreciationExpenseAccountId,
          description: "Depreciation Expense",
          amount: toStoredAmount(line.amount, 0, "Expense"),
          dimensions: assetDimensions(line)
        },
        {
          accountId: line.accumulatedDepreciationAccountId,
          description: "Accumulated Depreciation",
          amount: toStoredAmount(0, line.amount, "Asset"),
          dimensions: assetDimensions(line)
        }
      ]
    }));
}

export type DeferredTaxSettings = {
  /** Percent, e.g. 25. */
  taxRate: number;
  dtlAccountId: string;
  dtExpenseAccountId: string;
};

/** The deferred tax settings, or null when tax depreciation does not book
 *  deferred tax: off, no rate, or a deferred tax account missing. */
export function deferredTaxSettings(args: {
  enabled: boolean | null | undefined;
  taxRate: number | null | undefined;
  dtlAccountId: string | null | undefined;
  dtExpenseAccountId: string | null | undefined;
}): DeferredTaxSettings | null {
  const { enabled, taxRate, dtlAccountId, dtExpenseAccountId } = args;
  return enabled && taxRate && dtlAccountId && dtExpenseAccountId
    ? { taxRate, dtlAccountId, dtExpenseAccountId }
    : null;
}

export type DeferredTaxJournal = RunJournal & {
  /** Every line of the month, which stores this journal's id. */
  lineIds: string[];
  monthEnd: string;
};

/**
 * One deferred tax journal per month of a run, for the temporary difference
 * (tax − book, a missing tax amount is 0) at the tax rate, when it is above
 * `DEFERRED_TAX_MIN_AMOUNT`. Tax ahead of book is a liability (Dr expense,
 * Cr liability); book ahead of tax unwinds it (Dr liability, Cr benefit).
 * Two lines per location and asset class whose own amount is above the
 * minimum. Months come in the order of their first line.
 *
 * Quirks the ERP has always had: the amounts are not rounded; and when the
 * month's total is above the minimum but no group's is, the journal has no
 * lines and its lines still store its id.
 */
export function buildDeferredTaxJournals(args: {
  runReadableId: string;
  lines: DepreciationRunLine[];
  settings: DeferredTaxSettings | null;
}): DeferredTaxJournal[] {
  const { runReadableId, lines, settings } = args;
  if (!settings) return [];
  const { taxRate, dtlAccountId, dtExpenseAccountId } = settings;

  const linesByMonth = new Map<string, DepreciationRunLine[]>();
  for (const line of lines) {
    const monthLines = linesByMonth.get(line.monthEnd) ?? [];
    monthLines.push(line);
    linesByMonth.set(line.monthEnd, monthLines);
  }

  const journals: DeferredTaxJournal[] = [];
  for (const [monthEnd, monthLines] of linesByMonth) {
    const diffByGroup = new Map<string, Asset & { diff: number }>();
    for (const line of monthLines) {
      const diff = (line.taxAmount ?? 0) - line.amount;
      const key = `${line.locationId ?? ""}|${line.fixedAssetClassId}`;
      const existing = diffByGroup.get(key);
      if (existing) {
        existing.diff += diff;
      } else {
        diffByGroup.set(key, {
          locationId: line.locationId,
          fixedAssetClassId: line.fixedAssetClassId,
          diff
        });
      }
    }

    const total = [...diffByGroup.values()].reduce(
      (sum, group) => sum + group.diff,
      0
    );
    if (!(Math.abs(total * (taxRate / 100)) > DEFERRED_TAX_MIN_AMOUNT)) {
      continue;
    }
    const isLiability = total > 0;

    journals.push({
      lineIds: monthLines.map((line) => line.id),
      monthEnd,
      description: `Deferred Tax: Depreciation ${runReadableId}`,
      sourceType: "Asset Depreciation",
      lines: [...diffByGroup.values()]
        .filter(
          (group) =>
            Math.abs(group.diff * (taxRate / 100)) > DEFERRED_TAX_MIN_AMOUNT
        )
        .flatMap((group) => {
          const amount = Math.abs(group.diff * (taxRate / 100));
          const dimensions = assetDimensions(group);
          return [
            {
              accountId: isLiability ? dtExpenseAccountId : dtlAccountId,
              description: isLiability
                ? "Deferred Tax Expense"
                : "Deferred Tax Liability",
              amount: toStoredAmount(
                amount,
                0,
                isLiability ? "Expense" : "Liability"
              ),
              dimensions
            },
            {
              accountId: isLiability ? dtlAccountId : dtExpenseAccountId,
              description: isLiability
                ? "Deferred Tax Liability"
                : "Deferred Tax Benefit",
              amount: toStoredAmount(
                0,
                amount,
                isLiability ? "Liability" : "Expense"
              ),
              dimensions
            }
          ];
        })
    });
  }
  return journals;
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

/** An asset leaving the books with no proceeds, with its class accounts. */
export type Disposal = Asset & {
  assetReadableId: string;
  disposalMethod: Enums["disposalMethod"];
  disposalDate: string;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  lossOnDisposalAccountId: string;
};

/**
 * The scrap journal: Dr accumulated depreciation, Dr loss on disposal for the
 * whole net book value (no proceeds, so gain/loss = 0 − NBV, booked to the
 * dedicated Loss on Disposal account), Cr the asset at cost.
 */
export function buildDisposalJournal(
  disposal: Disposal
): RunJournal & { postingDate: string; netBookValue: number } {
  const netBookValue =
    disposal.acquisitionCost - disposal.accumulatedDepreciation;
  const dimensions = assetDimensions(disposal);
  const lines: RunJournalLine[] = [];
  if (disposal.accumulatedDepreciation > 0) {
    lines.push({
      accountId: disposal.accumulatedDepreciationAccountId,
      description: "Clear accumulated depreciation",
      amount: toStoredAmount(disposal.accumulatedDepreciation, 0, "Asset"),
      dimensions
    });
  }
  if (netBookValue > 0) {
    lines.push({
      accountId: disposal.lossOnDisposalAccountId,
      description: "Loss on disposal (scrap)",
      amount: toStoredAmount(netBookValue, 0, "Expense"),
      dimensions
    });
  }
  lines.push({
    accountId: disposal.assetAccountId,
    description: "Remove asset at cost",
    amount: toStoredAmount(0, disposal.acquisitionCost, "Asset"),
    dimensions
  });
  return {
    description: `Asset Disposal: ${disposal.assetReadableId} (${disposal.disposalMethod})`,
    postingDate: disposal.disposalDate,
    sourceType: "Asset Disposal",
    lines,
    netBookValue
  };
}

// ---------------------------------------------------------------------------
// Revenue recognition
// ---------------------------------------------------------------------------

type RevenueScheduleType = Enums["revenueScheduleType"];

const REVENUE_LINE_DESCRIPTIONS: Record<
  RevenueScheduleType,
  { debit: string; credit: string }
> = {
  Deferral: {
    debit: "Deferred revenue released",
    credit: "Revenue recognized"
  },
  Accrual: { debit: "Unbilled rent accrued", credit: "Rental income accrued" },
  Interest: {
    debit: "Net investment interest",
    credit: "Lease interest income"
  }
};

const CONTRACT_ACCRUAL_DESCRIPTIONS = {
  debit: "Contract asset accrued",
  credit: "Revenue recognized"
};

/** A revenue recognition schedule row, with the amount its run posts. */
export type RecognitionScheduleRow = {
  scheduleId: string;
  /** The date the row's journal posts on: its month's end, or the date the
   *  caller posts that month on. Rows of one date share a journal. */
  postingDate: string;
  type: RevenueScheduleType;
  amount: number;
  debitAccountId: string;
  creditAccountId: string;
  salesInvoiceLineId: string | null;
  rentalAgreementLineId: string | null;
  customerContractLineId: string | null;
  rentalLeaseScheduleLineId: string | null;
};

/** The documents the rows' journal lines reference, by source line id. */
export type RecognitionSources = {
  invoiceLines: Map<
    string,
    {
      invoiceId: string;
      customerId: string | null;
      itemId: string | null;
      locationId: string | null;
    }
  >;
  rentalLines: Map<
    string,
    {
      rentalAgreementId: string;
      customerId: string | null;
      itemId: string | null;
      locationId: string | null;
    }
  >;
  contractLines: Map<
    string,
    {
      customerContractId: string;
      customerId: string | null;
      itemId: string | null;
      /** The contract line's project, else the contract's. */
      projectId: string | null;
    }
  >;
};

export type RecognitionJournal = RunJournal & {
  postingDate: string;
  /** The schedule rows that store this journal's id. */
  scheduleIds: string[];
  /** The contract rows among them: their ledger entries store it too. */
  contractScheduleIds: string[];
  /** The lease schedule lines whose Interest rows it posts. */
  leaseScheduleLineIds: string[];
};

/** The first debit or credit account of the rows with no class, in row
 *  order, or undefined when every account has one. */
export function recognitionAccountWithoutClass(
  rows: Pick<RecognitionScheduleRow, "debitAccountId" | "creditAccountId">[],
  classById: Map<string, AccountClass>
): string | undefined {
  for (const row of rows) {
    if (!classById.has(row.debitAccountId)) return row.debitAccountId;
    if (!classById.has(row.creditAccountId)) return row.creditAccountId;
  }
  return undefined;
}

function recognitionSource(
  row: RecognitionScheduleRow,
  sources: RecognitionSources
): Pick<RunJournalLine, "documentType" | "documentId" | "dimensions"> {
  // A row references its invoice, else its rental agreement, else its
  // contract.
  const invoice = row.salesInvoiceLineId
    ? sources.invoiceLines.get(row.salesInvoiceLineId)
    : undefined;
  const rental =
    !invoice && row.rentalAgreementLineId
      ? sources.rentalLines.get(row.rentalAgreementLineId)
      : undefined;
  const contract =
    !invoice && !rental && row.customerContractLineId
      ? sources.contractLines.get(row.customerContractLineId)
      : undefined;
  const document = invoice
    ? { documentType: "Invoice" as const, documentId: invoice.invoiceId }
    : rental
      ? {
          documentType: "Rental Agreement" as const,
          documentId: rental.rentalAgreementId
        }
      : contract
        ? {
            documentType: "Contract" as const,
            documentId: contract.customerContractId
          }
        : {};
  const source = invoice ?? rental ?? contract;
  return {
    ...document,
    dimensions: {
      Customer: source?.customerId ?? null,
      Item: source?.itemId ?? null,
      Location: (invoice ?? rental)?.locationId ?? null,
      Project: contract?.projectId ?? null
    }
  };
}

/**
 * The journals of one revenue recognition run: one per posting date, in date
 * order, and two lines per row with an amount, each on the row's own
 * accounts, signed by the account's class. A negative row (a credit memo's
 * deferral) reverses the legs: the debit leg of a negative row is a credit
 * of its magnitude, and the reverse. A date whose rows all have no amount
 * still gets a journal, with no lines. The run's journal is the one of its
 * own period end, else the latest.
 *
 * Throws when an account of any row has no class.
 */
export function buildRecognitionJournals(args: {
  runReadableId: string;
  runPeriodEnd: string;
  rows: RecognitionScheduleRow[];
  sources: RecognitionSources;
  classById: Map<string, AccountClass>;
}): { journals: RecognitionJournal[]; runJournal: RecognitionJournal | null } {
  const { runReadableId, runPeriodEnd, rows, sources, classById } = args;
  const unclassified = recognitionAccountWithoutClass(rows, classById);
  if (unclassified) {
    throw new Error(
      `Account ${unclassified} on the revenue schedule has no class`
    );
  }
  const classOf = (accountId: string) => classById.get(accountId)!;

  const byDate = new Map<string, RecognitionJournal>();
  for (const row of rows) {
    const journal = byDate.get(row.postingDate) ?? {
      description: `Revenue Recognition ${runReadableId}`,
      sourceType: "Revenue Recognition" as const,
      postingDate: row.postingDate,
      lines: [],
      scheduleIds: [],
      contractScheduleIds: [],
      leaseScheduleLineIds: []
    };
    byDate.set(row.postingDate, journal);

    journal.scheduleIds.push(row.scheduleId);
    if (row.customerContractLineId) {
      journal.contractScheduleIds.push(row.scheduleId);
    }
    if (
      row.rentalLeaseScheduleLineId &&
      !journal.leaseScheduleLineIds.includes(row.rentalLeaseScheduleLineId)
    ) {
      journal.leaseScheduleLineIds.push(row.rentalLeaseScheduleLineId);
    }
    if (row.amount === 0) continue;

    const descriptions =
      row.customerContractLineId && row.type === "Accrual"
        ? CONTRACT_ACCRUAL_DESCRIPTIONS
        : REVENUE_LINE_DESCRIPTIONS[row.type];
    const magnitude = Math.abs(row.amount);
    const debitClass = classOf(row.debitAccountId);
    const creditClass = classOf(row.creditAccountId);
    const source = recognitionSource(row, sources);
    journal.lines.push(
      {
        accountId: row.debitAccountId,
        description: descriptions.debit,
        amount:
          row.amount > 0
            ? toStoredAmount(magnitude, 0, debitClass)
            : toStoredAmount(0, magnitude, debitClass),
        ...source
      },
      {
        accountId: row.creditAccountId,
        description: descriptions.credit,
        amount:
          row.amount > 0
            ? toStoredAmount(0, magnitude, creditClass)
            : toStoredAmount(magnitude, 0, creditClass),
        ...source
      }
    );
  }

  const journals = [...byDate.values()].sort((a, b) =>
    a.postingDate.localeCompare(b.postingDate)
  );
  return {
    journals,
    runJournal:
      byDate.get(runPeriodEnd) ?? journals[journals.length - 1] ?? null
  };
}
