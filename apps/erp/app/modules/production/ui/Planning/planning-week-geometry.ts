// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure geometry for the planning grid's Stock Availability strip. No JSX, no
// lingui — unit-tested by apps/erp/test/planning-week-geometry.test.ts.

/**
 * Where the zero line sits and how tall each week's bar is, as PERCENTAGES of
 * the strip's height. The row is scaled to its own range — the largest stock
 * above zero plus the deepest shortfall below it — so the shape reads at any
 * magnitude: a part holding 20,000 and a part holding 12 both fill the strip.
 * Magnitudes are therefore comparable along a row, not between rows; the
 * tooltip and the CSV carry the numbers.
 */
export function planningWeekGeometry(values: (number | undefined)[]): {
  /** Distance of the zero line from the TOP of the strip, 0–100. */
  zero: number;
  /** Bar height per week, 0–100; 0 for a zero or missing value. */
  heights: number[];
} {
  let above = 0;
  let below = 0;
  for (const value of values) {
    if (value === undefined) continue;
    if (value > above) above = value;
    if (-value > below) below = -value;
  }
  const range = above + below;
  // nothing but zeros (or nothing at all): a flat line through the middle
  if (range === 0) return { zero: 50, heights: values.map(() => 0) };

  return {
    zero: (above / range) * 100,
    heights: values.map((value) =>
      value === undefined ? 0 : (Math.abs(value) / range) * 100
    )
  };
}
