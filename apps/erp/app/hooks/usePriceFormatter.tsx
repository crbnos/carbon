import { priceFormatOptions, SCALE } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { useUser } from "./useUser";

/**
 * Per-unit price displays: settlement padding at the currency's decimals, up
 * to storage scale so the full stored price always renders ("$0.164").
 * When the currency row's decimalPlaces isn't reachable at the call site,
 * Intl's currency default supplies the minimum digits.
 */
export function usePriceFormatter(options?: {
  currency?: string;
  decimalPlaces?: number;
}) {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = options?.currency ?? baseCurrency;
  const decimalPlaces = options?.decimalPlaces;

  return useMemo(
    () =>
      new Intl.NumberFormat(
        locale,
        decimalPlaces != null
          ? priceFormatOptions(currency, decimalPlaces)
          : { style: "currency", currency, maximumFractionDigits: SCALE }
      ),
    [locale, currency, decimalPlaces]
  );
}
