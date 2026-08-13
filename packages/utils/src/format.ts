import { SCALE } from "./math";

/** A currency amount. Money and per-unit prices are the SAME kind: from the
 *  business's point of view a price is an amount in the same currency, so both
 *  render at that currency's decimals.
 *
 *  Those decimals are the MAXIMUM, not a pad. Trailing zeros state nothing, so
 *  3 renders "$3" and 3.5 renders "$3.5", while 3.03 keeps both digits and a
 *  plain 0 reads "$0". `decimalPlaces` is `currency.decimalPlaces` — the DB
 *  column, authoritative over Intl/CLDR, and never a literal.
 *
 *  Display rounds to this width; STORAGE does not. A per-unit price is still
 *  held at SCALE, which is why the editable price input keeps its own width —
 *  see INPUT_FORMAT.price. */
export function moneyFormatOptions(
  currency: string,
  decimalPlaces: number
): Intl.NumberFormatOptions {
  return {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalPlaces
  };
}

/** Per-unit prices render exactly like money. Kept as its own name so the call
 *  sites that mean "price" still read that way — it is deliberately not a
 *  different set of digits, and must not become one. */
export function priceFormatOptions(
  currency: string,
  decimalPlaces: number
): Intl.NumberFormatOptions {
  return moneyFormatOptions(currency, decimalPlaces);
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
  money: (currency: string, decimalPlaces: number) =>
    moneyFormatOptions(currency, decimalPlaces),
  /** Editable per-unit price — the ONE place price and money differ, and they
   *  have to. react-aria's blur commit runs parse(format(x)), so an input capped
   *  at the currency's decimals would round a typed 0.164/ea to 0.16 and SAVE
   *  it. Display rounds to the currency; the field a price is TYPED into must
   *  hold what storage holds. `decimalPlaces` is ignored for that reason. */
  price: (currency: string, _decimalPlaces?: number) => ({
    style: "currency" as const,
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: SCALE
  })
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

export function formatExchangeRate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, exchangeRateFormatOptions()).format(
    value
  );
}
