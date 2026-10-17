// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TaxLedgerDocument } from "@carbon/database/tax-ledger";
import {
  type ComponentTax,
  effectiveTaxPercent,
  recoverableTax,
  round,
  SCALE,
  splitLineTax,
  type TaxCodeInput,
  toBaseAmount
} from "@carbon/utils";

/**
 * How a memo's tax posts (spec "Memo tax"). `amount` is the gross on AR or
 * AP and `taxAmount` the tax inside it, both in document currency. A customer
 * memo moves all of the tax through Tax Received; a supplier memo moves only
 * the recoverable share through Tax Paid and leaves the rest in the reason
 * leg; with no code it moves none, as a legacy purchase line folded its tax
 * into cost. Shared by the posting and the pre-cutover rebuild, so both build the
 * same journal.
 */
export function planMemoTax(args: {
  isAR: boolean;
  amount: number;
  taxAmount: number;
  exchangeRate: number;
  decimals: number;
  taxCode: TaxCodeInput | undefined;
}): { netAmount: number; taxToAccount: number; parts: ComponentTax[] } {
  const { isAR, amount, taxAmount, exchangeRate, decimals, taxCode } = args;
  const netAmount = round(amount - taxAmount, decimals);
  const parts =
    taxAmount > 0 && taxCode && taxCode.components.length > 0
      ? splitLineTax({
          base: toBaseAmount(netAmount, exchangeRate),
          lineTax: toBaseAmount(taxAmount, exchangeRate),
          components: taxCode.components,
          scale: SCALE
        })
      : [];
  if (isAR) return { netAmount, taxToAccount: taxAmount, parts };
  // A supplier memo with no code reverses tax a legacy purchase line folded
  // into cost, so it stays in the reason leg, as on that invoice.
  if (parts.length === 0) return { netAmount, taxToAccount: 0, parts };
  const total = parts.reduce((t, p) => t + p.taxAmount, 0);
  return {
    netAmount,
    taxToAccount:
      total === 0
        ? 0
        : round(taxAmount * (recoverableTax(parts) / total), decimals),
    parts
  };
}

/**
 * The tax-ledger input of a memo with tax: one line at its net. A customer
 * credit and a supplier debit reverse tax the invoice recorded, so they
 * write negative; the other two add to it. Shared by the posting and the
 * cutover backfill.
 */
export function memoTaxLedger(args: {
  memo: {
    id: string;
    direction: "Credit" | "Debit";
    currencyCode: string;
    taxCodeId: string | null;
  };
  isAR: boolean;
  partyId: string;
  exchangeRate: number;
  netAmount: number;
  taxAmount: number;
  parts: ComponentTax[];
  taxCode: TaxCodeInput | undefined;
}): TaxLedgerDocument {
  const { memo, isAR, partyId, exchangeRate } = args;
  return {
    source: isAR ? "Sales" : "Purchase",
    documentType: "Memo",
    documentId: memo.id,
    customerId: isAR ? partyId : null,
    supplierId: isAR ? null : partyId,
    currencyCode: memo.currencyCode,
    exchangeRate,
    sign: (memo.direction === "Credit") === isAR ? -1 : 1,
    lines: [
      {
        documentLineId: null,
        taxCodeId: memo.taxCodeId,
        taxableBase: toBaseAmount(args.netAmount, exchangeRate),
        components: args.parts,
        taxPercent: args.taxCode
          ? effectiveTaxPercent(args.taxCode.components)
          : 0,
        taxAmount: toBaseAmount(args.taxAmount, exchangeRate),
        exempt: null
      }
    ]
  };
}
