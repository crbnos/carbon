// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone, type Json } from "@carbon/database";
import { toJson } from "@carbon/database/json";
import {
  buildLessorSchedule,
  datetime,
  generateRentalBillingPeriods,
  type PeriodSpec
} from "@carbon/utils";
import { sql } from "kysely";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  type AgreementRow,
  billingPeriodRow,
  currencyDecimals,
  type Db,
  insertUnitActivity,
  loadLeaseAccounting,
  lockAgreement,
  postLeaseJournal,
  type Trx
} from "./agreement";
import {
  activationBillingThrough,
  buildCommencementLines,
  type ClassificationInputs,
  certainPurchaseOption,
  classifyRentalLine,
  commencementAmounts,
  interestRows,
  type LeasePaymentTerms,
  leaseClosingTarget,
  leasePaymentTerms,
  salesTypeRequirementError,
  scheduleBillingPeriods,
  settledClassification
} from "./lessor";
import { returnRentalUnit } from "./return-unit";
import {
  cancelBlocker,
  closeBlocker,
  futureReleaseError,
  LIVE_LINE_STATUSES,
  openRentalDocumentBlocker,
  payloadValidator,
  RENTABLE_ASSET_STATUSES,
  type RentalAgreementPayload,
  releaseBlocker,
  unitAvailabilityError,
  unitLabel,
  unpricedUnitError
} from "./validators";

// The lifecycle of a rental agreement (spec §3, §4). Four actions, each ONE
// transaction that locks the agreement row first:
//
//   activate  Draft → Active: every unit Available and priced (its own
//             frequency and rate, already on the line), each line classified (ASC 842, `lessor.ts`),
//             first billing periods cut. An operating line posts nothing — the
//             unit simply stops being Available. A sales-type line commences:
//             the fleet unit is derecognized (asset Disposed by Sale), the
//             'Lease' journal books net investment / COGS / lease revenue, and
//             the effective-interest schedule plus its Interest recognition
//             rows are written.
//   A unit comes back through a rental receipt (`post-receipt`), which calls `returnRentalUnit`.
//   release   a Pending unit that never left the yard stops billing at the release date and is free again.
//   close     Active → Closed once every unit is back and everything billed.
//   cancel    Draft, or Active with nothing on rent / billed / recognized /
//             commenced → Cancelled; the Pending lines are deleted so their
//             units are free.

// Business-validation failures are 400s (InvalidInputError) with the exact
// message the app shows; a referenced record the caller's company does not own
// is a 404 (NotFoundError); everything else is a 500 so real outages surface in
// monitoring.

type ActivationPlan = {
  lineId: string;
  name: string;
  itemId: string;
  fixedAssetId: string;
  trackedEntityId: string | null;
  deliveredAt: string | null;
  periods: PeriodSpec[];
  classification: "Rental" | "Sale";
  classificationInputs: ClassificationInputs;
  terms: LeasePaymentTerms;
  closingTarget: number;
};

type Scope = { db: Db; companyId: string; userId: string };

async function activate(
  { db, companyId, userId }: Scope,
  payload: Extract<RentalAgreementPayload, { type: "activate" }>,
  today: string
): Promise<{ id: string }> {
  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId
    );
    if (agreement.status !== "Draft") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; only a Draft agreement can be activated`
      );
    }

    // Accrual and deferral amounts are posted in base currency (Task 40), so
    // until the agreement's exchange rate is carried through them a foreign
    // currency agreement would post document amounts as base. The same holds
    // for a sales-type line's net investment and lease revenue.
    const company = await trx
      .selectFrom("company")
      .select(["baseCurrencyCode", "companyGroupId"])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!company) throw new NotFoundError("Company not found");
    if (agreement.currencyCode !== company.baseCurrencyCode) {
      throw new InvalidInputError(
        "Rental agreements in a foreign currency are not supported yet"
      );
    }
    const decimals = await currencyDecimals(
      trx,
      companyId,
      agreement.currencyCode
    );

    // One read for the ledger switch and the classification thresholds.
    const settings = await trx
      .selectFrom("companySettings")
      .select([
        "accountingEnabled",
        "leaseMajorPartThresholdPercent",
        "leaseSubstantiallyAllThresholdPercent"
      ])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!settings) throw new NotFoundError("Company settings not found");
    const thresholds = {
      majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
      substantiallyAllPercent: Number(
        settings.leaseSubstantiallyAllThresholdPercent
      )
    };

    const lines = await trx
      .selectFrom("rentalAgreementLine")
      .select([
        "id",
        "fixedAssetId",
        "itemId",
        "trackedEntityId",
        "rateUnit",
        "rate",
        "fairValue",
        "economicLifeMonths",
        "guaranteedResidualValue",
        "unguaranteedResidualValue",
        "lessorClassification",
        "classificationOverride",
        sql<string | null>`"deliveredAt"::text`.as("deliveredAt")
      ])
      .where("rentalAgreementId", "=", agreement.id)
      .where("companyId", "=", companyId)
      .orderBy("createdAt")
      .forUpdate()
      .execute();
    if (lines.length === 0) {
      throw new InvalidInputError(
        "Add at least one fleet unit before activating the agreement"
      );
    }
    // Every line rents a fleet unit (spec §3). A sales-type lease straight
    // out of stock — a line with a tracked entity and no asset — has no
    // entry point in v1, so it is refused here with every other asset-less
    // line rather than half-supported.
    if (lines.some((line) => !line.fixedAssetId)) {
      throw new InvalidInputError("Every line needs a fleet unit");
    }
    const assetIds = [
      ...new Set(lines.map((line) => line.fixedAssetId as string))
    ];

    // One read for every unit: the view derives Reserved / On Rent from the
    // live line and In Maintenance from the out-of-service columns.
    const units = await trx
      .selectFrom("fleetAssets as fa")
      .leftJoin("rentalAgreement as live", (join) =>
        join
          .onRef("live.id", "=", "fa.rentalAgreementId")
          .onRef("live.companyId", "=", "fa.companyId")
      )
      .select([
        "fa.id",
        "fa.fixedAssetId",
        "fa.itemId",
        "fa.status",
        "fa.fleetStatus",
        "fa.outOfServiceReason",
        "fa.rentalAgreementId as liveAgreementId",
        "live.rentalAgreementId as liveAgreementReadableId"
      ])
      .where("fa.id", "in", assetIds)
      .where("fa.companyId", "=", companyId)
      .execute();
    const unitById = new Map(units.map((unit) => [unit.id, unit]));

    // Every problem at once, so a planner fixes the agreement in one pass.
    const problems: string[] = [];
    const plans: ActivationPlan[] = [];
    for (const line of lines) {
      const unit = unitById.get(line.fixedAssetId as string);
      if (!unit || !unit.itemId) {
        problems.push("A line names an asset that is not a fleet unit");
        continue;
      }
      const name = unit.fixedAssetId ?? unit.id ?? "A fleet unit";
      const unavailable = unitAvailabilityError(
        {
          fixedAssetId: name,
          status: unit.status,
          fleetStatus: unit.fleetStatus,
          outOfServiceReason: unit.outOfServiceReason,
          liveAgreementId: unit.liveAgreementId,
          liveAgreementReadableId: unit.liveAgreementReadableId
        },
        agreement.id
      );
      if (unavailable) {
        problems.push(unavailable);
        continue;
      }
      // The unit's own frequency and rate, fixed from here on: a later change
      // to the rate cards never touches a live line.
      const rate = Number(line.rate);
      const rateUnit = line.rateUnit;
      const unpriced = unpricedUnitError(name, rate);
      if (unpriced) {
        problems.push(unpriced);
        continue;
      }

      // ASC 842 classification, from the unit's rate and the agreement's
      // terms. An overridden line keeps the classification the override
      // stored; its inputs are still recorded.
      if (
        line.classificationOverride &&
        line.lessorClassification === "Financing"
      ) {
        problems.push(
          `${name} is overridden to Financing, which is not supported`
        );
        continue;
      }
      const terms = leasePaymentTerms({
        cycle: agreement.billingCycle,
        rateUnit,
        rate,
        discountRate: agreement.discountRate,
        startDate: agreement.startDate,
        endDate: agreement.endDate,
        decimals
      });
      const lineTerms = {
        fairValue: line.fairValue === null ? null : Number(line.fairValue),
        economicLifeMonths: line.economicLifeMonths,
        guaranteedResidualValue: Number(line.guaranteedResidualValue),
        unguaranteedResidualValue: Number(line.unguaranteedResidualValue)
      };
      const { classification: computed, record } = classifyRentalLine({
        terms,
        timing: agreement.billingTiming,
        agreement,
        line: lineTerms,
        thresholds
      });
      const classification = settledClassification(computed, {
        classificationOverride: line.classificationOverride,
        lessorClassification:
          line.lessorClassification === "Financing"
            ? null
            : line.lessorClassification
      });
      if (classification === "Sale") {
        const requirement = salesTypeRequirementError({
          name,
          cycle: agreement.billingCycle,
          rateUnit,
          startDate: agreement.startDate,
          endDate: agreement.endDate,
          fairValue: lineTerms.fairValue,
          today
        });
        if (requirement) {
          problems.push(requirement);
          continue;
        }
      }

      const { create } = generateRentalBillingPeriods({
        cycle: agreement.billingCycle,
        timing: agreement.billingTiming,
        rateUnit,
        rate,
        startDate: agreement.startDate,
        endDate: agreement.endDate,
        returnedAt: null,
        // A sales-type line bills its term and nothing past it.
        through: activationBillingThrough({
          classification,
          cycle: agreement.billingCycle,
          today,
          endDate: agreement.endDate
        }),
        existing: [],
        decimals
      });
      plans.push({
        lineId: line.id,
        name,
        itemId: unit.itemId,
        fixedAssetId: unit.id as string,
        trackedEntityId: line.trackedEntityId,
        deliveredAt: line.deliveredAt,
        periods: create,
        classification,
        classificationInputs: record,
        terms,
        closingTarget: leaseClosingTarget({
          purchaseOption: certainPurchaseOption(agreement),
          guaranteedResidualValue: lineTerms.guaranteedResidualValue,
          unguaranteedResidualValue: lineTerms.unguaranteedResidualValue
        })
      });
    }
    if (problems.length > 0) throw new InvalidInputError(problems.join("; "));

    const now = datetime.timestamp();

    // Sales-type commencement: what each line books, keyed by line.
    const commenced = await commenceSalesTypeLines(trx, {
      agreement,
      companyId,
      companyGroupId: company.companyGroupId,
      userId,
      today,
      accountingEnabled: settings.accountingEnabled,
      plans: plans.filter((plan) => plan.classification === "Sale")
    });

    // One update per line: each carries its own classification, and an
    // agreement holds a handful of units.
    for (const plan of plans) {
      const commencement = commenced.get(plan.lineId);
      await trx
        .updateTable("rentalAgreementLine")
        .set({
          lessorClassification: plan.classification,
          classificationInputs: toJson(plan.classificationInputs),
          ...(commencement
            ? {
                initialNetInvestment: commencement.netInvestment,
                sellingProfit: commencement.sellingProfit,
                commencementJournalId: commencement.journalId
              }
            : {}),
          status: plan.deliveredAt ? "On Rent" : "Pending",
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", plan.lineId)
        .where("companyId", "=", companyId)
        .execute();
    }

    const periodRows = plans.flatMap((plan) =>
      plan.periods.map((spec) =>
        billingPeriodRow(spec, plan.lineId, companyId, userId)
      )
    );
    if (periodRows.length > 0) {
      await trx.insertInto("rentalBillingPeriod").values(periodRows).execute();
    }

    await trx
      .updateTable("rentalAgreement")
      .set({
        status: "Active",
        activatedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", agreement.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: agreement.id };
  });
}

/**
 * Commences every sales-type line of an activating agreement (spec §4), in
 * the caller's transaction: derecognizes the fleet unit (asset Disposed by
 * Sale with a disposal row; the tracked unit Consumed into the lease), posts
 * the 'Lease' commencement journal when accounting is on, and writes the
 * effective-interest schedule — one `rentalLeaseScheduleLine` per payment and,
 * with accounting on, one Planned `Interest` recognition row per line that
 * earns interest (Dr net investment / Cr lease interest income).
 *
 * With accounting off the subledger is identical (asset disposed, schedule
 * written) and nothing is posted: no journal, and no Interest rows, since
 * there is no net investment on a ledger for them to accrue against.
 */
async function commenceSalesTypeLines(
  trx: Trx,
  args: {
    agreement: AgreementRow;
    companyId: string;
    companyGroupId: string | null;
    userId: string;
    today: string;
    accountingEnabled: boolean;
    plans: ActivationPlan[];
  }
): Promise<
  Map<
    string,
    {
      netInvestment: number;
      sellingProfit: number;
      journalId: string | null;
    }
  >
> {
  const { agreement, companyId, userId, today, plans } = args;
  const result = new Map<
    string,
    {
      netInvestment: number;
      sellingProfit: number;
      journalId: string | null;
    }
  >();
  if (plans.length === 0) return result;

  const assets = await trx
    .selectFrom("fixedAsset")
    .select([
      "id",
      "fixedAssetId",
      "fixedAssetClassId",
      "serialNumber",
      "trackedEntityId",
      "status",
      "acquisitionCost",
      "accumulatedDepreciation"
    ])
    .where(
      "id",
      "in",
      plans.map((plan) => plan.fixedAssetId)
    )
    .where("companyId", "=", companyId)
    .forUpdate()
    .execute();
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const classIds = [...new Set(assets.map((asset) => asset.fixedAssetClassId))];
  const classes = await trx
    .selectFrom("fixedAssetClass")
    .select(["id", "assetAccountId", "accumulatedDepreciationAccountId"])
    .where("id", "in", classIds)
    .where("companyId", "=", companyId)
    .execute();
  const classById = new Map(classes.map((row) => [row.id, row]));

  const accounting = args.accountingEnabled
    ? await loadLeaseAccounting(trx, {
        companyId,
        companyGroupId: args.companyGroupId,
        today
      })
    : null;

  const scheduleInserts: Array<{
    rentalAgreementLineId: string;
    periodDate: string;
    openingNetInvestment: number;
    paymentAmount: number;
    interestAmount: number;
    principalAmount: number;
    closingNetInvestment: number;
    companyId: string;
    createdBy: string;
  }> = [];
  const pendingInterest: Array<{
    rentalAgreementLineId: string;
    periodStart: string;
    periodEnd: string;
    scheduledDate: string;
    amount: number;
  }> = [];

  for (const plan of plans) {
    const asset = assetById.get(plan.fixedAssetId);
    if (!asset) throw new NotFoundError("Fixed asset not found");
    const assetClass = classById.get(asset.fixedAssetClassId);
    if (!assetClass) throw new NotFoundError("Fixed asset class not found");
    const { pv } = plan.classificationInputs;
    const acquisitionCost = Number(asset.acquisitionCost);
    const accumulatedDepreciation = Number(asset.accumulatedDepreciation);

    let amounts: ReturnType<typeof commencementAmounts>;
    try {
      amounts = commencementAmounts({
        pvPayments: pv.pvPayments,
        pvResidual: pv.pvResidual,
        acquisitionCost,
        accumulatedDepreciation
      });
    } catch (err) {
      throw new InvalidInputError(`${plan.name}: ${(err as Error).message}`);
    }
    const serial = asset.serialNumber ?? asset.fixedAssetId;
    const tags = {
      customerId: agreement.customerId,
      itemId: plan.itemId,
      locationId: agreement.locationId
    };

    let journalId: string | null = null;
    if (accounting) {
      journalId = await postLeaseJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: today,
        description: `Lease commencement ${agreement.rentalAgreementId} ${serial}`,
        lines: buildCommencementLines({
          pvPayments: pv.pvPayments,
          pvResidual: pv.pvResidual,
          acquisitionCost,
          accumulatedDepreciation,
          accounts: {
            netInvestmentInLeasesAccountId:
              accounting.accounts.netInvestmentInLeasesAccount,
            costOfGoodsSoldAccountId:
              accounting.accounts.costOfGoodsSoldAccount,
            leaseRevenueAccountId: accounting.accounts.leaseRevenueAccount,
            assetAccountId: assetClass.assetAccountId,
            accumulatedDepreciationAccountId:
              assetClass.accumulatedDepreciationAccountId
          }
        }),
        rentalAgreementId: agreement.id,
        rentalAgreementLineId: plan.lineId,
        tags
      });
    }

    // The unit leaves the register: sold to the lease at its net investment.
    // Guarded on the statuses activation accepted, so a concurrent disposal
    // or return to inventory rolls this back.
    const disposed = await trx
      .updateTable("fixedAsset")
      .set({
        status: "Disposed",
        disposalMethod: "Sale",
        disposalDate: today,
        saleProceeds: amounts.netInvestment,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", [...RENTABLE_ASSET_STATUSES])
      .executeTakeFirst();
    if (!disposed.numUpdatedRows) {
      throw new InvalidInputError(
        `${plan.name} changed status while the agreement was being activated`
      );
    }
    await trx
      .insertInto("fixedAssetDisposal")
      .values({
        fixedAssetId: asset.id,
        disposalMethod: "Sale",
        disposalDate: today,
        saleProceeds: amounts.netInvestment,
        netBookValueAtDisposal: amounts.carryingAmount,
        gainLoss: amounts.sellingProfit,
        journalId,
        companyId,
        createdBy: userId
      })
      .execute();

    // The serial is consumed into the lease: no longer on the asset, and the
    // agreement and customer on its attributes are how it is found again.
    const trackedEntityId = plan.trackedEntityId ?? asset.trackedEntityId;
    if (trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          status: "Consumed",
          attributes: sql<Json>`(COALESCE("attributes", '{}'::jsonb) - 'Fixed Asset') || jsonb_build_object('Rental Agreement', ${agreement.id}::text, 'Customer', ${agreement.customerId}::text)`
        })
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      await insertUnitActivity(trx, {
        type: "Lease Commencement",
        direction: "input",
        sourceDocument: "Rental Agreement",
        sourceDocumentId: agreement.id,
        sourceDocumentReadableId: agreement.rentalAgreementId,
        attributes: {
          "Rental Agreement": agreement.id,
          Customer: agreement.customerId
        },
        trackedEntityId,
        companyId,
        userId
      });
    }

    // The effective-interest schedule follows the billing periods: one line
    // per payment, dated at its billing period's end.
    const spans = scheduleBillingPeriods(plan.periods, plan.terms.periods);
    const schedule = buildLessorSchedule({
      netInvestment: amounts.netInvestment,
      payment: plan.terms.payment,
      periods: plan.terms.periods,
      annualRate: plan.terms.annualRate,
      timing: agreement.billingTiming,
      closingTarget: plan.closingTarget,
      periodDates: spans.map((span) => span.periodEnd)
    });
    for (const line of schedule) {
      scheduleInserts.push({
        rentalAgreementLineId: plan.lineId,
        periodDate: line.periodDate,
        openingNetInvestment: line.openingNetInvestment,
        paymentAmount: line.paymentAmount,
        interestAmount: line.interestAmount,
        principalAmount: line.principalAmount,
        closingNetInvestment: line.closingNetInvestment,
        companyId,
        createdBy: userId
      });
    }
    if (accounting) {
      for (const row of interestRows(schedule, spans)) {
        pendingInterest.push({
          rentalAgreementLineId: plan.lineId,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          scheduledDate: row.scheduledDate,
          amount: row.amount
        });
      }
    }

    result.set(plan.lineId, {
      netInvestment: amounts.netInvestment,
      sellingProfit: amounts.sellingProfit,
      journalId
    });
  }

  // One insert for every schedule line of the agreement; the Interest rows
  // find theirs by (line, periodDate), unique per line.
  const insertedSchedule =
    scheduleInserts.length === 0
      ? []
      : await trx
          .insertInto("rentalLeaseScheduleLine")
          .values(scheduleInserts)
          .returning([
            "id",
            "rentalAgreementLineId",
            sql<string>`"periodDate"::text`.as("periodDate")
          ])
          .execute();
  const scheduleIdByKey = new Map(
    insertedSchedule.map((row) => [
      `${row.rentalAgreementLineId}|${row.periodDate}`,
      row.id
    ])
  );
  if (accounting && pendingInterest.length > 0) {
    await trx
      .insertInto("revenueRecognitionSchedule")
      .values(
        pendingInterest.map((row) => {
          const rentalLeaseScheduleLineId = scheduleIdByKey.get(
            `${row.rentalAgreementLineId}|${row.scheduledDate}`
          );
          if (!rentalLeaseScheduleLineId) {
            throw new Error("Interest row has no lease schedule line");
          }
          return {
            type: "Interest" as const,
            status: "Planned" as const,
            rentalAgreementLineId: row.rentalAgreementLineId,
            rentalLeaseScheduleLineId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            scheduledDate: row.scheduledDate,
            amount: row.amount,
            debitAccountId: accounting.accounts.netInvestmentInLeasesAccount,
            creditAccountId: accounting.accounts.leaseInterestIncomeAccount,
            companyId,
            createdBy: userId
          };
        })
      )
      .execute();
  }

  return result;
}

async function releaseUnit(
  { db, companyId, userId }: Scope,
  payload: Extract<RentalAgreementPayload, { type: "release" }>,
  today: string
): Promise<{ id: string }> {
  const future = futureReleaseError(payload.returnedAt, today);
  if (future) throw new InvalidInputError(future);
  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId
    );
    if (agreement.status !== "Active") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are released from an Active agreement`
      );
    }

    const line = await trx
      .selectFrom("rentalAgreementLine")
      .select(["id", "status", "lessorClassification", "fixedAssetId"])
      .where("id", "=", payload.rentalAgreementLineId)
      .where("rentalAgreementId", "=", agreement.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line) throw new NotFoundError("Rental agreement line not found");

    const asset = line.fixedAssetId
      ? await trx
          .selectFrom("fixedAsset")
          .select(["fixedAssetId", "name"])
          .where("id", "=", line.fixedAssetId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : undefined;

    // A unit an open rental document still holds would be Returned while
    // the document names it (plan decision P2).
    const openShipment = await trx
      .selectFrom("shipment as s")
      .innerJoin("shipmentFixedAssetLine as l", (join) =>
        join
          .onRef("l.shipmentId", "=", "s.id")
          .onRef("l.companyId", "=", "s.companyId")
      )
      .select("s.shipmentId")
      .where("s.companyId", "=", companyId)
      .where("s.sourceDocument", "=", "Rental Agreement")
      .where("s.sourceDocumentId", "=", agreement.id)
      .where("s.status", "in", ["Draft", "Pending"])
      .where("l.rentalAgreementLineId", "=", line.id)
      .orderBy("s.createdAt")
      .executeTakeFirst();
    const openReceipt = await trx
      .selectFrom("receipt as r")
      .innerJoin("receiptFixedAssetLine as l", (join) =>
        join
          .onRef("l.receiptId", "=", "r.id")
          .onRef("l.companyId", "=", "r.companyId")
      )
      .select("r.receiptId")
      .where("r.companyId", "=", companyId)
      .where("r.sourceDocument", "=", "Rental Agreement")
      .where("r.sourceDocumentId", "=", agreement.id)
      .where("r.status", "in", ["Draft", "Pending"])
      .where("l.rentalAgreementLineId", "=", line.id)
      .orderBy("r.createdAt")
      .executeTakeFirst();
    const openDocument = openShipment
      ? `shipment ${openShipment.shipmentId}`
      : openReceipt
        ? `receipt ${openReceipt.receiptId}`
        : null;

    const blocker = releaseBlocker({
      label: unitLabel(asset, line.id),
      status: line.status,
      classification: line.lessorClassification,
      openDocument
    });
    if (blocker) throw new InvalidInputError(blocker);

    await returnRentalUnit(trx, {
      agreement,
      unit: {
        rentalAgreementLineId: line.id,
        returnedAt: payload.returnedAt
      },
      companyId,
      userId,
      today
    });
    return { id: agreement.id };
  });
}

// Everything close and cancel decide on, in three reads.
async function loadSettlementState(
  trx: Trx,
  companyId: string,
  agreementId: string
) {
  const lines = await trx
    .selectFrom("rentalAgreementLine")
    .select([
      "id",
      "status",
      "lessorClassification",
      "commencementJournalId",
      "initialNetInvestment"
    ])
    .where("rentalAgreementId", "=", agreementId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .execute();
  const lineIds = lines.map((line) => line.id);
  if (lineIds.length === 0) {
    return {
      lines,
      lineIds,
      pendingPeriods: 0,
      invoicedPeriods: 0,
      unbilledCharges: 0,
      billedCharges: 0
    };
  }

  const periods = await trx
    .selectFrom("rentalBillingPeriod")
    .select([
      sql<number>`count(*) FILTER (WHERE status = 'Pending')::int`.as(
        "pending"
      ),
      sql<number>`count(*) FILTER (WHERE status = 'Invoiced')::int`.as(
        "invoiced"
      )
    ])
    .where("rentalAgreementLineId", "in", lineIds)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  const charges = await trx
    .selectFrom("rentalAgreementCharge")
    .select([
      sql<number>`count(*) FILTER (WHERE "salesInvoiceLineId" IS NULL)::int`.as(
        "unbilled"
      ),
      sql<number>`count(*) FILTER (WHERE "salesInvoiceLineId" IS NOT NULL)::int`.as(
        "billed"
      )
    ])
    .where("rentalAgreementLineId", "in", lineIds)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  return {
    lines,
    lineIds,
    pendingPeriods: Number(periods.pending),
    invoicedPeriods: Number(periods.invoiced),
    unbilledCharges: Number(charges.unbilled),
    billedCharges: Number(charges.billed)
  };
}

async function close(
  { db, companyId, userId }: Scope,
  payload: Extract<RentalAgreementPayload, { type: "close" }>
): Promise<{ id: string }> {
  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId
    );
    if (agreement.status !== "Active") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; only an Active agreement can be closed`
      );
    }

    // A rental document still open holds units the close would strand.
    const openShipment = await trx
      .selectFrom("shipment as s")
      .innerJoin("shipmentFixedAssetLine as l", (join) =>
        join
          .onRef("l.shipmentId", "=", "s.id")
          .onRef("l.companyId", "=", "s.companyId")
      )
      .select("s.shipmentId")
      .where("s.companyId", "=", companyId)
      .where("s.sourceDocument", "=", "Rental Agreement")
      .where("s.sourceDocumentId", "=", agreement.id)
      .where("s.status", "in", ["Draft", "Pending"])
      .orderBy("s.createdAt")
      .executeTakeFirst();
    const openReceipt = await trx
      .selectFrom("receipt as r")
      .innerJoin("receiptFixedAssetLine as l", (join) =>
        join
          .onRef("l.receiptId", "=", "r.id")
          .onRef("l.companyId", "=", "r.companyId")
      )
      .select("r.receiptId")
      .where("r.companyId", "=", companyId)
      .where("r.sourceDocument", "=", "Rental Agreement")
      .where("r.sourceDocumentId", "=", agreement.id)
      .where("r.status", "in", ["Draft", "Pending"])
      .orderBy("r.createdAt")
      .executeTakeFirst();
    const openDocument = openRentalDocumentBlocker({
      shipmentId: openShipment?.shipmentId ?? null,
      receiptId: openReceipt?.receiptId ?? null
    });
    if (openDocument) throw new InvalidInputError(openDocument);

    const state = await loadSettlementState(trx, companyId, agreement.id);
    const blocker = closeBlocker({
      lineStatuses: state.lines.map((line) => line.status),
      pendingPeriods: state.pendingPeriods,
      unbilledCharges: state.unbilledCharges
    });
    if (blocker) throw new InvalidInputError(blocker);

    const now = datetime.timestamp();
    await trx
      .updateTable("rentalAgreement")
      .set({
        status: "Closed",
        closedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", agreement.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: agreement.id };
  });
}

async function cancel(
  { db, companyId, userId }: Scope,
  payload: Extract<RentalAgreementPayload, { type: "cancel" }>
): Promise<{ id: string }> {
  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId
    );

    const state = await loadSettlementState(trx, companyId, agreement.id);
    // An accrual (Task 40) already booked income against a line; dropping its
    // unbilled periods would strand that contract asset.
    const recognized =
      state.lineIds.length === 0
        ? { count: 0 }
        : await trx
            .selectFrom("revenueRecognitionSchedule")
            .select(sql<number>`count(*)::int`.as("count"))
            .where("rentalAgreementLineId", "in", state.lineIds)
            .where("companyId", "=", companyId)
            .executeTakeFirstOrThrow();

    const blocker = cancelBlocker({
      status: agreement.status,
      lineStatuses: state.lines.map((line) => line.status),
      invoicedPeriods: state.invoicedPeriods,
      billedCharges: state.billedCharges,
      recognizedRows: Number(recognized.count),
      // Booked at activation: journal when accounting is on, the net
      // investment either way (the unit was disposed regardless).
      commencedSalesTypeLines: state.lines.filter(
        (line) =>
          line.lessorClassification === "Sale" &&
          (line.commencementJournalId !== null ||
            line.initialNetInvestment !== null)
      ).length
    });
    if (blocker) throw new InvalidInputError(blocker);

    if (state.lineIds.length > 0) {
      // Nothing is invoiced (the blocker above), so every period left is
      // Pending and none will ever be billed.
      await trx
        .deleteFrom("rentalBillingPeriod")
        .where("rentalAgreementLineId", "in", state.lineIds)
        .where("companyId", "=", companyId)
        .where("status", "=", "Pending")
        .execute();

      // A Pending line holds its unit (the live-line unique index and the
      // fleetAssets view key on status, not on the agreement's), and the line
      // status enum has no Cancelled value. The never-delivered lines go, so
      // their units read Available again; their unbilled charges cascade.
      // Returned lines stay as the record of what the customer had.
      await trx
        .deleteFrom("rentalAgreementLine")
        .where("rentalAgreementId", "=", agreement.id)
        .where("companyId", "=", companyId)
        .where("status", "in", LIVE_LINE_STATUSES)
        .execute();
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("rentalAgreement")
      .set({
        status: "Cancelled",
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", agreement.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: agreement.id };
  });
}

export const postRentalAgreementInput = payloadValidator;
export type PostRentalAgreementInput = RentalAgreementPayload;

/** Activates, releases a unit of, closes or cancels a rental agreement, per
 *  `type` — each one transaction that locks the agreement row first. */
const postRentalAgreement = defineServerFn({
  name: "post-rental-agreement",
  input: postRentalAgreementInput,
  // Kysely below bypasses RLS; every operation needed sales update as an edge
  // function, and still does.
  permissions: { update: "sales" },
  async run({ db, companyId, userId }, payload): Promise<{ id: string }> {
    const scope = { db, companyId, userId };
    switch (payload.type) {
      case "activate": {
        const today = datetime
          .today(await getCompanyTimeZone(db, companyId))
          .toString();
        return activate(scope, payload, today);
      }
      case "release": {
        const today = datetime
          .today(await getCompanyTimeZone(db, companyId))
          .toString();
        return releaseUnit(scope, payload, today);
      }
      case "close":
        return close(scope, payload);
      case "cancel":
        return cancel(scope, payload);
    }
  }
});

export default postRentalAgreement;
