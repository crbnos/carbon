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

/** One step of the smallest unit the scale can hold: 1e-5. */
const SCALE_STEP = 1 / 10 ** SCALE;

/**
 * Stepper granularity, paired with the kinds above — a `step` is not a UI
 * nicety, it SNAPS the committed value. react-aria rounds to the nearest
 * multiple of `step` on commit, so a step coarser than the field's scale
 * silently truncates: `step: 0.0001` on a rate snapped a typed 6.255%
 * (0.06255) down to 6.25%, which no amount of formatting could reveal.
 * Never write a step literal at a call site — take it from here, or omit the
 * prop entirely.
 */
export const INPUT_STEP = {
  /** 1e-5 as a fraction = 0.001% — matches the rate kind's 3 percent-digits. */
  rate: SCALE_STEP,
  quantity: SCALE_STEP,
  price: SCALE_STEP,
  /** Settlement money steps in its own smallest unit (1 for JPY, 0.01 for USD). */
  money: (decimalPlaces: number) => 1 / 10 ** decimalPlaces
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
