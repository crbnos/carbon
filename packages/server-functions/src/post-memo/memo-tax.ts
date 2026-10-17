// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type ComponentTax,
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
 * leg. Shared by the posting and the pre-cutover rebuild, so both build the
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
  if (isAR || parts.length === 0) {
    return { netAmount, taxToAccount: taxAmount, parts };
  }
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
