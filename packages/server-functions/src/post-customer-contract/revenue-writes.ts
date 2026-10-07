// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The stored revenue plan of a contract (`customerContractRevenue`): one row
// per (line, calendar month). Shared by `post-customer-contract` and
// `create-contract-invoices`. Every statement is scoped by `companyId`, and
// each logical write is one set-based statement.
// Plan: `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part IV (D1, D2, D8, D9).

import type { KyselyTx } from "@carbon/database/client";
import {
  applyContractMovement,
  EMPTY_POSITION
} from "@carbon/database/contract-position";
import {
  type ContractRevenueRow,
  type ContractRevenueStatus,
  planRevenueSchedule,
  type RevenuePlanLine,
  reconcileRevenueSchedule
} from "@carbon/database/contract-revenue-schedule";
import {
  lineTotals,
  planInvoiceSchedule
} from "@carbon/database/contract-schedule";
import { equals, round } from "@carbon/database/precision";
import { sql } from "kysely";
import {
  type ContractLineRow,
  type ContractRow,
  type Scope,
  toLineTerms,
  toTerms
} from "./schedule-writes";

export type BilledTotals = {
  /** Σ every schedule row of the line (adjustments and memo credits included). */
  totals: Map<string, number>;
  /** The last `periodEnd` of the line's schedule rows. */
  lastPeriodEnds: Map<string, string>;
};

/** Plans the invoice schedule live when none is stored (an unedited Draft):
 *  the contract, its lines and how far to plan (`horizon`). */
export type LiveSchedule = {
  contract: ContractRow;
  lines: ContractLineRow[];
  through: string;
};

export type StoredRevenueRow = {
  id: string;
  lineId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: ContractRevenueStatus;
};

/**
 * What the invoice schedule bills each line. Reads the stored schedule rows;
 * with `live`, a contract that has none (an unedited Draft) is planned the
 * way the page plans it.
 */
export async function billedTotals(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  live?: LiveSchedule
): Promise<BilledTotals> {
  const rows = await trx
    .selectFrom("customerContractInvoiceLine")
    .select([
      "customerContractLineId",
      sql<number>`SUM("amount")`.as("total"),
      sql<string>`MAX("periodEnd")::text`.as("lastPeriodEnd")
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", scope.companyId)
    .groupBy("customerContractLineId")
    .execute();

  const totals = new Map<string, number>();
  const lastPeriodEnds = new Map<string, string>();
  if (rows.length === 0 && live) {
    const planned = planInvoiceSchedule(
      toTerms(live.contract),
      toLineTerms(live.lines),
      live.through
    );
    for (const [lineId, total] of lineTotals(planned))
      totals.set(lineId, total);
    for (const row of planned.flatMap((invoice) => invoice.rows)) {
      const last = lastPeriodEnds.get(row.lineId);
      if (!last || row.periodEnd > last) {
        lastPeriodEnds.set(row.lineId, row.periodEnd);
      }
    }
    return { totals, lastPeriodEnds };
  }
  for (const row of rows) {
    totals.set(row.customerContractLineId, round(Number(row.total)));
    lastPeriodEnds.set(row.customerContractLineId, row.lastPeriodEnd);
  }
  return { totals, lastPeriodEnds };
}

function toPlanLines(lines: ContractLineRow[]): RevenuePlanLine[] {
  return lines.map((line) => ({
    id: line.id,
    revenueType: line.revenueType,
    revenueMethod: line.revenueMethod,
    startDate: line.startDate,
    endDate: line.endDate,
    goLiveDate: line.goLiveDate,
    revenueStartDate: line.revenueStartDate,
    revenueEndDate: line.revenueEndDate
  }));
}

/** The revenue plan of `lines` from what the invoice schedule bills them. */
export async function plannedRevenue(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[],
  live?: Omit<LiveSchedule, "contract" | "lines">
): Promise<ContractRevenueRow[]> {
  const billed = await billedTotals(
    trx,
    scope,
    contract.id,
    live ? { contract, lines, through: live.through } : undefined
  );
  return planRevenueSchedule({
    lines: toPlanLines(lines),
    totals: billed.totals,
    fallbackEnds: billed.lastPeriodEnds,
    recognizeRevenueFrom: contract.recognizeRevenueFrom
  });
}

type RevenueValues = {
  customerContractId: string;
  customerContractLineId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: ContractRevenueStatus;
  companyId: string;
  createdBy: string;
};

function revenueValues(
  scope: Scope,
  contractId: string,
  row: ContractRevenueRow
): RevenueValues {
  return {
    customerContractId: contractId,
    customerContractLineId: row.lineId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    amount: round(row.amount),
    status: row.status,
    companyId: scope.companyId,
    createdBy: scope.userId
  };
}

async function insertRevenueRows(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  rows: ContractRevenueRow[]
): Promise<void> {
  if (rows.length === 0) return;
  await trx
    .insertInto("customerContractRevenue")
    .values(rows.map((row) => revenueValues(scope, contractId, row)))
    .execute();
}

/** Persists the live revenue plan. Called on a contract with no stored
 *  revenue rows — by the first revenue edit, at Confirm, or before an Active
 *  contract confirmed before Phase B is first reconciled. */
export async function materializeRevenue(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[],
  live?: Omit<LiveSchedule, "contract" | "lines">
): Promise<ContractRevenueRow[]> {
  const rows = await plannedRevenue(trx, scope, contract, lines, live);
  await insertRevenueRows(trx, scope, contract.id, rows);
  return rows;
}

/** The contract's stored revenue rows, in line and month order. */
export async function loadRevenue(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  lineIds?: string[]
): Promise<StoredRevenueRow[]> {
  if (lineIds && lineIds.length === 0) return [];
  let query = trx
    .selectFrom("customerContractRevenue")
    .select([
      "id",
      "customerContractLineId",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      "amount",
      "status"
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", scope.companyId);
  if (lineIds) query = query.where("customerContractLineId", "in", lineIds);
  const rows = await query
    .orderBy("customerContractLineId")
    .orderBy("periodStart")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    lineId: row.customerContractLineId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    amount: Number(row.amount),
    status: row.status
  }));
}

/** Whether the contract has any stored revenue row. */
export async function hasStoredRevenue(
  trx: KyselyTx,
  scope: Scope,
  contractId: string
): Promise<boolean> {
  const row = await trx
    .selectFrom("customerContractRevenue")
    .select("id")
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", scope.companyId)
    .limit(1)
    .executeTakeFirst();
  return !!row;
}

/** Materializes the revenue plan when none is stored. Returns true when it
 *  wrote one. */
export async function ensureRevenue(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[]
): Promise<boolean> {
  if (await hasStoredRevenue(trx, scope, contract.id)) return false;
  await materializeRevenue(trx, scope, contract, lines);
  return true;
}

/**
 * Reconcile, never rewrite (D9), for each line in `lineIds`: kept rows
 * (Recognized, Recognized Externally, Planned before `from`'s month) stay; the
 * line's Planned rows from that month on are replaced by the new plan; any
 * difference to the new plan's total lands on the first month on or after
 * `from` that is not kept. One delete and one insert for every line.
 */
export async function reconcileRevenue(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[],
  lineIds: string[],
  from: string
): Promise<void> {
  const known = new Set(lines.map((line) => line.id));
  const ids = [...new Set(lineIds)].filter((id) => known.has(id));
  if (ids.length === 0) return;

  // A Planned month the recognition run has already synthesized (its schedule
  // rows wait in a Draft run) is in flight: it is kept like a Recognized one,
  // so the run never loses the month it is about to post.
  const inFlight = new Set(
    (
      await trx
        .selectFrom("revenueRecognitionSchedule")
        .select("customerContractRevenueId")
        .where("companyId", "=", scope.companyId)
        .where("customerContractLineId", "in", ids)
        .where("customerContractRevenueId", "is not", null)
        .execute()
    ).map((row) => row.customerContractRevenueId!)
  );
  const existing = (await loadRevenue(trx, scope, contract.id, ids)).map(
    (row) =>
      row.status === "Planned" && inFlight.has(row.id)
        ? { ...row, status: "Recognized" as const }
        : row
  );
  const planned = await plannedRevenue(trx, scope, contract, lines);

  const replaced: { lineId: string; replaceFrom: string }[] = [];
  const inserts: ContractRevenueRow[] = [];
  for (const lineId of ids) {
    const result = reconcileRevenueSchedule({
      lineId,
      existing: existing.filter((row) => row.lineId === lineId),
      planned,
      from
    });
    replaced.push({ lineId, replaceFrom: result.replaceFrom });
    inserts.push(...result.rows);
  }

  const values = replaced.map(
    (row) => sql`(${row.lineId}::text, ${row.replaceFrom}::date)`
  );
  await sql`
    DELETE FROM "customerContractRevenue" AS r
    USING (VALUES ${sql.join(values)}) AS v("lineId", "replaceFrom")
    WHERE r."customerContractLineId" = v."lineId"
      AND r."periodStart" >= v."replaceFrom"
      AND r."status" = 'Planned'
      AND r."companyId" = ${scope.companyId}
      AND r."customerContractId" = ${contract.id}
      AND NOT EXISTS (
        SELECT 1 FROM "revenueRecognitionSchedule" s
        WHERE s."customerContractRevenueId" = r."id"
          AND s."companyId" = r."companyId"
      )
  `.execute(trx);
  await insertRevenueRows(trx, scope, contract.id, inserts);
}

/** The lines whose revenue plan may have changed between two states of a
 *  contract: a line that is new, whose terms changed, or whose billed total
 *  or last billed period moved. */
export function changedRevenueLines(
  before: { lines: ContractLineRow[]; billed: BilledTotals },
  after: { lines: ContractLineRow[]; billed: BilledTotals }
): string[] {
  const previous = new Map(before.lines.map((line) => [line.id, line]));
  const changed: string[] = [];
  for (const line of after.lines) {
    const old = previous.get(line.id);
    const termsChanged =
      !old ||
      old.startDate !== line.startDate ||
      old.endDate !== line.endDate ||
      old.goLiveDate !== line.goLiveDate ||
      old.revenueStartDate !== line.revenueStartDate ||
      old.revenueEndDate !== line.revenueEndDate ||
      old.revenueMethod !== line.revenueMethod;
    const billedChanged =
      !equals(
        before.billed.totals.get(line.id) ?? 0,
        after.billed.totals.get(line.id) ?? 0
      ) ||
      before.billed.lastPeriodEnds.get(line.id) !==
        after.billed.lastPeriodEnds.get(line.id);
    if (termsChanged || billedChanged) changed.push(line.id);
  }
  return changed;
}

/**
 * D8 — the opening position of a migrated contract, written at Confirm: per
 * line, Σ its `Billed Externally` schedule rows − Σ its `Recognized
 * Externally` revenue rows, applied to an empty position at the contract's
 * rate. No journal: the customer's own opening journal carries the balance.
 */
export async function writeOpeningEntries(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow
): Promise<void> {
  const billed = await trx
    .selectFrom("customerContractInvoiceLine as r")
    .innerJoin("customerContractInvoice as i", (join) =>
      join
        .onRef("i.id", "=", "r.customerContractInvoiceId")
        .onRef("i.companyId", "=", "r.companyId")
    )
    .select([
      "r.customerContractLineId",
      sql<number>`SUM(r."amount")`.as("total")
    ])
    .where("r.customerContractId", "=", contract.id)
    .where("r.companyId", "=", scope.companyId)
    .where("i.status", "=", "Billed Externally")
    .groupBy("r.customerContractLineId")
    .execute();
  const recognized = await trx
    .selectFrom("customerContractRevenue")
    .select(["customerContractLineId", sql<number>`SUM("amount")`.as("total")])
    .where("customerContractId", "=", contract.id)
    .where("companyId", "=", scope.companyId)
    .where("status", "=", "Recognized Externally")
    .groupBy("customerContractLineId")
    .execute();

  const opening = new Map<string, number>();
  for (const row of billed) {
    opening.set(row.customerContractLineId, Number(row.total));
  }
  for (const row of recognized) {
    opening.set(
      row.customerContractLineId,
      (opening.get(row.customerContractLineId) ?? 0) - Number(row.total)
    );
  }

  const entries = [...opening]
    .map(([lineId, amount]) => ({ lineId, amount: round(amount) }))
    .filter(({ amount }) => !equals(amount, 0))
    .map(({ lineId, amount }) => {
      const movement = applyContractMovement({
        position: EMPTY_POSITION,
        amount,
        rate: Number(contract.exchangeRate),
        counterpart: "receivable"
      });
      return {
        customerContractId: contract.id,
        customerContractLineId: lineId,
        entryType: "Opening" as const,
        postingDate: contract.startDate,
        journalId: null,
        deferredAmount: movement.deferredAmount,
        deferredBase: movement.deferredBase,
        assetAmount: movement.assetAmount,
        assetBase: movement.assetBase,
        companyId: scope.companyId,
        createdBy: scope.userId
      };
    });
  if (entries.length === 0) return;
  await trx.insertInto("customerContractLedgerEntry").values(entries).execute();
}
