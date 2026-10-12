// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Revenue recognition run proposals — shared by the ERP "New run" / "Repeat"
// routes and the monthly Inngest job, so a human and the scheduler propose exactly the same
// rows for a period. Posting stays in the ERP (accounting.server.ts): it is a
// human action under the period matrix.
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part I §1

import { getCompanyTimeZone } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  addMovement,
  applyContractMovement,
  EMPTY_POSITION
} from "@carbon/database/contract-position";
import { getNextSequence } from "@carbon/database/sequence";
import {
  datetime,
  daysBetweenInclusive,
  formatDate,
  formatIsoDate,
  parseIsoDate,
  round
} from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError } from "../errors";
import {
  loadContractPositions,
  lockContractPositions
} from "../lib/contract-ledger";
import { syncDraftRecognitionRuns } from "../lib/draft-recognition-run";
import { assertAccountingCutover } from "../lib/require-accounting-cutover";

export type RunProposalContext = {
  companyId: string;
  /** `YYYY-MM-DD`, the last day of the period being recognized. */
  periodEnd: string;
  userId: string;
};

/**
 * A synthesizer inserts the schedule rows that only exist once the period is
 * known — operating-rental accruals are the first. It runs inside the proposal
 * transaction before the due rows are selected, and must be idempotent:
 * proposing the same period twice must not duplicate rows.
 */
export type RunRowSynthesizer = (
  trx: KyselyTx,
  ctx: RunProposalContext
) => Promise<void>;

/**
 * Accrues earned-but-unbilled operating rent for the calendar month ending
 * `periodEnd` (Dr contract asset / Cr rental income), so the month's rental
 * revenue is right whenever the invoice for it posts. Spec §3, Decision 7.
 *
 * What is accrued: every non-adjustment billing period of a Rental-treated line
 * (`On Rent` or `Returned`) that no POSTED invoice covers yet — status
 * `Pending`, or `Invoiced` onto a Draft/Pending invoice. A drafted-but-unposted
 * invoice has written nothing to the ledger: the daily job drafts an Arrears
 * period on its last day, before the month-end run, so "Pending only" would
 * accrue nothing for exactly the Arrears case the accrual exists for. Advance
 * and Arrears are treated alike — an Advance period whose invoice has not
 * posted by month end has earned the same unbilled rent. Invoice posting
 * (post-sales-invoice) credits the contract asset for the accruals of the
 * period it bills, so an accrual is never recognized twice.
 *
 * How much: the part of the billing period's `amount` earned inside the
 * month, by days, with the window clipped to the line's custody
 * `[deliveredAt, returnedAt]` — no rent is earned before the unit is
 * delivered, and after a return the period was re-cut anyway. Each slice is
 * the difference of two cumulative roundings from the period's first day, so
 * a period's slices across months sum to its amount exactly.
 *
 * Row shape: `periodStart`/`periodEnd` are the accrued slice itself (never the
 * whole billing period or the whole month), so a slice lies inside exactly one
 * billing period — which is how invoice posting finds "the accruals of the
 * period it bills" by overlap — and two months of one billing period never
 * share a key. `scheduledDate` is the run's period end, so the proposal that
 * synthesized a row claims it. Any existing Accrual row of the line that
 * overlaps a slice (Planned or Posted) suppresses it, so proposing the same
 * month twice — or after a delete — inserts nothing new.
 *
 * Amounts are in the agreement currency, which activation holds to the base
 * currency in Phase C (post-rental-agreement).
 */
/** The company's proposal lock, taken by `synthesizeRentalAccruals`. A
 *  transaction-scoped advisory lock, so taking it again is a no-op. */
export async function lockRecognitionProposals(
  trx: KyselyTx,
  companyId: string
): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`revenue-recognition-accrual:${companyId}`}))`.execute(
    trx
  );
}

export async function synthesizeRentalAccruals(
  trx: KyselyTx,
  ctx: RunProposalContext
): Promise<void> {
  const { companyId, periodEnd, userId } = ctx;
  const { year, month } = parseIsoDate(periodEnd);
  const monthStart = formatIsoDate(year, month, 1);

  // Serialize concurrent proposals for one company (the monthly job and a
  // human "New run"): the existence check below is read-then-insert.
  await lockRecognitionProposals(trx, companyId);

  const periods = await trx
    .selectFrom("rentalBillingPeriod as p")
    .innerJoin("rentalAgreementLine as l", (join) =>
      join
        .onRef("l.id", "=", "p.rentalAgreementLineId")
        .onRef("l.companyId", "=", "p.companyId")
    )
    .leftJoin("salesInvoiceLine as sil", (join) =>
      join
        .onRef("sil.id", "=", "p.salesInvoiceLineId")
        .onRef("sil.companyId", "=", "p.companyId")
    )
    .leftJoin("salesInvoice as si", (join) =>
      join
        .onRef("si.id", "=", "sil.invoiceId")
        .onRef("si.companyId", "=", "sil.companyId")
    )
    .select([
      "p.rentalAgreementLineId",
      // DATE decodes to a JS Date through pg; compare and store the text form.
      sql<string>`p."periodStart"::text`.as("periodStart"),
      sql<string>`p."periodEnd"::text`.as("periodEnd"),
      "p.days",
      "p.amount",
      sql<string>`l."deliveredAt"::text`.as("deliveredAt"),
      sql<string | null>`l."returnedAt"::text`.as("returnedAt")
    ])
    .where("p.companyId", "=", companyId)
    .where("p.isAdjustment", "=", false)
    .where("p.periodStart", "<=", periodEnd)
    .where("p.periodEnd", ">=", monthStart)
    .where((eb) =>
      eb.or([
        eb("p.status", "=", "Pending"),
        eb("si.status", "in", ["Draft", "Pending"])
      ])
    )
    .where("l.lessorClassification", "=", "Rental")
    .where("l.status", "in", ["On Rent", "Returned"])
    .where("l.deliveredAt", "is not", null)
    .where("l.deliveredAt", "<=", periodEnd)
    .where((eb) =>
      eb.or([
        eb("l.returnedAt", "is", null),
        eb("l.returnedAt", ">=", monthStart)
      ])
    )
    .orderBy("p.rentalAgreementLineId")
    .orderBy("p.periodStart")
    .execute();
  if (periods.length === 0) return;

  // Every Accrual row touching the month, whatever its status: a slice that
  // overlaps one was already accrued.
  const existing = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select([
      "rentalAgreementLineId",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd")
    ])
    .where("companyId", "=", companyId)
    .where("type", "=", "Accrual")
    .where("rentalAgreementLineId", "is not", null)
    .where("periodStart", "<=", periodEnd)
    .where("periodEnd", ">=", monthStart)
    .execute();
  const accruedByLine = new Map<string, { start: string; end: string }[]>();
  for (const row of existing) {
    const lineId = row.rentalAgreementLineId!;
    const spans = accruedByLine.get(lineId) ?? [];
    spans.push({ start: row.periodStart, end: row.periodEnd });
    accruedByLine.set(lineId, spans);
  }

  const maxDate = (...dates: string[]) =>
    dates.reduce((a, b) => (a > b ? a : b));
  const minDate = (...dates: string[]) =>
    dates.reduce((a, b) => (a < b ? a : b));

  const slices: {
    rentalAgreementLineId: string;
    periodStart: string;
    periodEnd: string;
    amount: number;
  }[] = [];
  for (const period of periods) {
    const start = maxDate(period.periodStart, monthStart, period.deliveredAt);
    const end = period.returnedAt
      ? minDate(period.periodEnd, periodEnd, period.returnedAt)
      : minDate(period.periodEnd, periodEnd);
    if (start > end) continue;

    const alreadyAccrued = (
      accruedByLine.get(period.rentalAgreementLineId) ?? []
    ).some((span) => span.start <= end && span.end >= start);
    if (alreadyAccrued) continue;

    // Cumulative rounding from the period's first day: slice = earned through
    // `end` minus earned before `start`, so every slice of one period sums to
    // its amount exactly across months.
    const amount = Number(period.amount);
    const days = Number(period.days);
    const earnedThrough = (dayCount: number) =>
      round((amount * dayCount) / days);
    const daysBeforeStart = daysBetweenInclusive(period.periodStart, start) - 1;
    const daysThroughEnd = daysBetweenInclusive(period.periodStart, end);
    const accrual = round(
      earnedThrough(daysThroughEnd) - earnedThrough(daysBeforeStart)
    );
    if (accrual === 0) continue;

    slices.push({
      rentalAgreementLineId: period.rentalAgreementLineId,
      periodStart: start,
      periodEnd: end,
      amount: accrual
    });
  }
  if (slices.length === 0) return;

  const defaults = await trx
    .selectFrom("accountDefault")
    .select(["contractAssetAccount", "rentalIncomeAccount"])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults?.contractAssetAccount || !defaults.rentalIncomeAccount) {
    throw new Error(
      "Set the Contract Assets and Rental Income account defaults before recognizing rental revenue"
    );
  }

  await trx
    .insertInto("revenueRecognitionSchedule")
    .values(
      slices.map((slice) => ({
        companyId,
        type: "Accrual" as const,
        status: "Planned" as const,
        rentalAgreementLineId: slice.rentalAgreementLineId,
        periodStart: slice.periodStart,
        periodEnd: slice.periodEnd,
        scheduledDate: periodEnd,
        amount: slice.amount,
        debitAccountId: defaults.contractAssetAccount!,
        creditAccountId: defaults.rentalIncomeAccount!,
        createdBy: userId
      }))
    )
    .execute();
}

/**
 * Recognizes contract revenue (plan D5): every Planned `customerContractRevenue`
 * month starting on or before `periodEnd`, of a confirmed contract (Active, or
 * Ended with months still to recognize — a cancellation's catch-up rows), that
 * no schedule row has synthesized yet. Each month is a movement of −amount on
 * its line's position against revenue, at the period end's rate: the part the
 * deferred pool covers becomes a Deferral row (Dr Deferred Revenue / Cr Sales),
 * the rest an Accrual row (Dr Contract Assets / Cr Sales). A negative month (a
 * catch-up) raises the position instead, so its rows come out negative and post
 * with their sides swapped. One Recognition ledger entry per schedule row, so a
 * row deleted with its entry (the FK cascades) leaves the position consistent.
 *
 * Idempotent: a month with a schedule row is skipped. The plan row is marked
 * Recognized when its run posts, not here. A Planned contract schedule row
 * whose plan month has since been replaced (an amendment reconciles Planned
 * months by delete + insert, which nulls the row's `customerContractRevenueId`)
 * is dropped first, with its ledger entry, so the replacement is recognized
 * once.
 */
export async function synthesizeContractRevenue(
  trx: KyselyTx,
  ctx: RunProposalContext
): Promise<void> {
  const { companyId, periodEnd, userId } = ctx;

  // The position lock, shared with invoice posting and credit memos: the
  // movements below are computed from the positions as read.
  await lockContractPositions(trx, companyId);

  const orphans = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select("id")
    .where("companyId", "=", companyId)
    .where("status", "=", "Planned")
    .where("customerContractLineId", "is not", null)
    .where("customerContractRevenueId", "is", null)
    .execute();
  if (orphans.length > 0) {
    const orphanIds = orphans.map((row) => row.id);
    await syncDraftRecognitionRuns(trx, {
      companyId,
      userId,
      deletedScheduleIds: orphanIds
    });
    await trx
      .deleteFrom("revenueRecognitionSchedule")
      .where("companyId", "=", companyId)
      .where("id", "in", orphanIds)
      .execute();
  }

  const due = await trx
    .selectFrom("customerContractRevenue as r")
    .innerJoin("customerContract as c", (join) =>
      join
        .onRef("c.id", "=", "r.customerContractId")
        .onRef("c.companyId", "=", "r.companyId")
    )
    .innerJoin("company as co", "co.id", "r.companyId")
    .select([
      "r.id",
      "r.customerContractId",
      "r.customerContractLineId",
      sql<string>`r."periodStart"::text`.as("periodStart"),
      sql<string>`r."periodEnd"::text`.as("periodEnd"),
      "r.amount",
      // Base currency → 1; raises when the currency has no rate.
      sql<number>`get_exchange_rate(r."companyId", COALESCE(c."currencyCode", co."baseCurrencyCode"), ${periodEnd}::date)`.as(
        "rate"
      )
    ])
    .where("r.companyId", "=", companyId)
    .where("r.status", "=", "Planned")
    .where("r.periodStart", "<=", periodEnd)
    .where("r.amount", "<>", 0)
    .where("c.status", "<>", "Draft")
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("revenueRecognitionSchedule as s")
            .select("s.id")
            .whereRef("s.customerContractRevenueId", "=", "r.id")
            .where("s.companyId", "=", companyId)
        )
      )
    )
    .orderBy("r.customerContractLineId")
    .orderBy("r.periodStart")
    .orderBy("r.id")
    .execute();
  if (due.length === 0) return;

  const defaults = await trx
    .selectFrom("accountDefault")
    .select(["deferredRevenueAccount", "contractAssetAccount", "salesAccount"])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (
    !defaults?.deferredRevenueAccount ||
    !defaults.contractAssetAccount ||
    !defaults.salesAccount
  ) {
    throw new Error(
      "Set the Deferred Revenue, Contract Assets and Sales account defaults before recognizing contract revenue"
    );
  }

  const positions = await loadContractPositions(
    trx,
    companyId,
    due.map((row) => row.customerContractLineId)
  );

  type Planned = {
    schedule: {
      companyId: string;
      type: "Deferral" | "Accrual";
      status: "Planned";
      customerContractLineId: string;
      customerContractRevenueId: string;
      periodStart: string;
      periodEnd: string;
      scheduledDate: string;
      amount: number;
      contractAmount: number;
      debitAccountId: string;
      creditAccountId: string;
      createdBy: string;
    };
    entry: {
      customerContractId: string;
      customerContractLineId: string;
      customerContractRevenueId: string;
      postingDate: string;
      deferredAmount: number;
      deferredBase: number;
      assetAmount: number;
      assetBase: number;
    };
  };
  const planned: Planned[] = [];
  for (const row of due) {
    const position =
      positions.get(row.customerContractLineId) ?? EMPTY_POSITION;
    const movement = applyContractMovement({
      position,
      amount: -Number(row.amount),
      rate: Number(row.rate),
      counterpart: "revenue"
    });
    positions.set(row.customerContractLineId, addMovement(position, movement));
    // A month ending after the run's period end (a mid-month period end)
    // still belongs to this run.
    const scheduledDate = row.periodEnd < periodEnd ? row.periodEnd : periodEnd;
    const common = {
      companyId,
      status: "Planned" as const,
      customerContractLineId: row.customerContractLineId,
      customerContractRevenueId: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      scheduledDate,
      creditAccountId: defaults.salesAccount,
      createdBy: userId
    };
    const entry = {
      customerContractId: row.customerContractId,
      customerContractLineId: row.customerContractLineId,
      customerContractRevenueId: row.id,
      postingDate: scheduledDate
    };
    if (movement.deferredAmount !== 0 || movement.deferredBase !== 0) {
      planned.push({
        schedule: {
          ...common,
          type: "Deferral",
          amount: round(-movement.deferredBase),
          contractAmount: round(-movement.deferredAmount),
          debitAccountId: defaults.deferredRevenueAccount
        },
        entry: {
          ...entry,
          deferredAmount: movement.deferredAmount,
          deferredBase: movement.deferredBase,
          assetAmount: 0,
          assetBase: 0
        }
      });
    }
    if (movement.assetAmount !== 0 || movement.assetBase !== 0) {
      planned.push({
        schedule: {
          ...common,
          type: "Accrual",
          amount: movement.assetBase,
          contractAmount: movement.assetAmount,
          debitAccountId: defaults.contractAssetAccount
        },
        entry: {
          ...entry,
          deferredAmount: 0,
          deferredBase: 0,
          assetAmount: movement.assetAmount,
          assetBase: movement.assetBase
        }
      });
    }
  }
  if (planned.length === 0) return;

  // RETURNING follows the VALUES order, so each entry pairs with its row.
  const inserted = await trx
    .insertInto("revenueRecognitionSchedule")
    .values(planned.map((p) => p.schedule))
    .returning("id")
    .execute();
  await trx
    .insertInto("customerContractLedgerEntry")
    .values(
      planned.map((p, index) => ({
        ...p.entry,
        entryType: "Recognition" as const,
        revenueRecognitionScheduleId: inserted[index]!.id,
        companyId,
        createdBy: userId
      }))
    )
    .execute();
}

export const RUN_ROW_SYNTHESIZERS: RunRowSynthesizer[] = [
  synthesizeRentalAccruals,
  synthesizeContractRevenue
];

export type RunProposal = { id: string; runId: string; lineCount: number };

/** Every Planned row dated on or before `periodEnd` that no run holds yet. */
export async function selectDueScheduleRows(
  trx: KyselyTx,
  { companyId, periodEnd }: RunProposalContext
) {
  return trx
    .selectFrom("revenueRecognitionSchedule")
    .select(["id", "amount"])
    .where("companyId", "=", companyId)
    .where("status", "=", "Planned")
    .where("runLineId", "is", null)
    .where("scheduledDate", "<=", periodEnd)
    .orderBy("scheduledDate")
    .orderBy("id")
    .execute();
}

/** Claims `due` into the run: one line per row, each copying the row's
 *  amount, and the row stamped with its line. */
export async function claimScheduleRows(
  trx: KyselyTx,
  runId: string,
  due: { id: string; amount: number }[],
  { companyId, userId }: RunProposalContext
): Promise<void> {
  if (due.length === 0) return;

  await trx
    .insertInto("revenueRecognitionRunLine")
    .values(
      due.map((row) => ({
        runId,
        scheduleId: row.id,
        amount: row.amount,
        companyId,
        createdBy: userId
      }))
    )
    .execute();

  // Stamp each claimed row with its line in one statement (the line ↔
  // schedule pair is unique per company, so the join is one-to-one).
  await trx
    .updateTable("revenueRecognitionSchedule as s")
    .from("revenueRecognitionRunLine as l")
    .set({ runLineId: sql`l.id`, updatedBy: userId })
    .whereRef("l.scheduleId", "=", "s.id")
    .where("l.runId", "=", runId)
    .where("l.companyId", "=", companyId)
    .where("s.companyId", "=", companyId)
    .execute();
}

/**
 * Claims every Planned schedule row dated on or before `periodEnd` that no run
 * holds yet, into ONE Draft run. Returns null (and writes nothing) when nothing
 * is due, so a second proposal for the same period is a no-op rather than an
 * empty run.
 */
async function createRevenueRecognitionRunProposal(
  db: Kysely<KyselyDatabase>,
  args: RunProposalContext
): Promise<RunProposal | null> {
  const { companyId, periodEnd, userId } = args;

  return db.transaction().execute(async (trx) => {
    for (const synthesize of RUN_ROW_SYNTHESIZERS) {
      await synthesize(trx, args);
    }

    const due = await selectDueScheduleRows(trx, args);
    if (due.length === 0) return null;

    // One Draft per period (the partial unique index
    // revenueRecognitionRun_one_draft_per_period is the backstop): a period
    // that already has a Draft is recalculated, not proposed again.
    const draft = await trx
      .selectFrom("revenueRecognitionRun")
      .select("runId")
      .where("companyId", "=", companyId)
      .where("periodEnd", "=", periodEnd)
      .where("status", "=", "Draft")
      .executeTakeFirst();
    if (draft) {
      throw new InvalidInputError(
        `${draft.runId} is already a draft for this period. Recalculate it instead.`
      );
    }

    const runId = await getNextSequence(
      trx,
      "revenueRecognitionRun",
      companyId
    );
    const run = await trx
      .insertInto("revenueRecognitionRun")
      .values({
        runId,
        periodEnd,
        status: "Draft",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await claimScheduleRows(trx, run.id, due, args);

    return { id: run.id, runId, lineCount: due.length };
  });
}

/** Whether `date` is a real `YYYY-MM-DD` that is the last day of its month. */
function isMonthEnd(date: string): boolean {
  try {
    return endOfMonth(parseDate(date)).toString() === date;
  } catch {
    // parseDate throws on a day or month out of range ("2026-02-30").
    return false;
  }
}

export const proposeRevenueRecognitionRunInput = z.object({
  /** `YYYY-MM-DD`, the last day of the period being recognized. A mid-month
   *  date would accrue rent only up to it and leave the rest of the month to
   *  no run. */
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isMonthEnd, {
      message: "periodEnd must be the last day of a month"
    })
});

/** Proposes ONE Draft run for the period, or null when nothing is due (see
 *  `createRevenueRecognitionRunProposal`). */
const proposeRevenueRecognitionRun = defineServerFn({
  name: "propose-revenue-recognition-run",
  input: proposeRevenueRecognitionRunInput,
  permissions: { create: "accounting" },
  async run({ db, companyId, userId }, { periodEnd }) {
    await assertAccountingCutover(db, companyId);
    // A run may cover the current month or an earlier one, never a month that
    // has not started (the ERP's isFutureRunPeriod; this package cannot import
    // it). Guards the monthly job as well as the routes.
    const today = datetime.today(await getCompanyTimeZone(db, companyId));
    if (periodEnd > endOfMonth(today).toString()) {
      throw new InvalidInputError(
        `${formatDate(periodEnd, { month: "long", year: "numeric" })} has not started yet. A run can cover the current month or an earlier one.`
      );
    }
    return createRevenueRecognitionRunProposal(db, {
      companyId,
      periodEnd,
      userId
    });
  }
});

export default proposeRevenueRecognitionRun;
