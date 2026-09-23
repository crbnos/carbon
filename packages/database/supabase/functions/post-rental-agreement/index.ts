import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^4.5.4";
import { sql, Transaction } from "kysely";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { toJson } from "../lib/json.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database, Json } from "../lib/types.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { resolveInventoryAccount } from "../shared/get-posting-group.ts";
import { buildJournalLineDimensionInserts } from "../shared/journal-dimensions.ts";
import { buildLessorSchedule } from "../shared/lessor-lease.ts";
import {
  bookAdjustment,
  createAdjustmentJournal,
} from "../shared/post-adjustment.ts";
import { round } from "../shared/precision.ts";
import {
  ExistingBillingPeriod,
  generateRentalBillingPeriods,
  PeriodSpec,
  RateLadder,
} from "../shared/rental-billing.ts";
import {
  activationBillingThrough,
  buildCommencementLines,
  buildResidualReturnLines,
  certainPurchaseOption,
  ClassificationInputs,
  classifyRentalLine,
  commencementAmounts,
  interestRows,
  leaseClosingTarget,
  LeasePaymentTerms,
  leasePaymentTerms,
  netInvestmentAt,
  PostingLine,
  salesTypeRequirementError,
  salesTypeReturnError,
  scheduleBillingPeriods,
  settledClassification,
} from "./lessor.ts";
import {
  cancelBlocker,
  closeBlocker,
  futureReturnError,
  LIVE_LINE_STATUSES,
  payloadValidator,
  rateLadderError,
  RENTABLE_ASSET_STATUSES,
  RentalAgreementPayload,
  ResidualDestination,
  RETURNABLE_LINE_STATUSES,
  toRate,
  unitAvailabilityError,
} from "./validators.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-rental-agreement");

// The lifecycle of a rental agreement (spec §3, §4). Four actions, each ONE
// transaction that locks the agreement row first:
//
//   activate  Draft → Active: every unit Available, rates snapshotted from the
//             item's ladder, each line classified (ASC 842, `lessor.ts`),
//             first billing periods cut. An operating line posts nothing — the
//             unit simply stops being Available. A sales-type line commences:
//             the fleet unit is derecognized (asset Disposed by Sale), the
//             'Lease' journal books net investment / COGS / lease revenue, and
//             the effective-interest schedule plus its Interest recognition
//             rows are written.
//   return    a unit comes back, never after today: an operating line's
//             billing is re-cut at the return date (later Pending periods
//             dropped, the current one shortened, an advance-billed period
//             credited), optionally straight to maintenance. A sales-type
//             line's billing is its term and is left alone; the unit's closing
//             net investment (the schedule's balance on the return date) moves
//             into a new Rental Fleet asset or into stock.
//   close     Active → Closed once every unit is back and everything billed.
//   cancel    Draft, or Active with nothing on rent / billed / recognized /
//             commenced → Cancelled; the Pending lines are deleted so their
//             units are free.

type Client = Awaited<ReturnType<typeof requirePermissions>>;
type Trx = Transaction<DB>;
type Enums = Database["public"]["Enums"];

// Business-validation failures are 400s with the exact message the app shows;
// a referenced record the caller's company does not own is a 404; everything
// else is a 500 so real outages surface in monitoring.
class ValidationError extends Error {}
class NotFoundError extends Error {}

type AgreementRow = {
  id: string;
  rentalAgreementId: string;
  status: Enums["rentalAgreementStatus"];
  customerId: string;
  locationId: string;
  startDate: string;
  endDate: string | null;
  billingCycle: Enums["rentalBillingCycle"];
  billingTiming: Enums["rentalBillingTiming"];
  currencyCode: string;
  discountRate: number;
  ownershipTransfers: boolean;
  specializedAsset: boolean;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
};

// Re-read under the caller's company and lock: the id comes from the payload,
// and requirePermissions proves nothing about it. The lock serializes two
// actions on one agreement (a double-clicked Activate, a return racing a
// cancel). DATE columns decode to JS Dates through the driver, so they are
// selected as text — the billing math works on `YYYY-MM-DD` strings.
async function lockAgreement(
  trx: Trx,
  companyId: string,
  id: string,
): Promise<AgreementRow> {
  const agreement = await trx
    .selectFrom("rentalAgreement")
    .select([
      "id",
      "rentalAgreementId",
      "status",
      "customerId",
      "locationId",
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string | null>`"endDate"::text`.as("endDate"),
      "billingCycle",
      "billingTiming",
      "currencyCode",
      "discountRate",
      "ownershipTransfers",
      "specializedAsset",
      "purchaseOptionAmount",
      "purchaseOptionReasonablyCertain",
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!agreement) throw new NotFoundError("Rental agreement not found");
  return {
    ...agreement,
    discountRate: Number(agreement.discountRate),
    purchaseOptionAmount: agreement.purchaseOptionAmount === null
      ? null
      : Number(agreement.purchaseOptionAmount),
  };
}

function billingPeriodRow(
  spec: PeriodSpec,
  rentalAgreementLineId: string,
  companyId: string,
  userId: string,
) {
  return {
    rentalAgreementLineId,
    periodStart: spec.periodStart,
    periodEnd: spec.periodEnd,
    days: spec.days,
    amount: spec.amount,
    rateUnitApplied: spec.rateUnitApplied,
    isAdjustment: spec.isAdjustment,
    dueOn: spec.dueOn,
    status: "Pending" as const,
    companyId,
    createdBy: userId,
  };
}

// What the 'Lease' journals need, resolved once per request inside the
// transaction. The period resolver reuses the caller's transaction (the pool
// is size one) and locks the period row, so a close cannot slip in between.
type LeaseAccounting = {
  accountingPeriodId: string;
  accounts: {
    netInvestmentInLeasesAccount: string;
    leaseRevenueAccount: string;
    leaseInterestIncomeAccount: string;
    costOfGoodsSoldAccount: string;
    finishedGoodsAccount: string;
    rawMaterialsAccount: string;
  };
  // active dimensions for the company group, entityType → dimension id
  dimensionMap: Map<string, string>;
};

async function loadLeaseAccounting(
  trx: Trx,
  client: Client,
  args: { companyId: string; companyGroupId: string | null; today: string },
): Promise<LeaseAccounting> {
  const { companyId } = args;
  const defaults = await trx
    .selectFrom("accountDefault")
    .select([
      "netInvestmentInLeasesAccount",
      "leaseRevenueAccount",
      "leaseInterestIncomeAccount",
      "costOfGoodsSoldAccount",
      "finishedGoodsAccount",
      "rawMaterialsAccount",
    ])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Error getting account defaults");
  const {
    netInvestmentInLeasesAccount,
    leaseRevenueAccount,
    leaseInterestIncomeAccount,
  } = defaults;
  if (
    !netInvestmentInLeasesAccount || !leaseRevenueAccount ||
    !leaseInterestIncomeAccount
  ) {
    throw new ValidationError(
      "Set the Net Investment in Leases, Lease Revenue and Lease Interest Income accounts in the account defaults before booking a sales-type lease",
    );
  }

  // Dimensions are configured per company group; a company outside one
  // tags nothing.
  const dimensions = args.companyGroupId === null ? [] : await trx
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", args.companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", ["Customer", "Item", "Location"])
    .execute();

  const accountingPeriodId = await getCurrentAccountingPeriod(
    client,
    companyId,
    trx,
    args.today,
  );

  return {
    accountingPeriodId,
    accounts: {
      netInvestmentInLeasesAccount,
      leaseRevenueAccount,
      leaseInterestIncomeAccount,
      costOfGoodsSoldAccount: defaults.costOfGoodsSoldAccount,
      finishedGoodsAccount: defaults.finishedGoodsAccount,
      rawMaterialsAccount: defaults.rawMaterialsAccount,
    },
    dimensionMap: new Map(
      dimensions.map((dimension) => [dimension.entityType, dimension.id]),
    ),
  };
}

// One posted 'Lease' journal from already-balanced lines. Every line carries
// the agreement as its document and the agreement line as the line
// reference, tagged with the Customer / Item / Location dimensions the
// company group has active.
async function postLeaseJournal(
  trx: Trx,
  args: {
    accounting: LeaseAccounting;
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    lines: PostingLine[];
    rentalAgreementId: string;
    rentalAgreementLineId: string;
    tags: { customerId: string; itemId: string; locationId: string };
  },
): Promise<string> {
  const { accounting, companyId, userId } = args;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId: accounting.accountingPeriodId,
    description: args.description,
    postingDate: args.postingDate,
    userId,
    sourceType: "Lease",
  });

  const journalLineReference = nanoid();
  const journalLines = await trx
    .insertInto("journalLine")
    .values(
      args.lines.map((line) => ({
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: round(line.amount),
        quantity: 1,
        documentType: "Rental Agreement" as const,
        documentId: args.rentalAgreementId,
        documentLineReference: args.rentalAgreementLineId,
        journalLineReference,
        companyId,
      })),
    )
    .returning(["id"])
    .execute();

  const dimensionInserts = buildJournalLineDimensionInserts({
    journalLineIds: journalLines.map((line) => line.id),
    meta: journalLines.map(() => args.tags),
    dimensionMap: accounting.dimensionMap,
    companyId,
  });
  if (dimensionInserts.length > 0) {
    await trx.insertInto("journalLineDimension").values(dimensionInserts)
      .execute();
  }

  return journalId;
}

// The traceability graph records the lease as the consumer of the unit at
// commencement, and as its producer when it comes back to stock.
async function insertUnitActivity(
  trx: Trx,
  args: {
    type: "Lease Commencement" | "Return to Inventory" | "Capitalize";
    direction: "input" | "output";
    sourceDocument: "Rental Agreement" | "Fixed Asset";
    sourceDocumentId: string;
    sourceDocumentReadableId: string;
    attributes: Record<string, string>;
    trackedEntityId: string;
    companyId: string;
    userId: string;
  },
): Promise<void> {
  const activityId = nanoid();
  await trx
    .insertInto("trackedActivity")
    .values({
      id: activityId,
      type: args.type,
      sourceDocument: args.sourceDocument,
      sourceDocumentId: args.sourceDocumentId,
      sourceDocumentReadableId: args.sourceDocumentReadableId,
      attributes: args.attributes,
      companyId: args.companyId,
      createdBy: args.userId,
    })
    .execute();
  await trx
    .insertInto(
      args.direction === "input"
        ? "trackedActivityInput"
        : "trackedActivityOutput",
    )
    .values({
      trackedActivityId: activityId,
      trackedEntityId: args.trackedEntityId,
      quantity: 1,
      companyId: args.companyId,
      createdBy: args.userId,
    })
    .execute();
}

type ActivationPlan = {
  lineId: string;
  name: string;
  itemId: string;
  fixedAssetId: string;
  trackedEntityId: string | null;
  rates: RateLadder;
  deliveredAt: string | null;
  periods: PeriodSpec[];
  classification: "Operating" | "Sales-Type";
  classificationInputs: ClassificationInputs;
  terms: LeasePaymentTerms;
  closingTarget: number;
};

async function activate(
  client: Client,
  payload: Extract<RentalAgreementPayload, { type: "activate" }>,
  today: string,
): Promise<{ id: string }> {
  const { companyId, userId } = payload;

  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId,
    );
    if (agreement.status !== "Draft") {
      throw new ValidationError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; only a Draft agreement can be activated`,
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
      throw new ValidationError(
        "Rental agreements in a foreign currency are not supported yet",
      );
    }

    // One read for the ledger switch and the classification thresholds.
    const settings = await trx
      .selectFrom("companySettings")
      .select([
        "accountingEnabled",
        "leaseMajorPartThresholdPercent",
        "leaseSubstantiallyAllThresholdPercent",
      ])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!settings) throw new NotFoundError("Company settings not found");
    const thresholds = {
      majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
      substantiallyAllPercent: Number(
        settings.leaseSubstantiallyAllThresholdPercent,
      ),
    };

    const lines = await trx
      .selectFrom("rentalAgreementLine")
      .select([
        "id",
        "fixedAssetId",
        "itemId",
        "trackedEntityId",
        "rateMode",
        "rateUnit",
        "fairValue",
        "economicLifeMonths",
        "guaranteedResidualValue",
        "unguaranteedResidualValue",
        "lessorClassification",
        "classificationOverride",
        sql<string | null>`"deliveredAt"::text`.as("deliveredAt"),
      ])
      .where("rentalAgreementId", "=", agreement.id)
      .where("companyId", "=", companyId)
      .orderBy("createdAt")
      .forUpdate()
      .execute();
    if (lines.length === 0) {
      throw new ValidationError(
        "Add at least one fleet unit before activating the agreement",
      );
    }
    // Every line rents a fleet unit (spec §3). A sales-type lease straight
    // out of stock — a line with a tracked entity and no asset — has no
    // entry point in v1, so it is refused here with every other asset-less
    // line rather than half-supported.
    if (lines.some((line) => !line.fixedAssetId)) {
      throw new ValidationError("Every line needs a fleet unit");
    }
    const assetIds = [
      ...new Set(lines.map((line) => line.fixedAssetId as string)),
    ];

    // One read for every unit: the view derives Reserved / On Rent from the
    // live line and In Maintenance from the out-of-service columns.
    const units = await trx
      .selectFrom("fleetAssets as fa")
      .leftJoin("rentalAgreement as live", (join) =>
        join
          .onRef("live.id", "=", "fa.rentalAgreementId")
          .onRef("live.companyId", "=", "fa.companyId"))
      .select([
        "fa.id",
        "fa.fixedAssetId",
        "fa.itemId",
        "fa.status",
        "fa.fleetStatus",
        "fa.outOfServiceReason",
        "fa.rentalAgreementId as liveAgreementId",
        "live.rentalAgreementId as liveAgreementReadableId",
      ])
      .where("fa.id", "in", assetIds)
      .where("fa.companyId", "=", companyId)
      .execute();
    const unitById = new Map(units.map((unit) => [unit.id, unit]));

    const itemIds = [
      ...new Set(
        units.map((unit) => unit.itemId).filter((id): id is string => !!id),
      ),
    ];
    const rateRows = itemIds.length === 0 ? [] : await trx
      .selectFrom("itemRentalRate")
      .select(["itemId", "dayRate", "weekRate", "monthRate"])
      .where("companyId", "=", companyId)
      .where("currencyCode", "=", agreement.currencyCode)
      .where("itemId", "in", itemIds)
      .execute();
    const ratesByItem = new Map(rateRows.map((row) => [row.itemId, row]));

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
          liveAgreementReadableId: unit.liveAgreementReadableId,
        },
        agreement.id,
      );
      if (unavailable) {
        problems.push(unavailable);
        continue;
      }
      const rateRow = ratesByItem.get(unit.itemId);
      if (!rateRow) {
        problems.push(
          `${name} has no rental rates in ${agreement.currencyCode}`,
        );
        continue;
      }
      // The snapshot: a later price-list change never touches a live line.
      const rates: RateLadder = {
        dayRate: toRate(rateRow.dayRate),
        weekRate: toRate(rateRow.weekRate),
        monthRate: toRate(rateRow.monthRate),
      };
      const ladderProblem = rateLadderError({
        cycle: agreement.billingCycle,
        rateMode: line.rateMode,
        rateUnit: line.rateUnit,
        rates,
      });
      if (ladderProblem) {
        problems.push(`${name} ${ladderProblem}`);
        continue;
      }

      // ASC 842 classification, from the snapshot rates and the agreement's
      // terms. An overridden line keeps the classification the override
      // stored; its inputs are still recorded.
      if (
        line.classificationOverride &&
        line.lessorClassification === "Direct Financing"
      ) {
        problems.push(`${name} is overridden to Direct Financing, which is not supported`);
        continue;
      }
      const terms = leasePaymentTerms({
        cycle: agreement.billingCycle,
        rateMode: line.rateMode,
        rateUnit: line.rateUnit,
        rates,
        discountRate: agreement.discountRate,
        startDate: agreement.startDate,
        endDate: agreement.endDate,
      });
      const lineTerms = {
        fairValue: line.fairValue === null ? null : Number(line.fairValue),
        economicLifeMonths: line.economicLifeMonths,
        guaranteedResidualValue: Number(line.guaranteedResidualValue),
        unguaranteedResidualValue: Number(line.unguaranteedResidualValue),
      };
      const { classification: computed, record } = classifyRentalLine({
        terms,
        timing: agreement.billingTiming,
        agreement,
        line: lineTerms,
        thresholds,
      });
      const classification = settledClassification(computed, {
        classificationOverride: line.classificationOverride,
        lessorClassification: line.lessorClassification === "Direct Financing"
          ? null
          : line.lessorClassification,
      });
      if (classification === "Sales-Type") {
        const requirement = salesTypeRequirementError({
          name,
          cycle: agreement.billingCycle,
          startDate: agreement.startDate,
          endDate: agreement.endDate,
          fairValue: lineTerms.fairValue,
        });
        if (requirement) {
          problems.push(requirement);
          continue;
        }
      }

      const { create } = generateRentalBillingPeriods({
        cycle: agreement.billingCycle,
        timing: agreement.billingTiming,
        rateMode: line.rateMode,
        rateUnit: line.rateUnit,
        rates,
        startDate: agreement.startDate,
        endDate: agreement.endDate,
        returnedAt: null,
        // A sales-type line bills its term and nothing past it.
        through: activationBillingThrough({
          classification,
          cycle: agreement.billingCycle,
          today,
          endDate: agreement.endDate,
        }),
        existing: [],
      });
      plans.push({
        lineId: line.id,
        name,
        itemId: unit.itemId,
        fixedAssetId: unit.id as string,
        trackedEntityId: line.trackedEntityId,
        rates,
        deliveredAt: line.deliveredAt,
        periods: create,
        classification,
        classificationInputs: record,
        terms,
        closingTarget: leaseClosingTarget({
          purchaseOption: certainPurchaseOption(agreement),
          guaranteedResidualValue: lineTerms.guaranteedResidualValue,
          unguaranteedResidualValue: lineTerms.unguaranteedResidualValue,
        }),
      });
    }
    if (problems.length > 0) throw new ValidationError(problems.join("; "));

    const now = datetime.timestamp();

    // Sales-type commencement: what each line books, keyed by line.
    const commenced = await commenceSalesTypeLines(trx, client, {
      agreement,
      companyId,
      companyGroupId: company.companyGroupId,
      userId,
      today,
      accountingEnabled: settings.accountingEnabled,
      plans: plans.filter((plan) => plan.classification === "Sales-Type"),
    });

    // One update per line: each carries its own snapshot, and an agreement
    // holds a handful of units.
    for (const plan of plans) {
      const commencement = commenced.get(plan.lineId);
      await trx
        .updateTable("rentalAgreementLine")
        .set({
          dayRate: plan.rates.dayRate,
          weekRate: plan.rates.weekRate,
          monthRate: plan.rates.monthRate,
          lessorClassification: plan.classification,
          classificationInputs: toJson(plan.classificationInputs),
          ...(commencement
            ? {
              initialNetInvestment: commencement.netInvestment,
              sellingProfit: commencement.sellingProfit,
              commencementJournalId: commencement.journalId,
            }
            : {}),
          status: plan.deliveredAt ? "On Rent" : "Pending",
          updatedBy: userId,
          updatedAt: now,
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
        updatedAt: now,
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
  client: Client,
  args: {
    agreement: AgreementRow;
    companyId: string;
    companyGroupId: string | null;
    userId: string;
    today: string;
    accountingEnabled: boolean;
    plans: ActivationPlan[];
  },
): Promise<
  Map<string, {
    netInvestment: number;
    sellingProfit: number;
    journalId: string | null;
  }>
> {
  const { agreement, companyId, userId, today, plans } = args;
  const result = new Map<string, {
    netInvestment: number;
    sellingProfit: number;
    journalId: string | null;
  }>();
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
      "accumulatedDepreciation",
    ])
    .where("id", "in", plans.map((plan) => plan.fixedAssetId))
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
    ? await loadLeaseAccounting(trx, client, {
      companyId,
      companyGroupId: args.companyGroupId,
      today,
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
        accumulatedDepreciation,
      });
    } catch (err) {
      throw new ValidationError(`${plan.name}: ${(err as Error).message}`);
    }
    const serial = asset.serialNumber ?? asset.fixedAssetId;
    const tags = {
      customerId: agreement.customerId,
      itemId: plan.itemId,
      locationId: agreement.locationId,
    };

    let journalId: string | null = null;
    if (accounting) {
      journalId = await postLeaseJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: today,
        description:
          `Lease commencement ${agreement.rentalAgreementId} ${serial}`,
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
              assetClass.accumulatedDepreciationAccountId,
          },
        }),
        rentalAgreementId: agreement.id,
        rentalAgreementLineId: plan.lineId,
        tags,
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
        updatedBy: userId,
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", [...RENTABLE_ASSET_STATUSES])
      .executeTakeFirst();
    if (!disposed.numUpdatedRows) {
      throw new ValidationError(
        `${plan.name} changed status while the agreement was being activated`,
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
        createdBy: userId,
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
          attributes: sql<
            Json
          >`(COALESCE("attributes", '{}'::jsonb) - 'Fixed Asset') || jsonb_build_object('Rental Agreement', ${agreement.id}::text, 'Customer', ${agreement.customerId}::text)`,
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
          Customer: agreement.customerId,
        },
        trackedEntityId,
        companyId,
        userId,
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
      periodDates: spans.map((span) => span.periodEnd),
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
        createdBy: userId,
      });
    }
    if (accounting) {
      for (const row of interestRows(schedule, spans)) {
        pendingInterest.push({
          rentalAgreementLineId: plan.lineId,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          scheduledDate: row.scheduledDate,
          amount: row.amount,
        });
      }
    }

    result.set(plan.lineId, {
      netInvestment: amounts.netInvestment,
      sellingProfit: amounts.sellingProfit,
      journalId,
    });
  }

  // One insert for every schedule line of the agreement; the Interest rows
  // find theirs by (line, periodDate), unique per line.
  const insertedSchedule = scheduleInserts.length === 0 ? [] : await trx
    .insertInto("rentalLeaseScheduleLine")
    .values(scheduleInserts)
    .returning([
      "id",
      "rentalAgreementLineId",
      sql<string>`"periodDate"::text`.as("periodDate"),
    ])
    .execute();
  const scheduleIdByKey = new Map(
    insertedSchedule.map((row) => [
      `${row.rentalAgreementLineId}|${row.periodDate}`,
      row.id,
    ]),
  );
  if (accounting && pendingInterest.length > 0) {
    await trx
      .insertInto("revenueRecognitionSchedule")
      .values(
        pendingInterest.map((row) => {
          const rentalLeaseScheduleLineId = scheduleIdByKey.get(
            `${row.rentalAgreementLineId}|${row.scheduledDate}`,
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
            createdBy: userId,
          };
        }),
      )
      .execute();
  }

  return result;
}

async function returnUnit(
  client: Client,
  payload: Extract<RentalAgreementPayload, { type: "return" }>,
  today: string,
): Promise<{ id: string }> {
  const { companyId, userId, returnedAt } = payload;
  const future = futureReturnError(returnedAt, today);
  if (future) throw new ValidationError(future);

  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId,
    );
    if (agreement.status !== "Active") {
      throw new ValidationError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are returned from an Active agreement`,
      );
    }

    const line = await trx
      .selectFrom("rentalAgreementLine")
      .select([
        "id",
        "status",
        "fixedAssetId",
        "itemId",
        "trackedEntityId",
        "rateMode",
        "rateUnit",
        "dayRate",
        "weekRate",
        "monthRate",
        "lessorClassification",
        "initialNetInvestment",
        sql<string | null>`"deliveredAt"::text`.as("deliveredAt"),
      ])
      .where("id", "=", payload.rentalAgreementLineId)
      .where("rentalAgreementId", "=", agreement.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line) throw new NotFoundError("Rental agreement line not found");
    if (!RETURNABLE_LINE_STATUSES.has(line.status)) {
      throw new ValidationError(
        `The unit is ${line.status}; only a Pending or On Rent unit can be returned`,
      );
    }
    // `YYYY-MM-DD` compares chronologically as text.
    if (returnedAt < agreement.startDate) {
      throw new ValidationError(
        `The return date is before the agreement starts (${agreement.startDate})`,
      );
    }
    if (line.deliveredAt && returnedAt < line.deliveredAt) {
      throw new ValidationError(
        `The return date is before the unit was delivered (${line.deliveredAt})`,
      );
    }
    // A sales-type unit is off the books until it comes back: where it goes
    // (fleet or stock) is the caller's choice and has to be made. An
    // operating return ignores the destination.
    const salesTypeProblem = salesTypeReturnError({
      classification: line.lessorClassification,
      residualDestination: payload.residualDestination,
      returnedAt,
      endDate: agreement.endDate,
      takeOutOfService: !!payload.takeOutOfService,
    });
    if (salesTypeProblem) throw new ValidationError(salesTypeProblem);
    const salesType = line.lessorClassification === "Sales-Type";
    if (salesType && line.initialNetInvestment === null) {
      throw new ValidationError(
        "This sales-type line has no commencement booked; it cannot be returned as a lease",
      );
    }

    const now = datetime.timestamp();

    // A sales-type line's billing is its term, cut in full at activation, and
    // the unit comes back only on or after the end date — there is nothing to
    // re-cut. Regenerating would cut holdover periods past the end date that
    // bill rent against a net investment the schedule has already closed.
    if (!salesType) {
      const existingRows = await trx
        .selectFrom("rentalBillingPeriod")
        .select([
          sql<string>`"periodStart"::text`.as("periodStart"),
          sql<string>`"periodEnd"::text`.as("periodEnd"),
          "amount",
          "status",
          "isAdjustment",
        ])
        .where("rentalAgreementLineId", "=", line.id)
        .where("companyId", "=", companyId)
        .forUpdate()
        .execute();
      const existing: ExistingBillingPeriod[] = existingRows.map((row) => ({
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        amount: Number(row.amount),
        status: row.status,
        isAdjustment: row.isAdjustment,
      }));

      const plan = generateRentalBillingPeriods({
        cycle: agreement.billingCycle,
        timing: agreement.billingTiming,
        rateMode: line.rateMode,
        rateUnit: line.rateUnit,
        rates: {
          dayRate: toRate(line.dayRate),
          weekRate: toRate(line.weekRate),
          monthRate: toRate(line.monthRate),
        },
        startDate: agreement.startDate,
        endDate: agreement.endDate,
        returnedAt,
        through: returnedAt,
        existing,
      });

      // The generation stops at the return, so every unbilled period starting
      // after it is gone. An invoiced one is credited through `adjustments`.
      await trx
        .deleteFrom("rentalBillingPeriod")
        .where("rentalAgreementLineId", "=", line.id)
        .where("companyId", "=", companyId)
        .where("status", "=", "Pending")
        .where("isAdjustment", "=", false)
        .where("periodStart", ">", returnedAt)
        .execute();

      // The unbilled period the return falls inside ends on the return date.
      for (const recut of plan.recut) {
        await trx
          .updateTable("rentalBillingPeriod")
          .set({
            periodEnd: recut.periodEnd,
            days: recut.days,
            amount: recut.amount,
            rateUnitApplied: recut.rateUnitApplied,
            dueOn: recut.dueOn,
            updatedBy: userId,
            updatedAt: now,
          })
          .where("rentalAgreementLineId", "=", line.id)
          .where("companyId", "=", companyId)
          .where("periodStart", "=", recut.periodStart)
          .where("isAdjustment", "=", false)
          .where("status", "=", "Pending")
          .execute();
      }

      // `create` is non-empty when the return falls in a period not generated
      // yet; `adjustments` credits advance billing past the return.
      const inserts = [...plan.create, ...plan.adjustments].map((spec) =>
        billingPeriodRow(spec, line.id, companyId, userId)
      );
      if (inserts.length > 0) {
        await trx.insertInto("rentalBillingPeriod").values(inserts).execute();
      }
    }

    await trx
      .updateTable("rentalAgreementLine")
      .set({
        status: "Returned",
        returnedAt,
        meterIn: payload.meterIn ?? null,
        returnNotes: payload.returnNotes ?? null,
        updatedBy: userId,
        updatedAt: now,
      })
      .where("id", "=", line.id)
      .where("companyId", "=", companyId)
      .execute();

    // A sales-type unit's closing net investment moves back onto the books
    // — as a new Rental Fleet asset or into stock. The asset the line names
    // was disposed at commencement, so a fleet return's unit is the new one.
    let fleetAssetId = line.fixedAssetId;
    if (salesType) {
      const residual = await returnResidual(trx, client, {
        agreement,
        line: {
          id: line.id,
          itemId: line.itemId,
          fixedAssetId: line.fixedAssetId,
          trackedEntityId: line.trackedEntityId,
          initialNetInvestment: Number(line.initialNetInvestment),
        },
        destination: payload.residualDestination as ResidualDestination,
        returnedAt,
        companyId,
        userId,
        today,
      });
      fleetAssetId = residual.fixedAssetId;
    }

    // Straight to maintenance: the fleet status reads In Maintenance and the
    // unit cannot go back on rent until it is returned to service.
    if (payload.takeOutOfService && fleetAssetId) {
      await trx
        .updateTable("fixedAsset")
        .set({
          outOfServiceSince: returnedAt,
          outOfServiceReason: (payload.outOfServiceReason ?? "").trim(),
          updatedBy: userId,
          updatedAt: now,
        })
        .where("id", "=", fleetAssetId)
        .where("companyId", "=", companyId)
        .execute();
    }

    return { id: agreement.id };
  });
}

/**
 * End of a sales-type term with the unit coming back (spec §4): the closing
 * net investment — the schedule's balance on the return date
 * (`netInvestmentAt`: the closing of the last schedule line dated on or
 * before it, which at or after the end date is the closing target; the
 * initial NI when the line has no schedule) — leaves Net Investment in
 * Leases for either
 *
 *   Fleet      a new asset in the class named "Rental Fleet" (else the class
 *              the unit left at commencement) at that amount, with a Posted
 *              Capitalization transfer; Dr class asset / Cr net investment.
 *              The unit is consumed into the new asset.
 *   Inventory  stock at that unit cost (`bookAdjustment` +1, no variance
 *              journal); Dr the item's inventory account / Cr net investment.
 *              The unit is Available again.
 *
 * The schedule lines and Interest rows dated on or before the return stay,
 * posted or not: they are the term the lease ran, the closing already counts
 * them, and their interest posts through recognition runs after the return,
 * bringing Net Investment in Leases to zero. Only what is dated AFTER the
 * return is dropped — nothing accrues on a lease that has ended (normally
 * nothing, since a unit comes back on or after the end date). With
 * accounting off, the asset / stock moves identically and no journal is
 * posted.
 */
async function returnResidual(
  trx: Trx,
  client: Client,
  args: {
    agreement: AgreementRow;
    line: {
      id: string;
      itemId: string;
      fixedAssetId: string | null;
      trackedEntityId: string | null;
      initialNetInvestment: number;
    };
    destination: ResidualDestination;
    returnedAt: string;
    companyId: string;
    userId: string;
    today: string;
  },
): Promise<{ fixedAssetId: string | null }> {
  const { agreement, line, destination, returnedAt, companyId, userId, today } =
    args;

  // A Draft recognition run that already claimed interest dated after the
  // return would be left pointing at deleted rows. Interest on or before the
  // return is kept, so a run holding it is no obstacle.
  const claimed = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select(sql<number>`count(*)::int`.as("count"))
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .where("type", "=", "Interest")
    .where("status", "=", "Planned")
    .where("scheduledDate", ">", returnedAt)
    .where("runLineId", "is not", null)
    .executeTakeFirstOrThrow();
  if (Number(claimed.count) > 0) {
    throw new ValidationError(
      "A draft revenue recognition run includes this lease's interest; post or delete the run before returning the unit",
    );
  }

  const schedule = await trx
    .selectFrom("rentalLeaseScheduleLine")
    .select([
      sql<string>`"periodDate"::text`.as("periodDate"),
      "closingNetInvestment",
    ])
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .execute();
  const closing = netInvestmentAt({
    initialNetInvestment: line.initialNetInvestment,
    schedule: schedule.map((row) => ({
      periodDate: row.periodDate,
      closingNetInvestment: Number(row.closingNetInvestment),
    })),
    asOf: returnedAt,
  });
  if (closing < 0) {
    throw new ValidationError(
      `The lease's closing net investment is negative (${closing})`,
    );
  }

  // Sequential on purpose: one transaction is one connection.
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const settings = await trx
    .selectFrom("companySettings")
    .select("accountingEnabled")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const item = await trx
    .selectFrom("item")
    .select([
      "id",
      "name",
      "readableId",
      "itemTrackingType",
      "replenishmentSystem",
    ])
    .where("id", "=", line.itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const itemCost = await trx
    .selectFrom("itemCost")
    .select([
      "costingMethod",
      "unitCost",
      "standardCost",
      "itemPostingGroupId",
    ])
    .where("itemId", "=", line.itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const entity = line.trackedEntityId
    ? await trx
      .selectFrom("trackedEntity")
      .select(["id", "readableId"])
      .where("id", "=", line.trackedEntityId)
      .where("companyId", "=", companyId)
      .executeTakeFirst()
    : undefined;
  if (!item) throw new NotFoundError("Item not found");
  const serial = entity?.readableId ?? item.readableId;
  const accounting = settings.accountingEnabled
    ? await loadLeaseAccounting(trx, client, {
      companyId,
      companyGroupId: company.companyGroupId,
      today,
    })
    : null;
  const tags = {
    customerId: agreement.customerId,
    itemId: line.itemId,
    locationId: agreement.locationId,
  };
  const description = `Lease return ${agreement.rentalAgreementId} ${serial}`;

  let fixedAssetId: string | null = null;
  if (destination === "Fleet") {
    // The class the fleet register and capitalization default to; a company
    // that renamed it falls back to the class the unit was leased out of.
    const byName = await trx
      .selectFrom("fixedAssetClass")
      .select([
        "id",
        "assetAccountId",
        "depreciationMethod",
        "usefulLifeMonths",
        "residualValuePercent",
      ])
      .where("companyId", "=", companyId)
      .where("name", "=", "Rental Fleet")
      .where("isConstructionInProgress", "=", false)
      .executeTakeFirst();
    const original = byName || !line.fixedAssetId ? undefined : await trx
      .selectFrom("fixedAsset as fa")
      .innerJoin("fixedAssetClass as fac", (join) =>
        join
          .onRef("fac.id", "=", "fa.fixedAssetClassId")
          .onRef("fac.companyId", "=", "fa.companyId"))
      .select([
        "fac.id",
        "fac.assetAccountId",
        "fac.depreciationMethod",
        "fac.usefulLifeMonths",
        "fac.residualValuePercent",
      ])
      .where("fa.id", "=", line.fixedAssetId)
      .where("fa.companyId", "=", companyId)
      .where("fac.isConstructionInProgress", "=", false)
      .executeTakeFirst();
    const assetClass = byName ?? original;
    if (!assetClass) {
      throw new ValidationError(
        "No Rental Fleet asset class to return the unit into; create one or return the unit to inventory",
      );
    }

    let journalId: string | null = null;
    if (accounting && closing > 0) {
      journalId = await postLeaseJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: today,
        description,
        lines: buildResidualReturnLines({
          closing,
          debitAccountId: assetClass.assetAccountId,
          debitDescription: "Fixed Asset Acquisition",
          netInvestmentInLeasesAccountId:
            accounting.accounts.netInvestmentInLeasesAccount,
        }),
        rentalAgreementId: agreement.id,
        rentalAgreementLineId: line.id,
        tags,
      });
    }

    const assetReadableId = await getNextSequence(trx, "fixedAsset", companyId);
    const asset = await trx
      .insertInto("fixedAsset")
      .values({
        fixedAssetId: assetReadableId,
        fixedAssetClassId: assetClass.id,
        name: `${item.name} ${serial}`,
        itemId: line.itemId,
        trackedEntityId: line.trackedEntityId,
        serialNumber: entity?.readableId ?? null,
        locationId: agreement.locationId,
        quantity: 1,
        acquisitionCost: closing,
        acquisitionDate: today,
        depreciationStartDate: today,
        depreciationMethod: assetClass.depreciationMethod,
        usefulLifeMonths: assetClass.usefulLifeMonths,
        residualValuePercent: assetClass.residualValuePercent,
        status: "Active",
        companyId,
        createdBy: userId,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    fixedAssetId = asset.id;

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId,
    );
    const now = datetime.timestamp();
    await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Capitalization",
        sourceType: "Inventory",
        fixedAssetId: asset.id,
        itemId: line.itemId,
        trackedEntityId: line.trackedEntityId,
        locationId: agreement.locationId,
        quantity: 1,
        transferDate: today,
        amount: closing,
        journalId,
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        companyId,
        createdBy: userId,
      })
      .execute();

    if (line.trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          status: "Consumed",
          attributes: sql<
            Json
          >`(COALESCE("attributes", '{}'::jsonb) - 'Rental Agreement' - 'Customer') || jsonb_build_object('Fixed Asset', ${asset.id}::text)`,
        })
        .where("id", "=", line.trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      await insertUnitActivity(trx, {
        type: "Capitalize",
        direction: "input",
        sourceDocument: "Fixed Asset",
        sourceDocumentId: asset.id,
        sourceDocumentReadableId: assetReadableId,
        attributes: { "Fixed Asset": asset.id },
        trackedEntityId: line.trackedEntityId,
        companyId,
        userId,
      });
    }
  } else {
    if (!itemCost) throw new NotFoundError("Item cost not found");
    // Into stock at the closing net investment: a cost layer at that amount,
    // so the unit is later sold like any other stock. accounting: null keeps
    // the core from posting a variance journal; the lease journal is below.
    await bookAdjustment(trx, {
      ledger: {
        postingDate: today,
        itemId: line.itemId,
        quantity: 1,
        locationId: agreement.locationId,
        storageUnitId: null,
        trackedEntityId: line.trackedEntityId,
        entryType: "Positive Adjmt.",
        documentType: "Rental Agreement",
        documentId: agreement.id,
        companyId,
        createdBy: userId,
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: itemCost.itemPostingGroupId,
      },
      itemCost: {
        costingMethod: itemCost.costingMethod,
        unitCost: itemCost.unitCost,
        standardCost: itemCost.standardCost,
      },
      accounting: null,
      fixedUnitCost: closing,
    });

    if (accounting && closing > 0) {
      const inventoryAccount = resolveInventoryAccount(
        item.replenishmentSystem,
        accounting.accounts,
      );
      await postLeaseJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: today,
        description,
        lines: buildResidualReturnLines({
          closing,
          debitAccountId: inventoryAccount.account,
          debitDescription: inventoryAccount.description,
          netInvestmentInLeasesAccountId:
            accounting.accounts.netInvestmentInLeasesAccount,
        }),
        rentalAgreementId: agreement.id,
        rentalAgreementLineId: line.id,
        tags,
      });
    }

    if (line.trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          status: "Available",
          attributes: sql<
            Json
          >`COALESCE("attributes", '{}'::jsonb) - 'Rental Agreement' - 'Customer'`,
        })
        .where("id", "=", line.trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      await insertUnitActivity(trx, {
        type: "Return to Inventory",
        direction: "output",
        sourceDocument: "Rental Agreement",
        sourceDocumentId: agreement.id,
        sourceDocumentReadableId: agreement.rentalAgreementId,
        attributes: { "Rental Agreement": agreement.id },
        trackedEntityId: line.trackedEntityId,
        companyId,
        userId,
      });
    }
  }

  // The lease has ended: nothing dated after the return will ever accrue.
  // Everything on or before it stays and posts through recognition runs.
  await trx
    .deleteFrom("revenueRecognitionSchedule")
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .where("type", "=", "Interest")
    .where("status", "=", "Planned")
    .where("scheduledDate", ">", returnedAt)
    .execute();
  await trx
    .deleteFrom("rentalLeaseScheduleLine")
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .where("postedAt", "is", null)
    .where("periodDate", ">", returnedAt)
    .execute();

  return { fixedAssetId };
}

// Everything close and cancel decide on, in three reads.
async function loadSettlementState(
  trx: Trx,
  companyId: string,
  agreementId: string,
) {
  const lines = await trx
    .selectFrom("rentalAgreementLine")
    .select([
      "id",
      "status",
      "lessorClassification",
      "commencementJournalId",
      "initialNetInvestment",
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
      billedCharges: 0,
    };
  }

  const periods = await trx
    .selectFrom("rentalBillingPeriod")
    .select([
      sql<number>`count(*) FILTER (WHERE status = 'Pending')::int`.as(
        "pending",
      ),
      sql<number>`count(*) FILTER (WHERE status = 'Invoiced')::int`.as(
        "invoiced",
      ),
    ])
    .where("rentalAgreementLineId", "in", lineIds)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  const charges = await trx
    .selectFrom("rentalAgreementCharge")
    .select([
      sql<
        number
      >`count(*) FILTER (WHERE "salesInvoiceLineId" IS NULL)::int`.as(
        "unbilled",
      ),
      sql<
        number
      >`count(*) FILTER (WHERE "salesInvoiceLineId" IS NOT NULL)::int`.as(
        "billed",
      ),
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
    billedCharges: Number(charges.billed),
  };
}

async function close(
  payload: Extract<RentalAgreementPayload, { type: "close" }>,
): Promise<{ id: string }> {
  const { companyId, userId } = payload;

  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId,
    );
    if (agreement.status !== "Active") {
      throw new ValidationError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; only an Active agreement can be closed`,
      );
    }

    const state = await loadSettlementState(trx, companyId, agreement.id);
    const blocker = closeBlocker({
      lineStatuses: state.lines.map((line) => line.status),
      pendingPeriods: state.pendingPeriods,
      unbilledCharges: state.unbilledCharges,
    });
    if (blocker) throw new ValidationError(blocker);

    const now = datetime.timestamp();
    await trx
      .updateTable("rentalAgreement")
      .set({
        status: "Closed",
        closedAt: now,
        updatedBy: userId,
        updatedAt: now,
      })
      .where("id", "=", agreement.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: agreement.id };
  });
}

async function cancel(
  payload: Extract<RentalAgreementPayload, { type: "cancel" }>,
): Promise<{ id: string }> {
  const { companyId, userId } = payload;

  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId,
    );

    const state = await loadSettlementState(trx, companyId, agreement.id);
    // An accrual (Task 40) already booked income against a line; dropping its
    // unbilled periods would strand that contract asset.
    const recognized = state.lineIds.length === 0
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
      commencedSalesTypeLines: state.lines.filter((line) =>
        line.lessorClassification === "Sales-Type" &&
        (line.commencementJournalId !== null ||
          line.initialNetInvestment !== null)
      ).length,
    });
    if (blocker) throw new ValidationError(blocker);

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
        updatedAt: now,
      })
      .where("id", "=", agreement.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: agreement.id };
  });
}

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = payloadValidator.parse(await req.json());
    const { companyId, userId } = payload;

    const client = await requirePermissions(req, companyId, userId, {
      update: "sales",
    });

    let result: { id: string };
    switch (payload.type) {
      case "activate": {
        const today = datetime
          .today(await getCompanyTimeZone(client, companyId))
          .toString();
        result = await activate(client, payload, today);
        break;
      }
      case "return": {
        const today = datetime
          .today(await getCompanyTimeZone(client, companyId))
          .toString();
        result = await returnUnit(client, payload, today);
        break;
      }
      case "close":
        result = await close(payload);
        break;
      case "cancel":
        result = await cancel(payload);
        break;
    }

    return jsonResponse(result);
  } catch (err) {
    logger.error("post-rental-agreement failed", {
      error: String((err as Error).stack ?? err),
    });
    // A payload ZodError is the caller's input contract failing, same as our
    // own ValidationError — a 400, not an outage.
    const status = err instanceof NotFoundError
      ? 404
      : err instanceof ValidationError || err instanceof z.ZodError
      ? 400
      : 500;
    return errorResponse(err, status);
  }
});
