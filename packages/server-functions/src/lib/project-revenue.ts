// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project contract revenue in the monthly recognition run (Phase 4b). The
// community Right to Invoice synthesizer lives here, with the writers it
// shares with the commercial Percent Complete synthesizer
// (`@carbon/ee/project-revenue.server`, which imports them from
// `@carbon/server-functions/lib/project-revenue`).
//
// Each synthesizer rebuilds the run's month of each progress line (R5): it
// deletes the line's Planned schedule rows and Planned month row of that
// month, then writes a new month row (`customerContractRevenue`) and the Cost
// Relief rows. `synthesizeContractRevenue` runs after it and moves the month
// row through the contract position, as for a planned month.
// Plan: `.ai/plans/2026-10-09-project-billing-phase-4b.md` (decisions R1–R8).

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { formatIsoDate, parseIsoDate, round } from "@carbon/utils";
import { sql } from "kysely";
import type { RunProposalContext } from "../propose-revenue-recognition-run";
import { lockContractPositions } from "./contract-ledger";
import { syncDraftRecognitionRuns } from "./draft-recognition-run";

type ContractRevenueMethod =
  Database["public"]["Enums"]["contractRevenueMethod"];
type ContractBillingMethod =
  Database["public"]["Enums"]["contractBillingMethod"];

const INSERT_BATCH_SIZE = 1000;

/** The schedule row types a progress month writes for a contract line. */
const PROGRESS_SCHEDULE_TYPES = [
  "Deferral",
  "Accrual",
  "Cost Relief",
  "Loss Provision"
] as const;

export type ProgressLine = {
  id: string;
  customerContractId: string;
  billingMethod: ContractBillingMethod;
  revenueMethod: ContractRevenueMethod;
  projectId: string | null;
  projectElementId: string | null;
  feePercent: number | null;
  ceilingAmount: number | null;
};

export type ProgressMonth = {
  line: ProgressLine;
  /** The month's revenue: earned to date less what is recognized before it.
   *  Negative is a valid catch-up. */
  amount: number;
  earnedToDate: number;
  estimateAtCompletion?: number | null;
  transactionPrice?: number | null;
  progress?: number | null;
};

export type UnrelievedCost = {
  customerContractLineId: string;
  /** The account the ledger rows' journal lines debited (Project WIP). */
  accountId: string;
  amount: number;
  rows: { id: string; amount: number }[];
};

/** The first day of the month of `periodEnd` (`YYYY-MM-DD`). */
export function monthStartOf(periodEnd: string): string {
  const { year, month } = parseIsoDate(periodEnd);
  return formatIsoDate(year, month, 1);
}

/** The contract position lock, which `synthesizeContractRevenue` also takes.
 *  Transaction-scoped, so a second take is a no-op. */
export async function lockProjectRevenue(
  trx: KyselyTx,
  companyId: string
): Promise<void> {
  await lockContractPositions(trx, companyId);
}

/** The lines with one of `revenueMethods` on contracts that are not Draft. */
export async function loadProgressLines(
  trx: KyselyTx,
  args: {
    companyId: string;
    periodEnd: string;
    revenueMethods: ContractRevenueMethod[];
  }
): Promise<ProgressLine[]> {
  const rows = await trx
    .selectFrom("customerContractLine as l")
    .innerJoin("customerContract as c", (join) =>
      join
        .onRef("c.id", "=", "l.customerContractId")
        .onRef("c.companyId", "=", "l.companyId")
    )
    .select([
      "l.id",
      "l.customerContractId",
      "l.billingMethod",
      "l.revenueMethod",
      "l.projectId",
      "l.projectElementId",
      "l.feePercent",
      "l.ceilingAmount"
    ])
    .where("l.companyId", "=", args.companyId)
    .where("l.revenueMethod", "in", args.revenueMethods)
    .where("l.startDate", "<=", args.periodEnd)
    .where("c.status", "<>", "Draft")
    .orderBy("l.id")
    .execute();
  return rows.map((row) => ({
    ...row,
    feePercent: row.feePercent === null ? null : Number(row.feePercent),
    ceilingAmount: row.ceilingAmount === null ? null : Number(row.ceilingAmount)
  }));
}

/**
 * Rebuilds the month starting `monthStart` for each line (R5). A line whose
 * month row is Recognized is left alone. For the others, the Planned schedule
 * rows of the month go first (through `syncDraftRecognitionRuns`, so a Draft
 * run that holds one stays consistent); their contract ledger entries and
 * `projectCostRelief` rows cascade. Then the Planned month rows go. Returns
 * the ids of the lines still open for the month.
 */
export async function clearProgressMonth(
  trx: KyselyTx,
  ctx: RunProposalContext,
  args: { lineIds: string[]; monthStart: string }
): Promise<string[]> {
  const { companyId, userId } = ctx;
  if (args.lineIds.length === 0) return [];

  const recognized = await trx
    .selectFrom("customerContractRevenue")
    .select("customerContractLineId")
    .where("companyId", "=", companyId)
    .where("customerContractLineId", "in", args.lineIds)
    .where("periodStart", "=", args.monthStart)
    .where("status", "=", "Recognized")
    .execute();
  const closed = new Set(recognized.map((row) => row.customerContractLineId));
  const open = args.lineIds.filter((id) => !closed.has(id));
  if (open.length === 0) return [];

  const planned = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select("id")
    .where("companyId", "=", companyId)
    .where("status", "=", "Planned")
    .where("customerContractLineId", "in", open)
    .where("periodStart", "=", args.monthStart)
    .where("type", "in", [...PROGRESS_SCHEDULE_TYPES])
    .execute();
  if (planned.length > 0) {
    const scheduleIds = planned.map((row) => row.id);
    await syncDraftRecognitionRuns(trx, {
      companyId,
      userId,
      deletedScheduleIds: scheduleIds
    });
    await trx
      .deleteFrom("revenueRecognitionSchedule")
      .where("companyId", "=", companyId)
      .where("id", "in", scheduleIds)
      .execute();
  }

  await trx
    .deleteFrom("customerContractRevenue")
    .where("companyId", "=", companyId)
    .where("customerContractLineId", "in", open)
    .where("periodStart", "=", args.monthStart)
    .where("status", "=", "Planned")
    .execute();

  return open;
}

/** Σ month rows per line that start before `monthStart`, any status. */
export async function recognizedBefore(
  trx: KyselyTx,
  args: { companyId: string; lineIds: string[]; monthStart: string }
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (args.lineIds.length === 0) return result;
  const rows = await trx
    .selectFrom("customerContractRevenue")
    .select([
      "customerContractLineId",
      sql<number>`COALESCE(SUM("amount"), 0)`.as("amount")
    ])
    .where("companyId", "=", args.companyId)
    .where("customerContractLineId", "in", args.lineIds)
    .where("periodStart", "<", args.monthStart)
    .groupBy("customerContractLineId")
    .execute();
  for (const row of rows) {
    result.set(row.customerContractLineId, Number(row.amount));
  }
  return result;
}

/** One Planned month row per line with a non-zero amount, with the figures
 *  behind it (R7). */
export async function writeProgressMonths(
  trx: KyselyTx,
  ctx: RunProposalContext,
  months: ProgressMonth[]
): Promise<void> {
  const { companyId, periodEnd, userId } = ctx;
  const monthStart = monthStartOf(periodEnd);
  const values = months
    .map((month) => ({ ...month, amount: round(month.amount) }))
    .filter((month) => month.amount !== 0)
    .map((month) => ({
      companyId,
      customerContractId: month.line.customerContractId,
      customerContractLineId: month.line.id,
      periodStart: monthStart,
      periodEnd,
      amount: month.amount,
      status: "Planned" as const,
      earnedToDate: round(month.earnedToDate),
      estimateAtCompletion:
        month.estimateAtCompletion === undefined ||
        month.estimateAtCompletion === null
          ? null
          : round(month.estimateAtCompletion),
      transactionPrice:
        month.transactionPrice === undefined || month.transactionPrice === null
          ? null
          : round(month.transactionPrice),
      progress: month.progress ?? null,
      createdBy: userId
    }));
  if (values.length === 0) return;
  await trx.insertInto("customerContractRevenue").values(values).execute();
}

/**
 * The cost under each line's billing element subtree that no relief covers
 * yet (R3, R4): ledger rows posted on or before `through` whose journal line
 * is on an Asset account. A row with no journal line (accounting off) or an
 * expensed row has nothing in WIP. Grouped per line and account.
 */
export async function selectUnrelievedCost(
  trx: KyselyTx,
  args: { companyId: string; lineIds: string[]; through: string }
): Promise<UnrelievedCost[]> {
  const { companyId, lineIds, through } = args;
  if (lineIds.length === 0) return [];
  const { rows } = await sql<{
    customerContractLineId: string;
    accountId: string;
    id: string;
    amount: number;
  }>`
    SELECT s."customerContractLineId", jl."accountId", pl."id", pl."amount"
    FROM get_contract_line_subtree(${companyId}, ${lineIds}::text[]) s
    JOIN "projectLedger" pl
      ON pl."projectElementId" = s."projectElementId" AND pl."companyId" = ${companyId}
    JOIN "journalLine" jl
      ON jl."id" = pl."journalLineId" AND jl."companyId" = pl."companyId"
    JOIN "account" a ON a."id" = jl."accountId" AND a."class" = 'Asset'
    WHERE pl."postingDate" <= ${through}::date
      AND NOT EXISTS (
        SELECT 1 FROM "projectCostRelief" r
        WHERE r."projectLedgerId" = pl."id" AND r."companyId" = pl."companyId"
      )
    ORDER BY s."customerContractLineId", jl."accountId", pl."postingDate", pl."id"
  `.execute(trx);

  const groups = new Map<string, UnrelievedCost>();
  for (const row of rows) {
    const key = `${row.customerContractLineId}\u0000${row.accountId}`;
    const group = groups.get(key) ?? {
      customerContractLineId: row.customerContractLineId,
      accountId: row.accountId,
      amount: 0,
      rows: []
    };
    group.amount += Number(row.amount);
    group.rows.push({ id: row.id, amount: Number(row.amount) });
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    amount: round(group.amount)
  }));
}

/**
 * One Cost Relief schedule row per line and account (Dr cost of goods sold /
 * Cr the WIP account), dated the run's period end, then one
 * `projectCostRelief` row per ledger row it covers. A group that nets to 0
 * writes nothing: its rows stay unrelieved and still net to 0.
 */
export async function writeCostRelief(
  trx: KyselyTx,
  ctx: RunProposalContext,
  reliefs: UnrelievedCost[]
): Promise<void> {
  const { companyId, periodEnd, userId } = ctx;
  const groups = reliefs.filter((relief) => relief.amount !== 0);
  if (groups.length === 0) return;

  const defaults = await trx
    .selectFrom("accountDefault")
    .select("costOfGoodsSoldAccount")
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults?.costOfGoodsSoldAccount) {
    throw new Error(
      "Set the Cost of Goods Sold account default before recognizing project revenue"
    );
  }

  const monthStart = monthStartOf(periodEnd);
  const inserted = await trx
    .insertInto("revenueRecognitionSchedule")
    .values(
      groups.map((relief) => ({
        companyId,
        type: "Cost Relief" as const,
        status: "Planned" as const,
        customerContractLineId: relief.customerContractLineId,
        periodStart: monthStart,
        periodEnd,
        scheduledDate: periodEnd,
        amount: relief.amount,
        debitAccountId: defaults.costOfGoodsSoldAccount,
        creditAccountId: relief.accountId,
        createdBy: userId
      }))
    )
    .returning(["id", "customerContractLineId", "creditAccountId"])
    .execute();
  // Paired by (line, account), unique per insert: never by RETURNING order.
  const scheduleIdByKey = new Map(
    inserted.map((row) => [
      `${row.customerContractLineId}\u0000${row.creditAccountId}`,
      row.id
    ])
  );

  const values = groups.flatMap((relief) => {
    const scheduleId = scheduleIdByKey.get(
      `${relief.customerContractLineId}\u0000${relief.accountId}`
    );
    if (!scheduleId) {
      throw new Error("A Cost Relief row was not written");
    }
    return relief.rows.map((row) => ({
      companyId,
      projectLedgerId: row.id,
      revenueRecognitionScheduleId: scheduleId,
      amount: row.amount
    }));
  });
  for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
    await trx
      .insertInto("projectCostRelief")
      .values(values.slice(i, i + INSERT_BATCH_SIZE))
      .execute();
  }
}

/**
 * The Right to Invoice synthesizer (community). Per line, earned to date is
 * Σ the line's billable items that are not Written Off, whose ledger row
 * posted on or before the period end. The month is earned to date less what
 * is recognized before the month. Then every unrelieved WIP row of the
 * subtree is relieved (R3).
 */
export async function synthesizeProjectRevenue(
  trx: KyselyTx,
  ctx: RunProposalContext
): Promise<void> {
  const { companyId, periodEnd } = ctx;
  await lockProjectRevenue(trx, companyId);

  const lines = await loadProgressLines(trx, {
    companyId,
    periodEnd,
    revenueMethods: ["Right to Invoice"]
  });
  if (lines.length === 0) return;

  const monthStart = monthStartOf(periodEnd);
  const openIds = await clearProgressMonth(trx, ctx, {
    lineIds: lines.map((line) => line.id),
    monthStart
  });
  if (openIds.length === 0) return;
  const open = lines.filter((line) => openIds.includes(line.id));

  // A burden item has no ledger row: it counts by its own posting date.
  const earnedRows = await trx
    .selectFrom("projectBillableItem as b")
    .leftJoin("projectLedger as pl", (join) =>
      join
        .onRef("pl.id", "=", "b.projectLedgerId")
        .onRef("pl.companyId", "=", "b.companyId")
    )
    .select([
      "b.customerContractLineId",
      sql<number>`COALESCE(SUM(b."amount"), 0)`.as("amount")
    ])
    .where("b.companyId", "=", companyId)
    .where("b.customerContractLineId", "in", openIds)
    .where("b.status", "<>", "Written Off")
    .where(
      sql<string>`COALESCE(pl."postingDate", b."postingDate")`,
      "<=",
      periodEnd
    )
    .groupBy("b.customerContractLineId")
    .execute();
  const earned = new Map(
    earnedRows.map((row) => [row.customerContractLineId!, Number(row.amount)])
  );
  const before = await recognizedBefore(trx, {
    companyId,
    lineIds: openIds,
    monthStart
  });

  await writeProgressMonths(
    trx,
    ctx,
    open.map((line) => {
      const earnedToDate = round(earned.get(line.id) ?? 0);
      return {
        line,
        earnedToDate,
        amount: round(earnedToDate - (before.get(line.id) ?? 0))
      };
    })
  );

  const reliefs = await selectUnrelievedCost(trx, {
    companyId,
    lineIds: openIds,
    through: periodEnd
  });
  await writeCostRelief(trx, ctx, reliefs);
}
