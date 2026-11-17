// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Journal entries from another accounting system, one row per journal line.
// Spec: .ai/specs/2026-11-14-journal-entry-import.md

import { isDataLayerError } from "@carbon/api/errors";
import type { ServiceContext } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime, isBalanced, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { type Kysely, sql } from "kysely";
import { JOURNAL_BALANCE_TOLERANCE } from "~/modules/accounting/accounting.models";
import {
  ACCOUNTING_NOT_STARTED,
  postJournalEntry,
  saveJournalEntryWithLines
} from "~/modules/accounting/accounting.service";
import {
  hasAccountingCutover,
  periodPostingRefusal
} from "~/modules/accounting/accounting.utils";
import { parseTrialBalanceAmount } from "~/modules/accounting/trial-balance-csv";
import { journalEntryImportStatuses } from "./imports.models";
import { inChunks, invokeCreate, normalizeLookupName } from "./shared.service";

const logger = getLogger("erp", "shared", "journal-entry-import");

type Rec = Record<string, string>;
type Issue = { row: number; reason: string };

type Summary = {
  inserted: number;
  updated: number;
  errors: Issue[];
  skipped: Issue[];
};

type DimensionEntityType = Database["public"]["Enums"]["dimensionEntityType"];

export type JournalEntryImportStatus =
  (typeof journalEntryImportStatuses)[number];

export const JOURNAL_ENTRY_DIMENSION_SLOTS = [1, 2, 3] as const;

const JOURNAL_MAPPING_ENTITY = "journal";
const CSV_INTEGRATION = "csv";

export type JournalEntryImportRow = {
  reference: string;
  postingDate: string;
  accountNumber: string;
  debit: number;
  credit: number;
  description: string;
  journalDescription: string;
  status: JournalEntryImportStatus;
  dimensions: Array<{ slot: number; dimensionId: string; value: string }>;
};

export type JournalEntryImportLookups = {
  accountIdByNumber: ReadonlyMap<string, string>;
  dimensions: ReadonlyMap<string, { name: string }>;
  /** Per dimension id: the value ids under each normalized value name. */
  dimensionValueIds: ReadonlyMap<string, ReadonlyMap<string, string[]>>;
  periods: ReadonlyArray<{
    startDate: string;
    endDate: string;
    closeStatus: string;
  }>;
  hasCutover: boolean;
  /**
   * The newest closing snapshot's date. Balances start from it and add only
   * journals dated after it, so a journal on or before it would be in the
   * ledger but in no balance.
   */
  latestSnapshotDate: string | null;
  /** References a previous import wrote, with their journal entry number. */
  importedReferences: ReadonlyMap<string, string>;
};

export type PlannedJournalLine = {
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
  dimensions: Array<{ dimensionId: string; valueId: string }>;
};

export type PlannedJournalEntry = {
  reference: string;
  rows: number[];
  postingDate: string;
  description: string;
  status: JournalEntryImportStatus;
  lines: PlannedJournalLine[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  try {
    return parseDate(value).toString() === value;
  } catch {
    return false;
  }
}

function readAmount(
  value: string | undefined,
  label: "Debit" | "Credit"
): { amount: number } | { error: string } {
  const result = parseTrialBalanceAmount(value);
  if (!("error" in result)) return result;
  return result.error === "ambiguous-amount"
    ? {
        error: `${label} "${(value ?? "").trim()}" has a comma. Write amounts with a point for decimals and no thousands separator, such as 1234.56`
      }
    : { error: `${label} must be a number of 0 or more` };
}

/** A row's own checks; the plan checks its account and dimension values. */
export function readJournalEntryRow(
  record: Rec
): { row: JournalEntryImportRow } | { error: string } {
  const reference = (record.journalReference ?? "").trim();
  if (!reference) return { error: "Journal Reference is required" };

  const postingDate = (record.postingDate ?? "").trim();
  if (!isCalendarDate(postingDate)) {
    return { error: "Posting Date must be a date as YYYY-MM-DD" };
  }

  const accountNumber = (record.accountNumber ?? "").trim();
  if (!accountNumber) return { error: "Account Number is required" };

  const debit = readAmount(record.debit, "Debit");
  if ("error" in debit) return debit;
  const credit = readAmount(record.credit, "Credit");
  if ("error" in credit) return credit;
  // The manual journal entry's rule (`saveJournalEntry`).
  if (
    (debit.amount <= 0 && credit.amount <= 0) ||
    (debit.amount > 0 && credit.amount > 0)
  ) {
    return { error: "Each line must have either a debit or credit amount" };
  }

  // Blank (no column, Default cleared) is a Draft, as a new manual entry is.
  const statusText = (record.status ?? "").trim() || "Draft";
  const status = journalEntryImportStatuses.find(
    (option) => option === statusText
  );
  if (!status) return { error: "Status must be Draft or Posted" };

  const dimensions: JournalEntryImportRow["dimensions"] = [];
  for (const slot of JOURNAL_ENTRY_DIMENSION_SLOTS) {
    const dimensionId = (record[`dimension${slot}`] ?? "").trim();
    const value = (record[`dimension${slot}Value`] ?? "").trim();
    if (!value) continue;
    if (!dimensionId) {
      return {
        error: `Dimension ${slot} Value has no dimension. Choose the dimension for Dimension ${slot}`
      };
    }
    // journalLineDimension is unique on (line, dimension): one value each.
    if (dimensions.some((d) => d.dimensionId === dimensionId)) {
      return {
        error: `Dimension ${slot} names a dimension another Dimension column already names`
      };
    }
    dimensions.push({ slot, dimensionId, value });
  }

  return {
    row: {
      reference,
      postingDate,
      accountNumber,
      debit: debit.amount,
      credit: credit.amount,
      description: (record.description ?? "").trim(),
      journalDescription: (record.journalDescription ?? "").trim(),
      status,
      dimensions
    }
  };
}

function resolveLine(
  row: JournalEntryImportRow,
  lookups: JournalEntryImportLookups
): { line: PlannedJournalLine } | { error: string } {
  const accountId = lookups.accountIdByNumber.get(row.accountNumber);
  if (!accountId) {
    return {
      error: `Account "${row.accountNumber}" was not found in the chart of accounts`
    };
  }
  const dimensions: PlannedJournalLine["dimensions"] = [];
  for (const { slot, dimensionId, value } of row.dimensions) {
    const dimension = lookups.dimensions.get(dimensionId);
    if (!dimension) {
      return { error: `Dimension ${slot} is not an active dimension` };
    }
    const valueIds =
      lookups.dimensionValueIds
        .get(dimensionId)
        ?.get(normalizeLookupName(value)) ?? [];
    if (valueIds.length === 0) {
      return { error: `${dimension.name} "${value}" was not found` };
    }
    if (valueIds.length > 1) {
      return {
        error: `${dimension.name} "${value}" matches more than one value`
      };
    }
    dimensions.push({ dimensionId, valueId: valueIds[0]! });
  }
  return {
    line: {
      accountId,
      description: row.description || undefined,
      debit: row.debit,
      credit: row.credit,
      dimensions
    }
  };
}

/**
 * Rows group by Journal Reference, in first-appearance order. A journal is
 * whole or nothing: any refusal puts every row of it in `errors`, so the rows
 * to fix and import again are the whole journal. A reference a previous
 * import wrote is skipped.
 */
export function planJournalEntryImport(
  records: Rec[],
  lookups: JournalEntryImportLookups
): { journals: PlannedJournalEntry[]; errors: Issue[]; skipped: Issue[] } {
  const errors: Issue[] = [];
  const skipped: Issue[] = [];
  const journals: PlannedJournalEntry[] = [];

  const rowsByReference = new Map<string, number[]>();
  records.forEach((record, index) => {
    const reference = (record.journalReference ?? "").trim();
    if (!reference) {
      errors.push({ row: index, reason: "Journal Reference is required" });
      return;
    }
    const rows = rowsByReference.get(reference) ?? [];
    rows.push(index);
    rowsByReference.set(reference, rows);
  });

  for (const [reference, rows] of rowsByReference) {
    const refuse = (reason: string) => {
      for (const row of rows) errors.push({ row, reason });
    };

    const imported = lookups.importedReferences.get(reference);
    if (imported !== undefined) {
      for (const row of rows) {
        skipped.push({
          row,
          reason: `Journal ${reference} was imported before as ${imported}`
        });
      }
      continue;
    }

    const read: JournalEntryImportRow[] = [];
    const lines: PlannedJournalLine[] = [];
    const rowErrors = new Map<number, string>();
    for (const row of rows) {
      const result = readJournalEntryRow(records[row]!);
      const resolved =
        "error" in result ? result : resolveLine(result.row, lookups);
      if ("error" in resolved) {
        rowErrors.set(row, resolved.error);
        continue;
      }
      if ("row" in result) read.push(result.row);
      lines.push(resolved.line);
    }
    if (rowErrors.size > 0) {
      for (const row of rows) {
        errors.push({
          row,
          reason:
            rowErrors.get(row) ??
            `Not imported: another row of journal ${reference} needs fixing`
        });
      }
      continue;
    }

    const first = read[0]!;
    if (read.some((row) => row.postingDate !== first.postingDate)) {
      refuse(`Journal ${reference} has rows with different posting dates`);
      continue;
    }
    if (read.some((row) => row.status !== first.status)) {
      refuse(`Journal ${reference} has rows with different statuses`);
      continue;
    }

    const debits = read.reduce((sum, row) => sum + row.debit, 0);
    const credits = read.reduce((sum, row) => sum + row.credit, 0);
    // The manual journal entry's test (`postJournalEntry`), for a Draft too:
    // the file is the legacy books, and an unbalanced journal is a broken one.
    if (!isBalanced(debits, credits, JOURNAL_BALANCE_TOLERANCE)) {
      refuse(
        `Journal ${reference} does not balance: debits ${round(debits)}, credits ${round(credits)}`
      );
      continue;
    }

    if (first.status === "Posted" && !lookups.hasCutover) {
      refuse(`Journal ${reference}: ${ACCOUNTING_NOT_STARTED}`);
      continue;
    }

    // A manual journal posts as an "accounting" source: a Closed period
    // refuses it, a Locked one accepts it. A Draft is held to the same rule,
    // so the import never leaves a Draft that cannot post.
    const period = lookups.periods.find(
      (p) => p.startDate <= first.postingDate && first.postingDate <= p.endDate
    );
    const refusal = period
      ? periodPostingRefusal(period.closeStatus, "accounting")
      : null;
    if (refusal) {
      refuse(`Journal ${reference}: ${refusal}`);
      continue;
    }

    if (
      lookups.latestSnapshotDate &&
      first.postingDate <= lookups.latestSnapshotDate
    ) {
      refuse(
        `Journal ${reference}: dated on or before ${lookups.latestSnapshotDate}, the end of the latest closed period. Reopen the periods back to this date first.`
      );
      continue;
    }

    journals.push({
      reference,
      rows,
      postingDate: first.postingDate,
      description:
        read.find((row) => row.journalDescription)?.journalDescription ??
        reference,
      status: first.status,
      lines
    });
  }

  return { journals, errors, skipped };
}

// Values match the label the journal form's DimensionSelector shows.
const ENTITY_DIMENSION_SOURCES: Record<
  Exclude<DimensionEntityType, "Custom">,
  { table: string; label: string; only?: "active" | "isChargeable" }
> = {
  Location: { table: "location", label: "name" },
  ItemPostingGroup: { table: "itemPostingGroup", label: "name" },
  SupplierType: { table: "supplierType", label: "name" },
  CustomerType: { table: "customerType", label: "name" },
  Department: { table: "department", label: "name" },
  Employee: { table: "employeeSummary", label: "name" },
  CostCenter: { table: "costCenter", label: "name" },
  WorkCenter: { table: "workCenter", label: "name" },
  Process: { table: "process", label: "name" },
  FixedAssetClass: { table: "fixedAssetClass", label: "name" },
  Customer: { table: "customer", label: "name" },
  Supplier: { table: "supplier", label: "name" },
  Item: { table: "item", label: "readableIdWithRevision" },
  ScrapReason: { table: "scrapReason", label: "name" },
  // Only what the form offers: active projects, chargeable elements by number.
  Project: { table: "project", label: "name", only: "active" },
  ProjectElement: {
    table: "projectElement",
    label: "readableId",
    only: "isChargeable"
  }
};

function groupIdsByName(rows: Array<{ id: string; label: string | null }>) {
  const idsByName = new Map<string, string[]>();
  for (const { id, label } of rows) {
    if (!label) continue;
    const key = normalizeLookupName(label);
    const ids = idsByName.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    idsByName.set(key, ids);
  }
  return idsByName;
}

function distinct<T extends string>(values: Iterable<T>): T[] {
  return [...new Set([...values].filter((value) => value !== ""))];
}

async function loadJournalEntryImportLookups(
  db: Kysely<KyselyDatabase>,
  {
    records,
    companyId,
    companyGroupId
  }: { records: Rec[]; companyId: string; companyGroupId: string }
): Promise<JournalEntryImportLookups> {
  const text = (value: string | undefined) => (value ?? "").trim();
  const accountNumbers = distinct(records.map((r) => text(r.accountNumber)));
  const references = distinct(records.map((r) => text(r.journalReference)));
  const dates = distinct(
    records.map((r) => text(r.postingDate)).filter(isCalendarDate)
  ).sort();
  const valueNamesByDimension = new Map<string, Set<string>>();
  for (const record of records) {
    for (const slot of JOURNAL_ENTRY_DIMENSION_SLOTS) {
      const dimensionId = text(record[`dimension${slot}`]);
      const value = text(record[`dimension${slot}Value`]);
      if (!dimensionId || !value) continue;
      const names = valueNamesByDimension.get(dimensionId) ?? new Set();
      names.add(normalizeLookupName(value));
      valueNamesByDimension.set(dimensionId, names);
    }
  }

  const [accounts, dimensionRows, periods, settings, snapshot, imported] =
    await Promise.all([
      inChunks(accountNumbers, (chunk) =>
        db
          .selectFrom("account")
          .select(["id", "number"])
          .where("companyGroupId", "=", companyGroupId)
          .where("isGroup", "=", false)
          .where("active", "=", true)
          .where("number", "in", chunk)
          .execute()
      ),
      valueNamesByDimension.size === 0
        ? []
        : db
            .selectFrom("dimension")
            .select(["id", "name", "entityType"])
            .where("companyGroupId", "=", companyGroupId)
            .where("active", "=", true)
            .where("id", "in", [...valueNamesByDimension.keys()])
            .execute(),
      dates.length === 0
        ? []
        : db
            .selectFrom("accountingPeriod")
            .select([
              sql<string>`"startDate"::text`.as("startDate"),
              sql<string>`"endDate"::text`.as("endDate"),
              "closeStatus"
            ])
            .where("companyId", "=", companyId)
            .where("endDate", ">=", dates[0]!)
            .where("startDate", "<=", dates[dates.length - 1]!)
            .execute(),
      db
        .selectFrom("companySettings")
        .select("accountingCutoverDate")
        .where("id", "=", companyId)
        .executeTakeFirst(),
      db
        .selectFrom("accountingPeriodBalance")
        .select(sql<string | null>`MAX("endingBalanceDate")::text`.as("date"))
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
      // A mapping counts only while its journal exists: a deleted Draft can
      // be imported again.
      inChunks(references, (chunk) =>
        db
          .selectFrom("externalIntegrationMapping as mapping")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "mapping.entityId")
              .onRef("journal.companyId", "=", "mapping.companyId")
          )
          .select(["mapping.externalId", "journal.journalEntryId"])
          .where("mapping.integration", "=", CSV_INTEGRATION)
          .where("mapping.entityType", "=", JOURNAL_MAPPING_ENTITY)
          .where("mapping.companyId", "=", companyId)
          .where("mapping.externalId", "in", chunk)
          .execute()
      )
    ]);

  const customIds = dimensionRows
    .filter((d) => d.entityType === "Custom")
    .map((d) => d.id);
  const entityTypes = distinct(dimensionRows.map((d) => d.entityType)).filter(
    (type): type is Exclude<DimensionEntityType, "Custom"> => type !== "Custom"
  );
  const namesOf = (types: DimensionEntityType[]) =>
    distinct(
      dimensionRows
        .filter((d) => types.includes(d.entityType))
        .flatMap((d) => [...(valueNamesByDimension.get(d.id) ?? [])])
    );

  const [customValues, ...entityValues] = await Promise.all([
    customIds.length === 0
      ? []
      : inChunks(namesOf(["Custom"]), (chunk) =>
          db
            .selectFrom("dimensionValue")
            .select(["id", "name as label", "dimensionId"])
            .where("companyGroupId", "=", companyGroupId)
            .where("dimensionId", "in", customIds)
            .where(sql<string>`lower(trim("name"))`, "in", chunk)
            .execute()
        ),
    ...entityTypes.map((type) => {
      const source = ENTITY_DIMENSION_SOURCES[type];
      return inChunks(namesOf([type]), (chunk) => {
        let query = db
          // The table varies by type; each has an id and a companyId.
          .selectFrom(source.table as "location")
          .select([
            sql<string>`${sql.ref("id")}`.as("id"),
            sql<string | null>`${sql.ref(source.label)}`.as("label")
          ])
          .where(sql.ref("companyId"), "=", companyId)
          .where(sql`lower(trim(${sql.ref(source.label)}))`, "in", chunk);
        if (source.only) query = query.where(sql.ref(source.only), "=", true);
        return query.execute();
      });
    })
  ]);

  const valuesByType = new Map(
    entityTypes.map((type, index) => [
      type,
      groupIdsByName(entityValues[index] ?? [])
    ])
  );
  const dimensionValueIds = new Map<string, Map<string, string[]>>();
  for (const dimension of dimensionRows) {
    dimensionValueIds.set(
      dimension.id,
      dimension.entityType === "Custom"
        ? groupIdsByName(
            customValues.filter((v) => v.dimensionId === dimension.id)
          )
        : (valuesByType.get(dimension.entityType) ?? new Map())
    );
  }

  return {
    accountIdByNumber: new Map(
      accounts.flatMap((account) =>
        account.number ? [[account.number, account.id] as const] : []
      )
    ),
    dimensions: new Map(dimensionRows.map((d) => [d.id, { name: d.name }])),
    dimensionValueIds,
    periods,
    hasCutover: hasAccountingCutover(settings),
    latestSnapshotDate: snapshot?.date ?? null,
    importedReferences: new Map(
      imported.flatMap((row) =>
        row.externalId ? [[row.externalId, row.journalEntryId] as const] : []
      )
    )
  };
}

/** A failure's own message, unless it is a database error, which is logged. */
function reasonOf(err: unknown, fallback: string, context: object) {
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message !== "" && !isDataLayerError(err)) {
    return message;
  }
  logger.error(fallback, { ...context, error: err });
  return fallback;
}

/**
 * Writes each journal in file order through the manual journal entry's
 * building blocks, as the caller, so its number, Manual source, period rules
 * and audit trail are a manual entry's. A journal that fails part-way is
 * deleted while still a Draft.
 *
 * Each journal claims its reference in `externalIntegrationMapping` right
 * after it is created, before its lines are saved or it is posted, so a
 * retried or overlapping import of the same file never writes a reference
 * twice: the claim succeeds only when no existing journal holds the
 * reference, and the import that loses it deletes its empty Draft.
 */
export async function importJournalEntries(
  ctx: ServiceContext,
  { mappedRecords, summary }: { mappedRecords: Rec[]; summary: Summary }
) {
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const companyGroupId = ctx.company.groupId;
  const userId = ctx.auditUserId;

  const lookups = await loadJournalEntryImportLookups(db, {
    records: mappedRecords,
    companyId,
    companyGroupId
  });
  const plan = planJournalEntryImport(mappedRecords, lookups);
  summary.errors.push(...plan.errors);
  summary.skipped.push(...plan.skipped);

  const discardDraft = (journalId: string) =>
    db
      .deleteFrom("journal")
      .where("id", "=", journalId)
      .where("companyId", "=", companyId)
      .where("status", "=", "Draft")
      .execute();

  for (const journal of plan.journals) {
    const refuse = (reason: string) => {
      for (const row of journal.rows) {
        summary.errors.push({
          row,
          reason: `Journal ${journal.reference} was not imported: ${reason}`
        });
      }
    };
    const context = { companyId, reference: journal.reference };

    const created = await invokeCreate(ctx, { type: "journalEntry" });
    if (created.error || !created.data) {
      refuse(
        reasonOf(created.error, "Failed to create journal entry", context)
      );
      continue;
    }
    const journalId = String(created.data.id);

    let claimed: string | undefined;
    try {
      claimed = await claimJournalReference(db, {
        journalId,
        reference: journal.reference,
        companyId,
        userId
      });
    } catch (err) {
      await discardDraft(journalId);
      refuse(reasonOf(err, "Failed to record the journal reference", context));
      continue;
    }
    if (claimed !== journalId) {
      await discardDraft(journalId);
      for (const row of journal.rows) {
        summary.skipped.push({
          row,
          reason: `Journal ${journal.reference} was imported by another import at the same time`
        });
      }
      continue;
    }

    const saved = await saveJournalEntryWithLines(ctx.asCaller.supabase, {
      journalEntryId: journalId,
      postingDate: journal.postingDate,
      description: journal.description,
      updatedBy: userId,
      lines: journal.lines,
      companyId,
      companyGroupId
    });
    if (saved.error) {
      await discardDraft(journalId);
      refuse(reasonOf(saved.error, "Failed to save journal entry", context));
      continue;
    }

    if (journal.status === "Posted") {
      const posted = await postJournalEntry(
        ctx.asCaller.supabase,
        journalId,
        userId
      );
      if (posted.error) {
        await discardDraft(journalId);
        refuse(reasonOf(posted.error, "Failed to post journal entry", context));
        continue;
      }
    }

    summary.inserted += 1;
  }
}

/**
 * Points the reference's mapping at the journal and returns the journal the
 * mapping names afterwards. A mapping whose journal still exists is kept, so
 * the returned id differs from `journalId` when another import holds the
 * reference; a mapping left by a deleted journal is taken over.
 */
async function claimJournalReference(
  db: Kysely<KyselyDatabase>,
  {
    journalId,
    reference,
    companyId,
    userId
  }: { journalId: string; reference: string; companyId: string; userId: string }
) {
  const now = datetime.timestamp();
  const row = await db
    .insertInto("externalIntegrationMapping")
    .values({
      entityType: JOURNAL_MAPPING_ENTITY,
      entityId: journalId,
      integration: CSV_INTEGRATION,
      externalId: reference,
      companyId,
      allowDuplicateExternalId: false,
      createdBy: userId,
      createdAt: now,
      updatedAt: now
    })
    .onConflict((oc) =>
      oc
        .columns(["integration", "externalId", "entityType", "companyId"])
        .where("allowDuplicateExternalId", "=", false)
        .doUpdateSet((eb) => ({
          entityId: eb.ref("excluded.entityId"),
          updatedAt: eb.ref("excluded.updatedAt")
        }))
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("journal")
                .select("journal.id")
                .whereRef(
                  "journal.id",
                  "=",
                  "externalIntegrationMapping.entityId"
                )
                .whereRef(
                  "journal.companyId",
                  "=",
                  "externalIntegrationMapping.companyId"
                )
            )
          )
        )
    )
    .returning("entityId")
    .executeTakeFirst();
  return row?.entityId;
}
