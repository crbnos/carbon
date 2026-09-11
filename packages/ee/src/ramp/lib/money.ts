import { round } from "@carbon/utils";
import { fromMinorUnits } from "./models";

export type ParsedRampMinorAmount = {
  minorUnits: number;
  currencyCode: string | null;
};

export type RampMoneyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseVerifiedRampMinorAmount(
  value: unknown,
  label: string
): RampMoneyResult<ParsedRampMinorAmount> {
  if (typeof value === "number") {
    return {
      ok: false,
      error: `${label} uses an ambiguous bare-number amount; a verified Ramp minor-unit object is required`
    };
  }
  if (!value || typeof value !== "object") {
    return { ok: false, error: `${label} is missing` };
  }

  const money = value as Record<string, unknown>;
  const usesSignedShape = "value" in money;
  const minorUnits = usesSignedShape ? money.value : money.amount;
  if (
    typeof minorUnits !== "number" ||
    !Number.isFinite(minorUnits) ||
    !Number.isInteger(minorUnits)
  ) {
    return {
      ok: false,
      error: `${label} must contain a finite integer number of minor units`
    };
  }

  const rawCurrencyCode = usesSignedShape
    ? money.currency
    : money.currency_code;
  if (
    rawCurrencyCode !== undefined &&
    rawCurrencyCode !== null &&
    typeof rawCurrencyCode !== "string"
  ) {
    return { ok: false, error: `${label} has an invalid currency code` };
  }
  if (!usesSignedShape && !rawCurrencyCode) {
    return {
      ok: false,
      error: `${label} CurrencyAmount is missing its currency code`
    };
  }

  return {
    ok: true,
    value: {
      minorUnits,
      currencyCode: rawCurrencyCode || null
    }
  };
}

export function normalizeRampCardTransactionAmount(args: {
  entityAmount: unknown;
  deprecatedMajorAmount: number | null | undefined;
  currencyCode: string;
  decimals: number;
}): RampMoneyResult<number> {
  if (args.entityAmount !== null && args.entityAmount !== undefined) {
    const parsed = parseVerifiedRampMinorAmount(
      args.entityAmount,
      "Card transaction entity amount"
    );
    if (!parsed.ok) return parsed;
    if (
      parsed.value.currencyCode &&
      parsed.value.currencyCode !== args.currencyCode
    ) {
      return {
        ok: false,
        error: `Card transaction entity amount currency ${parsed.value.currencyCode} does not match ${args.currencyCode}`
      };
    }
    return {
      ok: true,
      value: rampMinorAmountToMajor(
        parsed.value,
        args.currencyCode,
        args.decimals
      )
    };
  }

  if (
    typeof args.deprecatedMajorAmount !== "number" ||
    !Number.isFinite(args.deprecatedMajorAmount)
  ) {
    return {
      ok: false,
      error: "Card transaction amount is missing or invalid"
    };
  }

  return {
    ok: true,
    value: round(args.deprecatedMajorAmount, args.decimals)
  };
}

export function rampMinorAmountToMajor(
  amount: ParsedRampMinorAmount,
  currencyCode: string,
  decimals: number
): number {
  return fromMinorUnits(amount.minorUnits, currencyCode, decimals);
}

export function validateRampCurrencyDecimals(
  value: unknown,
  currencyCode: string
): RampMoneyResult<number> {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return {
      ok: false,
      error: `Currency precision is unavailable or invalid for ${currencyCode}`
    };
  }
  return { ok: true, value };
}

export function validateRampExchangeRate(
  value: unknown,
  currencyCode: string
): RampMoneyResult<number> {
  if (value === null || value === undefined || value === "") {
    return {
      ok: false,
      error: `Exchange rate is unavailable for ${currencyCode}`
    };
  }
  const rate = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, error: `Exchange rate is invalid for ${currencyCode}` };
  }
  return { ok: true, value: rate };
}
