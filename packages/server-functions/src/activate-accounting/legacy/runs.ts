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
// The lines are built by the same builders the ERP posts runs with
// (@carbon/database/run-journals):
// - `buildDepreciationJournals`: one journal per line with a book amount, and
//   `buildDeferredTaxJournals`: one deferred tax journal per run and month,
//   with today's tax settings;
// - `buildDisposalJournal`: the scrap journal;
// - `buildRecognitionJournals`: one journal per run and month, two lines per
//   row, signed by account class; this file sets the journal columns of the
//   run, the schedule rows, the contract ledger entries and the lease
//   schedule lines.
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
  buildDeferredTaxJournals,
  buildDepreciationJournals,
  buildDisposalJournal,
  buildRecognitionJournals,
  type DeferredTaxSettings,
  type DepreciationRunLine,
  type Disposal,
  deferredTaxSettings,
  type RecognitionScheduleRow,
  type RecognitionSources,
  type RunJournal,
  recognitionAccountWithoutClass
} from "@carbon/database/run-journals";
import { type AccountClass, chunkArray, isAccountClass } from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { InvalidInputError } from "../../errors";
import {
  insertProvisionalJournals,
  type LegacyJournal,
  ROWS_PER_STATEMENT,
  readByIds
} from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

/** The runs and disposals the enable wrote a journal for. */
export type LegacyRunCounts = Pick<
  LegacyDocumentCounts,
  "depreciationRuns" | "assetDisposals" | "revenueRecognitionRuns"
>;

/** A journal and the rows that store its id. */
type Built<T> = { journal: LegacyJournal; attach: T };

/** A built run journal, dated, with a new reference on each line. */
function legacyJournal(
  journal: RunJournal,
  postingDate: string
): LegacyJournal {
  return {
    description: journal.description,
    postingDate,
    sourceType: journal.sourceType,
    lines: journal.lines.map((line) => ({
      ...line,
      journalLineReference: nanoid()
    }))
  };
}

/** The month end of a `YYYY-MM-DD` date. */
function monthEndOf(date: string): string {
  return endOfMonth(parseDate(date)).toString();
}

// ---------------------------------------------------------------------------
// Depreciation
// ---------------------------------------------------------------------------

export type DepreciationRunLineRow = DepreciationRunLine & {
  depreciationRunId: string;
  runReadableId: string;
  journalId: string | null;
  deferredTaxJournalId: string | null;
};

/**
 * The depreciation journals the legacy lines miss: one per line with a book
 * amount and no journal, and one deferred tax journal per run and month with
 * none, with today's settings. A month whose lines all have no tax amount
 * was built with tax depreciation off, so it had no deferred tax journal.
 */
export function buildLegacyDepreciationJournals(
  rows: DepreciationRunLineRow[],
  settings: DeferredTaxSettings | null
): {
  depreciation: Built<{ runId: string; lineIds: string[] }>[];
  deferredTax: Built<{ runId: string; lineIds: string[] }>[];
} {
  const runByLine = new Map(rows.map((row) => [row.id, row.depreciationRunId]));
  const depreciation = buildDepreciationJournals(
    rows.filter((row) => row.journalId === null)
  ).map((journal) => ({
    journal: legacyJournal(journal, journal.monthEnd),
    attach: { runId: runByLine.get(journal.lineId)!, lineIds: [journal.lineId] }
  }));

  const runs = Map.groupBy(
    rows.filter((row) => row.deferredTaxJournalId === null),
    (row) => row.depreciationRunId
  );
  const deferredTax = [...runs].flatMap(([runId, runLines]) => {
    const taxedMonths = new Set(
      runLines
        .filter((row) => row.taxAmount !== null)
        .map((row) => row.monthEnd)
    );
    return buildDeferredTaxJournals({
      runReadableId: runLines[0]!.runReadableId,
      lines: runLines.filter((row) => taxedMonths.has(row.monthEnd)),
      settings
    }).map((journal) => ({
      journal: legacyJournal(journal, journal.monthEnd),
      attach: { runId, lineIds: journal.lineIds }
    }));
  });
  return { depreciation, deferredTax };
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

/** Scrap disposals on or after the cutover with no journal. The asset's
 *  cost and accumulated depreciation did not change after its disposal. */
async function loadDisposals(
  trx: KyselyTx,
  companyId: string,
  cutoverDate: string
): Promise<(Disposal & { id: string })[]> {
  const rows = await legacyDisposals(trx, { companyId, cutoverDate }).execute();
  return rows.map((row) => ({
    ...row,
    disposalMethod: REBUILT_DISPOSAL_METHOD,
    acquisitionCost: Number(row.acquisitionCost),
    accumulatedDepreciation: Number(row.accumulatedDepreciation)
  }));
}

// ---------------------------------------------------------------------------
// Revenue recognition
// ---------------------------------------------------------------------------

export type RecognitionRow = RecognitionScheduleRow & {
  runId: string;
  runReadableId: string;
  runPeriodEnd: string;
};

/**
 * The journals of the legacy recognition rows, one per run and month (the
 * row's `postingDate` is its month end). The run's journal is the one of its
 * own period, else its latest month's.
 */
export function buildLegacyRecognitionJournals(
  rows: RecognitionRow[],
  sources: RecognitionSources,
  classById: Map<string, AccountClass>
): Built<{
  runId: string;
  scheduleIds: string[];
  leaseScheduleLineIds: string[];
  isRunJournal: boolean;
}>[] {
  const unclassified = recognitionAccountWithoutClass(rows, classById);
  if (unclassified) {
    throw new InvalidInputError(
      `Account ${unclassified} on the revenue schedule has no class. Set its class in Accounting → Chart of Accounts.`
    );
  }
  return [...Map.groupBy(rows, (row) => row.runId)].flatMap(
    ([runId, runRows]) => {
      const { journals, runJournal } = buildRecognitionJournals({
        runReadableId: runRows[0]!.runReadableId,
        runPeriodEnd: runRows[0]!.runPeriodEnd,
        rows: runRows,
        sources,
        classById
      });
      return journals.map((journal) => ({
        journal: legacyJournal(journal, journal.postingDate),
        attach: {
          runId,
          scheduleIds: journal.scheduleIds,
          leaseScheduleLineIds: journal.leaseScheduleLineIds,
          isRunJournal: journal === runJournal
        }
      }));
    }
  );
}

/**
 * Schedule rows a Posted run recognized on or after the cutover, with no
 * journal, the sources their journal lines reference (the invoice, else the
 * rental agreement, else the contract) and the class of their accounts.
 */
async function loadRecognitionRows(
  trx: KyselyTx,
  companyId: string,
  companyGroupId: string,
  cutoverDate: string
): Promise<{
  rows: RecognitionRow[];
  sources: RecognitionSources;
  classById: Map<string, AccountClass>;
}> {
  const scheduled = await legacyRecognitionSchedule(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (scheduled.length === 0) {
    return {
      rows: [],
      sources: {
        invoiceLines: new Map(),
        rentalLines: new Map(),
        contractLines: new Map()
      },
      classById: new Map()
    };
  }

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

  const rows = scheduled.map(
    (row): RecognitionRow => ({
      scheduleId: row.scheduleId,
      runId: row.runId,
      runReadableId: row.runReadableId,
      runPeriodEnd: row.runPeriodEnd,
      // Every journal takes its own month: there is no period yet.
      postingDate: monthEndOf(row.scheduledDate),
      type: row.type,
      amount: Number(row.amount),
      debitAccountId: row.debitAccountId,
      creditAccountId: row.creditAccountId,
      salesInvoiceLineId: row.salesInvoiceLineId,
      rentalAgreementLineId: row.rentalAgreementLineId,
      customerContractLineId: row.customerContractLineId,
      rentalLeaseScheduleLineId: row.rentalLeaseScheduleLineId
    })
  );
  return {
    rows,
    sources: {
      invoiceLines: new Map(invoiceLines.map((row) => [row.id, row])),
      rentalLines: new Map(rentalLines.map((row) => [row.id, row])),
      contractLines: new Map(contractLines.map((row) => [row.id, row]))
    },
    classById
  };
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
  const taxSettings = deferredTaxSettings({
    enabled: settings?.assetTaxDepreciationEnabled,
    taxRate: Number(settings?.assetTaxRate ?? 0),
    dtlAccountId: defaults.deferredTaxLiabilityAccountId,
    dtExpenseAccountId: defaults.deferredTaxExpenseAccountId
  });

  const runLines = await loadDepreciationRunLines(trx, companyId, cutoverDate);
  const { depreciation, deferredTax } = buildLegacyDepreciationJournals(
    runLines,
    taxSettings
  );
  const disposalRows = await loadDisposals(trx, companyId, cutoverDate);
  const disposals = disposalRows.map((row) => {
    const journal = buildDisposalJournal(row);
    return {
      journal: legacyJournal(journal, journal.postingDate),
      attach: { disposalId: row.id }
    };
  });
  const recognitionFacts = await loadRecognitionRows(
    trx,
    companyId,
    companyGroupId,
    cutoverDate
  );
  const recognition = buildLegacyRecognitionJournals(
    recognitionFacts.rows,
    recognitionFacts.sources,
    recognitionFacts.classById
  );

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
    rows: recognitionIds.flatMap(({ item, journalId }) =>
      item.attach.leaseScheduleLineIds.map((id) => ({ id, journalId }))
    )
  });
  // The run names the journal of its own period, else its latest month's.
  await setJournalColumn(trx, {
    companyId,
    table: "revenueRecognitionRun",
    rows: recognitionIds
      .filter(({ item }) => item.attach.isRunJournal)
      .map(({ item, journalId }) => ({ id: item.attach.runId, journalId }))
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
