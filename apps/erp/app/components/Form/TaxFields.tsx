import { NumberControlled } from "@carbon/form";
import { applyRate, deriveRate, INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";

/** An EMPTIED number input commits NaN, not 0 — that is react-aria's empty
 *  state (`if (!newInputValue.length) setNumberValue(NaN)`). For a cost
 *  component, empty means zero, and it has to be read that way BEFORE the sum:
 *  once one NaN is in, `unitPrice * qty + NaN` is NaN and nothing downstream can
 *  recover the other terms. */
const amount = (value: number) => (Number.isFinite(value) ? value : 0);

/**
 * The canonical tax denominator — `unitPrice × qty + shippingCost`. One named
 * function so every document computes the base the same way, and so clearing a
 * cost field cannot poison it: clearing Shipping on a 300.00 line re-derives the
 * tax against 300, which is what the user asked for, rather than against NaN.
 */
export function taxableBase(
  unitPrice: number,
  quantity: number,
  shippingCost: number
) {
  return amount(unitPrice) * amount(quantity) + amount(shippingCost);
}

/**
 * Re-derives the tax amount from the stored rate when the base changes
 * (quantity, unit price, shipping). Skips the first run so a saved line's
 * stored pair — which may hold a manual amount override — is not recomputed
 * on mount.
 */
export function useDerivedTaxAmount(
  subtotal: number,
  percent: number,
  currencyDecimals: number,
  onDerive: (amount: number) => void
) {
  const isMounted = useRef(false);
  // In a ref so an inline closure doesn't re-fire the effect every render.
  const derive = useRef(onDerive);
  useEffect(() => {
    derive.current = onDerive;
  });

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    // A base this can't evaluate is never a reason to destroy the stored pair:
    // a NaN amount serializes to "" and saves as 0, leaving a 6.25% line with no
    // tax. Callers build the base with taxableBase, so this should not fire —
    // it is what makes "never write a non-finite amount" true by construction.
    if (percent !== 0 && Number.isFinite(subtotal)) {
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
 * The tax value pair: one rate, one absolute amount. Every edit sets both, in
 * either direction. Controlled and stateless — base-change re-derivation is the
 * caller's useDerivedTaxAmount.
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
            // deriveRate rounds to internal scale, so the stored rate is what the
            // input renders. No base to divide by -> keep the rate the user typed.
            percent: subtotal > 0 ? deriveRate(value, subtotal) : percent,
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
