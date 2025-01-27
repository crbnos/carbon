import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { useUser } from "./useUser";

export function useCurrencyFormatter(options?: Intl.NumberFormatOptions) {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = options?.currency ?? baseCurrency;
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency,
        ...options,
      }),
    [locale, currency, options]
  );
  return formatter;
}
