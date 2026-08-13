import { SCALE } from "./math";

/** Settlement money: padded to the currency's decimals, because its zeros state
 *  the amount in full — "$3.00" is three dollars and zero cents, and an invoice
 *  total reading "$1,234.5" looks truncated.
 *
 *  A plain ZERO is the exception: there are no cents to state, so it renders
 *  "$0". Use moneyFormatOptionsFor(value, ...) wherever the value is known;
 *  editable inputs can't (react-aria takes static options) and use
 *  INPUT_FORMAT.money, which drops the padding so an empty cost shows "$0". */
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

/** moneyFormatOptions with the zero case applied — the digits a DISPLAY should
 *  use for this particular amount. */
export function moneyFormatOptionsFor(
  value: number,
  currency: string,
  decimalPlaces: number
): Intl.NumberFormatOptions {
  return moneyFormatOptions(currency, value === 0 ? 0 : decimalPlaces);
}

/** Per-unit prices (scale 5): distributors quote in thousandths (0.164/ea, 0.00125/g).
 *  A price carries only the digits it actually has — 3 renders "3", not "3.00" —
 *  because its precision genuinely varies and padding a variable-width number to a
 *  fixed one is noise. The max stays at SCALE so the full stored price renders.
 *
 *  Settlement money is the opposite and deliberately so: see moneyFormatOptions.
 *  Its zeros state the amount in full ("three dollars and zero cents"), and it has
 *  already been rounded TO the currency's decimals, so there is nothing past them
 *  left to show.
 *
 *  `decimalPlaces` no longer affects the output. It is kept optional so the ~60
 *  call sites that pass it still compile; they can drop the argument.
 */
export function priceFormatOptions(
  currency: string,
  _decimalPlaces?: number
): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: SCALE
  };
}

/** How many digits a percent carries. A scale-5 fraction is 3 percent-digits,
 *  so a rate round-trips exactly through either of the two kinds below. */
const PERCENT_DIGITS = 3;

/** Rates (0-1 fractions): rendered as a percentage, "6.25%". */
export function percentFormatOptions(): Intl.NumberFormatOptions {
  return {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: PERCENT_DIGITS
  };
}

/** The same rate typed as percentage POINTS — a bare 6.25 in a field already
 *  labelled "%", where the caller divides by 100. Same digits as the percent
 *  kind, so the two agree on what a rate can express. */
export function percentPointsFormatOptions(): Intl.NumberFormatOptions {
  return {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: PERCENT_DIGITS
  };
}

/** Quantities: full storage precision (trailing zeros never render — 3 stays "3"). */
export function quantityFormatOptions(): Intl.NumberFormatOptions {
  return { minimumFractionDigits: 0, maximumFractionDigits: SCALE };
}

/** FX rates: a plain scale-5 multiplier — neither a 0-1 percent nor a currency.
 *  Intl's decimal default caps at 3 fraction digits, which silently truncates a
 *  stored rate on an input's blur commit, so this kind has to be explicit. */
export function exchangeRateFormatOptions(): Intl.NumberFormatOptions {
  return { minimumFractionDigits: 0, maximumFractionDigits: SCALE };
}

/** Editable inputs MUST use these: react-aria's blur commit runs parse(format(x)),
 *  making the input formatter part of the storage round-trip. */
export const INPUT_FORMAT = {
  rate: percentFormatOptions(),
  percentPoints: percentPointsFormatOptions(),
  quantity: quantityFormatOptions(),
  exchangeRate: exchangeRateFormatOptions(),
  /** Editable money. react-aria takes STATIC options, so this cannot vary by
   *  value the way a display can — it drops the minimum outright so an empty
   *  shipping cost reads "$0" rather than "$0.00". The cost is that a half
   *  amount shows "$3.5" while being edited; it round-trips to the same
   *  number, and a read-only total still reads "$3.50". */
  money: (currency: string, decimalPlaces: number) => ({
    ...moneyFormatOptions(currency, decimalPlaces),
    minimumFractionDigits: 0
  }),
  price: (currency: string, decimalPlaces: number) =>
    priceFormatOptions(currency, decimalPlaces)
};

const SCALE_STEP = 1 / 10 ** SCALE;

/** Stepper granularity, paired with the kinds above. react-aria SNAPS the
 *  committed value to the nearest multiple of `step`, so a step coarser than
 *  the field's scale truncates it — take the step from here or omit the prop. */
export const INPUT_STEP = {
  rate: SCALE_STEP,
  quantity: SCALE_STEP,
  price: SCALE_STEP,
  exchangeRate: SCALE_STEP,
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
    moneyFormatOptionsFor(value, currency, decimalPlaces)
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

export function formatExchangeRate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, exchangeRateFormatOptions()).format(
    value
  );
}
