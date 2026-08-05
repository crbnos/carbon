// Length-unit conversion for cut lists.
//
// A cut list works in one unit (its unitOfDimension), but the stock dimension
// on an item carries its own unit, and a remnant lot records the unit it was
// measured in. Those can legitimately differ: a shop buys tube in mm and bar in
// inches, and both can end up in front of the same planner.
//
// Comparing 150 (mm) against 240 (inches) as bare numbers produces a plan that
// looks fine and is completely wrong, so every length crossing that boundary
// goes through here. Pure, no imports — same discipline as ffd.ts.

export const LENGTH_UNITS = ["in", "ft", "mm", "cm", "m"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/**
 * Micrometres per unit — integers on purpose. A millimetre base makes 25.4 and
 * 304.8 the factors, and 304.8 / 25.4 evaluates to 12.000000000000002, so a
 * 1 ft bar converts to a hair over 12 in and a piece that should fit exactly
 * reports as too long. Every value here is an exactly-representable integer,
 * so the ratios (ft→in = 304800/25400) come out exact.
 */
const MICRONS_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1_000,
  cm: 10_000,
  m: 1_000_000,
  in: 25_400,
  ft: 304_800
};

export function isLengthUnit(value: unknown): value is LengthUnit {
  return (
    typeof value === "string" &&
    (LENGTH_UNITS as readonly string[]).includes(value)
  );
}

/**
 * Convert a length between units. Returns null when either unit is unknown —
 * callers must treat that as "cannot compare", never as zero, or a piece would
 * silently look like it fits.
 */
export function convertLength(
  value: number,
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  if (!isLengthUnit(from) || !isLengthUnit(to)) return null;
  if (from === to) return value;
  return (value * MICRONS_PER_UNIT[from]) / MICRONS_PER_UNIT[to];
}
