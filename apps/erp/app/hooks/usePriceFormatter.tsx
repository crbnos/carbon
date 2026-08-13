import { priceFormatOptions } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { useUser } from "./useUser";

/**
 * Per-unit price displays: no padding, up to storage scale as the maximum so the
 * full stored price always renders ("$0.164", "$4.5", "$3"). A price carries only
 * the digits it actually has — its precision genuinely varies, and the currency's
 * settlement decimals have no say in it.
 *
 * That is the whole reason this hook exists next to `useCurrencyFormatter`: the
 * money kind's MAXIMUM is the currency's decimals, so running a price through it
 * truncates the stored value on screen (a 300.33323 unit price reads "$300.33").
 *
 * `decimalPlaces` no longer affects the output — it is accepted so the call sites
 * that pass it still compile, the same way `priceFormatOptions` keeps its second
 * argument. `currency` still matters: it picks the symbol.
 */
export function usePriceFormatter(options?: {
  currency?: string;
  decimalPlaces?: number;
}) {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = options?.currency ?? baseCurrency;

  return useMemo(
    () => new Intl.NumberFormat(locale, priceFormatOptions(currency)),
    [locale, currency]
  );
}
