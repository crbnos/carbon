import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { useUser } from "./useUser";

export function useCurrencyFormatter() {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: baseCurrency,
      }),
    [locale, baseCurrency]
  );
  return formatter;
}
