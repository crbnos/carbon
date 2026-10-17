// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TaxLedgerLine } from "@carbon/database/tax-ledger";
import {
  effectiveTaxPercent,
  round,
  SCALE,
  splitLineTax,
  type TaxCodeInput
} from "@carbon/utils";
import type {
  PurchasePostingAmounts,
  PurchasePostingLine
} from "../post-purchase-invoice/purchase-posting-amounts";

type TaxedLine = {
  id: string;
  quantity: number;
  unitPrice: number | null;
  shippingCost: number | null;
  taxAmount: number | null;
  taxCodeId: string | null;
};

/**
 * Each purchase line with its tax split by its code's components (base
 * amounts): the supplier's tax for a Normal code, self-assessed tax for a
 * Reverse Charge code. A line with no code is returned as it is. Shared by
 * the posting and the cutover backfill so both split the same way.
 */
export function withPurchaseTax<T extends TaxedLine>(
  lines: ReadonlyArray<T>,
  taxCodes: ReadonlyMap<string, TaxCodeInput>
): Array<T & Pick<PurchasePostingLine, "taxParts" | "selfAssessedParts">> {
  return lines.map((line) => {
    const code = line.taxCodeId ? taxCodes.get(line.taxCodeId) : undefined;
    if (!code || code.components.length === 0) return line;
    const base =
      line.quantity * (line.unitPrice ?? 0) + (line.shippingCost ?? 0);
    if (code.calculationType === "Reverse Charge") {
      return {
        ...line,
        selfAssessedParts: splitLineTax({
          base,
          lineTax: round(base * effectiveTaxPercent(code.components)),
          components: code.components,
          scale: SCALE
        })
      };
    }
    return {
      ...line,
      taxParts: splitLineTax({
        base,
        lineTax: line.taxAmount ?? 0,
        components: code.components,
        scale: SCALE
      })
    };
  });
}

/** The tax-ledger inputs of a posted purchase invoice, from its amounts. */
export function purchaseTaxLedgerLines(
  lines: ReadonlyArray<
    TaxedLine & { invoiceLineType: string; taxPercent: number | null }
  >,
  amountsByLineId: ReadonlyMap<string, PurchasePostingAmounts>
): TaxLedgerLine[] {
  return lines
    .filter((line) => line.invoiceLineType !== "Comment")
    .map((line) => {
      const amounts = amountsByLineId.get(line.id);
      const legs = amounts?.taxLegs ?? [];
      const selfAssessed = legs.some((leg) => leg.selfAssessed);
      return {
        documentLineId: line.id,
        taxCodeId: line.taxCodeId,
        taxableBase: (amounts?.nominalBaseCost ?? 0) + (line.shippingCost ?? 0),
        components: legs.map((leg) => leg.part),
        taxPercent: line.taxPercent ?? 0,
        taxAmount: selfAssessed
          ? (amounts?.selfAssessedTaxBase ?? 0)
          : (line.taxAmount ?? 0),
        exempt: null
      };
    });
}
