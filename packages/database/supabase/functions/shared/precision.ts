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

/** The extra whole units to make/procure to cover scrap at `rate`. Ceils to
 *  whole units — you cannot make a third of a part to throw away — while the
 *  fractional target itself is NEVER rounded (callers add the two).
 *  scrapAllowance(4.5, 0)    === 0     -> total stays 4.5
 *  scrapAllowance(31, 0.01)  === 1     -> total 32 */
export function scrapAllowance(target: number, rate: number): number {
  return round(target * rate, 0, RoundingMode.Up);
}

/** Tax/discount → settlement amount. `decimals` comes from currency.decimalPlaces — data, never a literal. */
export function applyRate(base: number, rate: number, decimals: number): number {
  return round(base * rate, decimals);
}

/** The other half of the value pair: recover the rate an absolute amount implies.
 *  Rounded to internal scale so the stored rate is a real 5dp fact, not a raw
 *  float. Precision only flows cleanly one way — a rate derived back from a
 *  cents-rounded amount is limited by that amount's scale. */
export function deriveRate(amount: number, subtotal: number): number {
  return subtotal > 0 ? round(amount / subtotal) : 0;
}

/** Ledger invariant. Throws with the drift so posting refuses rather than mis-posts.
 *  `tolerance` is a BUSINESS refusal threshold, distinct from EPSILON (float-noise guard):
 *  multi-currency journals legitimately carry small cross-rate residuals, so posting
 *  paths pass their domain tolerance explicitly (payment/memo: 0.01; manual/close: 0.001).
 *  The default EPSILON is for contexts that must balance exactly. */
export function assertBalanced(
  debits: number,
  credits: number,
  tolerance: number = EPSILON,
  label = "Journal"
): void {
  const drift = debits - credits;
  if (Math.abs(drift) > tolerance) {
    throw new Error(
      `${label} does not balance (off by ${round(drift)}); refusing to post`
    );
  }
}
