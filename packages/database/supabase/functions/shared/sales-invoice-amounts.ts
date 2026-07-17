/**
 * Pure amount math for a single posted sales invoice line.
 *
 * The GL credit side of a sales invoice is split between revenue and the sales
 * tax liability, but the invoice total (and therefore the AR debit) must not
 * move. `totalAmount` reproduces the historical `totalLineCostWithWeightedShipping`
 * expression exactly, and `taxAmount` is derived from it by subtraction so that
 * `revenueAmount + taxAmount === totalAmount` holds in floating point — a journal
 * that balances to the cent is worth more than a tax line rounded independently.
 */
export interface SalesInvoiceLineAmountInput {
  quantity: number;
  unitPrice?: number | null;
  /** Line-level shipping — part of the tax basis. */
  shippingCost?: number | null;
  addOnCost?: number | null;
  /** Excluded from the tax basis, but part of the invoice total. */
  nonTaxableAddOnCost?: number | null;
  /** Fractional rate, e.g. 0.07 for 7%. */
  taxPercent?: number | null;
  /** This line's share of untaxed header shipping, in invoice currency. */
  weightedHeaderShipping?: number | null;
  /** Invoice currency -> base currency. */
  exchangeRate?: number | null;
}

export interface SalesInvoiceLineAmounts {
  /** Pre-tax revenue + nonTaxableAddOnCost + weighted header shipping, in base currency. */
  revenueAmount: number;
  /** Sales tax collected, in base currency. Zero when taxPercent is zero. */
  taxAmount: number;
  /** The line's contribution to the invoice total (the AR debit), in base currency. */
  totalAmount: number;
}

/** The basis sales tax is charged on: quantity * unitPrice + line shipping + add-ons. */
export function getPreTaxLineCost(input: SalesInvoiceLineAmountInput): number {
  return (
    input.quantity * (input.unitPrice ?? 0) +
    (input.shippingCost ?? 0) +
    (input.addOnCost ?? 0)
  );
}

export function getSalesInvoiceLineAmounts(
  input: SalesInvoiceLineAmountInput
): SalesInvoiceLineAmounts {
  const exchangeRate = input.exchangeRate ?? 1;
  const preTaxLineCost = getPreTaxLineCost(input);
  const nonTaxableAddOnCost = input.nonTaxableAddOnCost ?? 0;
  const weightedHeaderShipping = input.weightedHeaderShipping ?? 0;

  const totalLineCost =
    preTaxLineCost * (1 + (input.taxPercent ?? 0)) + nonTaxableAddOnCost;

  const totalAmount = (totalLineCost + weightedHeaderShipping) * exchangeRate;
  const revenueAmount =
    (preTaxLineCost + nonTaxableAddOnCost + weightedHeaderShipping) *
    exchangeRate;

  return {
    revenueAmount,
    taxAmount: totalAmount - revenueAmount,
    totalAmount,
  };
}
