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

/** Round every part to `scale` so the results sum EXACTLY to `target`, moving at
 *  most ONE minor unit per part (largest-remainder / Hamilton apportionment).
 *
 *  Independently rounding N parts leaves a residual of up to N/2 minor units.
 *  Concentrating that residual on a single part is what breaks a part's own
 *  relative/absolute pair — a tax line stops matching its own `taxPercent`, and
 *  a provider that re-derives `amount = net × percent` rejects the document.
 *  Spreading it one unit at a time keeps every part within a minor unit of its
 *  exact value, which is the bound those provider checks assume.
 *
 *  Parts rounded furthest DOWN receive the surplus first; parts rounded furthest
 *  UP give a unit back first. Ties resolve by index so the result is stable.
 *  Refuses when the residual exceeds one unit per part — that is a real
 *  disagreement between the parts and the target, not a rounding artifact. */
export function distributeRoundingResidual(
  exactValues: number[],
  target: number,
  scale: number = SCALE
): number[] {
  const rounded = exactValues.map((value) => round(value, scale));
  if (!Number.isFinite(target) || rounded.some((v) => !Number.isFinite(v))) {
    throw new Error("Rounding residual inputs must be finite");
  }
  const sum = rounded.reduce((total, value) => total + value, 0);
  // Compare in whole minor units: the residual is an exact integer count of
  // them, so this never inherits the float noise of the sum itself.
  const residualUnits = Math.round(shift(target - sum, scale));
  if (residualUnits === 0) return rounded;
  if (Math.abs(residualUnits) > exactValues.length) {
    throw new Error(
      `Rounding residual of ${residualUnits} unit(s) exceeds ${exactValues.length} part(s)`
    );
  }
  const unit = shift(1, -scale);
  const direction = Math.sign(residualUnits);
  const order = exactValues
    .map((value, index) => ({ index, error: value - rounded[index]! }))
    // Surplus goes to the most under-rounded part; a deficit is taken from the
    // most over-rounded one.
    .sort((a, b) => direction * (b.error - a.error) || a.index - b.index);
  for (let i = 0; i < Math.abs(residualUnits); i++) {
    const { index } = order[i]!;
    rounded[index] = round(rounded[index]! + direction * unit, scale);
  }
  return rounded;
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

/** The ledger invariant, as a predicate. `tolerance` is a BUSINESS refusal
 *  threshold, distinct from EPSILON (the float-noise guard): multi-currency
 *  journals legitimately carry small cross-rate residuals, so callers pass their
 *  domain tolerance explicitly. The default EPSILON is for contexts that must
 *  balance exactly.
 *
 *  Use this where the caller decides what an imbalance MEANS — a validator
 *  returning `{ data, error }`, or a filter listing unbalanced journals. Use
 *  assertBalanced where the only correct response is to refuse. */
export function isBalanced(
  debits: number,
  credits: number,
  tolerance: number = EPSILON
): boolean {
  return Math.abs(debits - credits) <= tolerance;
}

/** isBalanced, for posting paths where an imbalance can only mean "stop": throws
 *  with the drift so posting refuses rather than mis-posts. */
export function assertBalanced(
  debits: number,
  credits: number,
  tolerance: number = EPSILON,
  label = "Journal"
): void {
  if (!isBalanced(debits, credits, tolerance)) {
    throw new Error(
      `${label} does not balance (off by ${round(debits - credits)}); refusing to post`
    );
  }
}
