// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How one rental agreement's due lines become invoices under invoice
// automation: which invoices to draft and which of them a person must review
// before they are posted. Pure, so the generator and its tests agree.
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part II

import type { Database } from "@carbon/database";

export type InvoiceAutomation =
  Database["public"]["Enums"]["invoiceAutomation"];

export const RENTAL_HOLD_CHARGES = "Charges are reviewed before posting";
export const RENTAL_HOLD_EARLY_RETURN = "Includes an early-return credit";
/** readableIds: distinct readable ids of the voided invoices, in first-seen order. */
export const rentalHoldRebill = (readableIds: string[]) =>
  `Re-billing ${readableIds.join(", ")}, which ${
    readableIds.length === 1 ? "was" : "were"
  } voided`;

export type PlannableLine<T> = {
  item: T;
  lineType: "Rent" | "Charge" | "Purchase Option";
  isAdjustment: boolean;
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
 * - Draft Only → one combined invoice, no hold (nothing is automated).
 * - Otherwise → a rent invoice and a charges invoice (Charge + Purchase
 *   Option, always held: a person confirms damage and buy-outs).
 * Rent hold precedence: re-bill of a voided invoice > early-return adjustment.
 * Empty invoices are omitted. Line order inside each invoice is the input order.
 */
export function planRentalInvoices<T>(
  mode: InvoiceAutomation,
  lines: PlannableLine<T>[]
): PlannedInvoice<T>[] {
  if (lines.length === 0) return [];

  if (mode === "Draft Only") {
    return [
      { lines: lines.map((l) => l.item), holdReason: null, role: "combined" }
    ];
  }

  const rent = lines.filter((l) => l.lineType === "Rent");
  const charges = lines.filter((l) => l.lineType !== "Rent");
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
