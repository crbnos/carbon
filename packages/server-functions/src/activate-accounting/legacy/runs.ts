// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journals of legacy asset and revenue runs
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a). Depreciation runs,
// scrap disposals and revenue recognition runs always wrote journals; the
// reset deleted them and left the rows Posted with no journal. For each one
// dated on or after the cutover the enable writes the journal again, from
// the stored rows, Provisional and dated the row's own month or date, and
// sets the row's journal column. Before the cutover the opening journal and
// the wizard figures cover them: the opening accumulated depreciation and
// deferred revenue are as of the day before the cutover
// (`getDepreciationAfterCutover`, `getDeferredRevenueItems`).
//
// Ported from apps/erp/app/modules/accounting/accounting.server.ts, which the
// server function cannot import:
// - `postDepreciationRun`: one journal per line with a book amount, and one
//   deferred tax journal per run and month, with today's tax settings;
// - `postDisposal`: the scrap journal;
// - `postRevenueRecognitionRun`: one journal per run and month, two lines per
//   row, signed by account class, and the journal
//   columns of the run, the contract ledger entries and the lease schedule
//   lines.
// The ERP dates a month in a Closed period on the run's period end; there is
// no period yet, so every journal takes its own month.
//
// The rows each step reads are the detection's
// (@carbon/database/legacy-documents), which the wizard counts.
//
// Not rebuilt: the depreciation of an asset that left the books with no
// journal (`assetsLeavingWithoutJournal`): the opening fixed assets leave
// it out too.
//
// A rebuilt journal may already sit in the accounting provider: the reset
// deleted the journal and its sync records, not the provider's copy. Like
// every journal the backfill writes, each one gets an Excluded sync operation
// per accounting integration (`insertProvisionalJournals`).

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import {
  type LegacyDocumentCounts,
  legacyDepreciationRunLines,
  legacyDisposals,
  legacyRecognitionSchedule,
  REBUILT_DISPOSAL_METHOD
} from "@carbon/database/legacy-documents";
import {
  type AccountClass,
  chunkArray,
  equals,
  isAccountClass,
  round,
  toStoredAmount
} from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { InvalidInputError } from "../../errors";
import {
  type DimensionEntityType,
  insertProvisionalJournals,
  type LegacyJournal,
  type LegacyJournalLine,
  ROWS_PER_STATEMENT,
  readByIds
} from "./write";

type Enums = Database["public"]["Enums"];
type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

/** The runs and disposals the enable wrote a journal for. */
export type LegacyRunCounts = Pick<
  LegacyDocumentCounts,
  "depreciationRuns" | "assetDisposals" | "revenueRecognitionRuns"
>;

/** A journal and the rows that store its id. */
type Built<T> = { journal: LegacyJournal; attach: T };

/** The month end of a `YYYY-MM-DD` date. */
function monthEndOf(date: string): string {
  return endOfMonth(parseDate(date)).toString();
}

function line(
  accountId: string,
  description: string,
  amount: number,
  dimensions: LegacyJournalLine["dimensions"],
  document: Pick<LegacyJournalLine, "documentType" | "documentId"> = {}
): LegacyJournalLine {
  return {
    accountId,
    description,
    amount,
    journalLineReference: nanoid(),
    ...document,
    dimensions
  };
}

// ---------------------------------------------------------------------------
// Depreciation
// ---------------------------------------------------------------------------

export type DepreciationRunLineRow = {
  id: string;
  depreciationRunId: string;
  runReadableId: string;
  /** The line's month, else the run's period end. */
  monthEnd: string;
  amount: number;
  taxAmount: number | null;
  journalId: string | null;
  deferredTaxJournalId: string | null;
  assetReadableId: string;
  locationId: string | null;
  fixedAssetClassId: string;
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
};

function assetDimensions(row: {
  locationId: string | null;
  fixedAssetClassId: string;
}): Partial<Record<DimensionEntityType, string | null>> {
  return { Location: row.locationId, FixedAssetClass: row.fixedAssetClassId };
}

/** One journal per line with a book amount and no journal, as
 *  `postDepreciationRun` writes it (accounting.server.ts). */
export function buildDepreciationJournals(
  lines: DepreciationRunLineRow[]
): Built<{ runId: string; lineIds: string[] }>[] {
  return lines
    .filter((row) => row.journalId === null && !equals(row.amount, 0))
    .map((row) => ({
      journal: {
        description: `Depreciation: ${row.assetReadableId}`,
        postingDate: row.monthEnd,
        sourceType: "Asset Depreciation",
        lines: [
          line(
            row.depreciationExpenseAccountId,
            "Depreciation Expense",
            toStoredAmount(row.amount, 0, "Expense"),
            assetDimensions(row)
          ),
          line(
            row.accumulatedDepreciationAccountId,
            "Accumulated Depreciation",
            toStoredAmount(0, row.amount, "Asset"),
            assetDimensions(row)
          )
        ]
      },
      attach: { runId: row.depreciationRunId, lineIds: [row.id] }
    }));
}

export type DeferredTaxSettings = {
  taxRate: number;
  dtlAccountId: string;
  dtExpenseAccountId: string;
};

/**
 * One deferred tax journal per run and month with no deferred tax journal,
 * as `postDepreciationRun` writes it (accounting.server.ts), with
 * today's settings. A month whose lines all have no tax amount was built
 * with tax depreciation off, so it had no deferred tax journal.
 */
export function buildDeferredTaxJournals(
  lines: DepreciationRunLineRow[],
  settings: DeferredTaxSettings | null
): Built<{ runId: string; lineIds: string[] }>[] {
  if (!settings) return [];
  const { taxRate, dtlAccountId, dtExpenseAccountId } = settings;
  const months = Map.groupBy(
    lines.filter((row) => row.deferredTaxJournalId === null),
    (row) => `${row.depreciationRunId}|${row.monthEnd}`
  );
  const built: Built<{ runId: string; lineIds: string[] }>[] = [];
  for (const monthLines of months.values()) {
    if (monthLines.every((row) => row.taxAmount === null)) continue;
    const first = monthLines[0]!;
    const diffByGroup = new Map<
      string,
      { locationId: string | null; fixedAssetClassId: string; diff: number }
    >();
    for (const row of monthLines) {
      const diff = (row.taxAmount ?? 0) - row.amount;
      const key = `${row.locationId ?? ""}|${row.fixedAssetClassId}`;
      const existing = diffByGroup.get(key);
      if (existing) existing.diff += diff;
      else
        diffByGroup.set(key, {
          locationId: row.locationId,
          fixedAssetClassId: row.fixedAssetClassId,
          diff
        });
    }
    const total = [...diffByGroup.values()].reduce(
      (sum, group) => sum + group.diff,
      0
    );
    const dtlAmount = Math.abs(total * (taxRate / 100));
    if (dtlAmount <= 0.01) continue;
    const isLiability = total > 0;
    const journalLines = [...diffByGroup.values()]
      .filter((group) => Math.abs(group.diff * (taxRate / 100)) > 0.01)
      .flatMap((group) => {
        const amount = round(Math.abs(group.diff * (taxRate / 100)));
        const dimensions = assetDimensions(group);
        return [
          line(
            isLiability ? dtExpenseAccountId : dtlAccountId,
            isLiability ? "Deferred Tax Expense" : "Deferred Tax Liability",
            toStoredAmount(amount, 0, isLiability ? "Expense" : "Liability"),
            dimensions
          ),
          line(
            isLiability ? dtlAccountId : dtExpenseAccountId,
            isLiability ? "Deferred Tax Liability" : "Deferred Tax Benefit",
            toStoredAmount(0, amount, isLiability ? "Liability" : "Expense"),
            dimensions
          )
        ];
      });
    built.push({
      journal: {
        description: `Deferred Tax: Depreciation ${first.runReadableId}`,
        postingDate: first.monthEnd,
        sourceType: "Asset Depreciation",
        lines: journalLines
      },
      attach: {
        runId: first.depreciationRunId,
        lineIds: monthLines.map((row) => row.id)
      }
    });
  }
  return built;
}

async function loadDepreciationRunLines(
  trx: KyselyTx,
  companyId: string,
  cutoverDate: string
): Promise<DepreciationRunLineRow[]> {
  const rows = await legacyDepreciationRunLines(trx, {
    companyId,
    cutoverDate
  }).execute();
  return rows.map((row) => ({
    id: row.id,
    depreciationRunId: row.depreciationRunId,
    runReadableId: row.runReadableId,
    monthEnd: row.monthEnd,
    amount: Number(row.amount),
    taxAmount: row.taxAmount === null ? null : Number(row.taxAmount),
    journalId: row.journalId,
    deferredTaxJournalId: row.deferredTaxJournalId,
    assetReadableId: row.assetReadableId,
    locationId: row.locationId,
    fixedAssetClassId: row.fixedAssetClassId,
    depreciationExpenseAccountId: row.depreciationExpenseAccountId,
    accumulatedDepreciationAccountId: row.accumulatedDepreciationAccountId
  }));
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

export type DisposalRow = {
  id: string;
  assetReadableId: string;
  disposalDate: string;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  locationId: string | null;
  fixedAssetClassId: string;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  lossOnDisposalAccountId: string;
};

/** The scrap journal, as `postDisposal` writes it (accounting.server.ts):
 *  proceeds are 0, so the whole net book value is a loss. */
export function buildDisposalJournal(row: DisposalRow): LegacyJournal {
  const nbv = row.acquisitionCost - row.accumulatedDepreciation;
  const dimensions = assetDimensions(row);
  const lines: LegacyJournalLine[] = [];
  if (row.accumulatedDepreciation > 0) {
    lines.push(
      line(
        row.accumulatedDepreciationAccountId,
        "Clear accumulated depreciation",
        toStoredAmount(row.accumulatedDepreciation, 0, "Asset"),
        dimensions
      )
    );
  }
  if (nbv > 0) {
    lines.push(
      line(
        row.lossOnDisposalAccountId,
        "Loss on disposal (scrap)",
        toStoredAmount(nbv, 0, "Expense"),
        dimensions
      )
    );
  }
  lines.push(
    line(
      row.assetAccountId,
      "Remove asset at cost",
      toStoredAmount(0, row.acquisitionCost, "Asset"),
      dimensions
    )
  );
  return {
    description: `Asset Disposal: ${row.assetReadableId} (${REBUILT_DISPOSAL_METHOD})`,
    postingDate: row.disposalDate,
    sourceType: "Asset Disposal",
    lines
  };
}

/** Scrap disposals on or after the cutover with no journal. The asset's
 *  cost and accumulated depreciation did not change after its disposal. */
async function loadDisposals(
  trx: KyselyTx,
  companyId: string,
  cutoverDate: string
): Promise<DisposalRow[]> {
  const rows = await legacyDisposals(trx, { companyId, cutoverDate }).execute();
  return rows.map((row) => ({
    ...row,
    acquisitionCost: Number(row.acquisitionCost),
    accumulatedDepreciation: Number(row.accumulatedDepreciation)
  }));
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

export type RecognitionRow = {
  scheduleId: string;
  runId: string;
  runReadableId: string;
  runPeriodEnd: string;
  scheduledDate: string;
  type: RevenueScheduleType;
  /** The run line's amount, as the run posted it. */
  amount: number;
  debitAccountId: string;
  creditAccountId: string;
  isContractRow: boolean;
  rentalLeaseScheduleLineId: string | null;
  document: Pick<LegacyJournalLine, "documentType" | "documentId">;
  dimensions: Partial<Record<DimensionEntityType, string | null>>;
};

/**
 * One journal per run and month, two lines per row with an amount, as
 * `postRevenueRecognitionRun` writes it (accounting.server.ts). A
 * negative row (a credit memo's deferral) reverses the legs.
 */
export function buildRecognitionJournals(
  rows: RecognitionRow[],
  classById: Map<string, AccountClass>
): Built<{
  runId: string;
  runPeriodEnd: string;
  monthEnd: string;
  scheduleIds: string[];
}>[] {
  const groups = Map.groupBy(
    rows,
    (row) => `${row.runId}|${monthEndOf(row.scheduledDate)}`
  );
  return [...groups.values()].map((groupRows) => {
    const first = groupRows[0]!;
    const monthEnd = monthEndOf(first.scheduledDate);
    const lines = groupRows.flatMap((row) => {
      if (row.amount === 0) return [];
      const descriptions =
        row.isContractRow && row.type === "Accrual"
          ? { debit: "Contract asset accrued", credit: "Revenue recognized" }
          : REVENUE_LINE_DESCRIPTIONS[row.type];
      const magnitude = Math.abs(row.amount);
      const debitClass = classById.get(row.debitAccountId);
      const creditClass = classById.get(row.creditAccountId);
      if (!debitClass || !creditClass) {
        throw new InvalidInputError(
          `Account ${debitClass ? row.creditAccountId : row.debitAccountId} on the revenue schedule has no class. Set its class in Accounting → Chart of Accounts.`
        );
      }
      const debitAmount =
        row.amount > 0
          ? toStoredAmount(magnitude, 0, debitClass)
          : toStoredAmount(0, magnitude, debitClass);
      const creditAmount =
        row.amount > 0
          ? toStoredAmount(0, magnitude, creditClass)
          : toStoredAmount(magnitude, 0, creditClass);
      return [
        line(
          row.debitAccountId,
          descriptions.debit,
          debitAmount,
          row.dimensions,
          row.document
        ),
        line(
          row.creditAccountId,
          descriptions.credit,
          creditAmount,
          row.dimensions,
          row.document
        )
      ];
    });
    return {
      journal: {
        description: `Revenue Recognition ${first.runReadableId}`,
        postingDate: monthEnd,
        sourceType: "Revenue Recognition",
        lines
      },
      attach: {
        runId: first.runId,
        runPeriodEnd: first.runPeriodEnd,
        monthEnd,
        scheduleIds: groupRows.map((row) => row.scheduleId)
      }
    };
  });
}

/**
 * Schedule rows a Posted run recognized on or after the cutover, with no
 * journal, and the source each row's journal lines reference: the invoice,
 * else the rental agreement, else the contract, as
 * `postRevenueRecognitionRun` references them.
 */
async function loadRecognitionRows(
  trx: KyselyTx,
  companyId: string,
  companyGroupId: string,
  cutoverDate: string
): Promise<{ rows: RecognitionRow[]; classById: Map<string, AccountClass> }> {
  const scheduled = await legacyRecognitionSchedule(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (scheduled.length === 0) return { rows: [], classById: new Map() };

  const invoiceLines = await readByIds(
    scheduled.map((row) => row.salesInvoiceLineId),
    (ids) =>
      trx
        .selectFrom("salesInvoiceLine as invoiceLine")
        .innerJoin("salesInvoice as invoice", (join) =>
          join
            .onRef("invoice.id", "=", "invoiceLine.invoiceId")
            .onRef("invoice.companyId", "=", "invoiceLine.companyId")
        )
        .select([
          "invoiceLine.id",
          "invoiceLine.invoiceId",
          "invoiceLine.itemId",
          "invoiceLine.locationId",
          "invoice.customerId"
        ])
        .where("invoiceLine.companyId", "=", companyId)
        .where("invoiceLine.id", "in", ids)
        .execute()
  );
  const rentalLines = await readByIds(
    scheduled
      .filter((row) => !row.salesInvoiceLineId)
      .map((row) => row.rentalAgreementLineId),
    (ids) =>
      trx
        .selectFrom("rentalAgreementLine as rentalLine")
        .innerJoin("rentalAgreement as agreement", (join) =>
          join
            .onRef("agreement.id", "=", "rentalLine.rentalAgreementId")
            .onRef("agreement.companyId", "=", "rentalLine.companyId")
        )
        .select([
          "rentalLine.id",
          "rentalLine.itemId",
          "agreement.id as rentalAgreementId",
          "agreement.customerId",
          "agreement.locationId"
        ])
        .where("rentalLine.companyId", "=", companyId)
        .where("rentalLine.id", "in", ids)
        .execute()
  );
  const contractLines = await readByIds(
    scheduled.map((row) => row.customerContractLineId),
    (ids) =>
      trx
        .selectFrom("customerContractLine as contractLine")
        .innerJoin("customerContract as contract", (join) =>
          join
            .onRef("contract.id", "=", "contractLine.customerContractId")
            .onRef("contract.companyId", "=", "contractLine.companyId")
        )
        .select([
          "contractLine.id",
          "contractLine.itemId",
          "contract.id as customerContractId",
          "contract.customerId",
          sql<
            string | null
          >`coalesce("contractLine"."projectId", "contract"."projectId")`.as(
            "projectId"
          )
        ])
        .where("contractLine.companyId", "=", companyId)
        .where("contractLine.id", "in", ids)
        .execute()
  );
  const accounts = await readByIds(
    scheduled.flatMap((row) => [row.debitAccountId, row.creditAccountId]),
    (ids) =>
      trx
        .selectFrom("account")
        .select(["id", "class"])
        .where("companyGroupId", "=", companyGroupId)
        .where("id", "in", ids)
        .execute()
  );
  const classById = new Map<string, AccountClass>();
  for (const account of accounts) {
    if (isAccountClass(account.class)) classById.set(account.id, account.class);
  }

  const invoiceLineById = new Map(invoiceLines.map((row) => [row.id, row]));
  const rentalLineById = new Map(rentalLines.map((row) => [row.id, row]));
  const contractLineById = new Map(contractLines.map((row) => [row.id, row]));

  const rows = scheduled.map((row): RecognitionRow => {
    const invoice = row.salesInvoiceLineId
      ? invoiceLineById.get(row.salesInvoiceLineId)
      : undefined;
    const rental =
      !invoice && row.rentalAgreementLineId
        ? rentalLineById.get(row.rentalAgreementLineId)
        : undefined;
    const contract =
      !invoice && !rental && row.customerContractLineId
        ? contractLineById.get(row.customerContractLineId)
        : undefined;
    const document: RecognitionRow["document"] = invoice
      ? { documentType: "Invoice", documentId: invoice.invoiceId }
      : rental
        ? {
            documentType: "Rental Agreement",
            documentId: rental.rentalAgreementId
          }
        : contract
          ? {
              documentType: "Contract",
              documentId: contract.customerContractId
            }
          : {};
    const source = invoice ?? rental ?? contract;
    return {
      scheduleId: row.scheduleId,
      runId: row.runId,
      runReadableId: row.runReadableId,
      runPeriodEnd: row.runPeriodEnd,
      scheduledDate: row.scheduledDate,
      type: row.type,
      amount: Number(row.amount),
      debitAccountId: row.debitAccountId,
      creditAccountId: row.creditAccountId,
      isContractRow: row.customerContractLineId !== null,
      rentalLeaseScheduleLineId: row.rentalLeaseScheduleLineId,
      document,
      dimensions: {
        Customer: source?.customerId ?? null,
        Item: source?.itemId ?? null,
        Location: source && "locationId" in source ? source.locationId : null,
        Project: source && "projectId" in source ? source.projectId : null
      }
    };
  });
  return { rows, classById };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** A table that stores the journal a run or disposal wrote. */
type JournalTable =
  | "depreciationRunLine"
  | "fixedAssetDisposal"
  | "revenueRecognitionSchedule"
  | "revenueRecognitionRun"
  | "customerContractLedgerEntry"
  | "rentalLeaseScheduleLine";

/**
 * Sets each row's journal column where it is still empty, one statement per
 * chunk. `key` is the column the ids match.
 */
async function setJournalColumn(
  trx: KyselyTx,
  {
    companyId,
    table,
    column = "journalId",
    key = "id",
    rows
  }: {
    companyId: string;
    table: JournalTable;
    column?: "journalId" | "deferredTaxJournalId";
    key?: "id" | "revenueRecognitionScheduleId";
    rows: { id: string; journalId: string }[];
  }
) {
  for (const chunk of chunkArray(rows, ROWS_PER_STATEMENT)) {
    await sql`UPDATE ${sql.table(table)} AS t
      SET ${sql.ref(column)} = v."journalId"
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
        AS v("id" text, "journalId" text)
      WHERE t.${sql.ref(key)} = v."id"
        AND t."companyId" = ${companyId}
        AND t.${sql.ref(column)} IS NULL`.execute(trx);
  }
}

/**
 * Writes the journals of the legacy runs and scrap disposals dated on or
 * after the cutover, Provisional, sets the rows' journal columns, and keeps
 * the journals out of provider sync.
 */
export async function journalLegacyRuns(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
  }
): Promise<{ counts: LegacyRunCounts; journalIds: string[] }> {
  const settings = await trx
    .selectFrom("companySettings")
    .select(["assetTaxDepreciationEnabled", "assetTaxRate"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  const taxRate = Number(settings?.assetTaxRate ?? 0);
  const taxSettings: DeferredTaxSettings | null =
    settings?.assetTaxDepreciationEnabled &&
    taxRate &&
    defaults.deferredTaxLiabilityAccountId &&
    defaults.deferredTaxExpenseAccountId
      ? {
          taxRate,
          dtlAccountId: defaults.deferredTaxLiabilityAccountId,
          dtExpenseAccountId: defaults.deferredTaxExpenseAccountId
        }
      : null;

  const runLines = await loadDepreciationRunLines(trx, companyId, cutoverDate);
  const depreciation = buildDepreciationJournals(runLines);
  const deferredTax = buildDeferredTaxJournals(runLines, taxSettings);
  const disposalRows = await loadDisposals(trx, companyId, cutoverDate);
  const disposals = disposalRows.map((row) => ({
    journal: buildDisposalJournal(row),
    attach: { disposalId: row.id }
  }));
  const { rows: recognitionRows, classById } = await loadRecognitionRows(
    trx,
    companyId,
    companyGroupId,
    cutoverDate
  );
  const recognition = buildRecognitionJournals(recognitionRows, classById);

  const built = [...depreciation, ...deferredTax, ...disposals, ...recognition];
  const ids = await insertProvisionalJournals(trx, {
    companyId,
    companyGroupId,
    userId,
    journals: built.map(({ journal }) => journal)
  });
  let offset = 0;
  const idsOf = <T>(list: T[]) => {
    const slice = ids.slice(offset, offset + list.length);
    offset += list.length;
    return list.map((item, index) => ({ item, journalId: slice[index] }));
  };
  const written = <T>(
    list: { item: T; journalId: string | null | undefined }[]
  ) =>
    list.filter(
      (entry): entry is { item: T; journalId: string } => !!entry.journalId
    );

  const depreciationIds = written(idsOf(depreciation));
  const deferredTaxIds = written(idsOf(deferredTax));
  const disposalIds = written(idsOf(disposals));
  const recognitionIds = written(idsOf(recognition));

  await setJournalColumn(trx, {
    companyId,
    table: "depreciationRunLine",
    rows: depreciationIds.flatMap(({ item, journalId }) =>
      item.attach.lineIds.map((id) => ({ id, journalId }))
    )
  });
  await setJournalColumn(trx, {
    companyId,
    table: "depreciationRunLine",
    column: "deferredTaxJournalId",
    rows: deferredTaxIds.flatMap(({ item, journalId }) =>
      item.attach.lineIds.map((id) => ({ id, journalId }))
    )
  });
  await setJournalColumn(trx, {
    companyId,
    table: "fixedAssetDisposal",
    rows: disposalIds.map(({ item, journalId }) => ({
      id: item.attach.disposalId,
      journalId
    }))
  });

  // Each schedule row, its contract ledger entry and its lease schedule line
  // record the journal of the row's own month.
  const journalBySchedule = new Map<string, string>();
  for (const { item, journalId } of recognitionIds) {
    for (const scheduleId of item.attach.scheduleIds) {
      journalBySchedule.set(scheduleId, journalId);
    }
  }
  const scheduleJournals = [...journalBySchedule].map(([id, journalId]) => ({
    id,
    journalId
  }));
  await setJournalColumn(trx, {
    companyId,
    table: "revenueRecognitionSchedule",
    rows: scheduleJournals
  });
  await setJournalColumn(trx, {
    companyId,
    table: "customerContractLedgerEntry",
    key: "revenueRecognitionScheduleId",
    rows: scheduleJournals
  });
  await setJournalColumn(trx, {
    companyId,
    table: "rentalLeaseScheduleLine",
    rows: recognitionRows.flatMap((row) => {
      const journalId = journalBySchedule.get(row.scheduleId);
      return row.rentalLeaseScheduleLineId && journalId
        ? [{ id: row.rentalLeaseScheduleLineId, journalId }]
        : [];
    })
  });
  // The run names the journal of its own period, else its latest month's.
  await setJournalColumn(trx, {
    companyId,
    table: "revenueRecognitionRun",
    rows: [...Map.groupBy(recognitionIds, ({ item }) => item.attach.runId)].map(
      ([runId, journals]) => {
        const byMonth = [...journals].sort((a, b) =>
          a.item.attach.monthEnd.localeCompare(b.item.attach.monthEnd)
        );
        const own = byMonth.find(
          ({ item }) => item.attach.monthEnd === item.attach.runPeriodEnd
        );
        return { id: runId, journalId: (own ?? byMonth.at(-1)!).journalId };
      }
    )
  });

  return {
    counts: {
      depreciationRuns: new Set(
        [...depreciationIds, ...deferredTaxIds].map(
          ({ item }) => item.attach.runId
        )
      ).size,
      assetDisposals: disposalIds.length,
      revenueRecognitionRuns: new Set(
        recognitionIds.map(({ item }) => item.attach.runId)
      ).size
    },
    journalIds: ids.filter((id): id is string => id !== null)
  };
}
