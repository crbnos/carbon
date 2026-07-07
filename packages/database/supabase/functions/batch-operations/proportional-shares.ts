// Pure integer apportionment — no I/O, no clock — so it is unit-testable with
// `deno test`. Used by batch completion to split a shared run's seconds across
// member operations proportionally to their quantity.

/**
 * Integer shares of `total` proportional to `weights`, summing EXACTLY to
 * `total` via the largest-remainder method. When every weight is 0 the split is
 * even (equal weights fallback).
 */
export function proportionalShares(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const effective = sum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sum > 0 ? sum : weights.length;
  const raw = effective.map((w) => (total * w) / effectiveSum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ frac: r - Math.floor(r), i }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] += 1;
    remainder -= 1;
  }
  return result;
}
