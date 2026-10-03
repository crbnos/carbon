// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "./precision.ts";

// The PriceTraceStep shape (apps/erp/app/modules/sales/types.ts): a package
// cannot import app code.
export type PriceTraceStep = {
  step: string;
  source: string;
  amount: number;
  adjustment?: number;
  ruleId?: string;
  label?: string;
};

/**
 * The trace a sales order line converted from a quote carries: the quote
 * break's own trace, then the quote line discount, ending at the net unit
 * price the order line is written with. Null when the break has no trace — a
 * manual price, or one priced before traces were recorded — since nothing
 * explains it.
 */
export function quoteToOrderPriceTrace(
  trace: unknown,
  unitPrice: number,
  netUnitPrice: number,
  discountPercent: number
): PriceTraceStep[] | null {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  const steps = (trace as PriceTraceStep[]).filter(
    (step) => step.step !== "Final Price"
  );
  if (discountPercent > 0) {
    steps.push({
      step: "Discount",
      source: `Quote Discount (${round(discountPercent * 100)}%)`,
      amount: netUnitPrice,
      adjustment: netUnitPrice - unitPrice
    });
  }
  steps.push({ step: "Final Price", source: "Quote", amount: netUnitPrice });
  return steps;
}
