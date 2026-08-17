import { applyRate, deriveRate } from "./precision";

/** An EMPTIED number input commits NaN, not 0 — that is react-aria's empty
 *  state (`if (!newInputValue.length) setNumberValue(NaN)`). For a cost
 *  component, empty means zero, and it has to be read that way BEFORE the sum:
 *  once one NaN is in, `unitPrice * qty + NaN` is NaN and nothing downstream can
 *  recover the other terms. */
const finiteOrZero = (value: number) => (Number.isFinite(value) ? value : 0);

/**
 * The canonical tax denominator — `unitPrice × qty + shippingCost`. One named
 * function so every document computes the base the same way, and so clearing a
 * cost field cannot poison it: clearing Shipping on a 300.00 line re-derives the
 * tax against 300, which is what the user asked for, rather than against NaN.
 *
 * Paths with no shipping term pass 0 explicitly rather than omitting it, so the
 * omission reads as a decision instead of an oversight.
 */
export function taxableBase(
  unitPrice: number,
  quantity: number,
  shippingCost: number
): number {
  return (
    finiteOrZero(unitPrice) * finiteOrZero(quantity) +
    finiteOrZero(shippingCost)
  );
}

export type TaxPair = { percent: number; amount: number };

/**
 * The tax value pair, one direction each. These two functions ARE the coupling —
 * every consumer goes through them, including the ones that cannot use the
 * TaxFields component (a pricing table holds one pair per quantity break, so it
 * cannot call a hook per row, and the server paths have no React at all).
 *
 * Precision only flows cleanly one way: an amount derived from a rate is exact
 * at the currency's decimals, but a rate derived back from a cents-rounded
 * amount is limited by that amount's scale — entering $0.56 on a $9.00 line
 * yields 6.222%, not 6.25%. Type the rate when the rate is what you mean.
 */
export function taxPairFromPercent(
  subtotal: number,
  percent: number,
  currencyDecimals: number
): TaxPair {
  return { percent, amount: applyRate(subtotal, percent, currencyDecimals) };
}

/** No base to divide by -> keep the rate the caller already holds, rather than
 *  zeroing it. `deriveRate` rounds to internal scale, so the stored rate is what
 *  the input renders back. */
export function taxPairFromAmount(
  subtotal: number,
  amount: number,
  currentPercent: number
): TaxPair {
  return {
    percent: subtotal > 0 ? deriveRate(amount, subtotal) : currentPercent,
    amount
  };
}
