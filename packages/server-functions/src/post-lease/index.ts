// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone } from "@carbon/database";
import { isBeforeCutover } from "@carbon/database/accounting-cutover-dates";
import {
  journalPostingStatus,
  readAccountingCutoverDate
} from "@carbon/database/journal-posting-status";
import { round } from "@carbon/database/precision";
import {
  buildLesseeSchedule,
  datetime,
  isPaidBeforeOpening,
  type LesseeScheduleLine,
  lesseeScheduleSpan
} from "@carbon/utils";
import { sql } from "kysely";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import {
  type AssetLines,
  type AssetSchedule,
  amortizationMonths,
  heldByRun,
  type LeaseLineRow,
  type LeasePaymentRow,
  type LeaseRow,
  loadLesseeAccounting,
  lockLease,
  type MeasuredAsset,
  measureAsset,
  paymentPoints,
  postLesseeJournal,
  readLines,
  readPayments,
  readThresholds,
  type Scope,
  type Trx,
  updateLineMeasurements,
  voidLeaseJournal,
  writeSchedules
} from "./lease";
import {
  commencementLines,
  type LeaseAccount,
  openingBalanceLines
} from "./lessee";
import { modify, purchase, terminate } from "./lifecycle";
import {
  activateBlocker,
  type LeasePayload,
  OPEN_ENDED_NEEDS_EXPEDIENT,
  payloadValidator
} from "./validators";

// The lifecycle of a lessee lease (spec `.ai/specs/2026-10-11-lessee-leases.md`).
// A lease holds one or more assets (`leaseLine`); each asset is a separate
// lease component (ASC 842-10-15-28) with its own classification,
// measurement, payment rows and schedule. Each action is ONE transaction that
// locks the lease row first:
//
//   activate   Draft → Active: classify each asset (ASC 842-10-25-2 or the
//              short-term election), measure its liability at the PV of its
//              payment rows, post ONE commencement journal with lines per
//              asset and write each asset's monthly schedule with its lease
//              run rows. A Short-Term asset posts nothing: its invoices go to
//              lease expense. A lease that started before the accounting
//              cutover posts an opening balance instead (spec Q8).
//   cancel     Active with nothing invoiced, posted by a run, modified or
//              ended → Cancelled, the commencement journal voided. A Draft
//              is deleted instead (the app's delete route).
//   modify     remeasure every active asset from an effective date
//              (lifecycle.ts).
//   terminate  end one asset early, derecognize it, gain or loss
//              (lifecycle.ts).
//   purchase   exercise one asset's purchase option into a fixed asset
//              (lifecycle.ts).
//
// Business-validation failures are 400s (InvalidInputError) with the message
// the app shows; a record the caller's company does not own is a 404.

/** The carrying liability and the accumulated ROU amortization a schedule
 *  reaches before `asOf`: the last line's closing liability (the initial
 *  liability when no line falls before it) and every earlier line's
 *  amortization. */
export function balancesBefore(
  lines: LesseeScheduleLine[],
  asOf: string,
  initialLiability: number
): { carryingLiability: number; accumulated: number } {
  const before = lines.filter((line) => line.periodDate < asOf);
  return {
    carryingLiability: before.at(-1)?.closingLiability ?? initialLiability,
    accumulated: round(
      before.reduce((sum, line) => sum + line.rouAmortization, 0)
    )
  };
}

/** Why a Skipped payment of a capitalized asset cannot activate, or null.
 *  Skipped means paid outside Carbon (before Invoice From): its invoice will
 *  never relieve the lease liability, so it must be one the opening balance
 *  holds. A payment due before the commencement is not in the schedule's
 *  months and is left alone. */
export function skippedPaymentBlocker(
  payment: Pick<
    LeasePaymentRow,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType" | "status"
  >,
  args: {
    description: string;
    lease: Pick<LeaseRow, "commencementDate" | "paymentTiming">;
    periodDates: string[];
    /** The opening balance's as-of date; null when there is none. */
    openingAsOf: string | null;
  }
): string | null {
  if (payment.status !== "Skipped") return null;
  if (payment.dueDate < args.lease.commencementDate) return null;
  if (
    args.openingAsOf &&
    isPaidBeforeOpening(payment, {
      commencementDate: args.lease.commencementDate,
      timing: args.lease.paymentTiming,
      periodDates: args.periodDates,
      asOf: args.openingAsOf
    })
  ) {
    return null;
  }
  const settledBy = args.openingAsOf
    ? `the opening balance on ${args.openingAsOf} still owes it`
    : "only its invoice settles the lease liability";
  return `${args.description}: the payment due ${payment.dueDate} is Skipped (paid outside Carbon), but ${settledBy}. Set Invoice From on or before ${payment.dueDate} so it is invoiced.`;
}

/** The retained earnings account default, with its class: an opening
 *  balance's difference goes there. */
async function retainedEarningsAccount(
  trx: Trx,
  companyId: string
): Promise<LeaseAccount> {
  const row = await trx
    .selectFrom("accountDefault")
    .innerJoin(
      "account",
      "account.id",
      "accountDefault.retainedEarningsAccount"
    )
    .select(["account.id", "account.class"])
    .where("accountDefault.companyId", "=", companyId)
    .executeTakeFirst();
  if (!row?.class) {
    throw new InvalidInputError(
      "Set the retained earnings account in Accounting → Default Accounts before activating a lease that started before accounting was set up"
    );
  }
  return { id: row.id, class: row.class };
}

async function activate(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "activate" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const lines = await readLines(trx, companyId, lease.id);
    const payments = await readPayments(trx, companyId, lease.id);
    const paymentsOf = (line: LeaseLineRow) =>
      payments.filter((payment) => payment.leaseLineId === line.id);

    const company = await trx
      .selectFrom("company")
      .select(["baseCurrencyCode", "companyGroupId"])
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    const blocker = activateBlocker({
      status: lease.status,
      assetCount: lines.length,
      assetsWithoutPayments: lines
        .filter((line) => paymentsOf(line).length === 0)
        .map((line) => line.description),
      currencyCode: lease.currencyCode,
      baseCurrencyCode: company.baseCurrencyCode
    });
    if (blocker) throw new InvalidInputError(blocker);

    const { shortTermExpedient, ...thresholds } = await readThresholds(
      trx,
      companyId
    );
    // An open-ended lease can be ended on notice, so every asset is
    // short-term (spec Addendum A10); it needs the expedient.
    const endDate = lease.endDate;
    if (!endDate && !shortTermExpedient) {
      throw new InvalidInputError(OPEN_ENDED_NEEDS_EXPEDIENT);
    }
    const measured: MeasuredAsset[] = lines.map((line) =>
      endDate
        ? measureAsset({
            line,
            payments: paymentsOf(line),
            endDate,
            lease,
            thresholds,
            shortTermExpedient
          })
        : {
            line,
            liability: 0,
            classification: "Short-Term",
            classificationInputs: { openEnded: true }
          }
    );
    const recognized = measured.filter(
      (
        asset
      ): asset is MeasuredAsset & {
        classification: "Operating" | "Finance";
      } => asset.classification !== "Short-Term"
    );
    const now = datetime.timestamp();

    let commencementJournalId: string | null = null;
    if (endDate && recognized.length > 0) {
      const span = lesseeScheduleSpan(lease.commencementDate, endDate);

      // A lease that started before the accounting cutover opens with the
      // balances its schedules reach on the as-of date (spec Q8) — the
      // cutover, or the first open period after it — and the months before
      // that are already in the opening equity: written Posted with no
      // journal. The payments those months pay are in that balance too, so
      // they are not invoiced.
      const cutoverDate = await readAccountingCutoverDate(trx, companyId);
      const openingAsOf =
        cutoverDate && lease.commencementDate < cutoverDate
          ? (
              await resolveAccountingPeriod(
                trx,
                companyId,
                cutoverDate,
                "historical-with-shift"
              )
            ).postingDate
          : null;
      for (const asset of recognized) {
        for (const payment of paymentsOf(asset.line)) {
          const skipped = skippedPaymentBlocker(payment, {
            description: asset.line.description,
            lease,
            periodDates: span.periodDates,
            openingAsOf
          });
          if (skipped) throw new InvalidInputError(skipped);
        }
      }

      const accounting = await loadLesseeAccounting(trx, {
        companyId,
        companyGroupId: company.companyGroupId
      });
      const schedules: AssetSchedule[] = recognized.map((asset) => ({
        leaseLineId: asset.line.id,
        commencementDate: lease.commencementDate,
        fromMonth: 0,
        classification: asset.classification,
        lines: buildLesseeSchedule({
          openingLiability: asset.liability,
          openingRouAsset: asset.liability,
          payments: paymentPoints(
            paymentsOf(asset.line),
            lease.commencementDate,
            lease.paymentTiming
          ),
          months: span.months,
          annualRate: lease.discountRate,
          timing: lease.paymentTiming,
          classification: asset.classification,
          amortizationMonths: amortizationMonths(asset.line, span.months),
          periodDates: span.periodDates,
          lastMonthShare: span.lastMonthShare
        })
      }));

      const retainedEarnings = openingAsOf
        ? await retainedEarningsAccount(trx, companyId)
        : null;
      const assets: AssetLines[] = recognized.map((asset, index) => ({
        leaseLineId: asset.line.id,
        locationId: asset.line.locationId ?? lease.locationId,
        lines:
          openingAsOf && retainedEarnings
            ? openingBalanceLines({
                ...balancesBefore(
                  schedules[index]!.lines,
                  openingAsOf,
                  asset.liability
                ),
                rouAssetCost: asset.liability,
                retainedEarnings,
                accounts: accounting.accounts
              })
            : commencementLines({
                liability: asset.liability,
                accounts: accounting.accounts
              })
      }));
      commencementJournalId = await postLesseeJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: openingAsOf ?? lease.commencementDate,
        description: `${openingAsOf ? "Lease Opening Balance" : "Lease Commencement"} ${lease.leaseId}`,
        assets,
        lease
      });

      await writeSchedules(trx, {
        leaseId: lease.id,
        schedules,
        accounts: accounting.accounts,
        companyId,
        userId,
        postedBefore: openingAsOf ?? undefined
      });

      const inOpening = openingAsOf
        ? recognized.flatMap((asset) =>
            paymentsOf(asset.line)
              .filter(
                (payment) =>
                  payment.status === "Pending" &&
                  isPaidBeforeOpening(payment, {
                    commencementDate: lease.commencementDate,
                    timing: lease.paymentTiming,
                    periodDates: span.periodDates,
                    asOf: openingAsOf
                  })
              )
              .map((payment) => payment.id)
          )
        : [];
      if (inOpening.length > 0) {
        await trx
          .updateTable("leasePayment")
          .set({ status: "Skipped", updatedBy: userId, updatedAt: now })
          .where("id", "in", inOpening)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    await updateLineMeasurements(trx, {
      companyId,
      userId,
      rows: measured.map((asset) => {
        const isRecognized = asset.classification !== "Short-Term";
        return {
          id: asset.line.id,
          lesseeClassification: asset.classification,
          classificationInputs: asset.classificationInputs,
          initialLiability: isRecognized ? asset.liability : null,
          rouAssetCost: isRecognized ? asset.liability : null
        };
      })
    });
    await trx
      .updateTable("lease")
      .set({
        status: "Active",
        commencementJournalId,
        activatedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    return { id: lease.id };
  });
}

async function cancel(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "cancel" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();
  return db.transaction().execute(async (trx: Trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    if (lease.status === "Draft") {
      throw new InvalidInputError(
        "A Draft lease is deleted, not cancelled; delete it instead"
      );
    }
    if (lease.status !== "Active") {
      throw new InvalidInputError(
        `The lease is ${lease.status}; only an Active lease with nothing invoiced or posted can be cancelled`
      );
    }

    // Cancel undoes the activation and nothing else: once an asset has
    // ended or the lease has changed, its journals and its fixed asset are
    // history that a void would leave half undone.
    const ended = (await readLines(trx, companyId, lease.id)).find(
      (line) => line.status !== "Active"
    );
    if (ended) {
      throw new InvalidInputError(
        `${ended.description} is ${ended.status}; a lease with an ended asset cannot be cancelled. Terminate its other assets instead.`
      );
    }
    const event = await trx
      .selectFrom("leaseEvent")
      .select("eventType")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (event) {
      throw new InvalidInputError(
        `The lease has a ${event.eventType} since it commenced; terminate it instead`
      );
    }
    const invoiced = await trx
      .selectFrom("leasePayment")
      .select("id")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Invoiced")
      .executeTakeFirst();
    if (invoiced) {
      throw new InvalidInputError(
        "A payment of this lease is already invoiced; terminate the lease instead"
      );
    }
    const run = await heldByRun(trx, { companyId, leaseId: lease.id });
    if (run) {
      throw new InvalidInputError(
        `${run} holds this lease's entries; delete or recalculate it first`
      );
    }
    // Rows an opening balance wrote Posted carry no run line; voiding the
    // opening journal takes them back out with the rest.
    const posted = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select("id")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Posted")
      .where("runLineId", "is not", null)
      .executeTakeFirst();
    if (posted) {
      throw new InvalidInputError(
        "A lease run has posted entries of this lease; terminate the lease instead"
      );
    }

    // The only journal an unchanged lease has: its commencement (or opening
    // balance). A Short-Term lease has none.
    if (lease.commencementJournalId) {
      const journal = await trx
        .selectFrom("journal")
        .select(sql<string>`"postingDate"::text`.as("postingDate"))
        .where("id", "=", lease.commencementJournalId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      const cutoverDate = await readAccountingCutoverDate(trx, companyId);
      if (isBeforeCutover(journal.postingDate, cutoverDate)) {
        throw new InvalidInputError(
          "This lease commenced before accounting was set up; its balances came from the opening journal. Terminate it instead."
        );
      }
      await voidLeaseJournal(trx, {
        journalId: lease.commencementJournalId,
        postingStatus: await journalPostingStatus(trx, companyId),
        companyId,
        userId,
        today
      });
    }

    // The Planned run rows cascade with their schedule lines.
    await trx
      .deleteFrom("leaseScheduleLine")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    const now = datetime.timestamp();
    await trx
      .updateTable("lease")
      .set({
        status: "Cancelled",
        closedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    return { id: lease.id };
  });
}

export const postLeaseInput = payloadValidator;
export type PostLeaseInput = LeasePayload;

const postLease = defineServerFn({
  name: "post-lease",
  input: postLeaseInput,
  // Kysely below bypasses RLS; every action changes a purchasing document.
  permissions: { update: "purchasing" },
  async run({ db, companyId, userId }, payload): Promise<{ id: string }> {
    const scope = { db, companyId, userId };
    switch (payload.type) {
      case "activate":
        return activate(scope, payload);
      case "cancel":
        return cancel(scope, payload);
      case "modify":
        return modify(scope, payload);
      case "terminate":
        return terminate(scope, payload);
      case "purchase":
        return purchase(scope, payload);
    }
  }
});

export default postLease;
