import { priceFormatOptions, SCALE } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { useConfiguredCurrencyDecimals } from "./useCurrencies";
import { useUser } from "./useUser";

/**
 * Per-unit price displays: the currency's decimals as the MINIMUM padding, up to
 * storage scale as the maximum so the full stored price always renders
 * ("$0.164", "CA$9.999"). Digits come from the company group's configured
 * `currency.decimalPlaces` — the DB column is authoritative over Intl/CLDR, the
 * same rule `useCurrencyFormatter` follows, so the price and money kinds can
 * never disagree about the same currency.
 *
 * `decimalPlaces` overrides the lookup when the caller already has the row
 * (e.g. from a loader). CLDR decides the minimum only when the currency isn't
 * configured for the group; the maximum is never left to Intl, whose currency
 * default of 2 would truncate a stored 1531.4475 to 1531.45.
 */
export function usePriceFormatter(options?: {
  currency?: string;
  decimalPlaces?: number;
}) {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = options?.currency ?? baseCurrency;
  const configuredDecimals = useConfiguredCurrencyDecimals(currency);
  const decimals = options?.decimalPlaces ?? configuredDecimals;

  return useMemo(
    () =>
      new Intl.NumberFormat(
        locale,
        decimals != null
          ? priceFormatOptions(currency, decimals)
          : { style: "currency", currency, maximumFractionDigits: SCALE }
      ),
    [locale, currency, decimals]
  );
}
