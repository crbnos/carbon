// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Modify, Terminate and Purchase of a lessee lease (spec
// `.ai/specs/2026-10-11-lessee-leases.md` §7 and the Addendum). Modify acts on
// the lease and remeasures every active asset; Terminate and Purchase act on
// one asset, and the lease ends with its last asset. Each is one transaction
// that locks the lease, checks the months before the effective date are
// posted and no run holds a later row, posts one 'Lease' journal with lines
// per asset, rewrites the schedules and the payment rows from the effective
// date, and records one `leaseEvent` per asset. Posted history is never
// changed.

import { equals } from "@carbon/database/precision";
import { getNextSequence } from "@carbon/database/sequence";
import {
  addDays,
  addMonths,
  buildLesseeSchedule,
  datetime,
  escalatedLeasePayment,
  isTermWithinTwelveMonths,
  type LesseeCarrying,
  leaseMonthsAt,
  lesseeCarryingAt,
  lesseeScheduleSpan,
  remeasureLease,
  round
} from "@carbon/utils";
import { sql } from "kysely";
import { InvalidInputError } from "../errors";
import { currencyDecimals } from "../lib/currency-decimals";
import { cutLeasePaymentRows } from "../lib/lease-payment-rows";
import {
  type AssetLines,
  type AssetSchedule,
  amortizationMonths,
  classificationOf,
  deleteSchedulesFrom,
  findLine,
  heldByRun,
  type LeaseLineRow,
  type LeaseRow,
  loadLesseeAccounting,
  lockLease,
  measureAsset,
  paymentPoints,
  postLesseeJournal,
  readLines,
  readPayments,
  readThresholds,
  type Scope,
  type Trx,
  updateLineMeasurements,
  writeSchedules
} from "./lease";
import { purchaseLines, remeasurementLines, terminationLines } from "./lessee";
import type { LeasePayload } from "./validators";

type Classification = "Operating" | "Finance" | "Short-Term";

/** The lease month that starts on `startDate`, or null when `startDate` is
 *  not a lease-month boundary (the commencement day of a month). */
export function leaseMonthStarting(
  commencementDate: string,
  startDate: string
): number | null {
  if (startDate < commencementDate) return null;
  const month = leaseMonthsAt(commencementDate, startDate);
  return addMonths(commencementDate, month) === startDate ? month : null;
}

/** The payment period `startDate` falls inside (after its first day), or
 *  null. A change takes effect where a payment period starts: the period
 *  before it is paid in full and the one after it is cut from the new terms. */
export function straddledPeriod(
  rows: { paymentType: string; periodStart: string; periodEnd: string }[],
  startDate: string
): { periodStart: string; periodEnd: string } | null {
  return (
    rows.find(
      (row) =>
        row.paymentType === "Rent" &&
        row.periodStart < startDate &&
        row.periodEnd >= startDate
    ) ?? null
  );
}

/**
 * The checks every lifecycle action shares, and each asset's carrying
 * amounts at `startDate` (the first day after the change takes effect).
 * Refuses a date that is not a lease-month boundary or falls inside a
 * payment period, a month before it whose run rows are not Posted, a month
 * on or after it that is already Posted, a later row a run holds, and an
 * Invoiced payment due on or after `startDate`.
 */
async function prepare(
  trx: Trx,
  args: {
    companyId: string;
    lease: LeaseRow;
    lines: LeaseLineRow[];
    startDate: string;
    label: string;
  }
): Promise<Map<string, LesseeCarrying>> {
  const { companyId, lease, lines, startDate, label } = args;
  if (lease.status !== "Active") {
    throw new InvalidInputError(
      `The lease is ${lease.status}; only an Active lease can be ${label}`
    );
  }
  const ended = lines.find((line) => line.status !== "Active");
  if (ended) {
    throw new InvalidInputError(
      `${ended.description} is ${ended.status}; only an active asset can be ${label}`
    );
  }
  if (leaseMonthStarting(lease.commencementDate, startDate) === null) {
    throw new InvalidInputError(
      `The date must fall on a lease-month boundary: the month starts on day ${lease.commencementDate.slice(8)} of a month`
    );
  }
  if (lease.endDate && startDate > addDays(lease.endDate, 1)) {
    throw new InvalidInputError("The date is after the end of the lease");
  }

  const lineIds = lines.map((line) => line.id);
  const payments = (await readPayments(trx, companyId, lease.id)).filter(
    (payment) => lineIds.includes(payment.leaseLineId)
  );
  const straddled = straddledPeriod(payments, startDate);
  if (straddled) {
    throw new InvalidInputError(
      `The date falls inside the payment period ${straddled.periodStart} to ${straddled.periodEnd}; choose a date where a payment period starts or ends`
    );
  }
  const invoiced = payments.find(
    (payment) => payment.status === "Invoiced" && payment.dueDate >= startDate
  );
  if (invoiced) {
    throw new InvalidInputError(
      `The payment due ${invoiced.dueDate} is already invoiced; choose a later date or delete the invoice`
    );
  }
  // A Skipped row was paid outside Carbon. One on or after the date would
  // outlive the change: it is neither cut again nor ever invoiced. Checked
  // after the posted months, whose message names the date to choose.
  const refuseSkipped = () => {
    const skipped = payments.find(
      (payment) => payment.status === "Skipped" && payment.dueDate >= startDate
    );
    if (skipped) {
      throw new InvalidInputError(
        `The payment due ${skipped.dueDate} is Skipped (paid outside Carbon); choose a date after it`
      );
    }
  };

  const carrying = new Map<string, LesseeCarrying>(
    lines.map((line) => [
      line.id,
      { liability: 0, accumulated: 0, rouAsset: 0 }
    ])
  );
  const recognized = lines.filter(
    (line) => line.lesseeClassification !== "Short-Term"
  );
  if (recognized.length === 0) {
    refuseSkipped();
    return carrying;
  }
  const recognizedIds = recognized.map((line) => line.id);

  const unposted = await trx
    .selectFrom("revenueRecognitionSchedule as s")
    .innerJoin("leaseScheduleLine as l", (join) =>
      join
        .onRef("l.id", "=", "s.leaseScheduleLineId")
        .onRef("l.companyId", "=", "s.companyId")
    )
    .select(sql<string>`s."scheduledDate"::text`.as("scheduledDate"))
    .where("s.companyId", "=", companyId)
    .where("l.leaseLineId", "in", recognizedIds)
    .where("s.status", "=", "Planned")
    .where("s.scheduledDate", "<", startDate)
    .orderBy("s.scheduledDate")
    .executeTakeFirst();
  if (unposted) {
    throw new InvalidInputError(
      `Post the lease run for ${unposted.scheduledDate} first: the months before the change must be on the books`
    );
  }
  // A month already posted — by a lease run or in an opening balance — is in
  // the GL. Rewriting it from an earlier date would post it twice, or leave
  // its amortization out of the carrying amounts below.
  const postedLater = await trx
    .selectFrom("revenueRecognitionSchedule as s")
    .innerJoin("leaseScheduleLine as l", (join) =>
      join
        .onRef("l.id", "=", "s.leaseScheduleLineId")
        .onRef("l.companyId", "=", "s.companyId")
    )
    .select(sql<string>`s."scheduledDate"::text`.as("scheduledDate"))
    .where("s.companyId", "=", companyId)
    .where("l.leaseLineId", "in", recognizedIds)
    .where("s.status", "=", "Posted")
    .where("s.scheduledDate", ">=", startDate)
    .orderBy("s.scheduledDate", "desc")
    .executeTakeFirst();
  if (postedLater) {
    throw new InvalidInputError(
      `The month ending ${postedLater.scheduledDate} is already posted; choose a date after it`
    );
  }
  const run = await heldByRun(trx, {
    companyId,
    leaseId: lease.id,
    fromDate: startDate,
    leaseLineIds: recognizedIds
  });
  if (run) {
    throw new InvalidInputError(
      `${run} holds this lease's entries from ${startDate}; delete or recalculate it first`
    );
  }
  refuseSkipped();

  const before = await trx
    .selectFrom("leaseScheduleLine")
    .select([
      "leaseLineId",
      "closingLiability",
      "rouAmortization",
      sql<string>`"periodDate"::text`.as("periodDate")
    ])
    .where("leaseLineId", "in", recognizedIds)
    .where("companyId", "=", companyId)
    .where("periodDate", "<", startDate)
    .orderBy("periodDate")
    .execute();
  for (const line of recognized) {
    carrying.set(
      line.id,
      lesseeCarryingAt({
        schedule: before.filter((row) => row.leaseLineId === line.id),
        startDate,
        initialLiability: line.initialLiability,
        rouAssetCost: line.rouAssetCost
      })
    );
  }
  return carrying;
}

/**
 * Deletes the Pending payment rows a change ends, for each asset: rows due
 * after `lastDay`, and its Purchase Option row. Returns, per asset, what the
 * deleted rows due on or before `lastDay` add back to the carrying
 * liability: the schedule already counted them as paid, and now they never
 * will be.
 */
async function deleteEndedPayments(
  trx: Trx,
  args: { companyId: string; leaseLineIds: string[]; lastDay: string }
): Promise<Map<string, number>> {
  const addBack = new Map(args.leaseLineIds.map((id) => [id, 0]));
  if (args.leaseLineIds.length === 0) return addBack;
  const deleted = await trx
    .deleteFrom("leasePayment")
    .where("leaseLineId", "in", args.leaseLineIds)
    .where("companyId", "=", args.companyId)
    .where("status", "=", "Pending")
    .where((eb) =>
      eb.or([
        eb("dueDate", ">", args.lastDay),
        eb("paymentType", "=", "Purchase Option")
      ])
    )
    .returning([
      "leaseLineId",
      "amount",
      sql<string>`"dueDate"::text`.as("dueDate")
    ])
    .execute();
  for (const row of deleted) {
    if (row.dueDate > args.lastDay) continue;
    addBack.set(
      row.leaseLineId,
      round((addBack.get(row.leaseLineId) ?? 0) + Number(row.amount))
    );
  }
  return addBack;
}

type EventRow = {
  leaseLineId: string;
  eventType: "Modification" | "Termination" | "Purchase";
  effectiveDate: string;
  liabilityBefore: number;
  liabilityAfter: number;
  rouAssetBefore: number;
  rouAssetAfter: number;
  gainLoss: number;
  classificationBefore: Classification;
  classificationAfter: Classification;
  fixedAssetId?: string | null;
  journalId: string | null;
  notes?: string | null;
};

async function insertEvents(
  trx: Trx,
  args: { companyId: string; userId: string; leaseId: string; rows: EventRow[] }
) {
  if (args.rows.length === 0) return;
  await trx
    .insertInto("leaseEvent")
    .values(
      args.rows.map((row) => ({
        ...row,
        leaseId: args.leaseId,
        fixedAssetId: row.fixedAssetId ?? null,
        notes: row.notes ?? null,
        companyId: args.companyId,
        createdBy: args.userId
      }))
    )
    .execute();
}

/** Ends one asset and, when it was the last active one, the lease: the lease
 *  takes the last asset's status and end date (spec Addendum A8). */
async function endAsset(
  trx: Trx,
  args: {
    companyId: string;
    userId: string;
    lease: LeaseRow;
    lines: LeaseLineRow[];
    leaseLineId: string;
    status: "Terminated" | "Purchased";
    endDate: string;
    fixedAssetId?: string;
  }
): Promise<void> {
  const { companyId, userId } = args;
  const now = datetime.timestamp();
  await trx
    .updateTable("leaseLine")
    .set({
      status: args.status,
      ...(args.fixedAssetId ? { fixedAssetId: args.fixedAssetId } : {}),
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "=", args.leaseLineId)
    .where("companyId", "=", companyId)
    .execute();
  const stillActive = args.lines.some(
    (line) => line.id !== args.leaseLineId && line.status === "Active"
  );
  if (stillActive) return;
  await trx
    .updateTable("lease")
    .set({
      status: args.status,
      endDate: args.endDate,
      closedAt: now,
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "=", args.lease.id)
    .where("companyId", "=", companyId)
    .execute();
}

async function companyAccounting(trx: Trx, companyId: string) {
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  return loadLesseeAccounting(trx, {
    companyId,
    companyGroupId: company.companyGroupId
  });
}

export async function modify(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "modify" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const lines = (await readLines(trx, companyId, lease.id)).filter(
      (line) => line.status === "Active"
    );
    if (lines.length === 0) {
      throw new InvalidInputError("The lease has no active asset to modify");
    }
    if (!lease.endDate) {
      throw new InvalidInputError(
        "An open-ended lease has no term to modify; terminate it and enter the new terms as a new lease"
      );
    }
    for (const entry of payload.lines) findLine(lines, entry.leaseLineId);
    const startDate = payload.effectiveDate;
    const carrying = await prepare(trx, {
      companyId,
      lease,
      lines,
      startDate,
      label: "modified"
    });
    if (
      lines.some((line) => line.lesseeClassification === "Short-Term") &&
      !isTermWithinTwelveMonths(lease.commencementDate, payload.endDate)
    ) {
      throw new InvalidInputError(
        "A short-term lease cannot run past 12 months; end it and enter the extension as a new lease"
      );
    }
    // `prepare` accepted the date as a lease-month boundary.
    const fromMonth = leaseMonthsAt(lease.commencementDate, startDate);

    // The remaining payments, cut again from the new terms. A Pending
    // purchase option the schedule paid before the date is never paid now:
    // it goes back into the carrying liability.
    const addBack = await deleteEndedPayments(trx, {
      companyId,
      leaseLineIds: lines.map((line) => line.id),
      lastDay: addDays(startDate, -1)
    });
    const decimals = await currencyDecimals(trx, companyId, lease.currencyCode);
    // The payment entered is the one at the effective date; an asset the
    // payload does not name keeps the rate it pays then.
    const paymentAtStart = (line: LeaseLineRow) =>
      payload.lines.find((entry) => entry.leaseLineId === line.id)
        ?.paymentAmount ??
      escalatedLeasePayment(
        line.paymentAmount,
        lease.annualEscalationPercent,
        fromMonth
      );
    const cut = new Map(
      lines.map((line) => [
        line.id,
        cutLeasePaymentRows({
          lease: {
            commencementDate: lease.commencementDate,
            endDate: payload.endDate,
            invoiceFromDate: lease.invoiceFromDate,
            paymentFrequency: payload.paymentFrequency,
            paymentTiming: lease.paymentTiming,
            annualEscalationPercent: payload.annualEscalationPercent
          },
          asset: line,
          decimals,
          from: { month: fromMonth, paymentAtStart: paymentAtStart(line) }
        })
      ])
    );
    const rowsOf = (line: LeaseLineRow) => cut.get(line.id)?.rows ?? [];
    const newRows = lines.flatMap((line) =>
      rowsOf(line).map((row) => ({
        ...row,
        leaseId: lease.id,
        companyId,
        createdBy: userId
      }))
    );
    if (newRows.length > 0) {
      await trx.insertInto("leasePayment").values(newRows).execute();
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("lease")
      .set({
        endDate: payload.endDate,
        discountRate: payload.discountRate,
        paymentFrequency: payload.paymentFrequency,
        annualEscalationPercent: payload.annualEscalationPercent,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();

    // Remeasure each recognized asset over what is left of the lease, and
    // reassess its classification (a Short-Term asset stays Short-Term).
    const { shortTermExpedient: _, ...thresholds } = await readThresholds(
      trx,
      companyId
    );
    const modified = { ...lease, discountRate: payload.discountRate };
    const span = lesseeScheduleSpan(
      lease.commencementDate,
      payload.endDate,
      fromMonth
    );
    const remeasured = lines
      .filter((line) => classificationOf(line) !== "Short-Term")
      .map((line) => {
        const rows = rowsOf(line);
        const points = paymentPoints(
          rows,
          lease.commencementDate,
          lease.paymentTiming,
          fromMonth
        );
        const carried = carrying.get(line.id)!;
        const before = {
          ...carried,
          liability: round(carried.liability + (addBack.get(line.id) ?? 0))
        };
        const result = remeasureLease({
          carryingLiability: before.liability,
          carryingRouAsset: before.rouAsset,
          remainingPayments: points,
          annualRate: payload.discountRate
        });
        const measured = measureAsset({
          line,
          payments: rows,
          fromMonth,
          endDate: payload.endDate,
          lease: modified,
          thresholds,
          shortTermExpedient: false
        });
        const after: "Operating" | "Finance" =
          line.classificationOverride === "Operating" ||
          line.classificationOverride === "Finance"
            ? line.classificationOverride
            : measured.classification === "Finance"
              ? "Finance"
              : "Operating";
        return { line, points, before, result, after, measured };
      });

    let journalId: string | null = null;
    if (remeasured.length > 0) {
      const accounting = await companyAccounting(trx, companyId);
      journalId = await postLesseeJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: startDate,
        description: `Lease Modification ${lease.leaseId}`,
        assets: remeasured.map(
          (asset): AssetLines => ({
            leaseLineId: asset.line.id,
            locationId: asset.line.locationId ?? lease.locationId,
            lines:
              asset.result.adjustment === 0 && asset.result.gain === 0
                ? []
                : remeasurementLines({
                    adjustment: asset.result.adjustment,
                    gain: asset.result.gain,
                    accounts: accounting.accounts
                  })
          })
        ),
        lease
      });

      await deleteSchedulesFrom(trx, {
        companyId,
        leaseLineIds: remeasured.map((asset) => asset.line.id),
        startDate
      });
      await writeSchedules(trx, {
        leaseId: lease.id,
        schedules: remeasured.map(
          (asset): AssetSchedule => ({
            // The months after the change are still the commencement's.
            leaseLineId: asset.line.id,
            commencementDate: lease.commencementDate,
            fromMonth,
            classification: asset.after,
            lines: buildLesseeSchedule({
              openingLiability: asset.result.liability,
              openingRouAsset: asset.result.rouAsset,
              payments: asset.points,
              months: span.months,
              annualRate: payload.discountRate,
              timing: lease.paymentTiming,
              classification: asset.after,
              amortizationMonths: amortizationMonths(
                asset.line,
                span.months,
                fromMonth
              ),
              periodDates: span.periodDates,
              lastMonthShare: span.lastMonthShare
            })
          })
        ),
        accounts: accounting.accounts,
        companyId,
        userId
      });
    }

    await updateLineMeasurements(trx, {
      companyId,
      userId,
      rows: lines.map((line) => {
        const asset = remeasured.find((row) => row.line.id === line.id);
        return {
          id: line.id,
          paymentAmount: cut.get(line.id)!.commencementPayment,
          lesseeClassification: asset?.after ?? "Short-Term",
          ...(asset
            ? {
                classificationInputs: asset.measured.classificationInputs,
                rouAssetCost: round(
                  Number(line.rouAssetCost ?? 0) +
                    asset.result.rouAsset -
                    asset.before.rouAsset
                )
              }
            : {})
        };
      })
    });
    await insertEvents(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      rows: lines.map((line) => {
        const asset = remeasured.find((row) => row.line.id === line.id);
        const before = classificationOf(line);
        return {
          leaseLineId: line.id,
          eventType: "Modification",
          effectiveDate: startDate,
          liabilityBefore: asset?.before.liability ?? 0,
          liabilityAfter: asset?.result.liability ?? 0,
          rouAssetBefore: asset?.before.rouAsset ?? 0,
          rouAssetAfter: asset?.result.rouAsset ?? 0,
          gainLoss: asset?.result.gain ?? 0,
          classificationBefore: before,
          classificationAfter: asset?.after ?? before,
          journalId: asset ? journalId : null,
          notes: payload.notes
        };
      })
    });
    return { id: lease.id };
  });
}

export async function terminate(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "terminate" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const lines = await readLines(trx, companyId, lease.id);
    const line = findLine(lines, payload.leaseLineId);
    const endOfLease = payload.terminationDate;
    if (endOfLease < lease.commencementDate) {
      throw new InvalidInputError(
        `The termination date cannot be before the commencement date, ${lease.commencementDate}`
      );
    }
    const startDate = addDays(endOfLease, 1);
    const carrying = (
      await prepare(trx, {
        companyId,
        lease,
        lines: [line],
        startDate,
        label: "terminated"
      })
    ).get(line.id)!;
    const before = classificationOf(line);

    // Payments after the date are never owed, nor is the purchase option; a
    // penalty is a final row.
    const addBack =
      (
        await deleteEndedPayments(trx, {
          companyId,
          leaseLineIds: [line.id],
          lastDay: endOfLease
        })
      ).get(line.id) ?? 0;
    if (payload.penaltyAmount > 0) {
      await trx
        .insertInto("leasePayment")
        .values({
          leaseId: lease.id,
          leaseLineId: line.id,
          paymentType: "Termination Penalty",
          periodStart: endOfLease,
          periodEnd: endOfLease,
          dueDate: endOfLease,
          amount: payload.penaltyAmount,
          status: "Pending",
          companyId,
          createdBy: userId
        })
        .execute();
    }

    let journalId: string | null = null;
    let gainLoss = 0;
    const carryingLiability = round(carrying.liability + addBack);
    if (before !== "Short-Term") {
      const accounting = await companyAccounting(trx, companyId);
      const termination = terminationLines({
        carryingLiability,
        penalty: payload.penaltyAmount,
        rouAssetCost: Number(line.rouAssetCost ?? 0),
        accumulated: carrying.accumulated,
        accounts: accounting.accounts
      });
      gainLoss = termination.gainLoss;
      journalId = await postLesseeJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: endOfLease,
        description: `Lease Termination ${lease.leaseId} ${line.description}`,
        assets: [
          {
            leaseLineId: line.id,
            locationId: line.locationId ?? lease.locationId,
            lines: termination.lines
          }
        ],
        lease
      });
      await deleteSchedulesFrom(trx, {
        companyId,
        leaseLineIds: [line.id],
        startDate
      });
    }

    await endAsset(trx, {
      companyId,
      userId,
      lease,
      lines,
      leaseLineId: line.id,
      status: "Terminated",
      endDate: endOfLease
    });
    await insertEvents(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      rows: [
        {
          leaseLineId: line.id,
          eventType: "Termination",
          effectiveDate: endOfLease,
          liabilityBefore: carryingLiability,
          liabilityAfter: payload.penaltyAmount,
          rouAssetBefore: carrying.rouAsset,
          rouAssetAfter: 0,
          gainLoss,
          classificationBefore: before,
          classificationAfter: before,
          journalId,
          notes: payload.notes
        }
      ]
    });
    return { id: lease.id };
  });
}

export async function purchase(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "purchase" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const lines = await readLines(trx, companyId, lease.id);
    const line = findLine(lines, payload.leaseLineId);
    if (line.lesseeClassification === "Short-Term") {
      throw new InvalidInputError(
        "A short-term asset has no right-of-use asset to purchase; end it and buy the asset on a purchase order"
      );
    }
    if (!lease.endDate) {
      throw new InvalidInputError(
        "An open-ended lease is short-term and has no right-of-use asset to purchase; end it and buy the asset on a purchase order"
      );
    }
    const exerciseDate = payload.exerciseDate;
    if (exerciseDate < lease.commencementDate) {
      throw new InvalidInputError(
        `The exercise date cannot be before the commencement date, ${lease.commencementDate}`
      );
    }
    // An asset whose ownership transfers is the lessee's at the end of the
    // lease with no option to exercise: it is "purchased" then, for nothing.
    const hasOption = (line.purchaseOptionAmount ?? 0) > 0;
    if (!hasOption) {
      if (!line.ownershipTransfers) {
        throw new InvalidInputError(
          `${line.description} has no purchase option`
        );
      }
      if (exerciseDate !== lease.endDate) {
        throw new InvalidInputError(
          `Ownership of ${line.description} passes at the end of the lease; take it on ${lease.endDate}`
        );
      }
      if (!equals(payload.purchasePrice, 0)) {
        throw new InvalidInputError(
          `${line.description} has no purchase option: ownership passes at the end of the lease for nothing, so the price is 0`
        );
      }
    }
    const startDate = addDays(exerciseDate, 1);
    const carrying = (
      await prepare(trx, {
        companyId,
        lease,
        lines: [line],
        startDate,
        label: "purchased"
      })
    ).get(line.id)!;

    const assetClass = await trx
      .selectFrom("fixedAssetClass")
      .select([
        "id",
        "assetAccountId",
        "depreciationMethod",
        "usefulLifeMonths",
        "residualValuePercent",
        "isConstructionInProgress"
      ])
      .where("id", "=", payload.fixedAssetClassId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!assetClass || assetClass.isConstructionInProgress) {
      throw new InvalidInputError("Choose an in-service fixed asset class");
    }
    // `account` is group-scoped; the id came from this company's class.
    const assetAccount = await trx
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "=", assetClass.assetAccountId)
      .executeTakeFirst();
    if (!assetAccount?.class) {
      throw new InvalidInputError(
        "The fixed asset class's asset account has no class"
      );
    }
    const assetAccountWithClass = {
      id: assetAccount.id,
      class: assetAccount.class
    };

    // An option row already invoiced on or before the exercise date is the
    // price: its invoice settles the liability, so nothing more is payable.
    const invoicedOption = await trx
      .selectFrom("leasePayment")
      .select(["amount"])
      .where("leaseLineId", "=", line.id)
      .where("companyId", "=", companyId)
      .where("paymentType", "=", "Purchase Option")
      .where("status", "=", "Invoiced")
      .where("dueDate", "<=", exerciseDate)
      .executeTakeFirst();
    if (
      invoicedOption &&
      round(Number(invoicedOption.amount)) !== round(payload.purchasePrice)
    ) {
      throw new InvalidInputError(
        `The purchase option is already invoiced at ${Number(invoicedOption.amount)}; exercise it at that price or delete the invoice`
      );
    }

    // Otherwise the option is paid once, on the exercise date; nothing after
    // it. A Pending option row the schedule already counted as paid goes back
    // into the carrying liability before the price replaces it.
    const addBack =
      (
        await deleteEndedPayments(trx, {
          companyId,
          leaseLineIds: [line.id],
          lastDay: exerciseDate
        })
      ).get(line.id) ?? 0;
    if (!invoicedOption && payload.purchasePrice > 0) {
      await trx
        .insertInto("leasePayment")
        .values({
          leaseId: lease.id,
          leaseLineId: line.id,
          paymentType: "Purchase Option",
          periodStart: exerciseDate,
          periodEnd: exerciseDate,
          dueDate: exerciseDate,
          amount: payload.purchasePrice,
          status: "Pending",
          companyId,
          createdBy: userId
        })
        .execute();
    }

    const carryingLiability = round(carrying.liability + addBack);
    const accounting = await companyAccounting(trx, companyId);
    const purchased = purchaseLines({
      carryingLiability,
      price: invoicedOption ? 0 : payload.purchasePrice,
      rouAssetCost: Number(line.rouAssetCost ?? 0),
      accumulated: carrying.accumulated,
      assetAccount: assetAccountWithClass,
      accounts: accounting.accounts
    });
    const journalId = await postLesseeJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: exerciseDate,
      description: `Lease Purchase ${lease.leaseId} ${line.description}`,
      assets: [
        {
          leaseLineId: line.id,
          locationId: line.locationId ?? lease.locationId,
          lines: purchased.lines
        }
      ],
      lease
    });

    const asset = await trx
      .insertInto("fixedAsset")
      .values({
        fixedAssetId: await getNextSequence(trx, "fixedAsset", companyId),
        fixedAssetClassId: assetClass.id,
        name: payload.name,
        serialNumber: line.serialNumber,
        locationId: line.locationId ?? lease.locationId,
        quantity: 1,
        acquisitionCost: purchased.assetCost,
        acquisitionDate: exerciseDate,
        depreciationStartDate: exerciseDate,
        depreciationMethod: assetClass.depreciationMethod,
        usefulLifeMonths: assetClass.usefulLifeMonths,
        residualValuePercent: assetClass.residualValuePercent,
        status: "Active",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await deleteSchedulesFrom(trx, {
      companyId,
      leaseLineIds: [line.id],
      startDate
    });
    await endAsset(trx, {
      companyId,
      userId,
      lease,
      lines,
      leaseLineId: line.id,
      status: "Purchased",
      endDate: exerciseDate,
      fixedAssetId: asset.id
    });
    const classification = classificationOf(line);
    await insertEvents(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      rows: [
        {
          leaseLineId: line.id,
          eventType: "Purchase",
          effectiveDate: exerciseDate,
          liabilityBefore: carryingLiability,
          liabilityAfter: invoicedOption ? 0 : payload.purchasePrice,
          rouAssetBefore: carrying.rouAsset,
          rouAssetAfter: 0,
          gainLoss: 0,
          classificationBefore: classification,
          classificationAfter: classification,
          fixedAssetId: asset.id,
          journalId,
          notes: payload.notes
        }
      ]
    });
    return { id: lease.id };
  });
}
