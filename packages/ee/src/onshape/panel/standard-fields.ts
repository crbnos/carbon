// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The item fields an Onshape property can set. Each `writer` key has one
 * function in the ERP's `STANDARD_FIELD_WRITERS` (onshape-push.server.ts),
 * the item page's own write, so its cascades run.
 */

import {
  ITEM_METHOD_TYPES,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_SOURCING_TYPES,
  ITEM_TRACKING_TYPES
} from "./item-values";
import type { PlanUnitOfMeasure } from "./plan";

export const STANDARD_FIELD_IDS = [
  "mpn",
  "replenishmentSystem",
  "defaultMethodType",
  "sourcingType",
  "itemTrackingType",
  "unitOfMeasureCode"
] as const;

export type StandardFieldId = (typeof STANDARD_FIELD_IDS)[number];

/**
 * - `itemColumn`: the column alone, as the Properties panel writes it.
 * - `itemMethod`: replenishment, method, sourcing; cascades to Draft methods.
 * - `itemTracking`: tracking type; cascades to open jobs, receipts, shipments.
 */
export type StandardFieldWriter = "itemColumn" | "itemMethod" | "itemTracking";

export type StandardField = {
  id: StandardFieldId;
  label: string;
  kind: "text" | "list";
  /** Null for text, and for the unit: the company's units, read at plan time. */
  values: readonly string[] | null;
  valueTypes: readonly string[];
  writer: StandardFieldWriter;
  /** A write also changes Draft BOMs or open jobs; the Fields page says so. */
  cascades: boolean;
};

const LIST_VALUE_TYPES = ["STRING", "ENUM", "BOOL"] as const;

export const STANDARD_FIELDS: readonly StandardField[] = [
  {
    id: "mpn",
    label: "Manufacturer Part Number",
    kind: "text",
    values: null,
    valueTypes: ["STRING", "ENUM", "OBJECT"],
    writer: "itemColumn",
    cascades: false
  },
  {
    id: "replenishmentSystem",
    label: "Replenishment",
    kind: "list",
    values: ITEM_REPLENISHMENT_SYSTEMS,
    valueTypes: LIST_VALUE_TYPES,
    writer: "itemMethod",
    cascades: true
  },
  {
    id: "defaultMethodType",
    label: "Default Method Type",
    kind: "list",
    values: ITEM_METHOD_TYPES,
    valueTypes: LIST_VALUE_TYPES,
    writer: "itemMethod",
    cascades: true
  },
  {
    id: "sourcingType",
    label: "Sourcing",
    kind: "list",
    values: ITEM_SOURCING_TYPES,
    valueTypes: LIST_VALUE_TYPES,
    writer: "itemMethod",
    cascades: true
  },
  {
    id: "itemTrackingType",
    label: "Tracking Type",
    kind: "list",
    values: ITEM_TRACKING_TYPES,
    valueTypes: LIST_VALUE_TYPES,
    writer: "itemTracking",
    cascades: true
  },
  {
    id: "unitOfMeasureCode",
    label: "Unit of Measure",
    kind: "list",
    values: null,
    valueTypes: ["STRING", "ENUM"],
    writer: "itemColumn",
    cascades: false
  }
];

const FIELD_BY_ID = new Map<string, StandardField>(
  STANDARD_FIELDS.map((field) => [field.id, field])
);

export function standardField(id: string): StandardField | undefined {
  return FIELD_BY_ID.get(id);
}

export function isStandardFieldId(value: unknown): value is StandardFieldId {
  return typeof value === "string" && FIELD_BY_ID.has(value);
}

export type ValueTranslation = {
  onshape: string;
  /** Null is "No value": the next precedence rule decides. */
  carbon: string | null;
};

export function standardFieldValues(
  field: StandardField,
  units: readonly PlanUnitOfMeasure[]
): string[] {
  if (field.kind !== "list") return [];
  return field.values ? [...field.values] : units.map((unit) => unit.code);
}

/** The fixed rows a translation can list; null when rows are typed by hand. */
export function onshapeValueOptions(
  valueType: string,
  options: readonly string[] | undefined
): string[] | null {
  if (valueType === "BOOL") return ["Yes", "No"];
  if (valueType === "ENUM" && options && options.length > 0) {
    return [...options];
  }
  return null;
}

/**
 * A new mapping's rows. Known Onshape options get a row only when they name a
 * Carbon value, so the review flags the rest. Unknown options: one identity
 * row per Carbon value. The unit gets none: values match a unit's code or name.
 */
export function defaultTranslations(
  field: StandardField,
  valueType: string,
  options?: readonly string[]
): ValueTranslation[] {
  if (field.kind !== "list") return [];
  if (valueType === "BOOL") {
    return [
      { onshape: "Yes", carbon: null },
      { onshape: "No", carbon: null }
    ];
  }
  if (!field.values) return [];
  const values = field.values;
  const listed = onshapeValueOptions(valueType, options);
  if (listed) {
    return listed.flatMap((option) => {
      const carbon = values.find((value) => sameText(value, option));
      return carbon ? [{ onshape: option, carbon }] : [];
    });
  }
  return values.map((value) => ({ onshape: value, carbon: value }));
}

export function untranslatedOptions(
  field: StandardField,
  options: readonly string[],
  translations: readonly ValueTranslation[],
  units: readonly PlanUnitOfMeasure[]
): string[] {
  return options.filter(
    (option) =>
      !translateValue({
        field,
        text: option,
        valueType: "ENUM",
        translations,
        units
      }).ok
  );
}

/**
 * Typed rows that repeat a fixed option or an earlier row, so the values
 * window stops what the save would refuse. An empty row is not a repeat.
 */
export function repeatedTranslationRows(
  rows: readonly { onshape: string; fixed: boolean }[]
): number[] {
  const seen = new Set<string>();
  const repeated: number[] = [];
  rows.forEach((row, index) => {
    const key = row.onshape.trim().toLowerCase();
    if (key === "") return;
    if (seen.has(key) && !row.fixed) repeated.push(index);
    seen.add(key);
  });
  return repeated;
}

/** The unit a value matches with no translation row: by code, then by name. */
export function matchingUnit(
  text: string,
  units: readonly PlanUnitOfMeasure[]
): { unit: PlanUnitOfMeasure; by: "code" | "name" } | null {
  const byCode = units.find((unit) => sameText(unit.code, text));
  if (byCode) return { unit: byCode, by: "code" };
  const byName = units.find((unit) => sameText(unit.name, text));
  return byName ? { unit: byName, by: "name" } : null;
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function booleanText(text: string): string {
  if (/^(true|yes|on)$/i.test(text)) return "Yes";
  if (/^(false|no|off)$/i.test(text)) return "No";
  return text;
}

export type TranslatedValue =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

/**
 * Matching ignores case and surrounding spaces. An empty value is no value,
 * never a problem; a list value nothing matches is a problem.
 */
export function translateValue({
  field,
  text,
  valueType,
  translations,
  units
}: {
  field: StandardField;
  text: string | null;
  valueType: string;
  translations: readonly ValueTranslation[];
  units: readonly PlanUnitOfMeasure[];
}): TranslatedValue {
  if (text === null || text.trim() === "") return { ok: true, value: null };
  const value = text.trim();
  if (field.kind === "text") return { ok: true, value };

  const onshape = valueType === "BOOL" ? booleanText(value) : value;
  const row = translations.find((entry) => sameText(entry.onshape, onshape));
  if (row) return { ok: true, value: row.carbon };

  if (field.id === "unitOfMeasureCode") {
    const unit =
      units.find((entry) => sameText(entry.code, onshape)) ??
      units.find((entry) => sameText(entry.name, onshape));
    if (unit) return { ok: true, value: unit.code };
  }
  return { ok: false, reason: `"${value}" has no Carbon value` };
}

export function translationErrors(
  field: StandardField,
  translations: readonly ValueTranslation[],
  units: readonly PlanUnitOfMeasure[]
): string[] {
  if (field.kind !== "list") {
    return translations.length > 0
      ? [`${field.label} takes the Onshape value as it is`]
      : [];
  }
  const errors: string[] = [];
  const allowed = standardFieldValues(field, units);
  const seen = new Set<string>();
  for (const row of translations) {
    const key = row.onshape.trim().toLowerCase();
    if (key === "") {
      errors.push("A translation row has no Onshape value");
      continue;
    }
    if (seen.has(key)) {
      errors.push(`"${row.onshape.trim()}" has two rows`);
    }
    seen.add(key);
    if (row.carbon !== null && !allowed.includes(row.carbon)) {
      errors.push(`"${row.carbon}" is not a ${field.label} value in Carbon`);
    }
  }
  return errors;
}
