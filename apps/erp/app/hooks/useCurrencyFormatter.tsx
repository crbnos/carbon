import { useRouteData } from "@carbon/react";
import { moneyFormatOptions, rateFormatOptions } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { path } from "~/utils/path";
import { useCurrencyDecimals, useCurrencyMinDecimals } from "./useCurrencies";

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
  /** A RATE rather than a settlement amount — a per-unit price or cost. Still
   *  padded to the currency's decimals, but allowed to exceed them up to the
   *  storage scale, so a $0.00123 fastener price displays as it is stored
   *  rather than as "$0.00". Matches what INPUT_FORMAT.rate commits. */
  rate?: boolean;
};

/**
 * Currency display — money and per-unit prices alike, because they are the same
 * kind. Digits come from `useCurrencyDecimals` — the group's configured
 * `currency.decimalPlaces` row, or CLDR's own digits for that currency when it
 * isn't configured.
 *
 * By default the amount is PADDED to those decimals, so its width states the
 * amount in full: "$300.00", "$3.50", "¥63", "BHD 0.563". A company can drop the
 * non-significant zeros by turning `showCurrencyTrailingZeros` off; that
 * preference is read here once (useCurrencyMinDecimals) rather than at 55 call sites.
 *
 * Callers pick a KIND, never a digit count: `rate` for a per-unit price (the
 * currency's decimals become a floor, not a ceiling), `wholeUnits` for a report
 * that shows whole amounts, `compact` for a "$1.2M" dashboard tile.
 */
export function useCurrencyFormatter(options?: CurrencyFormatterOptions) {
  // NOT useUser(): that THROWS when the authenticated route isn't mounted, and
  // this hook is used on the public quote share page, where it 500'd the whole
  // render. The company is only ever the FALLBACK currency here — an
  // unauthenticated caller always passes `currency` explicitly — so read the
  // route data directly and let it be absent.
  const authenticatedData = useRouteData<{
    company?: { baseCurrencyCode?: string | null };
  }>(path.to.authenticatedRoot);
  const baseCurrency = authenticatedData?.company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = options?.currency ?? baseCurrency;
  const currencyDecimals = useCurrencyDecimals(currency);
  const minDecimals = useCurrencyMinDecimals();

  // Every call site passes an object literal, so depending on `options` by
  // identity meant the memo never hit: a new Intl.NumberFormat on every render,
  // and — since the formatter is itself a dep of the `columns` memo in several
  // tables — a full column rebuild with it. Depend on the primitive fields.
  const { decimalPlaces, compact, wholeUnits, rate } = options ?? {};

  return useMemo(() => {
    // `wholeUnits` is a digit count of zero, expressed as the intent rather than
    // the number — this hook names kinds, it does not choose digits.
    const decimals = wholeUnits ? 0 : (decimalPlaces ?? currencyDecimals);
    const min = wholeUnits ? 0 : minDecimals;
    return new Intl.NumberFormat(locale, {
      ...(rate && !wholeUnits
        ? rateFormatOptions(currency, decimals, min)
        : moneyFormatOptions(decimals, { currency, minDecimalPlaces: min })),
      ...(compact
        ? { notation: "compact" as const, compactDisplay: "short" as const }
        : {})
    });
  }, [
    locale,
    currency,
    currencyDecimals,
    minDecimals,
    decimalPlaces,
    compact,
    wholeUnits,
    rate
  ]);
}
