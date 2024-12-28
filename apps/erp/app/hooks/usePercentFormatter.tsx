import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";

export function usePercentFormatter() {
  const { locale } = useLocale();

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "percent",

        maximumFractionDigits: 2,
      }),
    [locale]
  );
  return formatter;
}
