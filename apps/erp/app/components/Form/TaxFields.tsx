import { NumberControlled } from "@carbon/form";
import { applyRate, INPUT_FORMAT } from "@carbon/utils";
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
 * The tax value pair: one rate, one absolute amount — any edit sets both.
 * Coupling is one-way: a percent edit derives the amount; an amount edit
 * NEVER rewrites the percent (the old bidirectional coupling let the
 * currency input's cents-rounding blur overwrite a typed 6.25% with
 * amount/subtotal = 6.22%). Base-change re-derivation (quantity/price/
 * shipping edits) stays in the caller's effect — this component is
 * controlled and stateless.
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
        onChange={(value) => onChange({ percent, amount: value })}
      />
      <NumberControlled
        name={percentName}
        label={t`Tax Percent`}
        value={percent}
        minValue={0}
        maxValue={1}
        step={0.0001}
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
