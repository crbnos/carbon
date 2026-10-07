// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Rental invoice generation — shared by the ERP "Invoice" / "Sell to
// Customer" actions and the daily recurring-billing job, so a human and the
// scheduler bill exactly the same periods. Posting stays with
// post-sales-invoice (and invoice automation): this only drafts invoices.
// Spec: .ai/specs/implemented/2026-09-22-revenue-recognition-and-rentals.md §3

import type { Database } from "@carbon/database";
import { toBaseAmount } from "@carbon/database/accounting-currency";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { getNextSequence } from "@carbon/database/sequence";
import {
  billingHorizon,
  effectiveInvoiceAutomation,
  generateRentalBillingPeriods,
  type InvoiceAutomation,
  planRentalInvoices,
  round,
  wholeRateUnits
} from "@carbon/utils";
import { type Selectable, sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";

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

/** One invoice the generator drafted, and what automation may do with it. */
export type DraftedRentalInvoice = {
  invoiceId: string;
  rentalAgreementId: string;
  /** The agreement's effective invoice automation. */
  mode: InvoiceAutomation;
  /** Set when a person must review the draft before it is posted. */
  holdReason: string | null;
};

export type RentalInvoiceGenerationFailure = {
  rentalAgreementId: string;
  error: string;
};

export type RentalInvoiceGenerationResult = {
  invoices: DraftedRentalInvoice[];
  /** `invoices.map(i => i.invoiceId)`. */
  invoiceIds: string[];
  /** Agreements whose transaction rolled back; their rows stay unbilled. */
  failures: RentalInvoiceGenerationFailure[];
};

/**
 * Drafts the sales invoices of every Active agreement that has something due: every
 * Pending billing period with `dueOn <= asOf` and every unbilled charge dated
 * on or before `asOf`. First it rolls every live line's periods forward to
 * `billingHorizon(asOf)` — activation only cuts periods to one cycle ahead,
 * so an open-ended or held-over line gets its next period here. A Closed
 * agreement is billed too while it has Pending periods or unbilled charges —
 * voiding one of its invoices returns its rows to unbilled, and closing
 * required none — but it never rolls forward. Each agreement is its own transaction, so one
 * agreement's failure never rolls back another's invoice. The billed rows are
 * stamped with their invoice line, which is what makes a second call for the
 * same day a no-op; deleting the Draft invoice releases them
 * (the ERP's `releaseRentalInvoiceStamps`). Under invoice automation an agreement's
 * rent and its charges become separate invoices (`planRentalInvoices`).
 */
async function createRentalInvoicesForDuePeriods(
  db: Kysely<KyselyDatabase>,
  args: RentalInvoiceGenerationArgs
): Promise<RentalInvoiceGenerationResult> {
  const { companyId, asOf, rentalAgreementId } = args;

  // One read for every agreement with anything due; the per-agreement
  // transaction below re-reads its own rows under lock.
  let dueQuery = db
    .selectFrom("rentalAgreement as ra")
    .select("ra.id")
    .where("ra.companyId", "=", companyId)
    .where("ra.status", "in", BILLABLE_STATUSES)
    .where((eb) =>
      eb.or([
        // A live line of an Active agreement may need its next period cut
        // before anything is due.
        eb.and([
          eb("ra.status", "=", "Active"),
          eb.exists(
            eb
              .selectFrom("rentalAgreementLine as l")
              .select("l.id")
              .whereRef("l.rentalAgreementId", "=", "ra.id")
              .whereRef("l.companyId", "=", "ra.companyId")
              .where("l.status", "in", ["Pending", "On Rent"])
          )
        ]),
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

  // One agreement's failure never stops the others: what earlier agreements
  // committed is returned (so automation still runs over it) next to the
  // failures, rather than lost behind a throw.
  const invoices: DraftedRentalInvoice[] = [];
  const failures: RentalInvoiceGenerationFailure[] = [];
  if (agreements.length === 0) {
    return { invoices, invoiceIds: [], failures };
  }

  // The company default every agreement without its own automation follows;
  // one read for the whole run.
  const settings = await db
    .selectFrom("companySettings")
    .select("invoiceAutomation")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();

  for (const agreement of agreements) {
    try {
      const drafted = await db
        .transaction()
        .execute((trx) =>
          draftAgreementInvoices(
            trx,
            args,
            agreement.id,
            settings.invoiceAutomation
          )
        );
      invoices.push(...drafted);
    } catch (error) {
      failures.push({
        rentalAgreementId: agreement.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { invoices, invoiceIds: invoices.map((i) => i.invoiceId), failures };
}

type AgreementRow = Selectable<KyselyDatabase["rentalAgreement"]>;

/** Statuses with something left to bill: an Active agreement, and a Closed
 *  one whose voided invoice returned rows to unbilled. */
const BILLABLE_STATUSES: Database["public"]["Enums"]["rentalAgreementStatus"][] =
  ["Active", "Closed"];

type LineValues = {
  rentalAgreementLineId: string;
  rentalBillingPeriodId: string | null;
  rentalAgreementChargeId: string | null;
  rentalLineType: Database["public"]["Enums"]["rentalInvoiceLineType"];
  description: string;
  unitPrice: number;
  taxPercent: number;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
};

async function draftAgreementInvoices(
  trx: KyselyTx,
  args: RentalInvoiceGenerationArgs,
  agreementId: string,
  companyInvoiceAutomation: InvoiceAutomation
): Promise<DraftedRentalInvoice[]> {
  const { companyId, asOf, userId } = args;

  const agreement = await trx
    .selectFrom("rentalAgreement")
    .selectAll()
    .where("id", "=", agreementId)
    .where("companyId", "=", companyId)
    .where("status", "in", BILLABLE_STATUSES)
    .forUpdate()
    .executeTakeFirst();
  if (!agreement) return [];

  const mode = effectiveInvoiceAutomation(
    agreement.invoiceAutomation,
    companyInvoiceAutomation
  );

  // A Closed agreement only bills what a void returned to unbilled; it has
  // no live line to cut a new period for.
  if (agreement.status === "Active") {
    await rollBillingPeriodsForward(trx, {
      companyId,
      userId,
      asOf,
      agreementId: agreement.id,
      cycle: agreement.billingCycle,
      timing: agreement.billingTiming
    });
  }

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
      "p.periodStart",
      "p.periodEnd",
      "p.days",
      "p.amount",
      "p.rateUnitApplied",
      "p.isAdjustment",
      "p.voidedSalesInvoiceId",
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
      "c.chargeType",
      "c.description",
      "c.amount",
      "c.taxPercent",
      "c.voidedSalesInvoiceId"
    ])
    .where("l.rentalAgreementId", "=", agreement.id)
    .where("c.companyId", "=", companyId)
    .where("c.salesInvoiceLineId", "is", null)
    .where("c.chargeDate", "<=", asOf)
    .orderBy("c.chargeDate")
    .forUpdate("c")
    .execute();

  if (periods.length === 0 && charges.length === 0) return [];

  // The readable ids of the voided invoices these rows were billed on, so a
  // re-bill's hold names them. One read; a deleted invoice keeps its raw id.
  const voidedIds = [
    ...new Set(
      [...periods, ...charges]
        .map((row) => row.voidedSalesInvoiceId)
        .filter((voidedId): voidedId is string => !!voidedId)
    )
  ];
  const voidedReadableIds = new Map<string, string>();
  if (voidedIds.length > 0) {
    const voided = await trx
      .selectFrom("salesInvoice")
      .select(["id", "invoiceId"])
      .where("companyId", "=", companyId)
      .where("id", "in", voidedIds)
      .execute();
    for (const invoice of voided) {
      voidedReadableIds.set(invoice.id, invoice.invoiceId);
    }
  }
  const voidedReadableId = (voidedId: string | null) =>
    voidedId ? (voidedReadableIds.get(voidedId) ?? voidedId) : null;

  // Periods and charges are priced in the agreement's currency;
  // `salesInvoiceLine.unitPrice` is base currency (`convertedUnitPrice` =
  // unitPrice × exchangeRate is what the customer sees), as on every sales
  // document.
  const exchangeRate = Number(agreement.exchangeRate);
  const lines: {
    values: LineValues;
    isAdjustment: boolean;
    voidedInvoiceReadableId: string | null;
  }[] = [
    ...periods.map((period) => ({
      values: {
        rentalAgreementLineId: period.rentalAgreementLineId,
        rentalBillingPeriodId: period.id,
        rentalAgreementChargeId: null,
        rentalLineType: "Rent" as const,
        description: rentLineDescription({
          ...period,
          cycle: agreement.billingCycle
        }),
        unitPrice: toBaseAmount(Number(period.amount), exchangeRate),
        taxPercent: Number(agreement.taxPercent),
        serviceStartDate: period.periodStart,
        serviceEndDate: period.periodEnd
      },
      isAdjustment: period.isAdjustment ?? false,
      voidedInvoiceReadableId: voidedReadableId(period.voidedSalesInvoiceId)
    })),
    ...charges.map((charge) => ({
      values: {
        rentalAgreementLineId: charge.rentalAgreementLineId,
        rentalBillingPeriodId: null,
        rentalAgreementChargeId: charge.id,
        rentalLineType: charge.chargeType,
        description: charge.description,
        unitPrice: toBaseAmount(Number(charge.amount), exchangeRate),
        taxPercent: Number(charge.taxPercent),
        serviceStartDate: null,
        serviceEndDate: null
      },
      isAdjustment: false,
      voidedInvoiceReadableId: voidedReadableId(charge.voidedSalesInvoiceId)
    }))
  ];

  const planned = planRentalInvoices(
    mode,
    lines.map((line) => ({
      item: line.values,
      lineType: line.values.rentalLineType,
      isAdjustment: line.isAdjustment,
      voidedInvoiceReadableId: line.voidedInvoiceReadableId
    }))
  );

  const drafted: DraftedRentalInvoice[] = [];
  for (const invoice of planned) {
    const invoiceId = await insertRentalInvoice(
      trx,
      args,
      agreement,
      invoice.lines,
      invoice.holdReason
    );
    drafted.push({
      invoiceId,
      rentalAgreementId: agreement.id,
      mode,
      holdReason: invoice.holdReason
    });
  }
  return drafted;
}

/**
 * Inserts one Draft rental invoice (opportunity, header, shipment, lines) and
 * stamps the periods and charges it bills with their invoice line. Returns
 * the invoice id.
 */
async function insertRentalInvoice(
  trx: KyselyTx,
  args: RentalInvoiceGenerationArgs,
  agreement: AgreementRow,
  lines: LineValues[],
  holdReason: string | null
): Promise<string> {
  const { companyId, asOf, userId } = args;

  const subtotal = round(lines.reduce((sum, line) => sum + line.unitPrice, 0));
  const totalTax = round(
    lines.reduce((sum, line) => sum + line.unitPrice * line.taxPercent, 0)
  );

  const readableInvoiceId = await getNextSequence(
    trx,
    "salesInvoice",
    companyId
  );
  // Every sales invoice has an opportunity, as insertSalesInvoice makes one:
  // its documents live under the opportunity's storage folder, and the
  // invoice page reads it.
  const opportunity = await trx
    .insertInto("opportunity")
    .values({ companyId, customerId: agreement.customerId })
    .returning(["id"])
    .executeTakeFirstOrThrow();
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
      opportunityId: opportunity.id,
      automationHoldReason: holdReason,
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
      // The agreement's Rental Site is where the units go: the ship-to.
      customerLocationId: agreement.customerLocationId,
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
    .select(["id", "rateUnit", "rate"])
    .where("rentalAgreementId", "=", agreementId)
    .where("companyId", "=", companyId)
    .where("status", "in", ["Pending", "On Rent"])
    // A sales-type lease's whole term was cut at activation and its payments
    // run down Net Investment in Leases; a holdover period past the end date
    // has no place on that schedule, so only operating lines roll forward.
    .where((eb) =>
      eb.or([
        eb("lessorClassification", "is", null),
        eb("lessorClassification", "=", "Rental")
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
      rateUnit: line.rateUnit,
      rate: Number(line.rate),
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
 *  SN-1001", "… · 31 days · Month rate — …" (a Monthly unit on a Calendar
 *  Month agreement is its month rate prorated by days, so it names no unit
 *  count), or for an early-return credit "Early return credit — 3 days used". */
export function rentLineDescription(period: {
  cycle: Database["public"]["Enums"]["rentalBillingCycle"];
  periodStart: string;
  periodEnd: string;
  days: number;
  rateUnitApplied: RateUnit | null;
  isAdjustment: boolean;
  assetName: string | null;
  serialNumber: string | null;
}): string {
  // A unit capitalized from stock is named "<item> <serial>": its serial is
  // named once, not twice.
  const serial =
    period.serialNumber && !period.assetName?.includes(period.serialNumber)
      ? period.serialNumber
      : null;
  const unit = [period.assetName, serial].filter(Boolean).join(" ");
  if (period.isAdjustment) {
    return `Early return credit — ${period.days} days used${unit ? ` — ${unit}` : ""}`;
  }
  const tier =
    period.rateUnitApplied === null
      ? ""
      : period.cycle === "Calendar Month" && period.rateUnitApplied === "Month"
        ? " · Month rate"
        : ` · ${wholeRateUnits(period.days, period.rateUnitApplied)} × ${period.rateUnitApplied} rate`;
  return `${period.periodStart} – ${period.periodEnd} · ${period.days} days${tier}${unit ? ` — ${unit}` : ""}`;
}

export const createRentalInvoicesInput = z.object({
  /** `YYYY-MM-DD` in the company's timezone. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Bill one agreement only. */
  rentalAgreementId: z.string().optional()
});

/** Drafts the rental invoices due on or before `asOf` (see
 *  `createRentalInvoicesForDuePeriods`). An agreement that fails is reported
 *  in `failures`, never thrown, so the others still draft. */
const createRentalInvoices = defineServerFn({
  name: "create-rental-invoices",
  input: createRentalInvoicesInput,
  permissions: { update: "sales", create: "invoicing" },
  async run({ db, companyId, userId }, { asOf, rentalAgreementId }) {
    return createRentalInvoicesForDuePeriods(db, {
      companyId,
      userId,
      asOf,
      rentalAgreementId
    });
  }
});

export default createRentalInvoices;
