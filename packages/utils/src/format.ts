import { SCALE } from "./precision";

export type MoneyFormatOptions = {
  /** The ISO code. Present -> the symbol renders ("$300.00"); absent -> a bare
   *  amount ("300.00") for surfaces that print the code separately, like the PDF
   *  amount columns. It is an INPUT to the money kind, not a second kind. */
  currency?: string;
  /** Drops the non-significant zeros when 0. See below. */
  minDecimalPlaces?: number;
};

/** The one stand-in when no currency is in play at all. ISO's own default. */
export const DEFAULT_CURRENCY_DECIMALS = 2;

/** What CLDR says a currency's settlement decimals are — JPY 0, USD 2, BHD 3.
 *  Per-currency, not per-locale, so the probe locale is arbitrary and the answer
 *  is cached for the process.
 *
 *  This is the ONLY fallback when a currency has no configured `decimalPlaces`
 *  row. Asking CLDR beats assuming 2, which is what made an unconfigured JPY
 *  field offer two decimal places. A malformed code throws, so 2 stands in — the
 *  same ISO default Intl uses for an unknown-but-well-formed one. */
const cldrDecimalsByCode = new Map<string, number>();
export function cldrCurrencyDecimals(currencyCode: string): number {
  const cached = cldrDecimalsByCode.get(currencyCode);
  if (cached !== undefined) return cached;

  let decimals = DEFAULT_CURRENCY_DECIMALS;
  try {
    decimals =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currencyCode
      }).resolvedOptions().maximumFractionDigits ?? DEFAULT_CURRENCY_DECIMALS;
  } catch {
    // Not a valid ISO code — keep the default rather than throwing at render.
  }
  cldrDecimalsByCode.set(currencyCode, decimals);
  return decimals;
}

/** THE money kind. Money, per-unit prices, and bare document amounts are all
 *  this one thing: from the business's point of view a price is an amount in the
 *  same currency, so they render at the same decimals.
 *
 *  `decimalPlaces` is `currency.decimalPlaces` — the DB column, authoritative
 *  over Intl/CLDR, and never a literal. It is always the MAXIMUM.
 *
 *  `minDecimalPlaces` decides whether the non-significant zeros it implies are
 *  kept, and DEFAULTS to keeping them: "$300.00", "$3.50", "$0.00", "¥63".
 *  Fixed-width money is the accounting convention — it keeps columns of amounts
 *  aligned and an explicit ".00" reads as money rather than a bare count. Pass 0
 *  to drop the padding ("$300", "$3.5"); that is a per-company display
 *  preference (`companySettings.showCurrencyTrailingZeros`), which is why it is
 *  a parameter here rather than a second kind.
 *
 *  Display rounds to this width; STORAGE is a separate question — a value wider
 *  than the currency (a scale-5 unit price) is shown rounded, and the editable
 *  field commits at this width too (see INPUT_FORMAT). */
export function moneyFormatOptions(
  decimalPlaces: number,
  { currency, minDecimalPlaces = decimalPlaces }: MoneyFormatOptions = {}
): Intl.NumberFormatOptions {
  return {
    // The symbol is the only thing `currency` decides. Digits are the same
    // question either way, answered once here — answering it twice is how the
    // PDF column and the email of the same document came to disagree, one
    // following `currency.decimalPlaces` and the other capped at CLDR's 2.
    ...(currency
      ? { style: "currency" as const, currency }
      : { style: "decimal" as const }),
    minimumFractionDigits: minDecimalPlaces,
    maximumFractionDigits: decimalPlaces
  };
}

/** Already-built currency options with a different MINIMUM — the company's
 *  trailing-zero preference, applied by the editable-field wrapper, which sees
 *  a finished options object rather than the kind that produced it.
 *
 *  Lives here because this file is the one place digit counts are chosen; a
 *  wrapper writing `minimumFractionDigits` itself is the drift
 *  `no-inline-fraction-digits` exists to catch. Only the minimum moves, so the
 *  value a field commits is unchanged (react-aria commits parse(format(x)) and
 *  padding zeros carry no value). */
export function withMinimumDecimals(
  options: Intl.NumberFormatOptions,
  minDecimalPlaces: number
): Intl.NumberFormatOptions {
  return { ...options, minimumFractionDigits: minDecimalPlaces };
}

/** How many digits a percent carries. A scale-5 fraction is 3 percent-digits,
 *  so a rate round-trips exactly through either of the two kinds below. */
const PERCENT_DIGITS = 3;

/** The digit-count kinds that take no arguments are frozen CONSTANTS, not
 *  factories. They are read on every render of every field and cell, and
 *  react-stately memoizes its NumberFormatter on the options object's identity —
 *  a fresh object per call defeats that memo and rebuilds the formatter each
 *  render. */

/** Rates (0-1 fractions): rendered as a percentage, "6.25%". */
export const PERCENT_FORMAT: Intl.NumberFormatOptions = Object.freeze({
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: PERCENT_DIGITS
});

/** The same rate typed as percentage POINTS — a bare 6.25 in a field already
 *  labelled "%", where the caller divides by 100. Same digits as the percent
 *  kind, so the two agree on what a rate can express. */
export const PERCENT_POINTS_FORMAT: Intl.NumberFormatOptions = Object.freeze({
  style: "decimal",
  minimumFractionDigits: 0,
  maximumFractionDigits: PERCENT_DIGITS
});

/** Quantities: full storage precision (trailing zeros never render — 3 stays
 *  "3"). FX rates are the same shape — a plain scale-5 multiplier, neither a
 *  0-1 percent nor a currency — and deliberately share this one constant rather
 *  than duplicating it. Intl's decimal default caps at 3 fraction digits, which
 *  silently truncates a stored value on an input's blur commit, so both have to
 *  be explicit. */
export const SCALE_FORMAT: Intl.NumberFormatOptions = Object.freeze({
  minimumFractionDigits: 0,
  maximumFractionDigits: SCALE
});

/** Editable inputs MUST use these: react-aria's blur commit runs parse(format(x)),
 *  making the input formatter part of the storage round-trip. */
export const INPUT_FORMAT = {
  rate: PERCENT_FORMAT,
  percentPoints: PERCENT_POINTS_FORMAT,
  quantity: SCALE_FORMAT,
  exchangeRate: SCALE_FORMAT,
  /** Editable currency — money and per-unit prices alike, and the SAME digits
   *  they display with, padding included: an empty cost reads "$0.00".
   *  react-aria's blur commit is literally `setNumberValue(parse(format(x)))`,
   *  so this options object is what decides the precision a typed amount is
   *  STORED at: at USD's 2 places a typed 300.22121 commits as 300.22, and at
   *  JPY's 0 a typed 63.4 commits as 63. */
  money: (currency: string, decimalPlaces: number, minDecimalPlaces?: number) =>
    moneyFormatOptions(decimalPlaces, { currency, minDecimalPlaces }),
  price: (currency: string, decimalPlaces: number, minDecimalPlaces?: number) =>
    moneyFormatOptions(decimalPlaces, { currency, minDecimalPlaces })
};

const SCALE_STEP = 1 / 10 ** SCALE;

/** Stepper granularity, paired with the kinds above. react-aria SNAPS the
 *  committed value to the nearest multiple of `step`, so a step coarser than
 *  the field's scale truncates it — take the step from here or omit the prop. */
export const INPUT_STEP = {
  rate: SCALE_STEP,
  quantity: SCALE_STEP,
  exchangeRate: SCALE_STEP,
  /** Currency steps in its own smallest unit (1 for JPY, 0.01 for USD) — for
   *  money and prices alike, since they share one format. There is deliberately
   *  no finer `price` step: react-aria commits parse(format(x)), so a step below
   *  the field's own format can only produce values the formatter rounds away. */
  money: (decimalPlaces: number) => 1 / 10 ** decimalPlaces
};

export function formatMoney(
  value: number,
  locale: string,
  currency: string,
  decimalPlaces: number,
  minDecimalPlaces?: number
): string {
  return new Intl.NumberFormat(
    locale,
    moneyFormatOptions(decimalPlaces, { currency, minDecimalPlaces })
  ).format(value);
}

export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, PERCENT_FORMAT).format(value);
}

export function formatQuantity(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, SCALE_FORMAT).format(value);
}

export function formatExchangeRate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, SCALE_FORMAT).format(value);
}
