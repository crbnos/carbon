// Rental invoice generation — shared by the ERP "Generate invoices" action and
// the daily Inngest job, so a human and the scheduler bill exactly the same
// periods. Posting stays with post-sales-invoice: this only drafts invoices.
// Spec: .ai/specs/2026-09-22-revenue-recognition-and-rentals.md §3

import { sql } from "kysely";
import { round } from "../supabase/functions/shared/precision.ts";
import {
  billingHorizon,
  generateRentalBillingPeriods,
  wholeRateUnits
} from "../supabase/functions/shared/rental-billing.ts";
import type { Kysely, KyselyDatabase, KyselyTx } from "./client";
import { getNextSequence } from "./sequence";
import type { Database } from "./types";

type RateUnit = Database["public"]["Enums"]["rentalRateUnit"];

export type RentalInvoiceGenerationArgs = {
  companyId: string;
  /** `YYYY-MM-DD` in the company's timezone: periods due on or before it, and
   *  charges dated on or before it, are billed. */
  asOf: string;
  /** Bill one agreement only (the agreement page's action). */
  rentalAgreementId?: string;
  userId: string;
};

/**
 * Drafts one sales invoice per Active agreement that has something due: every
 * Pending billing period with `dueOn <= asOf` and every unbilled charge dated
 * on or before `asOf`. First it rolls every live line's periods forward to
 * `billingHorizon(asOf)` — activation only cuts periods to one cycle ahead,
 * so an open-ended or held-over line gets its next period here. Each agreement is its own transaction, so one
 * agreement's failure never rolls back another's invoice. The billed rows are
 * stamped with their invoice line, which is what makes a second call for the
 * same day a no-op; deleting the Draft invoice releases them
 * (`releaseRentalInvoiceStamps`).
 */
export async function createRentalInvoicesForDuePeriods(
  db: Kysely<KyselyDatabase>,
  args: RentalInvoiceGenerationArgs
): Promise<{ invoiceIds: string[] }> {
  const { companyId, asOf, rentalAgreementId } = args;

  // One read for every agreement with anything due; the per-agreement
  // transaction below re-reads its own rows under lock.
  let dueQuery = db
    .selectFrom("rentalAgreement as ra")
    .select("ra.id")
    .where("ra.companyId", "=", companyId)
    .where("ra.status", "=", "Active")
    .where((eb) =>
      eb.or([
        // A live line may need its next period cut before anything is due.
        eb.exists(
          eb
            .selectFrom("rentalAgreementLine as l")
            .select("l.id")
            .whereRef("l.rentalAgreementId", "=", "ra.id")
            .whereRef("l.companyId", "=", "ra.companyId")
            .where("l.status", "in", ["Pending", "On Rent"])
        ),
        eb.exists(
          eb
            .selectFrom("rentalBillingPeriod as p")
            .innerJoin("rentalAgreementLine as l", (join) =>
              join
                .onRef("l.id", "=", "p.rentalAgreementLineId")
                .onRef("l.companyId", "=", "p.companyId")
            )
            .select("p.id")
            .whereRef("l.rentalAgreementId", "=", "ra.id")
            .whereRef("l.companyId", "=", "ra.companyId")
            .where("p.status", "=", "Pending")
            .where("p.dueOn", "<=", asOf)
        ),
        eb.exists(
          eb
            .selectFrom("rentalAgreementCharge as c")
            .innerJoin("rentalAgreementLine as l", (join) =>
              join
                .onRef("l.id", "=", "c.rentalAgreementLineId")
                .onRef("l.companyId", "=", "c.companyId")
            )
            .select("c.id")
            .whereRef("l.rentalAgreementId", "=", "ra.id")
            .whereRef("l.companyId", "=", "ra.companyId")
            .where("c.salesInvoiceLineId", "is", null)
            .where("c.chargeDate", "<=", asOf)
        )
      ])
    )
    .orderBy("ra.rentalAgreementId");
  if (rentalAgreementId) {
    dueQuery = dueQuery.where("ra.id", "=", rentalAgreementId);
  }
  const agreements = await dueQuery.execute();

  const invoiceIds: string[] = [];
  for (const agreement of agreements) {
    const invoiceId = await db
      .transaction()
      .execute((trx) => draftAgreementInvoice(trx, args, agreement.id));
    if (invoiceId) invoiceIds.push(invoiceId);
  }
  return { invoiceIds };
}

async function draftAgreementInvoice(
  trx: KyselyTx,
  args: RentalInvoiceGenerationArgs,
  agreementId: string
): Promise<string | null> {
  const { companyId, asOf, userId } = args;

  const agreement = await trx
    .selectFrom("rentalAgreement")
    .selectAll()
    .where("id", "=", agreementId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Active")
    .forUpdate()
    .executeTakeFirst();
  if (!agreement) return null;

  await rollBillingPeriodsForward(trx, {
    companyId,
    userId,
    asOf,
    agreementId: agreement.id,
    cycle: agreement.billingCycle,
    timing: agreement.billingTiming
  });

  // Locked so a concurrent run (the daily job and a manual "Generate
  // invoices") cannot bill the same period twice.
  const periods = await trx
    .selectFrom("rentalBillingPeriod as p")
    .innerJoin("rentalAgreementLine as l", (join) =>
      join
        .onRef("l.id", "=", "p.rentalAgreementLineId")
        .onRef("l.companyId", "=", "p.companyId")
    )
    .leftJoin("fixedAsset as fa", (join) =>
      join
        .onRef("fa.id", "=", "l.fixedAssetId")
        .onRef("fa.companyId", "=", "l.companyId")
    )
    .select([
      "p.id",
      "p.rentalAgreementLineId",
      // DATE decodes to a JS Date through pg; the text form is what the
      // description prints and the service dates store.
      sql<string>`p."periodStart"::text`.as("periodStart"),
      sql<string>`p."periodEnd"::text`.as("periodEnd"),
      "p.days",
      "p.amount",
      "p.rateUnitApplied",
      "p.isAdjustment",
      "fa.name as assetName",
      "fa.serialNumber"
    ])
    .where("l.rentalAgreementId", "=", agreement.id)
    .where("p.companyId", "=", companyId)
    .where("p.status", "=", "Pending")
    .where("p.dueOn", "<=", asOf)
    .orderBy("p.periodStart")
    .orderBy("p.isAdjustment")
    .forUpdate("p")
    .execute();

  const charges = await trx
    .selectFrom("rentalAgreementCharge as c")
    .innerJoin("rentalAgreementLine as l", (join) =>
      join
        .onRef("l.id", "=", "c.rentalAgreementLineId")
        .onRef("l.companyId", "=", "c.companyId")
    )
    .select([
      "c.id",
      "c.rentalAgreementLineId",
      "c.kind",
      "c.description",
      "c.amount",
      "c.taxPercent"
    ])
    .where("l.rentalAgreementId", "=", agreement.id)
    .where("c.companyId", "=", companyId)
    .where("c.salesInvoiceLineId", "is", null)
    .where("c.chargeDate", "<=", asOf)
    .orderBy("c.chargeDate")
    .forUpdate("c")
    .execute();

  if (periods.length === 0 && charges.length === 0) return null;

  type LineValues = {
    rentalAgreementLineId: string;
    rentalBillingPeriodId: string | null;
    rentalAgreementChargeId: string | null;
    rentalInvoiceLineKind: Database["public"]["Enums"]["rentalInvoiceLineKind"];
    description: string;
    unitPrice: number;
    taxPercent: number;
    serviceStartDate: string | null;
    serviceEndDate: string | null;
  };

  const lines: LineValues[] = [
    ...periods.map((period) => ({
      rentalAgreementLineId: period.rentalAgreementLineId,
      rentalBillingPeriodId: period.id,
      rentalAgreementChargeId: null,
      rentalInvoiceLineKind: "Rent" as const,
      description: rentLineDescription({
        ...period,
        cycle: agreement.billingCycle
      }),
      unitPrice: Number(period.amount),
      taxPercent: Number(agreement.taxPercent),
      serviceStartDate: period.periodStart,
      serviceEndDate: period.periodEnd
    })),
    ...charges.map((charge) => ({
      rentalAgreementLineId: charge.rentalAgreementLineId,
      rentalBillingPeriodId: null,
      rentalAgreementChargeId: charge.id,
      rentalInvoiceLineKind: charge.kind,
      description: charge.description,
      unitPrice: Number(charge.amount),
      taxPercent: Number(charge.taxPercent),
      serviceStartDate: null,
      serviceEndDate: null
    }))
  ];

  const subtotal = round(lines.reduce((sum, line) => sum + line.unitPrice, 0));
  const totalTax = round(
    lines.reduce((sum, line) => sum + line.unitPrice * line.taxPercent, 0)
  );

  const readableInvoiceId = await getNextSequence(
    trx,
    "salesInvoice",
    companyId
  );
  const invoice = await trx
    .insertInto("salesInvoice")
    .values({
      invoiceId: readableInvoiceId,
      status: "Draft",
      customerId: agreement.customerId,
      invoiceCustomerId: agreement.customerId,
      invoiceCustomerContactId: agreement.customerContactId,
      invoiceCustomerLocationId: agreement.customerLocationId,
      locationId: agreement.locationId,
      paymentTermId: agreement.paymentTermId,
      currencyCode: agreement.currencyCode,
      exchangeRate: agreement.exchangeRate,
      dateIssued: asOf,
      subtotal,
      totalDiscount: 0,
      totalTax,
      totalAmount: round(subtotal + totalTax),
      opportunityId: null,
      companyId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("salesInvoiceShipment")
    .values({
      id: invoice.id,
      locationId: agreement.locationId,
      shippingCost: 0,
      companyId,
      createdBy: userId
    })
    .execute();

  await trx
    .insertInto("salesInvoiceLine")
    .values(
      lines.map((line, index) => ({
        invoiceId: invoice.id,
        invoiceLineType: "Rental" as const,
        rentalAgreementId: agreement.id,
        ...line,
        quantity: 1,
        // NOT NULL with a default — stated, never left to the default.
        methodType: "Pull from Inventory" as const,
        unitOfMeasureCode: "EA",
        exchangeRate: agreement.exchangeRate,
        locationId: agreement.locationId,
        sortOrder: index + 1,
        companyId,
        createdBy: userId
      }))
    )
    .execute();

  // Stamp what was billed with the line that billed it.
  await trx
    .updateTable("rentalBillingPeriod as p")
    .from("salesInvoiceLine as sil")
    .set({
      status: "Invoiced",
      salesInvoiceLineId: sql`sil.id`,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .whereRef("sil.rentalBillingPeriodId", "=", "p.id")
    .whereRef("sil.companyId", "=", "p.companyId")
    .where("sil.invoiceId", "=", invoice.id)
    .where("p.companyId", "=", companyId)
    .execute();

  await trx
    .updateTable("rentalAgreementCharge as c")
    .from("salesInvoiceLine as sil")
    .set({
      salesInvoiceLineId: sql`sil.id`,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .whereRef("sil.rentalAgreementChargeId", "=", "c.id")
    .whereRef("sil.companyId", "=", "c.companyId")
    .where("sil.invoiceId", "=", invoice.id)
    .where("c.companyId", "=", companyId)
    .execute();

  return invoice.id;
}

/**
 * Cuts the periods every live (Pending / On Rent) line of the agreement is
 * missing up to `billingHorizon(asOf)`, from the line's activation snapshot.
 * A fixed term was generated in full at activation, so this only adds the
 * rolling period of an open-ended line or a holdover period past the end
 * date. Existing rows are never touched — returns re-cut through the edge
 * function. Sales-type lines never roll: their term is fixed at activation.
 */
async function rollBillingPeriodsForward(
  trx: KyselyTx,
  args: {
    companyId: string;
    userId: string;
    asOf: string;
    agreementId: string;
    cycle: Database["public"]["Enums"]["rentalBillingCycle"];
    timing: Database["public"]["Enums"]["rentalBillingTiming"];
  }
): Promise<void> {
  const { companyId, userId, asOf, agreementId, cycle, timing } = args;

  const dates = await trx
    .selectFrom("rentalAgreement")
    .select([
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string | null>`"endDate"::text`.as("endDate")
    ])
    .where("id", "=", agreementId)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  const lines = await trx
    .selectFrom("rentalAgreementLine")
    .select(["id", "rateMode", "rateUnit", "dayRate", "weekRate", "monthRate"])
    .where("rentalAgreementId", "=", agreementId)
    .where("companyId", "=", companyId)
    .where("status", "in", ["Pending", "On Rent"])
    // A sales-type lease's whole term was cut at activation and its payments
    // run down Net Investment in Leases; a holdover period past the end date
    // has no place on that schedule, so only operating lines roll forward.
    .where((eb) =>
      eb.or([
        eb("lessorClassification", "is", null),
        eb("lessorClassification", "=", "Operating")
      ])
    )
    .forUpdate()
    .execute();
  if (lines.length === 0) return;

  const existing = await trx
    .selectFrom("rentalBillingPeriod")
    .select([
      "rentalAgreementLineId",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      "amount",
      "status",
      "isAdjustment"
    ])
    .where("companyId", "=", companyId)
    .where(
      "rentalAgreementLineId",
      "in",
      lines.map((line) => line.id)
    )
    .execute();

  const through = billingHorizon(cycle, asOf);
  const rows = lines.flatMap((line) => {
    const { create } = generateRentalBillingPeriods({
      cycle,
      timing,
      rateMode: line.rateMode,
      rateUnit: line.rateUnit,
      rates: {
        dayRate: line.dayRate === null ? null : Number(line.dayRate),
        weekRate: line.weekRate === null ? null : Number(line.weekRate),
        monthRate: line.monthRate === null ? null : Number(line.monthRate)
      },
      startDate: dates.startDate,
      endDate: dates.endDate,
      returnedAt: null,
      through,
      existing: existing
        .filter((row) => row.rentalAgreementLineId === line.id)
        .map((row) => ({
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          amount: Number(row.amount),
          status: row.status,
          isAdjustment: row.isAdjustment
        }))
    });
    return create.map((spec) => ({
      rentalAgreementLineId: line.id,
      periodStart: spec.periodStart,
      periodEnd: spec.periodEnd,
      days: spec.days,
      amount: spec.amount,
      rateUnitApplied: spec.rateUnitApplied,
      isAdjustment: false,
      dueOn: spec.dueOn,
      status: "Pending" as const,
      companyId,
      createdBy: userId
    }));
  });

  if (rows.length > 0) {
    await trx.insertInto("rentalBillingPeriod").values(rows).execute();
  }
}

/** "2026-10-01 – 2026-10-28 · 28 days · 1 × Month rate — Skid Steer 4
 *  SN-1001" (a 28 Days cycle), "… · 31 days · Month rate — …" (a Calendar
 *  Month period is the month tier prorated by days, so it names no unit
 *  count), or for an early-return credit "Early return credit — 3 days used". */
function rentLineDescription(period: {
  cycle: Database["public"]["Enums"]["rentalBillingCycle"];
  periodStart: string;
  periodEnd: string;
  days: number;
  rateUnitApplied: RateUnit | null;
  isAdjustment: boolean;
  assetName: string | null;
  serialNumber: string | null;
}): string {
  const unit = [period.assetName, period.serialNumber]
    .filter(Boolean)
    .join(" ");
  if (period.isAdjustment) {
    return `Early return credit — ${period.days} days used${unit ? ` — ${unit}` : ""}`;
  }
  const tier =
    period.rateUnitApplied === null
      ? ""
      : period.cycle === "Calendar Month"
        ? " · Month rate"
        : ` · ${wholeRateUnits(period.days, period.rateUnitApplied)} × ${period.rateUnitApplied} rate`;
  return `${period.periodStart} – ${period.periodEnd} · ${period.days} days${tier}${unit ? ` — ${unit}` : ""}`;
}

/**
 * Releases the billing periods and charges a Draft invoice (or some of its
 * lines) billed, so the next generation bills them again. Called in the same
 * transaction as the delete: `salesInvoiceLineId` has no foreign key, so a
 * delete alone would leave the rows stamped as billed by a line that no
 * longer exists.
 */
export async function releaseRentalInvoiceStamps(
  trx: KyselyTx,
  args: { companyId: string; salesInvoiceLineIds: string[]; userId: string }
): Promise<void> {
  const { companyId, salesInvoiceLineIds, userId } = args;
  if (salesInvoiceLineIds.length === 0) return;

  await trx
    .updateTable("rentalBillingPeriod")
    .set({
      status: "Pending",
      salesInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
    .execute();

  await trx
    .updateTable("rentalAgreementCharge")
    .set({
      salesInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
    .execute();
}
