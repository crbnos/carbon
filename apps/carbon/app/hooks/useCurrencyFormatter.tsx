import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";

export function useCurrencyFormatter() {
  const { locale } = useLocale();
  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }),
    [locale]
  );
  return formatter;
}
