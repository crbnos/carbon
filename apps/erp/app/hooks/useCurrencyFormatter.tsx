import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { useUser } from "./useUser";

export function useCurrencyFormatter(options?: Intl.NumberFormatOptions) {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = options?.currency ?? baseCurrency;

  // Every call site passes an object literal, so depending on `options` by
  // identity meant the memo never hit: a new Intl.NumberFormat on every render,
  // and — since the formatter is itself a dep of the `columns` memo in several
  // tables — a full column rebuild with it. Depend on the fields instead.
  const optionsKey = options ? JSON.stringify(options) : "";
  const formatter = useMemo(() => {
    const opts = optionsKey
      ? (JSON.parse(optionsKey) as Intl.NumberFormatOptions)
      : undefined;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
      ...opts
    });
  }, [locale, currency, optionsKey]);
  return formatter;
}
