// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Which drafted contract invoices a person must review before invoice
// automation posts them. Pure, so the generator and its tests agree.
// Spec: .ai/specs/2026-10-02-contracts.md

import {
  type InvoiceAutomation,
  rentalHoldRebill
} from "./rental-invoice-plan";

export { rentalHoldRebill as recurringHoldRebill } from "./rental-invoice-plan";

export const CONTRACT_HOLD_ADJUSTMENT =
  "Includes a credit for a contract change";

/** The hold for one drafted contract invoice. Draft Only → null (nothing is
 *  automated). Re-bill of a voided invoice (any row with
 *  voidedInvoiceReadableId) wins over a negative adjustment row. */
export function contractInvoiceHold(
  mode: InvoiceAutomation,
  rows: {
    amount: number;
    isAdjustment: boolean;
    voidedInvoiceReadableId: string | null;
  }[]
): string | null {
  if (mode === "Draft Only") return null;

  const voided = [
    ...new Set(
      rows
        .map((row) => row.voidedInvoiceReadableId)
        .filter((id): id is string => !!id)
    )
  ];
  if (voided.length > 0) return rentalHoldRebill(voided);

  return rows.some((row) => row.isAdjustment && row.amount < 0)
    ? CONTRACT_HOLD_ADJUSTMENT
    : null;
}
