// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Carbon's standard units of measure: the master list every company holds.
 * A new company gets all of them, the units of its measurement system active
 * and the others inactive; migration 20261024044646_units-of-measure-master-list
 * gave existing companies the units they lacked. Client-safe and free of imports.
 */

/**
 * One name and one code per unit. Metric codes are SI symbols with their case
 * (kg, mm, mL); the count and imperial codes are the ones every company has
 * used. Companies created before the master list keep the codes they have:
 * Meter is MT there and Liter is LT.
 */
export const unitOfMeasureCatalog = [
  { name: "Each", code: "EA", group: "Count" },
  { name: "Case", code: "CS", group: "Count" },
  { name: "Pack", code: "PK", group: "Count" },
  { name: "Pallet", code: "PL", group: "Count" },
  { name: "Roll", code: "RL", group: "Count" },
  { name: "Box", code: "BX", group: "Count" },
  { name: "Bag", code: "BG", group: "Count" },
  { name: "Drum", code: "DR", group: "Count" },
  { name: "Gram", code: "g", group: "Metric" },
  { name: "Kilogram", code: "kg", group: "Metric" },
  { name: "Tonne", code: "t", group: "Metric" },
  { name: "Millimeter", code: "mm", group: "Metric" },
  { name: "Centimeter", code: "cm", group: "Metric" },
  { name: "Meter", code: "m", group: "Metric" },
  { name: "Square Meter", code: "m2", group: "Metric" },
  { name: "Cubic Meter", code: "m3", group: "Metric" },
  { name: "Milliliter", code: "mL", group: "Metric" },
  { name: "Liter", code: "L", group: "Metric" },
  { name: "Ounce", code: "OZ", group: "Imperial" },
  { name: "Pound", code: "LB", group: "Imperial" },
  { name: "Ton", code: "TN", group: "Imperial" },
  { name: "Inch", code: "INCH", group: "Imperial" },
  { name: "Foot", code: "FOOT", group: "Imperial" },
  { name: "Yard", code: "YD", group: "Imperial" },
  { name: "Square Foot", code: "FT2", group: "Imperial" },
  { name: "Cubic Foot", code: "FT3", group: "Imperial" },
  { name: "Gallon", code: "GL", group: "Imperial" }
] as const;

export type StandardUnitOfMeasure = (typeof unitOfMeasureCatalog)[number];
export type UnitOfMeasureGroup = StandardUnitOfMeasure["group"];
export type StandardUnitOfMeasureCode = StandardUnitOfMeasure["code"];

// Meter and Liter were in the one list every company got before the master
// list, so an imperial company keeps them active.
const metricUnitsActiveForImperial = new Set<string>([
  "m",
  "L"
] satisfies StandardUnitOfMeasureCode[]);

const catalogByCode = new Map<string, StandardUnitOfMeasure>(
  unitOfMeasureCatalog.map((unit) => [unit.code, unit])
);

/** The catalog unit with this exact code, or undefined. */
export function getStandardUnitOfMeasure(
  code: string
): StandardUnitOfMeasure | undefined {
  return catalogByCode.get(code);
}

/**
 * Whether a company starts with this unit active: count units always, metric
 * units when `companySettings.useMetric` is set, imperial units (with Meter and
 * Liter) when it is not.
 */
export function isUnitOfMeasureActiveByDefault(
  unit: StandardUnitOfMeasure,
  useMetric: boolean
): boolean {
  if (unit.group === "Count") return true;
  if (useMetric) return unit.group === "Metric";
  return (
    unit.group === "Imperial" || metricUnitsActiveForImperial.has(unit.code)
  );
}

/** The units a new company is seeded with: the whole catalog. */
export function seedUnitsOfMeasure(useMetric: boolean) {
  return unitOfMeasureCatalog.map((unit) => ({
    name: unit.name,
    code: unit.code,
    active: isUnitOfMeasureActiveByDefault(unit, useMetric),
    createdBy: "system" as const
  }));
}
