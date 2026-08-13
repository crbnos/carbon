import { useMount } from "@carbon/react";
import { cldrCurrencyDecimals, DEFAULT_CURRENCY_DECIMALS } from "@carbon/utils";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getCurrenciesList } from "~/modules/accounting";
import { path } from "~/utils/path";
import { useCompanySettings } from "./useCompanySettings";

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
 * Resolve settlement decimals for ANY currency code — a stable function, for
 * the tables whose currency varies per row and so cannot call a hook per value.
 *
 * The group's configured `currency.decimalPlaces` row is authoritative; CLDR
 * decides only when the currency isn't configured or the list is still loading.
 * One index and one fallback policy, so a per-row table and a single-currency
 * field can never disagree about how wide an amount is.
 */
export function useCurrencyDecimalsLookup(): (
  currencyCode: string | null | undefined
) => number {
  const currencies = useCurrencies();

  return useMemo(() => {
    // Indexed rather than scanned: this runs inside every money formatter,
    // which in a table means once per row per render over the full ISO list.
    const configured = new Map(
      currencies.flatMap((c) =>
        c.decimalPlaces == null ? [] : [[c.code, c.decimalPlaces] as const]
      )
    );
    return (currencyCode) =>
      currencyCode
        ? (configured.get(currencyCode) ?? cldrCurrencyDecimals(currencyCode))
        : DEFAULT_CURRENCY_DECIMALS;
  }, [currencies]);
}

/** Settlement decimals for one currency — money inputs need a concrete number
 *  for `INPUT_FORMAT.money`, and display formatters want the same answer so an
 *  editable amount and the read-only one beside it agree. */
export function useCurrencyDecimals(
  currencyCode: string | null | undefined
): number {
  return useCurrencyDecimalsLookup()(currencyCode);
}

/**
 * The MINIMUM digits a currency amount displays with — the company's
 * `showCurrencyTrailingZeros` preference resolved to a number for
 * `moneyFormatOptions`.
 *
 * `undefined` means "pad to the currency's decimals", which is both the default
 * and what an UNAUTHENTICATED context gets: the public quote share page has no
 * company settings to read, and a customer-facing document should show money at
 * full width regardless of an internal display preference.
 */
export function useCurrencyMinDecimals(): number | undefined {
  const settings = useCompanySettings();
  return settings?.showCurrencyTrailingZeros === false ? 0 : undefined;
}
