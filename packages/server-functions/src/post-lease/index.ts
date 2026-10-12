// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone } from "@carbon/database";
import { isBeforeCutover } from "@carbon/database/accounting-cutover-dates";
import { readAccountingCutoverDate } from "@carbon/database/journal-posting-status";
import { round } from "@carbon/database/precision";
import {
  buildLesseeSchedule,
  datetime,
  type LesseeScheduleLine
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
  scheduleSpan,
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
//   cancel     Draft → deleted; Active with nothing invoiced or posted →
//              Cancelled, every journal of the lease voided.
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
            fromDate: lease.commencementDate,
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
      const accounting = await loadLesseeAccounting(trx, {
        companyId,
        companyGroupId: company.companyGroupId
      });
      const span = scheduleSpan(lease.commencementDate, endDate);
      const schedules: AssetSchedule[] = recognized.map((asset) => ({
        leaseLineId: asset.line.id,
        startDate: lease.commencementDate,
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
          periodDates: span.periodDates
        })
      }));

      // A lease that started before the accounting cutover opens with the
      // balances its schedules reach on the as-of date (spec Q8) — the
      // cutover, or the first open period after it — and the months before
      // that are already in the opening equity: written Posted with no
      // journal. The payments due before it are in that balance too, so
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

      if (openingAsOf) {
        await trx
          .updateTable("leasePayment")
          .set({ status: "Skipped", updatedBy: userId, updatedAt: now })
          .where("leaseId", "=", lease.id)
          .where("companyId", "=", companyId)
          .where(
            "leaseLineId",
            "in",
            recognized.map((asset) => asset.line.id)
          )
          .where("status", "=", "Pending")
          .where("dueDate", "<", openingAsOf)
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
  payload: Extract<LeasePayload, { type: "cancel" }>,
  today: string
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx: Trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);

    if (lease.status === "Draft") {
      await trx
        .deleteFrom("lease")
        .where("id", "=", lease.id)
        .where("companyId", "=", companyId)
        .execute();
      return { id: lease.id };
    }
    if (lease.status !== "Active") {
      throw new InvalidInputError(
        `The lease is ${lease.status}; only a Draft lease or an Active lease with nothing invoiced or posted can be cancelled`
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

    // Every journal the lease posted: the commencement (or opening balance)
    // and each Modify, Terminate or Purchase journal since.
    const events = await trx
      .selectFrom("leaseEvent")
      .select("journalId")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("journalId", "is not", null)
      .execute();
    const journalIds = [
      ...new Set(
        [
          lease.commencementJournalId,
          ...events.map((event) => event.journalId)
        ].filter((id): id is string => id !== null)
      )
    ];
    if (journalIds.length > 0) {
      const journals = await trx
        .selectFrom("journal")
        .select(["id", sql<string>`"postingDate"::text`.as("postingDate")])
        .where("id", "in", journalIds)
        .where("companyId", "=", companyId)
        .execute();
      const cutoverDate = await readAccountingCutoverDate(trx, companyId);
      if (
        journals.some((journal) =>
          isBeforeCutover(journal.postingDate, cutoverDate)
        )
      ) {
        throw new InvalidInputError(
          "This lease commenced before accounting was set up; its balances came from the opening journal. Terminate it instead."
        );
      }
      const accounting = await loadLesseeAccounting(trx, {
        companyId,
        companyGroupId: null
      });
      for (const journalId of journalIds) {
        await voidLeaseJournal(trx, {
          journalId,
          postingStatus: accounting.postingStatus,
          companyId,
          userId,
          today
        });
      }
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
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();
    switch (payload.type) {
      case "activate":
        return activate(scope, payload);
      case "cancel":
        return cancel(scope, payload, today);
      case "modify":
        return modify(scope, payload, today);
      case "terminate":
        return terminate(scope, payload, today);
      case "purchase":
        return purchase(scope, payload, today);
    }
  }
});

export default postLease;
