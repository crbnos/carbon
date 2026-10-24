// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isUnitOfMeasureActiveByDefault,
  seedUnitsOfMeasure,
  unitOfMeasureCatalog
} from "./units-of-measure";

const key = (value: string) => value.replace(/\s+/g, "").toLowerCase();

const activeNames = (useMetric: boolean) =>
  seedUnitsOfMeasure(useMetric)
    .filter((unit) => unit.active)
    .map((unit) => unit.name);

describe("unitOfMeasureCatalog", () => {
  it("gives each unit its own code and name, ignoring case, within the column limits", () => {
    const codes = unitOfMeasureCatalog.map((u) => key(u.code));
    const names = unitOfMeasureCatalog.map((u) => key(u.name));
    // The unit_of_measure_enforce_unique_code interceptor refuses a code that
    // differs from another only in case.
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(names).size).toBe(names.length);
    for (const unit of unitOfMeasureCatalog) {
      expect(unit.code).not.toMatch(/\s/);
      expect(unit.code.length).toBeLessThanOrEqual(10);
      expect(unit.name.length).toBeLessThanOrEqual(50);
    }
  });

  it("uses SI symbols for metric codes", () => {
    const metric = unitOfMeasureCatalog
      .filter((u) => u.group === "Metric")
      .map((u) => u.code);
    expect(metric).toEqual([
      "g",
      "kg",
      "t",
      "mm",
      "cm",
      "m",
      "m2",
      "m3",
      "mL",
      "L"
    ]);
  });
});

describe("seedUnitsOfMeasure", () => {
  it("seeds every catalog unit, whatever the measurement system", () => {
    for (const useMetric of [true, false]) {
      expect(seedUnitsOfMeasure(useMetric).map((u) => u.code)).toEqual(
        unitOfMeasureCatalog.map((u) => u.code)
      );
    }
  });

  it("activates the 17 units an imperial company always had, and the imperial area and volume units", () => {
    expect(activeNames(false).sort()).toEqual(
      [
        "Each",
        "Case",
        "Pack",
        "Pallet",
        "Roll",
        "Box",
        "Bag",
        "Drum",
        "Gallon",
        "Liter",
        "Ounce",
        "Pound",
        "Ton",
        "Yard",
        "Meter",
        "Inch",
        "Foot",
        "Square Foot",
        "Cubic Foot"
      ].sort()
    );
  });

  it("activates the count and metric units of a metric company, and no imperial unit", () => {
    expect(activeNames(true)).toEqual([
      "Each",
      "Case",
      "Pack",
      "Pallet",
      "Roll",
      "Box",
      "Bag",
      "Drum",
      "Gram",
      "Kilogram",
      "Tonne",
      "Millimeter",
      "Centimeter",
      "Meter",
      "Square Meter",
      "Cubic Meter",
      "Milliliter",
      "Liter"
    ]);
  });

  it("is created by the system user", () => {
    expect(
      new Set(seedUnitsOfMeasure(true).map((unit) => unit.createdBy))
    ).toEqual(new Set(["system"]));
  });
});

describe("units-of-measure-master-list migration", () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        "../supabase/migrations/20261024044646_units-of-measure-master-list.sql",
        import.meta.url
      )
    ),
    "utf8"
  );
  const rows = [
    ...sql.matchAll(/\('([^']+)', '([^']+)', (true|false), (true|false)\)/g)
  ].map(([, code, name, metric, imperial]) => ({
    code,
    name,
    activeWhenMetric: metric === "true",
    activeWhenImperial: imperial === "true"
  }));

  it("gives existing companies the catalog, active as a new company gets it", () => {
    expect(rows).toEqual(
      unitOfMeasureCatalog.map((unit) => ({
        code: unit.code,
        name: unit.name,
        activeWhenMetric: isUnitOfMeasureActiveByDefault(unit, true),
        activeWhenImperial: isUnitOfMeasureActiveByDefault(unit, false)
      }))
    );
  });
});
