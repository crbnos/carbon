// The SIBLING, not "@carbon/form" and not the ~/components/Form barrel: the
// barrel imports this file, so taking it from there would be a cycle, and taking
// it from @carbon/form would skip the company's trailing-zero preference — which
// is exactly what left Tax Amount padded while the Shipping field beside it
// wasn't. Any currency field must come from ./CurrencyNumber.

import type { TaxPair } from "@carbon/utils";
import {
  INPUT_FORMAT,
  INPUT_STEP,
  taxableBase,
  taxPairFromAmount,
  taxPairFromPercent
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { NumberControlled } from "./CurrencyNumber";

type UseTaxPairArgs = {
  /** The three terms of the canonical base. Read them off your state — field
   *  names differ per document, so this hook never guesses at keys. */
  unitPrice: number;
  quantity: number;
  shippingCost: number;
  percent: number;
  amount: number;
  currency: string;
  /** currency.decimalPlaces — data from the route, never a literal */
  currencyDecimals: number;
  onChange: (next: TaxPair) => void;
};

/** What the hook hands to the fields: the pair, the base it was derived
 *  against, and the currency it renders in. The three base TERMS stay with the
 *  caller — only their canonical combination travels. */
export type TaxPairControl = TaxPair & {
  subtotal: number;
  currency: string;
  currencyDecimals: number;
  onChange: (next: TaxPair) => void;
};

/**
 * Owns one document line's tax pair: the canonical base, and the re-derivation
 * that keeps the amount honest when that base moves.
 *
 * The base is derived during render rather than mirrored into state — it is a
 * function of values the caller already holds, so storing it could only let the
 * two drift. The single effect exists for the one thing render cannot express:
 * re-deriving the AMOUNT when the base changes, while skipping the first run so
 * a saved line's manual amount override survives being reopened.
 *
 * Spread the result straight into <TaxFields>; it carries everything that
 * component needs except the two form-field names.
 */
export function useTaxPair({
  unitPrice,
  quantity,
  shippingCost,
  percent,
  amount,
  currency,
  currencyDecimals,
  onChange
}: UseTaxPairArgs): TaxPairControl {
  const subtotal = taxableBase(unitPrice, quantity, shippingCost);

  const isMounted = useRef(false);
  // In a ref so an inline closure doesn't re-fire the effect every render.
  // React 18 has no useEffectEvent; this is its stand-in.
  const latestOnChange = useRef(onChange);
  useEffect(() => {
    latestOnChange.current = onChange;
  });

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    // A base this can't evaluate is never a reason to destroy the stored pair:
    // a NaN amount serializes to "" and saves as 0, leaving a 6.25% line with no
    // tax. taxableBase already guards each term, so this should not fire — it is
    // what makes "never write a non-finite amount" true by construction.
    if (percent !== 0 && Number.isFinite(subtotal)) {
      latestOnChange.current(
        taxPairFromPercent(subtotal, percent, currencyDecimals)
      );
    }
  }, [subtotal, percent, currencyDecimals]);

  return {
    subtotal,
    percent,
    amount,
    currency,
    currencyDecimals,
    onChange
  };
}

type TaxFieldsProps = TaxPairControl & {
  /** Form field name for the stored rate, e.g. "taxPercent" */
  percentName: string;
  /** Form field name for the stored amount, e.g. "supplierTaxAmount". Kept
   *  independent of the state key — purchase invoices store `taxAmount` but
   *  submit `supplierTaxAmount`. */
  amountName: string;
  isReadOnly?: boolean;
};

/**
 * The tax value pair: one rate, one absolute amount. Every edit sets both, in
 * either direction. Controlled and stateless — the base and its re-derivation
 * belong to useTaxPair.
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
          onChange(taxPairFromAmount(subtotal, value, percent))
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
          onChange(taxPairFromPercent(subtotal, value, currencyDecimals))
        }
      />
    </>
  );
}
