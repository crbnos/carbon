// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How one rental agreement's due lines become invoices under invoice
// automation: which invoices to draft and which of them a person must review
// before they are posted. Pure, so the generator and its tests agree.
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part II

import type { Database } from "@carbon/database";
import { toBaseAmount } from "@carbon/database/accounting-currency";
import { round } from "@carbon/database/precision";
import { wholeRateUnits } from "@carbon/database/rental-periods";
import { formatDate } from "./date";

type Enums = Database["public"]["Enums"];

export type InvoiceAutomation =
  Database["public"]["Enums"]["invoiceAutomation"];

export const RENTAL_HOLD_CHARGES = "Charges are reviewed before posting";
export const RENTAL_HOLD_EARLY_RETURN = "Includes an early-return credit";
/** An invoice drafted ahead of its due dates (the Invoice dialog): a person
 *  posts it, whatever the agreement's mode or who drafted it. */
export const RENTAL_HOLD_EARLY_INVOICE =
  "Created early: review and post it yourself";
/** readableIds: distinct readable ids of the voided invoices, in first-seen order. */
export const rentalHoldRebill = (readableIds: string[]) =>
  `Re-billing ${readableIds.join(", ")}, which ${
    readableIds.length === 1 ? "was" : "were"
  } voided`;

export type PlannableLine<T> = {
  item: T;
  lineType: "Rent" | "Charge" | "Purchase Option";
  isAdjustment: boolean;
  /** A Charge drafted on its own held invoice instead of with the rent. */
  invoiceSeparately: boolean;
  /** Readable id of a voided invoice this row was previously billed on, else null. */
  voidedInvoiceReadableId: string | null;
};

export type PlannedInvoice<T> = {
  lines: T[];
  holdReason: string | null;
  role: "combined" | "rent" | "charges";
};

/**
 * Splits one agreement's due lines into the invoices to draft.
 * - Draft Only and Manual → one combined invoice, no hold (nothing is automated).
 * - Otherwise → a rent invoice, unheld, carrying the rent and every Charge
 *   (alone when no rent is due), and a charges invoice, always held, for
 *   the Charges marked `invoiceSeparately` and every Purchase Option — a
 *   person confirms damage and buy-outs.
 * Rent hold precedence: re-bill of a voided invoice > early-return adjustment.
 * The re-bill check covers every line of the rent invoice, charges included.
 * Empty invoices are omitted. Line order inside each invoice is the input order.
 */
export function planRentalInvoices<T>(
  mode: InvoiceAutomation,
  lines: PlannableLine<T>[]
): PlannedInvoice<T>[] {
  if (lines.length === 0) return [];

  if (!invoiceAutomationPosts(mode)) {
    return [
      { lines: lines.map((l) => l.item), holdReason: null, role: "combined" }
    ];
  }

  const withRent = (l: PlannableLine<T>) =>
    l.lineType === "Rent" || (l.lineType === "Charge" && !l.invoiceSeparately);
  const rent = lines.filter(withRent);
  const charges = lines.filter((l) => !withRent(l));
  const planned: PlannedInvoice<T>[] = [];

  if (rent.length > 0) {
    const voided = [
      ...new Set(
        rent
          .map((l) => l.voidedInvoiceReadableId)
          .filter((id): id is string => !!id)
      )
    ];
    const holdReason =
      voided.length > 0
        ? rentalHoldRebill(voided)
        : rent.some((l) => l.isAdjustment)
          ? RENTAL_HOLD_EARLY_RETURN
          : null;
    planned.push({ lines: rent.map((l) => l.item), holdReason, role: "rent" });
  }

  if (charges.length > 0) {
    planned.push({
      lines: charges.map((l) => l.item),
      holdReason: RENTAL_HOLD_CHARGES,
      role: "charges"
    });
  }

  return planned;
}

/** The mode in force for an agreement: its own override, else the company's. */
export function effectiveInvoiceAutomation(
  agreementMode: InvoiceAutomation | null,
  companyMode: InvoiceAutomation
): InvoiceAutomation {
  return agreementMode ?? companyMode;
}

/** Whether invoices under this mode post (and send) on their own. Draft
 *  Only and Manual leave every invoice a draft that a person posts. */
export function invoiceAutomationPosts(
  mode: InvoiceAutomation | null | undefined
): boolean {
  return !!mode && mode !== "Draft Only" && mode !== "Manual";
}

/** One rental invoice line as drafted: a Rent line per billing period, or a
 *  Charge / Purchase Option line per charge. `unitPrice` is base currency. */
export type RentalInvoiceLineValues = {
  rentalAgreementLineId: string;
  rentalBillingPeriodId: string | null;
  rentalAgreementChargeId: string | null;
  rentalLineType: Enums["rentalInvoiceLineType"];
  description: string;
  unitPrice: number;
  taxPercent: number;
  taxCodeId: string | null;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
};

export type RentalPlanPeriod = {
  id: string;
  rentalAgreementLineId: string;
  periodStart: string;
  periodEnd: string;
  days: number;
  amount: number;
  rateUnitApplied: Enums["rentalRateUnit"] | null;
  isAdjustment: boolean;
  voidedSalesInvoiceId: string | null;
  assetName: string | null;
  serialNumber: string | null;
};

export type RentalPlanCharge = {
  id: string;
  rentalAgreementLineId: string;
  chargeType: Enums["rentalInvoiceLineType"];
  description: string;
  amount: number;
  /** The charge's rate on the invoice date. */
  taxPercent: number;
  taxCodeId: string | null;
  invoiceSeparately: boolean;
  voidedSalesInvoiceId: string | null;
};

/** "Oct 1, 2026 – Oct 28, 2026 · 28 days · 1 × Month rate — Skid Steer 4
 *  SN-1001", "… · 31 days · Month rate — …" (a Monthly unit on a Calendar
 *  Month or Monthly agreement is its month rate prorated by days, so it names
 *  no unit count), or for an early-return credit "Early return credit — 3 days used". */
export function rentLineDescription(period: {
  cycle: Enums["rentalBillingCycle"];
  periodStart: string;
  periodEnd: string;
  days: number;
  rateUnitApplied: Enums["rentalRateUnit"] | null;
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
      : period.cycle !== "28 Days" && period.rateUnitApplied === "Month"
        ? " · Month rate"
        : ` · ${wholeRateUnits(period.days, period.rateUnitApplied)} × ${period.rateUnitApplied} rate`;
  return `${formatDate(period.periodStart)} – ${formatDate(period.periodEnd)} · ${period.days} days${tier}${unit ? ` — ${unit}` : ""}`;
}

/**
 * The invoices one agreement's due rows become: a Rent line per period at the
 * agreement's tax, a line per charge at its own tax, split by
 * `planRentalInvoices`. Early-return adjustments never go on an invoice (a
 * credit could net it below zero); the caller drafts them on a credit memo.
 * Shared by drafting and the Next Invoice preview, so the two cannot differ.
 */
export function planAgreementRentalInvoices(input: {
  billingCycle: Enums["rentalBillingCycle"];
  /** The rent lines' rate on the invoice date, from the agreement's code. */
  taxPercent: number;
  taxCodeId: string | null;
  exchangeRate: number;
  mode: InvoiceAutomation;
  periods: RentalPlanPeriod[];
  charges: RentalPlanCharge[];
  /** Voided invoice id → its readable id, so a re-bill's hold names it. */
  voidedReadableIds: Map<string, string>;
}): PlannedInvoice<RentalInvoiceLineValues>[] {
  const voidedReadableId = (voidedId: string | null) =>
    voidedId ? (input.voidedReadableIds.get(voidedId) ?? voidedId) : null;

  // Periods and charges are priced in the agreement's currency;
  // `salesInvoiceLine.unitPrice` is base currency, as on every sales document.
  const lines: PlannableLine<RentalInvoiceLineValues>[] = [
    ...input.periods
      .filter((period) => !period.isAdjustment)
      .map((period) => ({
        item: {
          rentalAgreementLineId: period.rentalAgreementLineId,
          rentalBillingPeriodId: period.id,
          rentalAgreementChargeId: null,
          rentalLineType: "Rent" as const,
          description: rentLineDescription({
            ...period,
            cycle: input.billingCycle
          }),
          unitPrice: toBaseAmount(period.amount, input.exchangeRate),
          taxPercent: input.taxPercent,
          taxCodeId: input.taxCodeId,
          serviceStartDate: period.periodStart,
          serviceEndDate: period.periodEnd
        },
        lineType: "Rent" as const,
        isAdjustment: false,
        invoiceSeparately: false,
        voidedInvoiceReadableId: voidedReadableId(period.voidedSalesInvoiceId)
      })),
    ...input.charges.map((charge) => ({
      item: {
        rentalAgreementLineId: charge.rentalAgreementLineId,
        rentalBillingPeriodId: null,
        rentalAgreementChargeId: charge.id,
        rentalLineType: charge.chargeType,
        description: charge.description,
        unitPrice: toBaseAmount(charge.amount, input.exchangeRate),
        taxPercent: charge.taxPercent,
        taxCodeId: charge.taxCodeId,
        serviceStartDate: null,
        serviceEndDate: null
      },
      lineType: charge.chargeType,
      isAdjustment: false,
      invoiceSeparately: charge.invoiceSeparately,
      voidedInvoiceReadableId: voidedReadableId(charge.voidedSalesInvoiceId)
    }))
  ];
  return planRentalInvoices(input.mode, lines);
}

/** A rental invoice's header totals, in base currency at the storage scale. */
export function rentalInvoiceTotals(
  lines: Pick<RentalInvoiceLineValues, "unitPrice" | "taxPercent">[]
) {
  const subtotal = round(lines.reduce((sum, line) => sum + line.unitPrice, 0));
  const totalTax = round(
    lines.reduce((sum, line) => sum + line.unitPrice * line.taxPercent, 0)
  );
  return { subtotal, totalTax, totalAmount: round(subtotal + totalTax) };
}
