import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getCurrenciesList } from "~/modules/accounting";
import { path } from "~/utils/path";

/**
 * The ISO currency list with the company group's configured `decimalPlaces`
 * riding along (null for a currency the group hasn't set up). Served through
 * the cached currencies clientLoader, so mounting this in many components
 * costs one network round-trip per session, not per mount.
 */
export function useCurrencies() {
  const currencyFetcher =
    useFetcher<Awaited<ReturnType<typeof getCurrenciesList>>>();

  useMount(() => {
    currencyFetcher.load(path.to.api.currencies);
  });

  return currencyFetcher.data?.data ?? [];
}

/**
 * The group's configured settlement decimals for a currency, or null when the
 * currency isn't configured (or the list hasn't loaded yet). The `currency`
 * row is authoritative over Intl/CLDR — display formatters fall back to CLDR
 * only when this returns null.
 */
export function useConfiguredCurrencyDecimals(
  currencyCode: string | null | undefined
): number | null {
  const currencies = useCurrencies();

  return useMemo(
    () =>
      currencies.find((c) => c.code === currencyCode)?.decimalPlaces ?? null,
    [currencies, currencyCode]
  );
}

/**
 * Settlement decimals for money INPUTS, which need a concrete number for
 * `INPUT_FORMAT.money`: the configured value, or 2 as the last resort while
 * the list loads / for an unconfigured ISO currency.
 */
export function useCurrencyDecimals(
  currencyCode: string | null | undefined
): number {
  return useConfiguredCurrencyDecimals(currencyCode) ?? 2;
}
