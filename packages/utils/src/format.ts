import { SCALE } from "./math";

/** Settlement money: padded to the currency's decimals — settlement zeros aren't empty. */
export function moneyFormatOptions(
  currency: string,
  decimalPlaces: number
): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency,
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  };
}

/** Per-unit prices (scale 5): distributors quote in thousandths (0.164/ea, 0.00125/g).
 *  min = settlement padding, max = SCALE so the full stored price always renders. */
export function priceFormatOptions(
  currency: string,
  decimalPlaces: number
): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency,
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: SCALE
  };
}

/** Rates (0-1 fractions): 3 percent-digits — a scale-5 fraction round-trips exactly. */
export function percentFormatOptions(): Intl.NumberFormatOptions {
  return {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  };
}

/** Quantities: full storage precision (trailing zeros never render — 3 stays "3"). */
export function quantityFormatOptions(): Intl.NumberFormatOptions {
  return { minimumFractionDigits: 0, maximumFractionDigits: SCALE };
}

/** Editable inputs MUST use these: react-aria's blur commit runs parse(format(x)),
 *  making the input formatter part of the storage round-trip. */
export const INPUT_FORMAT = {
  rate: percentFormatOptions(),
  quantity: quantityFormatOptions(),
  money: (currency: string, decimalPlaces: number) =>
    moneyFormatOptions(currency, decimalPlaces),
  price: (currency: string, decimalPlaces: number) =>
    priceFormatOptions(currency, decimalPlaces)
};

export function formatMoney(
  value: number,
  locale: string,
  currency: string,
  decimalPlaces: number
): string {
  return new Intl.NumberFormat(
    locale,
    moneyFormatOptions(currency, decimalPlaces)
  ).format(value);
}

export function formatPrice(
  value: number,
  locale: string,
  currency: string,
  decimalPlaces: number
): string {
  return new Intl.NumberFormat(
    locale,
    priceFormatOptions(currency, decimalPlaces)
  ).format(value);
}

export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, percentFormatOptions()).format(value);
}

export function formatQuantity(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, quantityFormatOptions()).format(value);
}
