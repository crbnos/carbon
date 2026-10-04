// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Internal helpers shared by `post-customer-contract` and
// `create-contract-invoices`: lock and load a contract, translate its rows into
// the pure planner's types (`@carbon/database/contract-schedule`), and write
// what the planner returns. Every statement is scoped by `companyId`.
// Plan: .ai/plans/2026-10-03-contracts-phase-a.md Task 9 step 2.

import type { Database } from "@carbon/database";
import type { KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  type ContractLineTerms,
  type ContractPlannedInvoice,
  type ContractScheduleReconciliation,
  type ContractTerms,
  type ExistingRow,
  type PlannedRow,
  planInvoiceSchedule
} from "@carbon/database/contract-schedule";
import { toJson } from "@carbon/database/json";
import { round } from "@carbon/database/precision";
import { type Selectable, sql } from "kysely";
import { NotFoundError } from "../errors";

type Enums = Database["public"]["Enums"];

export type Scope = { companyId: string; userId: string };

export type ContractRow = Selectable<KyselyDatabase["customerContract"]>;
export type ContractLineRow = Selectable<
  KyselyDatabase["customerContractLine"]
>;
export type ContractInvoiceRow = {
  id: string;
  invoiceDate: string;
  status: Enums["contractInvoiceStatus"];
  isEdited: boolean;
  salesInvoiceId: string | null;
};

export type LoadedContract = {
  contract: ContractRow;
  lines: ContractLineRow[];
  /** Every persisted schedule row (memo-borne ones included), as the planner
   *  reads it. */
  existing: ExistingRow[];
  /** Every planned invoice, including any left without rows. */
  invoices: ContractInvoiceRow[];
};

const DATE_TEXT = (column: string) => sql<string>`${sql.ref(column)}::text`;

/** The columns a line copy (or an added line) carries over. */
export type LineFields = Omit<
  ContractLineRow,
  | "id"
  | "companyId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "salesOrderLineId"
>;

/** Insert values for a contract line copied from `line` with `overrides`.
 *  Every copy sets the same keys, so copies and added lines insert in one
 *  statement. The sales-order link never moves to a copy (it is unique per
 *  order line). */
export function copyLineValues(
  scope: Scope,
  line: LineFields,
  overrides: Partial<LineFields>
) {
  const merged = { ...line, ...overrides };
  return {
    customerContractId: merged.customerContractId,
    kind: merged.kind,
    itemId: merged.itemId,
    description: merged.description,
    quantity: merged.quantity,
    rate: merged.rate,
    rateUnit: merged.rateUnit,
    discountPercent: merged.discountPercent,
    discountEndsOn: merged.discountEndsOn,
    taxPercent: merged.taxPercent,
    startDate: merged.startDate,
    endDate: merged.endDate,
    goLiveDate: merged.goLiveDate,
    revenueMethod: merged.revenueMethod,
    revenueStartDate: merged.revenueStartDate,
    revenueEndDate: merged.revenueEndDate,
    amendmentId: merged.amendmentId,
    amendsLineId: merged.amendsLineId,
    salesOrderLineId: null,
    projectId: merged.projectId,
    sortOrder: merged.sortOrder,
    customFields: toJson(merged.customFields) ?? null,
    companyId: scope.companyId,
    createdBy: scope.userId
  };
}

/** Lines in their display order: sort order, start date, id. */
async function loadLines(
  trx: KyselyTx,
  companyId: string,
  contractId: string
): Promise<ContractLineRow[]> {
  const lines = await trx
    .selectFrom("customerContractLine")
    .selectAll()
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", companyId)
    .orderBy("sortOrder")
    .orderBy("startDate")
    .orderBy("id")
    .execute();
  return lines.map((line) => ({
    ...line,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    discountPercent: Number(line.discountPercent),
    taxPercent: Number(line.taxPercent)
  }));
}

/** The persisted schedule rows and invoices of a contract (no lock: the
 *  caller already holds the header lock, which serializes every writer). */
export async function loadSchedule(
  trx: KyselyTx,
  companyId: string,
  contractId: string
): Promise<{ existing: ExistingRow[]; invoices: ContractInvoiceRow[] }> {
  const invoices = await trx
    .selectFrom("customerContractInvoice")
    .select([
      "id",
      DATE_TEXT("invoiceDate").as("invoiceDate"),
      "status",
      "isEdited",
      "salesInvoiceId"
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", companyId)
    .orderBy("invoiceDate")
    .execute();

  const rows = await trx
    .selectFrom("customerContractInvoiceLine as r")
    .leftJoin("customerContractInvoice as i", (join) =>
      join
        .onRef("i.id", "=", "r.customerContractInvoiceId")
        .onRef("i.companyId", "=", "r.companyId")
    )
    .select([
      "r.id",
      "r.customerContractInvoiceId",
      sql<string | null>`i."invoiceDate"::text`.as("invoiceDate"),
      "i.status as invoiceStatus",
      "i.isEdited as invoiceIsEdited",
      "r.customerContractLineId",
      sql<string>`r."periodStart"::text`.as("periodStart"),
      sql<string>`r."periodEnd"::text`.as("periodEnd"),
      "r.units",
      "r.unitPrice",
      "r.amount",
      "r.isAdjustment",
      "r.memoId"
    ])
    .where("r.customerContractId", "=", contractId)
    .where("r.companyId", "=", companyId)
    .orderBy("r.periodStart")
    .orderBy("r.id")
    .execute();

  return {
    invoices: invoices.map((invoice) => ({
      ...invoice,
      isEdited: invoice.isEdited ?? false
    })),
    existing: rows.map((row) => ({
      id: row.id,
      invoiceId: row.customerContractInvoiceId,
      invoiceDate: row.invoiceDate,
      invoiceStatus: row.invoiceStatus ?? null,
      invoiceIsEdited: row.invoiceIsEdited ?? false,
      lineId: row.customerContractLineId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      units: Number(row.units),
      unitPrice: Number(row.unitPrice),
      amount: Number(row.amount),
      isAdjustment: row.isAdjustment ?? false,
      memoId: row.memoId
    }))
  };
}

/** Locks the contract header (`FOR UPDATE`) under `companyId` and loads its
 *  lines and every schedule row joined to its invoice. The lock serializes
 *  every action on one contract: a double-clicked Confirm, an amendment racing
 *  the daily invoicing job. Throws `NotFoundError` when the id is not a
 *  contract of the company. */
export async function loadContractForUpdate(
  trx: KyselyTx,
  companyId: string,
  id: string
): Promise<LoadedContract> {
  const contract = await trx
    .selectFrom("customerContract")
    .selectAll()
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!contract) throw new NotFoundError("Contract not found");

  const lines = await loadLines(trx, companyId, contract.id);
  const { existing, invoices } = await loadSchedule(
    trx,
    companyId,
    contract.id
  );
  return {
    contract: {
      ...contract,
      exchangeRate: Number(contract.exchangeRate),
      renewalUplift: Number(contract.renewalUplift)
    },
    lines,
    existing,
    invoices
  };
}

/** The contract's billing terms, as the planner reads them. */
export function toTerms(
  contract: Pick<
    ContractRow,
    | "startDate"
    | "endDate"
    | "billingFrequency"
    | "billingAlignment"
    | "billingTiming"
    | "firstInvoiceDate"
    | "billedThrough"
  >
): ContractTerms {
  return {
    startDate: contract.startDate,
    endDate: contract.endDate,
    billingFrequency: contract.billingFrequency,
    billingAlignment: contract.billingAlignment,
    billingTiming: contract.billingTiming,
    firstInvoiceDate: contract.firstInvoiceDate,
    billedThrough: contract.billedThrough
  };
}

/** The lines, as the planner reads them (input order is kept). */
export function toLineTerms(
  lines: Pick<
    ContractLineRow,
    | "id"
    | "kind"
    | "quantity"
    | "rate"
    | "rateUnit"
    | "discountPercent"
    | "startDate"
    | "endDate"
  >[]
): ContractLineTerms[] {
  return lines.map((line) => ({
    id: line.id,
    kind: line.kind,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    rateUnit: line.rateUnit,
    discountPercent: Number(line.discountPercent),
    startDate: line.startDate,
    endDate: line.endDate
  }));
}

/** How far a reconciliation plans: the horizon, or further when the persisted
 *  schedule already reaches past it — so a reconciliation never deletes rows
 *  an earlier horizon roll planned. `planInvoiceSchedule` still clips at the
 *  contract's end date. */
export function reconcileThrough(
  horizonDate: string,
  existing: Pick<ExistingRow, "periodEnd">[]
): string {
  let through = horizonDate;
  for (const row of existing) {
    if (row.periodEnd > through) through = row.periodEnd;
  }
  return through;
}

type RowValues = {
  customerContractId: string;
  customerContractInvoiceId: string | null;
  customerContractLineId: string;
  periodStart: string;
  periodEnd: string;
  units: number;
  unitPrice: number;
  amount: number;
  isAdjustment: boolean;
  memoId: string | null;
  companyId: string;
  createdBy: string;
};

/** One `customerContractInvoiceLine` insert value. Every row sets the same
 *  keys, so a multi-row insert never mixes a column's DEFAULT with values. */
export function scheduleRowValues(
  scope: Scope,
  contractId: string,
  row: Pick<
    PlannedRow,
    | "lineId"
    | "periodStart"
    | "periodEnd"
    | "units"
    | "unitPrice"
    | "amount"
    | "isAdjustment"
  >,
  parent: { invoiceId: string | null; memoId: string | null }
): RowValues {
  return {
    customerContractId: contractId,
    customerContractInvoiceId: parent.invoiceId,
    customerContractLineId: row.lineId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    units: round(row.units),
    unitPrice: round(row.unitPrice),
    amount: round(row.amount),
    isAdjustment: row.isAdjustment,
    memoId: parent.memoId,
    companyId: scope.companyId,
    createdBy: scope.userId
  };
}

export async function insertScheduleRows(
  trx: KyselyTx,
  rows: RowValues[]
): Promise<void> {
  if (rows.length === 0) return;
  await trx.insertInto("customerContractInvoiceLine").values(rows).execute();
}

const invoiceKey = (invoiceDate: string, status: string) =>
  `${invoiceDate}|${status}`;

/** Inserts one invoice per `(invoiceDate, status)` and returns their ids by
 *  that key. The keys must be unique in `wanted`. */
export async function insertContractInvoices(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  wanted: {
    invoiceDate: string;
    status: "Planned" | "Billed Externally";
    isEdited?: boolean;
  }[]
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (wanted.length === 0) return ids;
  const inserted = await trx
    .insertInto("customerContractInvoice")
    .values(
      wanted.map((invoice) => ({
        customerContractId: contractId,
        invoiceDate: invoice.invoiceDate,
        status: invoice.status,
        isEdited: invoice.isEdited ?? false,
        companyId: scope.companyId,
        createdBy: scope.userId
      }))
    )
    .returning(["id", DATE_TEXT("invoiceDate").as("invoiceDate"), "status"])
    .execute();
  for (const invoice of inserted) {
    ids.set(invoiceKey(invoice.invoiceDate, invoice.status), invoice.id);
  }
  return ids;
}

/** Writes planned invoices and their rows. */
async function insertPlannedInvoices(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  planned: ContractPlannedInvoice[]
): Promise<void> {
  const ids = await insertContractInvoices(trx, scope, contractId, planned);
  await insertScheduleRows(
    trx,
    planned.flatMap((invoice) => {
      const invoiceId = ids.get(
        invoiceKey(invoice.invoiceDate, invoice.status)
      )!;
      return invoice.rows.map((row) =>
        scheduleRowValues(scope, contractId, row, { invoiceId, memoId: null })
      );
    })
  );
}

/** Persists the computed schedule (`planInvoiceSchedule` through `through`):
 *  one `customerContractInvoice` per planned invoice, carrying its status
 *  (`Planned` / `Billed Externally`), and its rows. Called on a contract with
 *  no persisted rows — at Confirm, or by the first schedule edit. */
export async function materializeSchedule(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[],
  through: string
): Promise<void> {
  const planned = planInvoiceSchedule(
    toTerms(contract),
    toLineTerms(lines),
    through
  );
  await insertPlannedInvoices(trx, scope, contract.id, planned);
}

/** Bulk update of re-cut rows: one statement for all of them. */
async function recutRows(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  recut: ContractScheduleReconciliation["recut"]
): Promise<void> {
  if (recut.length === 0) return;
  const values = recut.map(
    (row) =>
      sql`(${row.id}::text, ${row.periodEnd}::date, ${round(row.units)}::numeric, ${round(row.unitPrice)}::numeric, ${round(row.amount)}::numeric)`
  );
  await sql`
    UPDATE "customerContractInvoiceLine" AS r
    SET "periodEnd" = v."periodEnd",
        "units" = v."units",
        "unitPrice" = v."unitPrice",
        "amount" = v."amount",
        "updatedBy" = ${scope.userId},
        "updatedAt" = now()
    FROM (VALUES ${sql.join(values)}) AS v("id", "periodEnd", "units", "unitPrice", "amount")
    WHERE r."id" = v."id"
      AND r."companyId" = ${scope.companyId}
      AND r."customerContractId" = ${contractId}
  `.execute(trx);
}

/** Applies a `reconcileContractSchedule` result, in this order:
 *
 *  1. deletes the rows in `deleteRowIds`, then the `Planned` invoices in
 *     `deleteInvoiceIds` (their rows cascade);
 *  2. re-cuts the rows in `recut`;
 *  3. inserts `create` — a group joins a kept invoice with the same date and
 *     status, else it gets a new invoice;
 *  4. inserts `adjustments`. With `adjustmentMemoId` they are memo-borne
 *     (no invoice). Otherwise each attaches to the `Planned` invoice of its
 *     `invoiceDate` (a created or kept one), inserting one when none exists. */
export async function applyReconciliation(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  result: ContractScheduleReconciliation,
  options: { adjustmentMemoId?: string | null } = {}
): Promise<void> {
  const { companyId } = scope;

  if (result.deleteRowIds.length > 0) {
    await trx
      .deleteFrom("customerContractInvoiceLine")
      .where("id", "in", result.deleteRowIds)
      .where("customerContractId", "=", contractId)
      .where("companyId", "=", companyId)
      .execute();
  }
  if (result.deleteInvoiceIds.length > 0) {
    await trx
      .deleteFrom("customerContractInvoice")
      .where("id", "in", result.deleteInvoiceIds)
      .where("customerContractId", "=", contractId)
      .where("companyId", "=", companyId)
      .where("status", "=", "Planned")
      .execute();
  }

  await recutRows(trx, scope, contractId, result.recut);

  const memoId = options.adjustmentMemoId ?? null;
  const adjustmentsOnInvoices = memoId ? [] : result.adjustments;
  const invoiceIds =
    result.create.length > 0 || adjustmentsOnInvoices.length > 0
      ? await resolveInvoiceIds(trx, scope, contractId, [
          ...result.create,
          ...adjustmentsOnInvoices.map((row) => ({
            invoiceDate: row.invoiceDate,
            status: "Planned" as const
          }))
        ])
      : new Map<string, string>();

  const rows: RowValues[] = [];
  for (const invoice of result.create) {
    const invoiceId = invoiceIds.get(
      invoiceKey(invoice.invoiceDate, invoice.status)
    )!;
    for (const row of invoice.rows) {
      rows.push(
        scheduleRowValues(scope, contractId, row, { invoiceId, memoId: null })
      );
    }
  }
  for (const row of adjustmentsOnInvoices) {
    rows.push(
      scheduleRowValues(scope, contractId, row, {
        invoiceId: invoiceIds.get(invoiceKey(row.invoiceDate, "Planned"))!,
        memoId: null
      })
    );
  }
  if (memoId) {
    for (const row of result.adjustments) {
      rows.push(
        scheduleRowValues(scope, contractId, row, { invoiceId: null, memoId })
      );
    }
  }
  await insertScheduleRows(trx, rows);
}

/** The id of the contract's invoice for each wanted `(invoiceDate, status)`:
 *  an existing `Planned` / `Billed Externally` invoice with that date and
 *  status, else a new one (one insert for all the missing ones). */
export async function resolveInvoiceIds(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  wanted: {
    invoiceDate: string;
    status: "Planned" | "Billed Externally";
  }[],
  options: { isEdited?: boolean } = {}
): Promise<Map<string, string>> {
  const existing = await trx
    .selectFrom("customerContractInvoice")
    .select(["id", DATE_TEXT("invoiceDate").as("invoiceDate"), "status"])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", scope.companyId)
    .where("status", "in", ["Planned", "Billed Externally"])
    .orderBy("id")
    .execute();
  const ids = new Map<string, string>();
  for (const invoice of existing) {
    const key = invoiceKey(invoice.invoiceDate, invoice.status);
    if (!ids.has(key)) ids.set(key, invoice.id);
  }

  const missing = new Map<
    string,
    {
      invoiceDate: string;
      status: "Planned" | "Billed Externally";
      isEdited?: boolean;
    }
  >();
  for (const invoice of wanted) {
    const key = invoiceKey(invoice.invoiceDate, invoice.status);
    if (!ids.has(key) && !missing.has(key)) {
      missing.set(key, {
        invoiceDate: invoice.invoiceDate,
        status: invoice.status,
        isEdited: options.isEdited
      });
    }
  }
  const inserted = await insertContractInvoices(trx, scope, contractId, [
    ...missing.values()
  ]);
  for (const [key, id] of inserted) ids.set(key, id);
  return ids;
}

export { invoiceKey };

/** Deletes the contract's `Planned` invoices that have no rows left. */
export async function deleteEmptyPlannedInvoices(
  trx: KyselyTx,
  scope: Scope,
  contractId: string
): Promise<void> {
  await trx
    .deleteFrom("customerContractInvoice as i")
    .where("i.customerContractId", "=", contractId)
    .where("i.companyId", "=", scope.companyId)
    .where("i.status", "=", "Planned")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("customerContractInvoiceLine as r")
            .select("r.id")
            .whereRef("r.customerContractInvoiceId", "=", "i.id")
            .whereRef("r.companyId", "=", "i.companyId")
        )
      )
    )
    .execute();
}
