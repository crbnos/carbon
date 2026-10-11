// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One unit of an Active rental agreement comes back: the line goes Returned,
// an operating line's billing is re-cut at the return date, and a sales-type
// line's closing net investment moves into a new fleet asset or into stock.

import type { Json } from "@carbon/database";
import { getNextSequence } from "@carbon/database/sequence";
import {
  datetime,
  type ExistingBillingPeriod,
  generateRentalBillingPeriods
} from "@carbon/utils";
import { sql } from "kysely";
import { InvalidInputError, NotFoundError } from "../errors";
import { resolveInventoryAccount } from "../lib/get-posting-group";
import { bookAdjustment } from "../lib/post-adjustment";
import {
  type AgreementRow,
  billingPeriodRow,
  currencyDecimals,
  insertUnitActivity,
  loadLeaseAccounting,
  postLeaseJournal,
  type Trx
} from "./agreement";
import {
  buildResidualReturnLines,
  netInvestmentAt,
  salesTypeReturnError
} from "./lessor";
import {
  RETURNABLE_LINE_STATUSES,
  type ResidualDestination
} from "./validators";

export type RentalUnitReturn = {
  rentalAgreementLineId: string;
  returnedAt: string; // YYYY-MM-DD
  meterIn?: number | null;
  returnNotes?: string | null;
  takeOutOfService?: boolean;
  outOfServiceReason?: string | null;
  residualDestination?: ResidualDestination | null;
};

/** Returns one unit of a locked, Active agreement. The caller locks the
 *  agreement, checks it is Active and refuses a future return date. */
export async function returnRentalUnit(
  trx: Trx,
  args: {
    agreement: AgreementRow;
    unit: RentalUnitReturn;
    companyId: string;
    userId: string;
    today: string;
    /** Where a `Sale` line's residual lands (stock or new fleet asset).
     *  Without it, the agreement's location, as today. */
    locationId?: string;
  }
): Promise<{ fixedAssetId: string | null }> {
  const { agreement, unit, companyId, userId, today } = args;
  const { returnedAt } = unit;

  const line = await trx
    .selectFrom("rentalAgreementLine")
    .select([
      "id",
      "status",
      "fixedAssetId",
      "itemId",
      "trackedEntityId",
      "rateUnit",
      "rate",
      "lessorClassification",
      "initialNetInvestment",
      sql<string | null>`"deliveredAt"::text`.as("deliveredAt")
    ])
    .where("id", "=", unit.rentalAgreementLineId)
    .where("rentalAgreementId", "=", agreement.id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!line) throw new NotFoundError("Rental agreement line not found");
  if (!RETURNABLE_LINE_STATUSES.has(line.status)) {
    throw new InvalidInputError(
      `The unit is ${line.status}; only a Pending or On Rent unit can be returned`
    );
  }
  // `YYYY-MM-DD` compares chronologically as text.
  if (returnedAt < agreement.startDate) {
    throw new InvalidInputError(
      `The return date is before the agreement starts (${agreement.startDate})`
    );
  }
  if (line.deliveredAt && returnedAt < line.deliveredAt) {
    throw new InvalidInputError(
      `The return date is before the unit was delivered (${line.deliveredAt})`
    );
  }
  // A sales-type unit is off the books until it comes back: where it goes
  // (fleet or stock) is the caller's choice and has to be made. An
  // operating return ignores the destination.
  const salesTypeProblem = salesTypeReturnError({
    classification: line.lessorClassification,
    residualDestination: unit.residualDestination,
    returnedAt,
    endDate: agreement.endDate,
    takeOutOfService: !!unit.takeOutOfService
  });
  if (salesTypeProblem) throw new InvalidInputError(salesTypeProblem);
  const salesType = line.lessorClassification === "Sale";
  if (salesType && line.initialNetInvestment === null) {
    throw new InvalidInputError(
      "This line is treated as a sale but has no commencement booked; it cannot be returned"
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
        "isAdjustment"
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
      isAdjustment: row.isAdjustment
    }));

    const plan = generateRentalBillingPeriods({
      cycle: agreement.billingCycle,
      timing: agreement.billingTiming,
      rateUnit: line.rateUnit,
      rate: Number(line.rate),
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      returnedAt,
      through: returnedAt,
      existing,
      decimals: await currencyDecimals(trx, companyId, agreement.currencyCode)
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
          updatedAt: now
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
      meterIn: unit.meterIn ?? null,
      returnNotes: unit.returnNotes ?? null,
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "=", line.id)
    .where("companyId", "=", companyId)
    .execute();

  // A sales-type unit's closing net investment moves back onto the books
  // — as a new Rental Fleet asset or into stock. The asset the line names
  // was disposed at commencement, so a fleet return's unit is the new one.
  let fleetAssetId = line.fixedAssetId;
  if (salesType) {
    const residual = await returnResidual(trx, {
      agreement,
      line: {
        id: line.id,
        itemId: line.itemId,
        fixedAssetId: line.fixedAssetId,
        trackedEntityId: line.trackedEntityId,
        initialNetInvestment: Number(line.initialNetInvestment)
      },
      destination: unit.residualDestination as ResidualDestination,
      returnedAt,
      companyId,
      userId,
      today,
      locationId: args.locationId ?? agreement.locationId
    });
    fleetAssetId = residual.fixedAssetId;
  }

  // Straight to maintenance: the fleet status reads In Maintenance and the
  // unit cannot go back on rent until it is returned to service.
  if (unit.takeOutOfService && fleetAssetId) {
    await trx
      .updateTable("fixedAsset")
      .set({
        outOfServiceSince: returnedAt,
        outOfServiceReason: (unit.outOfServiceReason ?? "").trim(),
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", fleetAssetId)
      .where("companyId", "=", companyId)
      .execute();
  }

  return { fixedAssetId: fleetAssetId };
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
 * nothing, since a unit comes back on or after the end date). Before the
 * accounting cutover the journal is Provisional.
 */
async function returnResidual(
  trx: Trx,
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
    locationId: string;
  }
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
    throw new InvalidInputError(
      "A draft revenue recognition run includes this lease's interest; post or delete the run before returning the unit"
    );
  }

  const schedule = await trx
    .selectFrom("rentalLeaseScheduleLine")
    .select([
      sql<string>`"periodDate"::text`.as("periodDate"),
      "closingNetInvestment"
    ])
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .execute();
  const closing = netInvestmentAt({
    initialNetInvestment: line.initialNetInvestment,
    schedule: schedule.map((row) => ({
      periodDate: row.periodDate,
      closingNetInvestment: Number(row.closingNetInvestment)
    })),
    asOf: returnedAt
  });
  if (closing < 0) {
    throw new InvalidInputError(
      `The lease's closing net investment is negative (${closing})`
    );
  }

  // Sequential on purpose: one transaction is one connection.
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const item = await trx
    .selectFrom("item")
    .select([
      "id",
      "name",
      "readableId",
      "itemTrackingType",
      "replenishmentSystem"
    ])
    .where("id", "=", line.itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const itemCost = await trx
    .selectFrom("itemCost")
    .select(["costingMethod", "unitCost", "standardCost", "itemPostingGroupId"])
    .where("itemId", "=", line.itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  // The serial left the line's asset at commencement when the line named
  // only the asset (as `commenceSalesTypeLines` resolves it), so a line
  // without its own serial takes the disposed asset's.
  const disposedAsset =
    !line.trackedEntityId && line.fixedAssetId
      ? await trx
          .selectFrom("fixedAsset")
          .select("trackedEntityId")
          .where("id", "=", line.fixedAssetId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : undefined;
  const trackedEntityId =
    line.trackedEntityId ?? disposedAsset?.trackedEntityId ?? null;
  const entity = trackedEntityId
    ? await trx
        .selectFrom("trackedEntity")
        .select(["id", "readableId"])
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
    : undefined;
  if (!item) throw new NotFoundError("Item not found");
  const serial = entity?.readableId ?? item.readableId;
  const accounting = await loadLeaseAccounting(trx, {
    companyId,
    companyGroupId: company.companyGroupId,
    today
  });
  const tags = {
    customerId: agreement.customerId,
    itemId: line.itemId,
    locationId: agreement.locationId
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
        "residualValuePercent"
      ])
      .where("companyId", "=", companyId)
      .where("name", "=", "Rental Fleet")
      .where("isConstructionInProgress", "=", false)
      .executeTakeFirst();
    const original =
      byName || !line.fixedAssetId
        ? undefined
        : await trx
            .selectFrom("fixedAsset as fa")
            .innerJoin("fixedAssetClass as fac", (join) =>
              join
                .onRef("fac.id", "=", "fa.fixedAssetClassId")
                .onRef("fac.companyId", "=", "fa.companyId")
            )
            .select([
              "fac.id",
              "fac.assetAccountId",
              "fac.depreciationMethod",
              "fac.usefulLifeMonths",
              "fac.residualValuePercent"
            ])
            .where("fa.id", "=", line.fixedAssetId)
            .where("fa.companyId", "=", companyId)
            .where("fac.isConstructionInProgress", "=", false)
            .executeTakeFirst();
    const assetClass = byName ?? original;
    if (!assetClass) {
      throw new InvalidInputError(
        "No Rental Fleet asset class to return the unit into; create one or return the unit to inventory"
      );
    }

    let journalId: string | null = null;
    if (closing > 0) {
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
          accountDefaultRoles: accounting.accountDefaultRoles
        }),
        rentalAgreementId: agreement.id,
        rentalAgreementLineId: line.id,
        tags
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
        trackedEntityId,
        serialNumber: entity?.readableId ?? null,
        locationId: args.locationId,
        quantity: 1,
        acquisitionCost: closing,
        acquisitionDate: today,
        depreciationStartDate: today,
        depreciationMethod: assetClass.depreciationMethod,
        usefulLifeMonths: assetClass.usefulLifeMonths,
        residualValuePercent: assetClass.residualValuePercent,
        status: "Active",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    fixedAssetId = asset.id;

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId
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
        trackedEntityId,
        locationId: args.locationId,
        quantity: 1,
        transferDate: today,
        amount: closing,
        journalId,
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        companyId,
        createdBy: userId
      })
      .execute();

    if (trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          status: "Consumed",
          attributes: sql<Json>`(COALESCE("attributes", '{}'::jsonb) - 'Rental Agreement' - 'Customer') || jsonb_build_object('Fixed Asset', ${asset.id}::text)`
        })
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      await insertUnitActivity(trx, {
        type: "Capitalize",
        direction: "input",
        sourceDocument: "Fixed Asset",
        sourceDocumentId: asset.id,
        sourceDocumentReadableId: assetReadableId,
        attributes: { "Fixed Asset": asset.id },
        trackedEntityId,
        companyId,
        userId
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
        locationId: args.locationId,
        storageUnitId: null,
        trackedEntityId,
        entryType: "Positive Adjmt.",
        documentType: "Rental Agreement",
        documentId: agreement.id,
        companyId,
        createdBy: userId
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: itemCost.itemPostingGroupId
      },
      itemCost: {
        costingMethod: itemCost.costingMethod,
        unitCost: itemCost.unitCost,
        standardCost: itemCost.standardCost
      },
      accounting: null,
      fixedUnitCost: closing
    });

    if (closing > 0) {
      const inventoryAccount = resolveInventoryAccount(
        item.replenishmentSystem,
        accounting.accounts
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
          accountDefaultRoles: accounting.accountDefaultRoles
        }),
        rentalAgreementId: agreement.id,
        rentalAgreementLineId: line.id,
        tags
      });
    }

    if (trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          status: "Available",
          attributes: sql<Json>`COALESCE("attributes", '{}'::jsonb) - 'Rental Agreement' - 'Customer'`
        })
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      await insertUnitActivity(trx, {
        type: "Return to Inventory",
        direction: "output",
        sourceDocument: "Rental Agreement",
        sourceDocumentId: agreement.id,
        sourceDocumentReadableId: agreement.rentalAgreementId,
        attributes: { "Rental Agreement": agreement.id },
        trackedEntityId,
        companyId,
        userId
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
