import { moneyFormatOptions } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import {
  useConfiguredCurrencyDecimals,
  useCurrencyMinDecimals
} from "./useCurrencies";
import { useUser } from "./useUser";

/** Everything a call site is allowed to override, and nothing else.
 *
 * The set is deliberately closed rather than the full `Intl.NumberFormatOptions`:
 * it is what the 71 call sites actually pass, every value is a primitive, and
 * that is what lets the memo below depend on the fields instead of the object.
 * Widening it back to `Intl.NumberFormatOptions` reintroduces the identity
 * problem — add a field here instead. */
export type CurrencyFormatterOptions = {
  currency?: string;
  /** Overrides the configured lookup when the caller already has the row */
  decimalPlaces?: number;
  /** "$1.2M" for dashboard tiles, instead of the full amount. */
  compact?: boolean;
  /** Drop the fraction entirely — a report that deliberately shows whole units.
   *  Combined with `compact` this is "$1M" rather than "$1.2M". */
  wholeUnits?: boolean;
};

/**
 * Currency display — money and per-unit prices alike, because they are the same
 * kind. Digits come from the company group's configured `currency.decimalPlaces`
 * as the maximum. The DB column is authoritative over Intl/CLDR; CLDR only
 * decides when the currency isn't configured for the group (or the list hasn't
 * loaded yet).
 *
 * By default the amount is PADDED to those decimals, so its width states the
 * amount in full: "$300.00", "$3.50", "¥63", "BHD 0.563". A company can drop the
 * non-significant zeros by turning `showCurrencyTrailingZeros` off; that
 * preference is read here once (useCurrencyMinDecimals) rather than at 55 call sites.
 *
 * Callers pick a KIND, never a digit count: `wholeUnits` for a report that shows
 * whole amounts, `compact` for a "$1.2M" dashboard tile.
 */
export function useCurrencyFormatter(options?: CurrencyFormatterOptions) {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = options?.currency ?? baseCurrency;
  const configuredDecimals = useConfiguredCurrencyDecimals(currency);
  const minDecimals = useCurrencyMinDecimals();

  // Every call site passes an object literal, so depending on `options` by
  // identity meant the memo never hit: a new Intl.NumberFormat on every render,
  // and — since the formatter is itself a dep of the `columns` memo in several
  // tables — a full column rebuild with it. Depend on the primitive fields.
  const { decimalPlaces, compact, wholeUnits } = options ?? {};

  return useMemo(() => {
    // `wholeUnits` is a digit count of zero, expressed as the intent rather than
    // the number — this hook names kinds, it does not choose digits.
    const decimals = wholeUnits ? 0 : (decimalPlaces ?? configuredDecimals);
    return new Intl.NumberFormat(locale, {
      ...(decimals != null
        ? moneyFormatOptions(decimals, {
            currency,
            minDecimalPlaces: wholeUnits ? 0 : minDecimals
          })
        : { style: "currency" as const, currency }),
      ...(compact
        ? { notation: "compact" as const, compactDisplay: "short" as const }
        : {})
    });
  }, [
    locale,
    currency,
    configuredDecimals,
    minDecimals,
    decimalPlaces,
    compact,
    wholeUnits
  ]);
}
