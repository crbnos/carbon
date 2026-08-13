import { PERCENT_FORMAT } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";

export function usePercentFormatter() {
  const { locale } = useLocale();

  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, PERCENT_FORMAT),
    [locale]
  );
  return formatter;
}
