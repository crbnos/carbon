// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { classifyRentalLine, leasePaymentTerms } from "../../lessor-lease.ts";
import {
  billingHorizon,
  generateRentalBillingPeriods
} from "../../rental-periods.ts";
import { resolveDate, resolveTimestamp } from "../dates.ts";
import { insertId, insertRow, maybeOne, need, nextSequence } from "../sql.ts";
import type { Ctx } from "../types.ts";

/** Writes what activation (ERP `sales.service.ts`) and a posted rental shipment
 *  (`inventory.service.ts` postRentalShipment) write; neither posts a journal. */
export async function seedRentalAgreements(ctx: Ctx): Promise<void> {
  const specs = ctx.dataset.sales.rentalAgreements;
  if (specs.length === 0) return;
  const { client, companyId, companyGroupId, userId } = ctx;
  const today = ctx.anchor.toString();

  const settings = await maybeOne<{
    leaseDefaultDiscountRate: number | string;
    leaseMajorPartThresholdPercent: number | string;
    leaseSubstantiallyAllThresholdPercent: number | string;
  }>(
    client,
    `SELECT "leaseDefaultDiscountRate", "leaseMajorPartThresholdPercent",
            "leaseSubstantiallyAllThresholdPercent"
     FROM "companySettings" WHERE id = $1`,
    [companyId]
  );
  if (!settings) throw new Error("Seed: companySettings row missing");
  const discountRate = Number(settings.leaseDefaultDiscountRate);
  const thresholds = {
    majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
    substantiallyAllPercent: Number(
      settings.leaseSubstantiallyAllThresholdPercent
    )
  };
  const currency = await maybeOne<{ decimalPlaces: number | null }>(
    client,
    `SELECT "decimalPlaces" FROM currency WHERE code = 'USD' AND "companyGroupId" = $1`,
    [companyGroupId]
  );
  const decimals = Number(currency?.decimalPlaces ?? 2);

  for (const spec of specs) {
    ctx.log(`rental agreement ${spec.key} — ${spec.status}`);
    const isActive = spec.status === "Active";
    const startDate = resolveDate(ctx.anchor, spec.startOffset);
    const endDate =
      spec.endOffset === undefined
        ? null
        : resolveDate(ctx.anchor, spec.endOffset);
    const customerId = need(ctx.refs.customers, spec.customer, "customer");
    const terms = {
      ownershipTransfers: false,
      specializedAsset: false,
      purchaseOptionAmount: null,
      purchaseOptionReasonablyCertain: false
    };

    const rentalAgreementId = await nextSequence(ctx, "rentalAgreement");
    const agreementId = await insertId(ctx, "rentalAgreement", {
      rentalAgreementId,
      status: spec.status,
      customerId,
      customerLocationId: need(
        ctx.refs.misc,
        `cloc:${spec.customer}`,
        "customer location"
      ),
      customerContactId: need(
        ctx.refs.contacts,
        `cc:${spec.customer}:${spec.primaryContact}`,
        "customer contact"
      ),
      salesPersonId: userId,
      locationId: need(ctx.refs.locations, "Plant", "location"),
      startDate,
      endDate,
      billingCycle: spec.billingCycle,
      billingTiming: spec.billingTiming,
      currencyCode: "USD",
      exchangeRate: 1,
      discountRate,
      ...terms,
      // The nightly billing job drafts every due period; Draft Only keeps it
      // from posting and emailing invoices for a demo customer.
      invoiceAutomation: "Draft Only",
      activatedAt: isActive
        ? resolveTimestamp(ctx.anchor, spec.startOffset, "09:00:00")
        : undefined,
      createdAt: resolveTimestamp(ctx.anchor, spec.startOffset, "08:00:00")
    });
    ctx.refs.documents[`ra:${spec.key}`] = agreementId;

    for (const [index, other] of (spec.contacts ?? []).entries()) {
      await insertRow(ctx, "rentalAgreementContact", {
        rentalAgreementId: agreementId,
        customerContactId: need(
          ctx.refs.contacts,
          `cc:${spec.customer}:${other.contact}`,
          "customer contact"
        ),
        role: other.role,
        sortOrder: index
      });
    }

    const lineIds: string[] = [];
    const delivered: { lineId: string; serialId: string; date: string }[] = [];
    for (const line of spec.lines) {
      const fixedAssetId = need(
        ctx.refs.documents,
        `fixedAsset:${line.fixedAsset}`,
        "fixed asset"
      );
      const serialId = need(
        ctx.refs.misc,
        `fleet-serial:${line.fixedAsset}`,
        "fleet serial"
      );
      const asset = ctx.dataset.accounting.fixedAssets.find(
        (a) => a.key === line.fixedAsset
      );
      if (!asset?.fleet) {
        throw new Error(
          `Seed: fixed asset "${line.fixedAsset}" is no fleet unit`
        );
      }
      const item = need(ctx.refs.items, asset.fleet.item, "item");

      let classification: Record<string, unknown> = {};
      if (isActive) {
        const payment = leasePaymentTerms({
          cycle: spec.billingCycle,
          rateUnit: line.rateUnit,
          rate: line.rate,
          discountRate,
          startDate,
          endDate,
          decimals
        });
        const { classification: computed, record } = classifyRentalLine({
          terms: payment,
          timing: spec.billingTiming,
          agreement: terms,
          line: {
            fairValue: line.fairValue,
            economicLifeMonths: line.economicLifeMonths,
            guaranteedResidualValue: 0,
            unguaranteedResidualValue: 0
          },
          thresholds
        });
        if (computed !== "Rental") {
          throw new Error(
            `Seed: rental agreement "${spec.key}" line "${line.fixedAsset}" classifies as ${computed}; the seed writes Rental lines only`
          );
        }
        classification = {
          lessorClassification: computed,
          classificationInputs: JSON.stringify(record)
        };
      }

      const deliveredAt =
        line.deliveredOffset === undefined
          ? undefined
          : resolveDate(ctx.anchor, line.deliveredOffset);
      const lineId = await insertId(ctx, "rentalAgreementLine", {
        rentalAgreementId: agreementId,
        status: deliveredAt ? "On Rent" : "Pending",
        fixedAssetId,
        itemId: item.id,
        trackedEntityId: serialId,
        rateUnit: line.rateUnit,
        rate: line.rate,
        fairValue: line.fairValue,
        economicLifeMonths: line.economicLifeMonths,
        deliveredAt,
        ...classification
      });
      lineIds.push(lineId);
      if (deliveredAt) delivered.push({ lineId, serialId, date: deliveredAt });

      if (isActive) {
        const { create } = generateRentalBillingPeriods({
          cycle: spec.billingCycle,
          timing: spec.billingTiming,
          rateUnit: line.rateUnit,
          rate: line.rate,
          startDate,
          endDate,
          returnedAt: null,
          through: billingHorizon(spec.billingCycle, today),
          existing: [],
          decimals
        });
        for (const period of create) {
          await insertRow(ctx, "rentalBillingPeriod", {
            rentalAgreementLineId: lineId,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            days: period.days,
            amount: period.amount,
            rateUnitApplied: period.rateUnitApplied,
            isAdjustment: period.isAdjustment,
            dueOn: period.dueOn,
            status: "Pending"
          });
        }
      }
    }

    // One posted rental shipment per delivery day, as the Deliver action
    // drafts it and posting it settles the units.
    const byDate = new Map<string, typeof delivered>();
    for (const unit of delivered) {
      byDate.set(unit.date, [...(byDate.get(unit.date) ?? []), unit]);
    }
    for (const [date, units] of byDate) {
      const shipmentReadableId = await nextSequence(ctx, "shipment");
      const shipmentId = await insertId(ctx, "shipment", {
        shipmentId: shipmentReadableId,
        sourceDocument: "Rental Agreement",
        sourceDocumentId: agreementId,
        sourceDocumentReadableId: rentalAgreementId,
        customerId,
        locationId: need(ctx.refs.locations, "Plant", "location"),
        status: "Posted",
        postingDate: date,
        postedBy: userId
      });
      for (const unit of units) {
        await insertRow(ctx, "shipmentFixedAssetLine", {
          shipmentId,
          rentalAgreementLineId: unit.lineId,
          shipped: true
        });
        const activityId = await insertId(ctx, "trackedActivity", {
          type: "Rental Delivery",
          sourceDocument: "Shipment",
          sourceDocumentId: shipmentId,
          sourceDocumentReadableId: shipmentReadableId,
          attributes: JSON.stringify({
            Shipment: shipmentId,
            "Rental Agreement": agreementId
          })
        });
        await insertRow(ctx, "trackedActivityInput", {
          trackedActivityId: activityId,
          trackedEntityId: unit.serialId,
          quantity: 1
        });
      }
    }

    for (const charge of spec.charges ?? []) {
      const lineId = lineIds[charge.line - 1];
      if (!lineId) {
        throw new Error(
          `Seed: rental agreement "${spec.key}" charge names line ${charge.line}, which does not exist`
        );
      }
      await insertRow(ctx, "rentalAgreementCharge", {
        rentalAgreementLineId: lineId,
        chargeDate: resolveDate(ctx.anchor, charge.dateOffset),
        description: charge.description,
        amount: charge.amount
      });
    }
  }
}
