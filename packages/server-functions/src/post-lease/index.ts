// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone, type Json } from "@carbon/database";
import { readAccountingCutoverDate } from "@carbon/database/journal-posting-status";
import {
  buildLesseeSchedule,
  classifyLesseeLease,
  datetime,
  presentValueOfPayments
} from "@carbon/utils";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError } from "../errors";
import { refuseVoidBeforeCutover } from "../lib/cutover-void";
import {
  amortizationMonths,
  heldByRun,
  loadLesseeAccounting,
  lockLease,
  paymentPoints,
  postLesseeJournal,
  readPayments,
  type Scope,
  scheduleSpan,
  type Trx,
  voidLeaseJournal,
  writeSchedule
} from "./lease";
import { commencementLines } from "./lessee";
import { modify, purchase, terminate } from "./lifecycle";
import {
  activateBlocker,
  type LeasePayload,
  payloadValidator
} from "./validators";

// The lifecycle of a lessee lease (spec `.ai/specs/2026-10-11-lessee-leases.md`).
// Each action is ONE transaction that locks the lease row first:
//
//   activate   Draft → Active: classify (ASC 842-10-25-2 or the short-term
//              election), measure the liability at the PV of the payment
//              rows, post the commencement journal and write the monthly
//              schedule with its lease run rows. A Short-Term lease posts
//              nothing: its invoices go to lease expense.
//   cancel     Draft → deleted; Active with nothing invoiced or posted →
//              Cancelled, the commencement journal voided.
//   modify     remeasure from an effective date (lifecycle.ts).
//   terminate  end early, derecognize, gain or loss (lifecycle.ts).
//   purchase   exercise the purchase option into a fixed asset (lifecycle.ts).
//
// Business-validation failures are 400s (InvalidInputError) with the message
// the app shows; a record the caller's company does not own is a 404.

async function activate(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "activate" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const payments = await readPayments(trx, companyId, lease.id);

    const company = await trx
      .selectFrom("company")
      .select(["baseCurrencyCode", "companyGroupId"])
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    const blocker = activateBlocker({
      status: lease.status,
      paymentCount: payments.length,
      currencyCode: lease.currencyCode,
      baseCurrencyCode: company.baseCurrencyCode
    });
    if (blocker) throw new InvalidInputError(blocker);

    const settings = await trx
      .selectFrom("companySettings")
      .select([
        "leaseMajorPartThresholdPercent",
        "leaseSubstantiallyAllThresholdPercent",
        "leaseShortTermExpedient"
      ])
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();

    const span = scheduleSpan(lease.commencementDate, lease.endDate);
    const points = paymentPoints(
      payments,
      lease.commencementDate,
      lease.paymentTiming
    );
    const liability = presentValueOfPayments({
      payments: points,
      annualRate: lease.discountRate
    });
    const result = classifyLesseeLease(
      {
        termMonths: span.termMonths,
        pvPayments: liability,
        fairValue: lease.fairValue,
        economicLifeMonths: lease.economicLifeMonths,
        ownershipTransfers: lease.ownershipTransfers,
        purchaseOptionReasonablyCertain: lease.purchaseOptionReasonablyCertain,
        specializedAsset: lease.specializedAsset,
        shortTermExpedient: settings.leaseShortTermExpedient
      },
      {
        majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
        substantiallyAllPercent: Number(
          settings.leaseSubstantiallyAllThresholdPercent
        )
      }
    );
    const classification =
      lease.classificationOverride ?? result.classification;
    const classificationInputs = {
      ...result,
      termMonths: span.termMonths,
      pvPayments: liability,
      discountRate: lease.discountRate,
      thresholds: {
        majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
        substantiallyAllPercent: Number(
          settings.leaseSubstantiallyAllThresholdPercent
        )
      },
      override: lease.classificationOverride
    } as unknown as Json;
    const now = datetime.timestamp();

    if (classification === "Short-Term") {
      await trx
        .updateTable("lease")
        .set({
          status: "Active",
          lesseeClassification: classification,
          classificationInputs,
          activatedAt: now,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", lease.id)
        .where("companyId", "=", companyId)
        .execute();
      return { id: lease.id };
    }

    // A lease that started before the accounting cutover would put its
    // commencement journal before the cutover; its opening balance needs
    // the as-of path (plan Task 30).
    const cutoverDate = await readAccountingCutoverDate(trx, companyId);
    if (cutoverDate && lease.commencementDate < cutoverDate) {
      throw new InvalidInputError(
        "This lease started before accounting was set up. Opening balances for it are not supported yet."
      );
    }

    const accounting = await loadLesseeAccounting(trx, {
      companyId,
      companyGroupId: company.companyGroupId
    });
    const commencementJournalId = await postLesseeJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: lease.commencementDate,
      description: `Lease Commencement ${lease.leaseId}`,
      lines: commencementLines({ liability, accounts: accounting.accounts }),
      lease
    });

    const lines = buildLesseeSchedule({
      openingLiability: liability,
      openingRouAsset: liability,
      payments: points,
      months: span.months,
      annualRate: lease.discountRate,
      timing: lease.paymentTiming,
      classification,
      amortizationMonths: amortizationMonths(lease, span.months),
      periodDates: span.periodDates
    });
    await writeSchedule(trx, {
      lease,
      lines,
      fromMonth: 0,
      classification,
      accounts: accounting.accounts,
      companyId,
      userId
    });

    await trx
      .updateTable("lease")
      .set({
        status: "Active",
        lesseeClassification: classification,
        classificationInputs,
        initialLiability: liability,
        initialRouAsset: liability,
        rouAssetCost: liability,
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
    const posted = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select("id")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Posted")
      .executeTakeFirst();
    if (posted) {
      throw new InvalidInputError(
        "A lease run has posted entries of this lease; terminate the lease instead"
      );
    }

    if (lease.commencementJournalId) {
      const journal = await trx
        .selectFrom("journal")
        .select("postingDate")
        .where("id", "=", lease.commencementJournalId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      await refuseVoidBeforeCutover(
        trx,
        companyId,
        journal?.postingDate ? String(journal.postingDate) : null,
        "This lease commenced before accounting was set up; its balances came from the opening journal. Terminate it instead."
      );
      const accounting = await loadLesseeAccounting(trx, {
        companyId,
        companyGroupId: null
      });
      await voidLeaseJournal(trx, {
        journalId: lease.commencementJournalId,
        description: `VOID Lease Commencement ${lease.leaseId}`,
        postingStatus: accounting.postingStatus,
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
