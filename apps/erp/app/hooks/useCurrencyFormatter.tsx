import { moneyFormatOptions } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { useConfiguredCurrencyDecimals } from "./useCurrencies";
import { useUser } from "./useUser";

/**
 * Settlement money display. Digits come from the company group's configured
 * `currency.decimalPlaces` — the DB column is authoritative over Intl/CLDR —
 * padded both ways per the money kind ("$4.50", "¥63"). CLDR only decides when
 * the currency isn't configured for the group (or the list hasn't loaded yet).
 *
 * `decimalPlaces` overrides the lookup when the caller already has the row
 * (e.g. from a loader). Any other Intl options a caller passes win over the
 * kind — reports that deliberately show whole units keep doing so.
 */
export function useCurrencyFormatter(
  options?: Intl.NumberFormatOptions & { decimalPlaces?: number }
) {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const { locale } = useLocale();
  const currency = options?.currency ?? baseCurrency;
  const configuredDecimals = useConfiguredCurrencyDecimals(currency);

  // Every call site passes an object literal, so depending on `options` by
  // identity meant the memo never hit: a new Intl.NumberFormat on every render,
  // and — since the formatter is itself a dep of the `columns` memo in several
  // tables — a full column rebuild with it. Depend on the fields instead.
  const optionsKey = options ? JSON.stringify(options) : "";
  const formatter = useMemo(() => {
    const { decimalPlaces, ...opts } = optionsKey
      ? (JSON.parse(optionsKey) as Intl.NumberFormatOptions & {
          decimalPlaces?: number;
        })
      : {};
    const decimals = decimalPlaces ?? configuredDecimals;
    const build = (digits: number | null) =>
      new Intl.NumberFormat(locale, {
        ...(digits != null
          ? moneyFormatOptions(currency, digits)
          : { style: "currency" as const, currency }),
        ...opts
      });

    // A plain zero has no cents to state, so it reads "$0" rather than "$0.00".
    // Every other amount keeps its full width — an invoice total showing
    // "$1,234.5" looks truncated. Only `format` is ever called on this (270
    // call sites, no formatToParts/resolvedOptions), so branching by value is
    // safe; a static Intl.NumberFormat could not do it.
    const padded = build(decimals);
    const bare = build(0);
    // Delegates everything except `format` so this stays a drop-in
    // Intl.NumberFormat — several call sites pass it as one.
    const wrapped: Intl.NumberFormat = {
      format: (value) => (Number(value) === 0 ? bare : padded).format(value),
      // Casts because the interface's parameter union is wider than the
      // implementation overloads; nothing calls these today.
      formatToParts: (value) => padded.formatToParts(value as number),
      resolvedOptions: () => padded.resolvedOptions(),
      formatRange: (start, end) =>
        padded.formatRange(start as number, end as number),
      formatRangeToParts: (start, end) =>
        padded.formatRangeToParts(start as number, end as number)
    };
    return wrapped;
  }, [locale, currency, optionsKey, configuredDecimals]);
  return formatter;
}
