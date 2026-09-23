// Revenue recognition run proposals — shared by the ERP "New run" route and the
// monthly Inngest job, so a human and the scheduler propose exactly the same
// rows for a period. Posting stays in the ERP (accounting.server.ts): it is a
// human action under the period matrix.
// Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §1

import { sql } from "kysely";
import { round } from "../supabase/functions/shared/precision.ts";
import {
  daysBetweenInclusive,
  formatIsoDate,
  parseIsoDate
} from "../supabase/functions/shared/revenue-schedule.ts";
import type { Kysely, KyselyDatabase, KyselyTx } from "./client";
import { getNextSequence } from "./sequence";

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
 * What is accrued: every non-adjustment billing period of an Operating line
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
export async function synthesizeRentalAccruals(
  trx: KyselyTx,
  ctx: RunProposalContext
): Promise<void> {
  const { companyId, periodEnd, userId } = ctx;
  const { year, month } = parseIsoDate(periodEnd);
  const monthStart = formatIsoDate(year, month, 1);

  // Serialize concurrent proposals for one company (the monthly job and a
  // human "New run"): the existence check below is read-then-insert.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`revenue-recognition-accrual:${companyId}`}))`.execute(
    trx
  );

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
    .where("l.lessorClassification", "=", "Operating")
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

export const RUN_ROW_SYNTHESIZERS: RunRowSynthesizer[] = [
  synthesizeRentalAccruals
];

export type RunProposal = { id: string; runId: string; lineCount: number };

/**
 * Claims every Planned schedule row dated on or before `periodEnd` that no run
 * holds yet, into ONE Draft run. Returns null (and writes nothing) when nothing
 * is due, so a second proposal for the same period is a no-op rather than an
 * empty run.
 */
export async function createRevenueRecognitionRunProposal(
  db: Kysely<KyselyDatabase>,
  args: RunProposalContext
): Promise<RunProposal | null> {
  const { companyId, periodEnd, userId } = args;

  return db.transaction().execute(async (trx) => {
    for (const synthesize of RUN_ROW_SYNTHESIZERS) {
      await synthesize(trx, args);
    }

    const due = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select(["id", "amount"])
      .where("companyId", "=", companyId)
      .where("status", "=", "Planned")
      .where("runLineId", "is", null)
      .where("scheduledDate", "<=", periodEnd)
      .orderBy("scheduledDate")
      .orderBy("id")
      .execute();

    if (due.length === 0) return null;

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

    await trx
      .insertInto("revenueRecognitionRunLine")
      .values(
        due.map((row) => ({
          runId: run.id,
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
      .where("l.runId", "=", run.id)
      .where("l.companyId", "=", companyId)
      .where("s.companyId", "=", companyId)
      .execute();

    return { id: run.id, runId, lineCount: due.length };
  });
}
