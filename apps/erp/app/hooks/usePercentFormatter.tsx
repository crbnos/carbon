import { percentFormatOptions } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";

export function usePercentFormatter() {
  const { locale } = useLocale();

  const formatter = useMemo(
    () => new Intl.NumberFormat(locale, percentFormatOptions()),
    [locale]
  );
  return formatter;
}
