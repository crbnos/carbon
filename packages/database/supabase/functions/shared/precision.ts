/** Internal precision: prices, rates, quantities, ledger amounts. */
export const SCALE = 5;

/** One comparison tolerance. 5dp values are multiples of 1e-5; float noise is ~1e-12. */
export const EPSILON = 1e-6;

export const RoundingMode = {
  /** Ties away from zero — matches Postgres round(). (Math.round(-2.5) = -2; Postgres = -3.) */
  HalfUp: "halfUp",
  /** Away from zero to the next step — scrap allowances. */
  Up: "up"
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/** Exponent-shift: decimal-string round-trip, immune to 1.005-style float artifacts. */
const shift = (value: number, exp: number): number => {
  const [m, e = "0"] = value.toExponential().split("e");
  return Number(`${m}e${Number(e) + exp}`);
};

export function round(
  value: number,
  scale: number = SCALE,
  mode: RoundingMode = RoundingMode.HalfUp
): number {
  if (!Number.isFinite(value)) return value;
  const fn =
    mode === RoundingMode.Up
      ? (n: number) => Math.sign(n) * Math.ceil(Math.abs(n))
      : (n: number) => Math.sign(n) * Math.round(Math.abs(n));
  return shift(fn(shift(value, scale)), -scale);
}

/** Accumulates at full precision, rounds once at the end. */
export function sum(values: number[], scale: number = SCALE): number {
  let total = 0;
  for (const v of values) total += v;
  return round(total, scale);
}

export function equals(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** Scrap allowance rounds up to whole units; the target itself is NEVER rounded.
 *  withScrap(4.5, 0)   === 4.5
 *  withScrap(31, 0.31) === 32 */
export function withScrap(target: number, scrap: number): number {
  return target + round(scrap, 0, RoundingMode.Up);
}

/** Tax/discount → settlement amount. `decimals` comes from currency.decimalPlaces — data, never a literal. */
export function applyRate(base: number, rate: number, decimals: number): number {
  return round(base * rate, decimals);
}

/** Ledger invariant. Throws with the drift so posting refuses rather than mis-posts.
 *  `tolerance` is a BUSINESS refusal threshold, distinct from EPSILON (float-noise guard):
 *  multi-currency journals legitimately carry small cross-rate residuals, so posting
 *  paths pass their domain tolerance explicitly (payment/memo: 0.01; manual/close: 0.001).
 *  The default EPSILON is for contexts that must balance exactly. */
export function assertBalanced(
  debits: number,
  credits: number,
  tolerance: number = EPSILON
): void {
  const drift = debits - credits;
  if (Math.abs(drift) > tolerance) {
    throw new Error(`Journal does not balance (off by ${round(drift)})`);
  }
}
