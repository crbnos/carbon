import { round } from "./precision.ts";

function requireFinite(amount: number, label: string): number {
  if (!Number.isFinite(amount)) {
    throw new Error(`${label} must be finite`);
  }
  return amount;
}

/** Refuse an unusable foreign-per-base rate.
 *
 *  Exported so callers that only need the CHECK can say so. The alternative
 *  spelling — `toBaseAmount(0, rate)` with the result thrown away — reads as
 *  dead code to every reader, linter and dead-code pass, so deleting it looks
 *  free while silently removing rate validation from a posting path. */
export function assertExchangeRate(rate: number): void {
  requireRate(rate);
}

function requireRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Foreign-per-base exchange rate must be positive and finite");
  }
}

/** Refuse a currency precision that cannot describe a settlement amount.
 *  Exported for the same reason as `assertExchangeRate`. */
export function assertCurrencyDecimals(currencyDecimals: number): void {
  requireCurrencyDecimals(currencyDecimals);
}

function requireCurrencyDecimals(currencyDecimals: number): void {
  if (!Number.isSafeInteger(currencyDecimals) || currencyDecimals < 0) {
    throw new Error("Currency decimal places must be a nonnegative integer");
  }
}

/** Persist a document-currency amount as company-base carrying value. */
export function toBaseAmount(
  documentAmount: number,
  foreignPerBaseRate: number
): number {
  requireFinite(documentAmount, "Document amount");
  requireRate(foreignPerBaseRate);
  return requireFinite(round(documentAmount / foreignPerBaseRate), "Base amount");
}

/** Round at the document boundary using that currency's configured decimals. */
export function toDocumentAmount(
  baseAmount: number,
  foreignPerBaseRate: number,
  currencyDecimals: number
): number {
  requireFinite(baseAmount, "Base amount");
  requireRate(foreignPerBaseRate);
  requireCurrencyDecimals(currencyDecimals);
  return requireFinite(
    round(baseAmount * foreignPerBaseRate, currencyDecimals),
    "Document amount"
  );
}

/** Positive means realized gain for either AR or AP. Relief amounts carry no FX. */
export function calculateSettlementFx(input: {
  appliedAmount: number;
  sourceAmount: number;
  sourceExchangeRate: number;
  isAR: boolean;
  /** Actual released carrying value, including the source's final rounding residual. */
  sourceBaseAmount?: number;
}): number {
  requireRate(input.sourceExchangeRate);
  requireFinite(input.appliedAmount, "Applied amount");
  requireFinite(input.sourceAmount, "Source amount");
  const sourceBase = requireFinite(
    input.sourceBaseAmount ?? input.sourceAmount / input.sourceExchangeRate,
    "Source base amount"
  );
  if (input.appliedAmount < 0 || input.sourceAmount < 0 || sourceBase < 0) {
    throw new Error("Settlement principal amounts must be nonnegative");
  }
  const fx = round(
    input.isAR
      ? sourceBase - input.appliedAmount
      : input.appliedAmount - sourceBase
  );
  return fx === 0 ? 0 : requireFinite(fx, "Settlement FX amount");
}
