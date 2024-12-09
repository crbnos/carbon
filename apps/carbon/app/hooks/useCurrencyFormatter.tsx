import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { useUser } from "./useUser";

export function useCurrencyFormatter(
  currencyCode?: string,
  maximumFractionDigits?: number
) {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = currencyCode ?? baseCurrency;
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency,
        maximumFractionDigits: maximumFractionDigits ?? 2,
      }),
    [locale, currency, maximumFractionDigits]
  );
  return formatter;
}
