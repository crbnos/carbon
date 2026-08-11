import { NumberControlled } from "@carbon/form";
import { applyRate, INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";

/**
 * Re-derives the tax amount from the stored rate when the line's BASE changes
 * (quantity, unit price, shipping) — the other half of the value pair's rule.
 *
 * Deliberately skips the first run. A saved line arrives with both halves
 * already stored, and a manual amount override is legitimately inconsistent
 * with its rate; recomputing on mount would silently discard that override on
 * screen and write the derived figure back on the next save.
 */
export function useDerivedTaxAmount(
  subtotal: number,
  percent: number,
  currencyDecimals: number,
  onDerive: (amount: number) => void
) {
  const isMounted = useRef(false);
  // Held in a ref so callers can pass an inline closure without the effect
  // re-firing on every render.
  const derive = useRef(onDerive);
  useEffect(() => {
    derive.current = onDerive;
  });

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (percent !== 0) {
      derive.current(applyRate(subtotal, percent, currencyDecimals));
    }
  }, [subtotal, percent, currencyDecimals]);
}

type TaxFieldsProps = {
  /** Form field name for the stored rate, e.g. "taxPercent" */
  percentName: string;
  /** Form field name for the stored amount, e.g. "supplierTaxAmount" */
  amountName: string;
  /** Caller computes: unitPrice * quantity + shippingCost (the canonical denominator) */
  subtotal: number;
  currency: string;
  /** currency.decimalPlaces — data from the route, never a literal */
  currencyDecimals: number;
  percent: number;
  amount: number;
  isReadOnly?: boolean;
  onChange: (next: { percent: number; amount: number }) => void;
};

/**
 * The tax value pair: one rate, one absolute amount — every edit sets BOTH, in
 * either direction, so the stored pair is always internally consistent.
 *
 * The precision only flows cleanly one way. A rate carries more decimals than a
 * settlement amount does, so deriving the rate back from the amount is limited
 * by the amount's scale — 0.56 on a 9.00 subtotal is 6.222%, not the 6.25% that
 * produced it. That is inherent to money having fewer decimals than a rate, and
 * is why the derived rate is rounded to internal scale here.
 *
 * What it is NOT is the old 6.25% → 6.22% corruption: that came from deriving
 * the amount UNROUNDED (0.5625), which the money input then re-committed as a
 * changed value on blur and fed back through the coupling. The amount is now
 * derived through applyRate at the currency's decimals, so blurring the field
 * commits an identical value and triggers nothing.
 *
 * Base-change re-derivation (quantity/price/shipping edits) stays in the
 * caller's useDerivedTaxAmount — this component is controlled and stateless.
 */
export function TaxFields({
  percentName,
  amountName,
  subtotal,
  currency,
  currencyDecimals,
  percent,
  amount,
  isReadOnly,
  onChange
}: TaxFieldsProps) {
  const { t } = useLingui();

  return (
    <>
      <NumberControlled
        name={amountName}
        label={t`Tax Amount`}
        value={amount}
        minValue={0}
        formatOptions={INPUT_FORMAT.money(currency, currencyDecimals)}
        isReadOnly={isReadOnly}
        onChange={(value) =>
          onChange({
            // Rounded to internal scale so the stored rate is exactly what the
            // percent input can render (3 percent-digits); a raw quotient like
            // 0.0622222… would display as one value and store another.
            percent: subtotal > 0 ? round(value / subtotal) : percent,
            amount: value
          })
        }
      />
      <NumberControlled
        name={percentName}
        label={t`Tax Percent`}
        value={percent}
        minValue={0}
        maxValue={1}
        step={INPUT_STEP.rate}
        formatOptions={INPUT_FORMAT.rate}
        isReadOnly={isReadOnly}
        onChange={(value) =>
          onChange({
            percent: value,
            amount: applyRate(subtotal, value, currencyDecimals)
          })
        }
      />
    </>
  );
}
