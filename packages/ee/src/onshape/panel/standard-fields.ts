// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The Carbon item fields an Onshape property can set: the target list.
 *
 * This is the one place an item field becomes mappable. Each field declares
 * its kind, its valid values, the Onshape value types it accepts and the
 * writer that sets it on an existing item. The ERP holds one function per
 * writer key (`STANDARD_FIELD_WRITERS`, apps/erp onshape-push.server.ts), and
 * each is the code the item page itself uses, so its cascades run. There is
 * no generic "property X into column Y" write.
 *
 * A list field carries a value translation, Onshape value → Carbon value. A
 * value no row matches is a problem the review shows; the push skips it.
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
 * How an existing item's field is written:
 * - `itemColumn`: the column alone, as the Properties panel writes it.
 * - `itemMethod`: replenishment, default method and sourcing, with the
 *   cascade onto Draft make methods.
 * - `itemTracking`: tracking type, with the cascade onto Draft and Planned
 *   jobs and Draft receipt and shipment lines.
 */
export type StandardFieldWriter = "itemColumn" | "itemMethod" | "itemTracking";

export type StandardField = {
  id: StandardFieldId;
  /** The label the item page uses. */
  label: string;
  kind: "text" | "list";
  /**
   * The Carbon values of a fixed list. Null for text, and for the unit, whose
   * values are the company's own units, read at plan time.
   */
  values: readonly string[] | null;
  /** The Onshape value types the field accepts. */
  valueTypes: readonly string[];
  writer: StandardFieldWriter;
  /** A write also changes Draft BOMs or open jobs (help text on the Fields page). */
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

/** One row of a translation: an Onshape value and the Carbon value it sets. */
export type ValueTranslation = {
  onshape: string;
  /** Null is "No value": the next rule in the precedence order decides. */
  carbon: string | null;
};

/** The Carbon values a list field accepts: its fixed list or the unit codes. */
export function standardFieldValues(
  field: StandardField,
  units: readonly PlanUnitOfMeasure[]
): string[] {
  if (field.kind !== "list") return [];
  return field.values ? [...field.values] : units.map((unit) => unit.code);
}

/**
 * The rows a new mapping starts with. A fixed list gets one row per Carbon
 * value with its own text on the Onshape side, so an Onshape list with the
 * same options needs no setup. A BOOL property gets Yes and No, both "No
 * value". The unit gets none: a value matches a unit's code or name.
 */
export function defaultTranslations(
  field: StandardField,
  valueType: string
): ValueTranslation[] {
  if (field.kind !== "list") return [];
  if (valueType === "BOOL") {
    return [
      { onshape: "Yes", carbon: null },
      { onshape: "No", carbon: null }
    ];
  }
  return (field.values ?? []).map((value) => ({
    onshape: value,
    carbon: value
  }));
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A BOOL value as the "Yes" or "No" a translation row names. */
function booleanText(text: string): string {
  if (/^(true|yes|on)$/i.test(text)) return "Yes";
  if (/^(false|no|off)$/i.test(text)) return "No";
  return text;
}

export type TranslatedValue =
  | { ok: true; value: string | null }
  | { ok: false; reason: string };

/**
 * An Onshape value as the Carbon value of an item field.
 *
 * An empty value gives no value; it is never a problem. A list value matches
 * a translation row, ignoring case and the spaces at the two ends; a unit
 * value then matches a unit's code or name. A value nothing matches is a
 * problem.
 */
export function translateValue({
  field,
  text,
  valueType,
  translations,
  units
}: {
  field: StandardField;
  /** The Onshape value as display text; null when empty. */
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

/**
 * Why a translation cannot be saved: a Carbon value outside the field's list,
 * or two rows for one Onshape value. Empty when it is valid.
 */
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
