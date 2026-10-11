// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Modify, Terminate and Purchase of a lessee lease (spec
// `.ai/specs/2026-10-11-lessee-leases.md` §7). Each is one transaction that
// locks the lease, checks the months before the effective date are posted
// and no run holds a later row, posts one 'Lease' journal, rewrites the
// schedule and the payment rows from the effective date, and records a
// `leaseEvent`. Posted history is never changed.

import { getNextSequence } from "@carbon/database/sequence";
import {
  addDays,
  addMonths,
  buildLesseeSchedule,
  classifyLesseeLease,
  datetime,
  generateLeasePayments,
  remeasureLease,
  round,
  wholeMonthsInTerm
} from "@carbon/utils";
import { sql } from "kysely";
import { InvalidInputError } from "../errors";
import { currencyDecimals } from "../post-rental-agreement/agreement";
import {
  amortizationMonths,
  heldByRun,
  type LeaseRow,
  loadLesseeAccounting,
  lockLease,
  paymentPoints,
  postLesseeJournal,
  type Scope,
  scheduleSpan,
  type Trx,
  writeSchedule
} from "./lease";
import {
  type LeaseAccount,
  purchaseLines,
  remeasurementLines,
  terminationLines
} from "./lessee";
import type { LeasePayload } from "./validators";

/** The lease month that starts on `startDate`, or null when `startDate` is
 *  not a lease-month boundary (the commencement day of a month). */
export function leaseMonthStarting(
  commencementDate: string,
  startDate: string
): number | null {
  if (startDate < commencementDate) return null;
  const month =
    startDate === commencementDate
      ? 0
      : wholeMonthsInTerm(commencementDate, addDays(startDate, -1));
  return addMonths(commencementDate, month) === startDate ? month : null;
}

type Carrying = {
  /** The lease's liability at the start of the effective month. */
  liability: number;
  /** ROU amortization the lease runs have booked before it. */
  accumulated: number;
  /** The ROU asset's carrying amount: cost less accumulated amortization. */
  rouAsset: number;
};

/**
 * The checks every lifecycle action shares, and the carrying amounts at
 * `startDate` (the first day after the change takes effect). Refuses a date
 * that is not a lease-month boundary, a month before it whose run rows are
 * not Posted, a later row a run holds, and an Invoiced payment due on or
 * after `firstUninvoicedDue`.
 */
async function prepare(
  trx: Trx,
  args: {
    companyId: string;
    lease: LeaseRow;
    startDate: string;
    firstUninvoicedDue: string;
    label: string;
  }
): Promise<Carrying> {
  const { companyId, lease, startDate, label } = args;
  if (lease.status !== "Active") {
    throw new InvalidInputError(
      `The lease is ${lease.status}; only an Active lease can be ${label}`
    );
  }
  if (leaseMonthStarting(lease.commencementDate, startDate) === null) {
    throw new InvalidInputError(
      `The date must fall on a lease-month boundary: the month starts on day ${lease.commencementDate.slice(8)} of a month`
    );
  }
  if (startDate > addDays(lease.endDate, 1)) {
    throw new InvalidInputError("The date is after the end of the lease");
  }

  const invoiced = await trx
    .selectFrom("leasePayment")
    .select(sql<string>`"dueDate"::text`.as("dueDate"))
    .where("leaseId", "=", lease.id)
    .where("companyId", "=", companyId)
    .where("status", "=", "Invoiced")
    .where("dueDate", ">=", args.firstUninvoicedDue)
    .orderBy("dueDate")
    .executeTakeFirst();
  if (invoiced) {
    throw new InvalidInputError(
      `The payment due ${invoiced.dueDate} is already invoiced; choose a later date or delete the invoice`
    );
  }

  if (lease.lesseeClassification === "Short-Term") {
    return { liability: 0, accumulated: 0, rouAsset: 0 };
  }

  const unposted = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select(sql<string>`"scheduledDate"::text`.as("scheduledDate"))
    .where("leaseId", "=", lease.id)
    .where("companyId", "=", companyId)
    .where("status", "=", "Planned")
    .where("scheduledDate", "<", startDate)
    .orderBy("scheduledDate")
    .executeTakeFirst();
  if (unposted) {
    throw new InvalidInputError(
      `Post the lease run for ${unposted.scheduledDate} first: the months before the change must be on the books`
    );
  }
  const run = await heldByRun(trx, {
    companyId,
    leaseId: lease.id,
    fromDate: startDate
  });
  if (run) {
    throw new InvalidInputError(
      `${run} holds this lease's entries from ${startDate}; delete or recalculate it first`
    );
  }

  const before = await trx
    .selectFrom("leaseScheduleLine")
    .select([
      "closingLiability",
      "rouAmortization",
      sql<string>`"periodDate"::text`.as("periodDate")
    ])
    .where("leaseId", "=", lease.id)
    .where("companyId", "=", companyId)
    .where("periodDate", "<", startDate)
    .orderBy("periodDate")
    .execute();
  const last = before[before.length - 1];
  const liability = last
    ? Number(last.closingLiability)
    : Number(lease.initialLiability ?? 0);
  const accumulated = round(
    before.reduce((sum, line) => sum + Number(line.rouAmortization), 0)
  );
  return {
    liability,
    accumulated,
    rouAsset: round(Number(lease.rouAssetCost ?? 0) - accumulated)
  };
}

async function deleteScheduleFrom(
  trx: Trx,
  args: { companyId: string; leaseId: string; startDate: string }
) {
  // The Planned run rows cascade with their schedule lines.
  await trx
    .deleteFrom("leaseScheduleLine")
    .where("leaseId", "=", args.leaseId)
    .where("companyId", "=", args.companyId)
    .where("periodDate", ">=", args.startDate)
    .execute();
}

async function insertEvent(
  trx: Trx,
  args: {
    companyId: string;
    userId: string;
    leaseId: string;
    eventType: "Modification" | "Termination" | "Purchase";
    effectiveDate: string;
    liabilityBefore: number;
    liabilityAfter: number;
    rouAssetBefore: number;
    rouAssetAfter: number;
    gainLoss: number;
    classificationBefore: "Operating" | "Finance" | "Short-Term";
    classificationAfter: "Operating" | "Finance" | "Short-Term";
    fixedAssetId?: string | null;
    journalId?: string | null;
    notes?: string | null;
  }
) {
  const { companyId, userId, ...event } = args;
  await trx
    .insertInto("leaseEvent")
    .values({
      ...event,
      fixedAssetId: event.fixedAssetId ?? null,
      journalId: event.journalId ?? null,
      notes: event.notes ?? null,
      companyId,
      createdBy: userId
    })
    .execute();
}

export async function modify(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "modify" }>,
  _today: string
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const startDate = payload.effectiveDate;
    const carrying = await prepare(trx, {
      companyId,
      lease,
      startDate,
      firstUninvoicedDue: startDate,
      label: "modified"
    });
    const before = lease.lesseeClassification ?? "Operating";
    if (
      before === "Short-Term" &&
      payload.endDate > addDays(addMonths(lease.commencementDate, 12), -1)
    ) {
      throw new InvalidInputError(
        "A short-term lease cannot run past 12 months; end it and enter the extension as a new lease"
      );
    }

    // The remaining payments, cut again from the new terms.
    await trx
      .deleteFrom("leasePayment")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Pending")
      .where("dueDate", ">=", startDate)
      .execute();
    const decimals = await currencyDecimals(trx, companyId, lease.currencyCode);
    const rows = generateLeasePayments({
      commencementDate: startDate,
      endDate: payload.endDate,
      paymentAmount: payload.paymentAmount,
      frequency: payload.paymentFrequency,
      timing: lease.paymentTiming,
      annualEscalationPercent: payload.annualEscalationPercent,
      purchaseOptionAmount: lease.purchaseOptionReasonablyCertain
        ? (lease.purchaseOptionAmount ?? 0)
        : 0,
      decimals
    });
    if (rows.length > 0) {
      await trx
        .insertInto("leasePayment")
        .values(
          rows.map((row) => ({
            ...row,
            leaseId: lease.id,
            status: "Pending" as const,
            companyId,
            createdBy: userId
          }))
        )
        .execute();
    }

    const now = datetime.timestamp();
    const terms = {
      endDate: payload.endDate,
      discountRate: payload.discountRate,
      paymentAmount: payload.paymentAmount,
      paymentFrequency: payload.paymentFrequency,
      annualEscalationPercent: payload.annualEscalationPercent,
      updatedBy: userId,
      updatedAt: now
    };

    if (before === "Short-Term") {
      await trx
        .updateTable("lease")
        .set(terms)
        .where("id", "=", lease.id)
        .where("companyId", "=", companyId)
        .execute();
      await insertEvent(trx, {
        companyId,
        userId,
        leaseId: lease.id,
        eventType: "Modification",
        effectiveDate: startDate,
        liabilityBefore: 0,
        liabilityAfter: 0,
        rouAssetBefore: 0,
        rouAssetAfter: 0,
        gainLoss: 0,
        classificationBefore: before,
        classificationAfter: before,
        notes: payload.notes
      });
      return { id: lease.id };
    }

    const span = scheduleSpan(startDate, payload.endDate);
    const points = paymentPoints(rows, startDate, lease.paymentTiming);
    const remeasured = remeasureLease({
      carryingLiability: carrying.liability,
      carryingRouAsset: carrying.rouAsset,
      remainingPayments: points,
      annualRate: payload.discountRate
    });

    // Reassess the classification over what is left of the lease.
    const settings = await trx
      .selectFrom("companySettings")
      .select([
        "leaseMajorPartThresholdPercent",
        "leaseSubstantiallyAllThresholdPercent"
      ])
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    const result = classifyLesseeLease(
      {
        termMonths: span.termMonths,
        pvPayments: remeasured.liability,
        fairValue: lease.fairValue,
        economicLifeMonths: lease.economicLifeMonths,
        ownershipTransfers: lease.ownershipTransfers,
        purchaseOptionReasonablyCertain: lease.purchaseOptionReasonablyCertain,
        specializedAsset: lease.specializedAsset,
        shortTermExpedient: false
      },
      {
        majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
        substantiallyAllPercent: Number(
          settings.leaseSubstantiallyAllThresholdPercent
        )
      }
    );
    const after =
      lease.classificationOverride === "Operating" ||
      lease.classificationOverride === "Finance"
        ? lease.classificationOverride
        : result.classification === "Finance"
          ? "Finance"
          : "Operating";

    const company = await trx
      .selectFrom("company")
      .select("companyGroupId")
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    const accounting = await loadLesseeAccounting(trx, {
      companyId,
      companyGroupId: company.companyGroupId
    });
    const journalId =
      remeasured.adjustment === 0 && remeasured.gain === 0
        ? null
        : await postLesseeJournal(trx, {
            accounting,
            companyId,
            userId,
            postingDate: startDate,
            description: `Lease Modification ${lease.leaseId}`,
            lines: remeasurementLines({
              adjustment: remeasured.adjustment,
              gain: remeasured.gain,
              accounts: accounting.accounts
            }),
            lease
          });

    await deleteScheduleFrom(trx, {
      companyId,
      leaseId: lease.id,
      startDate
    });
    const lines = buildLesseeSchedule({
      openingLiability: remeasured.liability,
      openingRouAsset: remeasured.rouAsset,
      payments: points,
      months: span.months,
      annualRate: payload.discountRate,
      timing: lease.paymentTiming,
      classification: after,
      amortizationMonths: amortizationMonths(lease, span.months),
      periodDates: span.periodDates
    });
    await writeSchedule(trx, {
      // Lease months after the change run from the effective date.
      lease: { id: lease.id, commencementDate: startDate },
      lines,
      fromMonth: 0,
      classification: after,
      accounts: accounting.accounts,
      companyId,
      userId
    });

    await trx
      .updateTable("lease")
      .set({
        ...terms,
        lesseeClassification: after,
        rouAssetCost: round(
          Number(lease.rouAssetCost ?? 0) +
            remeasured.rouAsset -
            carrying.rouAsset
        )
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    await insertEvent(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      eventType: "Modification",
      effectiveDate: startDate,
      liabilityBefore: carrying.liability,
      liabilityAfter: remeasured.liability,
      rouAssetBefore: carrying.rouAsset,
      rouAssetAfter: remeasured.rouAsset,
      gainLoss: remeasured.gain,
      classificationBefore: before,
      classificationAfter: after,
      journalId,
      notes: payload.notes
    });
    return { id: lease.id };
  });
}

export async function terminate(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "terminate" }>,
  _today: string
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const endOfLease = payload.terminationDate;
    const startDate = addDays(endOfLease, 1);
    const carrying = await prepare(trx, {
      companyId,
      lease,
      startDate,
      firstUninvoicedDue: startDate,
      label: "terminated"
    });
    const before = lease.lesseeClassification ?? "Operating";

    // Payments after the date are never owed; a penalty is a final row.
    await trx
      .deleteFrom("leasePayment")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Pending")
      .where((eb) =>
        eb.or([
          eb("dueDate", ">", endOfLease),
          eb("paymentType", "=", "Purchase Option")
        ])
      )
      .execute();
    if (payload.penaltyAmount > 0) {
      await trx
        .insertInto("leasePayment")
        .values({
          leaseId: lease.id,
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
    if (before !== "Short-Term") {
      const company = await trx
        .selectFrom("company")
        .select("companyGroupId")
        .where("id", "=", companyId)
        .executeTakeFirstOrThrow();
      const accounting = await loadLesseeAccounting(trx, {
        companyId,
        companyGroupId: company.companyGroupId
      });
      const termination = terminationLines({
        carryingLiability: carrying.liability,
        penalty: payload.penaltyAmount,
        rouAssetCost: Number(lease.rouAssetCost ?? 0),
        accumulated: carrying.accumulated,
        accounts: accounting.accounts
      });
      gainLoss = termination.gainLoss;
      journalId = await postLesseeJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: endOfLease,
        description: `Lease Termination ${lease.leaseId}`,
        lines: termination.lines,
        lease
      });
      await deleteScheduleFrom(trx, {
        companyId,
        leaseId: lease.id,
        startDate
      });
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("lease")
      .set({
        status: "Terminated",
        endDate: endOfLease,
        closedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    await insertEvent(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      eventType: "Termination",
      effectiveDate: endOfLease,
      liabilityBefore: carrying.liability,
      liabilityAfter: payload.penaltyAmount,
      rouAssetBefore: carrying.rouAsset,
      rouAssetAfter: 0,
      gainLoss,
      classificationBefore: before,
      classificationAfter: before,
      journalId,
      notes: payload.notes
    });
    return { id: lease.id };
  });
}

export async function purchase(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "purchase" }>,
  _today: string
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    if (lease.lesseeClassification === "Short-Term") {
      throw new InvalidInputError(
        "A short-term lease has no right-of-use asset to purchase; end it and buy the asset on a purchase order"
      );
    }
    if (!lease.purchaseOptionAmount) {
      throw new InvalidInputError("This lease has no purchase option");
    }
    const exerciseDate = payload.exerciseDate;
    const startDate = addDays(exerciseDate, 1);
    const carrying = await prepare(trx, {
      companyId,
      lease,
      startDate,
      firstUninvoicedDue: startDate,
      label: "purchased"
    });

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

    // The option is paid once, on the exercise date; nothing after it.
    await trx
      .deleteFrom("leasePayment")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Pending")
      .where((eb) =>
        eb.or([
          eb("dueDate", ">", exerciseDate),
          eb("paymentType", "=", "Purchase Option")
        ])
      )
      .execute();
    await trx
      .insertInto("leasePayment")
      .values({
        leaseId: lease.id,
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

    const company = await trx
      .selectFrom("company")
      .select("companyGroupId")
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    const accounting = await loadLesseeAccounting(trx, {
      companyId,
      companyGroupId: company.companyGroupId
    });
    const purchased = purchaseLines({
      carryingLiability: carrying.liability,
      price: payload.purchasePrice,
      rouAssetCost: Number(lease.rouAssetCost ?? 0),
      accumulated: carrying.accumulated,
      assetAccount: assetAccount as LeaseAccount,
      accounts: accounting.accounts
    });
    const journalId = await postLesseeJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: exerciseDate,
      description: `Lease Purchase ${lease.leaseId}`,
      lines: purchased.lines,
      lease
    });

    const asset = await trx
      .insertInto("fixedAsset")
      .values({
        fixedAssetId: await getNextSequence(trx, "fixedAsset", companyId),
        fixedAssetClassId: assetClass.id,
        name: payload.name,
        locationId: lease.locationId,
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

    await deleteScheduleFrom(trx, { companyId, leaseId: lease.id, startDate });

    const now = datetime.timestamp();
    await trx
      .updateTable("lease")
      .set({
        status: "Purchased",
        endDate: exerciseDate,
        fixedAssetId: asset.id,
        closedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    const classification = lease.lesseeClassification ?? "Operating";
    await insertEvent(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      eventType: "Purchase",
      effectiveDate: exerciseDate,
      liabilityBefore: carrying.liability,
      liabilityAfter: payload.purchasePrice,
      rouAssetBefore: carrying.rouAsset,
      rouAssetAfter: 0,
      gainLoss: 0,
      classificationBefore: classification,
      classificationAfter: classification,
      fixedAssetId: asset.id,
      journalId,
      notes: payload.notes
    });
    return { id: lease.id };
  });
}
