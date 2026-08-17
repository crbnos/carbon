import { useMount } from "@carbon/react";
import { cldrCurrencyDecimals, DEFAULT_CURRENCY_DECIMALS } from "@carbon/utils";
import { createContext, useContext, useMemo } from "react";
import { useFetcher } from "react-router";
import type { getCurrenciesList } from "~/modules/accounting";
import { path } from "~/utils/path";
import { useCompanySettings } from "./useCompanySettings";

type CurrencyList = NonNullable<
  Awaited<ReturnType<typeof getCurrenciesList>>["data"]
>;

/** Set by a route that loaded the list itself. The currencies API is
 *  `requirePermissions`-gated, so the fetcher below returns nothing on a public
 *  page and every amount silently falls back to CLDR — which is the one thing
 *  the standard says is NOT authoritative. */
const CurrenciesContext = createContext<CurrencyList | undefined>(undefined);

export const CurrenciesProvider = CurrenciesContext.Provider;

/**
 * The ISO currency list with the company group's configured `decimalPlaces`
 * riding along (null for a currency the group hasn't set up). Served through
 * the cached currencies clientLoader, so mounting this in many components
 * costs one network round-trip per session, not per mount.
 */
export function useCurrencies(): CurrencyList {
  const provided = useContext(CurrenciesContext);
  const currencyFetcher =
    useFetcher<Awaited<ReturnType<typeof getCurrenciesList>>>();

  useMount(() => {
    // A provided list means the route already has it and the endpoint is not
    // reachable anyway — asking would be a guaranteed 401 on every public view.
    if (!provided) currencyFetcher.load(path.to.api.currencies);
  });

  return provided ?? currencyFetcher.data?.data ?? [];
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
 * `undefined` means "pad to the currency's decimals" — the default, and what any
 * context without settings gets. A public page is NOT automatically one of those:
 * the quote share page hands its own service-role copy down through
 * `CompanySettingsProvider`, because the preference is how the company wants its
 * money to read, and a customer looking at the quote is exactly who it is for.
 */
export function useCurrencyMinDecimals(): number | undefined {
  const settings = useCompanySettings();
  return settings?.showCurrencyTrailingZeros === false ? 0 : undefined;
}
