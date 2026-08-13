import { moneyFormatOptions } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import {
  useConfiguredCurrencyDecimals,
  useCurrencyMinDecimals
} from "./useCurrencies";
import { useUser } from "./useUser";

/**
 * Currency display — money and per-unit prices alike, because they are the same
 * kind. Digits come from the company group's configured `currency.decimalPlaces`
 * as the maximum. The DB column is authoritative over Intl/CLDR; CLDR only
 * decides when the currency isn't configured for the group (or the list hasn't
 * loaded yet).
 *
 * By default the amount is PADDED to those decimals, so its width states the
 * amount in full: "$300.00", "$3.50", "¥63", "BHD 0.563". A company can drop the
 * non-significant zeros with `hideCurrencyTrailingZeros`; that preference is read
 * here once (useCurrencyMinDecimals) rather than at 55 call sites.
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
  const minDecimals = useCurrencyMinDecimals();

  // Every call site passes an object literal, so depending on `options` by
  // identity meant the memo never hit: a new Intl.NumberFormat on every render,
  // and — since the formatter is itself a dep of the `columns` memo in several
  // tables — a full column rebuild with it. Depend on the fields instead.
  const optionsKey = options ? JSON.stringify(options) : "";
  return useMemo(() => {
    const { decimalPlaces, ...opts } = optionsKey
      ? (JSON.parse(optionsKey) as Intl.NumberFormatOptions & {
          decimalPlaces?: number;
        })
      : {};
    const decimals = decimalPlaces ?? configuredDecimals;
    return new Intl.NumberFormat(locale, {
      ...(decimals != null
        ? moneyFormatOptions(currency, decimals, minDecimals)
        : { style: "currency" as const, currency }),
      ...opts
    });
  }, [locale, currency, optionsKey, configuredDecimals, minDecimals]);
}
