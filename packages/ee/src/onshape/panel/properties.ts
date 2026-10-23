// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Onshape properties → part custom fields and item fields, through the
// company's property map (`propertyMap` on the integration metadata).

import { parseDate } from "@internationalized/date";
import type { PlanUnitOfMeasure } from "./plan";
import type { StandardFieldId, ValueTranslation } from "./standard-fields";
import {
  defaultTranslations,
  isStandardFieldId,
  standardField,
  translateValue
} from "./standard-fields";

export type OnshapePropertyValue = {
  propertyId: string;
  name: string;
  valueType: string;
  value: unknown;
  editable?: boolean;
  /** An ENUM's options as labels, when the metadata lists them. */
  options?: string[];
};

/**
 * "create" (Set at creation): written only to an item the push creates.
 * "everyPush" (Update on every push): also replaces Carbon's value on an
 * existing item the push links.
 */
export const MAPPING_MODES = ["create", "everyPush"] as const;
export type MappingMode = (typeof MAPPING_MODES)[number];

export type PropertyMapTarget =
  | { kind: "customField"; fieldId: string }
  | { kind: "item"; field: StandardFieldId };

export type PropertyMapEntry = {
  onshapePropertyId: string;
  /** Display, and the BOM column fallback; the propertyId is the join. */
  onshapeName: string;
  valueType: string;
  target: PropertyMapTarget;
  mode: MappingMode;
  /** List item fields only: Onshape value → Carbon value. */
  translations?: ValueTranslation[];
};

export type DescriptionModes = {
  /** Short Description (`item.name`). */
  name: MappingMode;
  /** Long Description (`item.description`). */
  description: MappingMode;
};

export const DEFAULT_DESCRIPTION_MODES: DescriptionModes = {
  name: "create",
  description: "create"
};

export type PlanCustomFieldDefinition = {
  id: string;
  name: string;
  /** A `CUSTOM_FIELD_DATA_TYPES` value. */
  dataTypeId: number;
  listOptions: string[] | null;
};

export type PlanCustomField = {
  fieldId: string;
  name: string;
  mode: MappingMode;
  dataTypeId: number;
  listOptions: string[] | null;
  /** Coerced to the Carbon type; null when Onshape holds no value. */
  value: string | number | boolean | null;
  onshapeName: string;
  /** Existing items only: Carbon's current value as text, null when none. */
  replaces?: string | null;
};

export type PlanItemField = {
  field: StandardFieldId;
  label: string;
  /** After translation; null writes nothing. */
  value: string | null;
  mode: MappingMode;
  onshapeName: string;
};

export type UnmappedProperty = {
  propertyId: string;
  name: string;
  valueType: string;
  value: string;
};

/**
 * A ticked Yes/No custom field: the ERP checkbox's post value, and what its
 * tables test for. A JSON `true` renders unticked; unticked is no key.
 */
export const BOOLEAN_TRUE = "on";

export const CUSTOM_FIELD_DATA_TYPES = {
  boolean: 1,
  date: 2,
  list: 3,
  numeric: 4,
  text: 5
} as const;

export const CUSTOM_FIELD_TYPE_LABELS: Record<number, string> = {
  [CUSTOM_FIELD_DATA_TYPES.boolean]: "Yes/No",
  [CUSTOM_FIELD_DATA_TYPES.date]: "Date",
  [CUSTOM_FIELD_DATA_TYPES.list]: "List",
  [CUSTOM_FIELD_DATA_TYPES.numeric]: "Numeric",
  [CUSTOM_FIELD_DATA_TYPES.text]: "Text"
};

/**
 * The custom field type each Onshape value type maps onto; absent types (USER,
 * BLOB, …) are not mappable. Textual types land on Text, never List: Onshape
 * owns the value and its options, so Carbon keeps an unconstrained copy.
 */
export const MAPPABLE_VALUE_TYPES: Record<string, readonly number[]> = {
  STRING: [CUSTOM_FIELD_DATA_TYPES.text],
  BOOL: [CUSTOM_FIELD_DATA_TYPES.boolean],
  INT: [CUSTOM_FIELD_DATA_TYPES.numeric],
  DOUBLE: [CUSTOM_FIELD_DATA_TYPES.numeric],
  DATE: [CUSTOM_FIELD_DATA_TYPES.date],
  ENUM: [CUSTOM_FIELD_DATA_TYPES.text],
  // Material and similar objects map as their display name.
  OBJECT: [CUSTOM_FIELD_DATA_TYPES.text]
};

/**
 * Identity, description and lifecycle properties: never "not mapped". Lower
 * case, since a BOM template can relabel a column in any case.
 */
const RESERVED_PROPERTY_NAMES = new Set([
  "name",
  "part number",
  "revision",
  "description",
  "state",
  "exclude from bom",
  "not revision managed"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A list value as its option's label: the metadata API sends the stored value
 * ("2"), a BOM cell the label ("Released"), and a mapping must see one text.
 */
function enumLabel(value: unknown, options: unknown): unknown {
  if (typeof value !== "string" || !Array.isArray(options)) return value;
  const option = options.find(
    (entry) => isRecord(entry) && entry.value === value
  );
  const label = isRecord(option) ? option.label : null;
  return typeof label === "string" && label.trim() !== "" ? label : value;
}

function enumOptions(options: unknown): string[] | null {
  if (!Array.isArray(options)) return null;
  const labels: string[] = [];
  for (const option of options) {
    if (!isRecord(option)) continue;
    const label = enumLabel(option.value, options);
    if (typeof label === "string" && label.trim() !== "") labels.push(label);
  }
  return labels.length > 0 ? labels : null;
}

/**
 * "N/A" is Onshape's BOM text for a property the row does not have (a
 * part-only property on an assembly row). Read as no value on every path.
 */
export function isNotApplicable(value: unknown): boolean {
  return typeof value === "string" && value.trim() === "N/A";
}

export function parseProperties(payload: unknown): OnshapePropertyValue[] {
  const properties = isRecord(payload) ? payload.properties : null;
  if (!Array.isArray(properties)) return [];
  const out: OnshapePropertyValue[] = [];
  for (const property of properties) {
    if (!isRecord(property)) continue;
    const propertyId = property.propertyId;
    const name = property.name;
    const valueType = property.valueType;
    if (typeof propertyId !== "string" || typeof name !== "string") continue;
    const options =
      valueType === "ENUM" ? enumOptions(property.enumValues) : null;
    out.push({
      propertyId,
      name,
      valueType: typeof valueType === "string" ? valueType : "STRING",
      value: isNotApplicable(property.value)
        ? null
        : valueType === "ENUM"
          ? enumLabel(property.value, property.enumValues)
          : property.value,
      editable:
        typeof property.editable === "boolean" ? property.editable : undefined,
      ...(options ? { options } : {})
    });
  }
  return out;
}

/** Per-part properties from element metadata at `depth=2`; null if not nested. */
export function partPropertiesFromElementMetadata(
  payload: unknown
): Map<string, OnshapePropertyValue[]> | null {
  const parts = isRecord(payload) ? payload.parts : null;
  const items = isRecord(parts) ? parts.items : null;
  if (!Array.isArray(items) || items.length === 0) return null;
  const byPartId = new Map<string, OnshapePropertyValue[]>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const partId = item.partId;
    if (typeof partId !== "string") continue;
    byPartId.set(partId, parseProperties(item));
  }
  return byPartId.size > 0 ? byPartId : null;
}

export function propertyDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? null : text;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isRecord(value)) {
    const display = value.displayName ?? value.name;
    return typeof display === "string" && display.trim() !== ""
      ? display
      : null;
  }
  return null;
}

/** An absent value is `{ ok: true, value: null }`: not written, no problem. */
export function coerceOnshapeValue(
  value: unknown,
  dataTypeId: number,
  listOptions: string[] | null
):
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; reason: string } {
  const text = propertyDisplayValue(value);
  switch (dataTypeId) {
    case CUSTOM_FIELD_DATA_TYPES.boolean: {
      if (typeof value === "boolean") {
        return { ok: true, value: value ? BOOLEAN_TRUE : null };
      }
      if (text === null) return { ok: true, value: null };
      if (/^(true|yes|on)$/i.test(text)) {
        return { ok: true, value: BOOLEAN_TRUE };
      }
      if (/^(false|no|off)$/i.test(text)) return { ok: true, value: null };
      return { ok: false, reason: `"${text}" is not yes/no` };
    }
    case CUSTOM_FIELD_DATA_TYPES.date: {
      if (text === null) return { ok: true, value: null };
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return { ok: false, reason: `"${text}" is not a date` };
      const [, year, month, day] = match as unknown as [
        string,
        string,
        string,
        string
      ];
      // The regex passes "2026-13-40"; `parseDate` refuses it.
      try {
        return {
          ok: true,
          value: parseDate(`${year}-${month}-${day}`).toString()
        };
      } catch {
        return { ok: false, reason: `"${text}" is not a date` };
      }
    }
    case CUSTOM_FIELD_DATA_TYPES.numeric: {
      if (typeof value === "number" && Number.isFinite(value)) {
        return { ok: true, value };
      }
      if (text === null) return { ok: true, value: null };
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        return { ok: false, reason: `"${text}" is not a number` };
      }
      return { ok: true, value: parsed };
    }
    case CUSTOM_FIELD_DATA_TYPES.list: {
      if (text === null) return { ok: true, value: null };
      // Not checked against listOptions: the text is written as it is.
      return { ok: true, value: text };
    }
    case CUSTOM_FIELD_DATA_TYPES.text:
      return { ok: true, value: text };
    default:
      return { ok: false, reason: "unsupported field type" };
  }
}

function isMappingMode(value: unknown): value is MappingMode {
  return value === "create" || value === "everyPush";
}

function parseTranslations(value: unknown): ValueTranslation[] | null {
  if (!Array.isArray(value)) return null;
  const out: ValueTranslation[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.onshape !== "string") continue;
    out.push({
      onshape: row.onshape,
      carbon: typeof row.carbon === "string" ? row.carbon : null
    });
  }
  return out;
}

/**
 * Also reads a bare `carbonFieldId` as a custom field target and mode "owned"
 * as "everyPush". A list item field stored without translations gets the
 * default rows.
 */
export function parsePropertyMap(metadata: unknown): PropertyMapEntry[] {
  const raw = isRecord(metadata) ? metadata.propertyMap : null;
  if (!Array.isArray(raw)) return [];
  const out: PropertyMapEntry[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { onshapePropertyId, onshapeName, valueType, carbonFieldId } = entry;
    if (typeof onshapePropertyId !== "string") continue;
    const type = typeof valueType === "string" ? valueType : "STRING";

    let target: PropertyMapTarget | null = null;
    const stored = isRecord(entry.target) ? entry.target : null;
    if (stored?.kind === "customField" && typeof stored.fieldId === "string") {
      target = { kind: "customField", fieldId: stored.fieldId };
    } else if (stored?.kind === "item" && isStandardFieldId(stored.field)) {
      target = { kind: "item", field: stored.field };
    } else if (!stored && typeof carbonFieldId === "string") {
      target = { kind: "customField", fieldId: carbonFieldId };
    }
    if (!target) continue;

    const mode: MappingMode =
      entry.mode === "everyPush" || entry.mode === "owned"
        ? "everyPush"
        : "create";
    const mapped: PropertyMapEntry = {
      onshapePropertyId,
      onshapeName: typeof onshapeName === "string" ? onshapeName : "",
      valueType: type,
      target,
      mode
    };
    if (target.kind === "item") {
      const field = standardField(target.field);
      if (field?.kind === "list") {
        mapped.translations =
          parseTranslations(entry.translations) ??
          defaultTranslations(field, type);
      }
    }
    out.push(mapped);
  }
  return out;
}

export function parseDescriptionModes(metadata: unknown): DescriptionModes {
  const raw = isRecord(metadata) ? metadata.descriptionModes : null;
  const modes = isRecord(raw) ? raw : {};
  return {
    name: isMappingMode(modes.name) ? modes.name : "create",
    description: isMappingMode(modes.description) ? modes.description : "create"
  };
}

/** The Carbon fields every push overwrites, for the item card. */
export function everyPushTargets(metadata: unknown): {
  descriptions: Array<keyof DescriptionModes>;
  itemFields: StandardFieldId[];
  customFieldIds: string[];
} {
  const modes = parseDescriptionModes(metadata);
  const map = parsePropertyMap(metadata).filter(
    (entry) => entry.mode === "everyPush"
  );
  return {
    descriptions: (["name", "description"] as const).filter(
      (field) => modes[field] === "everyPush"
    ),
    itemFields: map.flatMap((entry) =>
      entry.target.kind === "item" ? [entry.target.field] : []
    ),
    customFieldIds: map.flatMap((entry) =>
      entry.target.kind === "customField" ? [entry.target.fieldId] : []
    )
  };
}

export function targetKey(target: PropertyMapTarget): string {
  return target.kind === "customField"
    ? `customField:${target.fieldId}`
    : `item:${target.field}`;
}

/**
 * A map entry without `onshapeName` and `valueType`: both are re-read from
 * Onshape on every load, so a change in either is not the user's decision.
 */
type PropertyMapDecision = {
  onshapePropertyId: string;
  target: PropertyMapTarget;
  mode: MappingMode;
  translations?: ValueTranslation[];
};

function decisionKey(entry: PropertyMapDecision): string {
  return JSON.stringify([
    targetKey(entry.target),
    entry.mode,
    (entry.translations ?? []).map((row) => [row.onshape, row.carbon])
  ]);
}

/** Order is ignored: editing a row moves it to the end of the Fields draft. */
export function propertyMapEqual(
  a: readonly PropertyMapDecision[],
  b: readonly PropertyMapDecision[]
): boolean {
  if (a.length !== b.length) return false;
  const index = new Map(a.map((entry) => [entry.onshapePropertyId, entry]));
  if (index.size !== a.length) return false;
  // A key repeated in `b` can stand in for one it dropped.
  const seen = new Set<string>();
  for (const entry of b) {
    if (seen.has(entry.onshapePropertyId)) return false;
    seen.add(entry.onshapePropertyId);
    const other = index.get(entry.onshapePropertyId);
    if (!other) return false;
    if (decisionKey(other) !== decisionKey(entry)) return false;
  }
  return true;
}

/**
 * `matchByName` is for a BOM row: its cells are keyed by column, and a column
 * whose id is not the property id still matches by the property's name.
 */
export function resolveMappedFields({
  properties,
  map,
  definitions,
  units = [],
  matchByName = false
}: {
  properties: OnshapePropertyValue[];
  map: PropertyMapEntry[];
  definitions: PlanCustomFieldDefinition[];
  units?: readonly PlanUnitOfMeasure[];
  matchByName?: boolean;
}): {
  fields: PlanCustomField[];
  itemFields: PlanItemField[];
  problems: string[];
  unmapped: UnmappedProperty[];
} {
  const definitionById = new Map(definitions.map((d) => [d.id, d]));
  const propertyById = new Map(properties.map((p) => [p.propertyId, p]));
  const propertyByName = new Map<string, OnshapePropertyValue>();
  if (matchByName) {
    for (const property of properties) {
      if (!propertyByName.has(property.name)) {
        propertyByName.set(property.name, property);
      }
    }
  }
  const fields: PlanCustomField[] = [];
  const itemFields: PlanItemField[] = [];
  const problems: string[] = [];
  const used = new Set<string>();

  for (const entry of map) {
    const property =
      propertyById.get(entry.onshapePropertyId) ??
      (entry.onshapeName ? propertyByName.get(entry.onshapeName) : undefined);
    if (!property) continue;
    used.add(property.propertyId);

    if (entry.target.kind === "item") {
      const field = standardField(entry.target.field);
      if (!field) continue;
      const translated = translateValue({
        field,
        text: propertyDisplayValue(property.value),
        // The map's type: a BOM column may not report one.
        valueType: entry.valueType,
        translations: entry.translations ?? [],
        units
      });
      if (!translated.ok) {
        problems.push(
          `${property.name}: ${translated.reason}. ${field.label} not written.`
        );
        continue;
      }
      itemFields.push({
        field: field.id,
        label: field.label,
        value: translated.value,
        mode: entry.mode,
        onshapeName: property.name
      });
      continue;
    }

    const definition = definitionById.get(entry.target.fieldId);
    if (!definition) {
      problems.push(
        `${property.name}: the mapped Carbon field no longer exists`
      );
      continue;
    }
    const coerced = coerceOnshapeValue(
      property.value,
      definition.dataTypeId,
      definition.listOptions
    );
    if (!coerced.ok) {
      problems.push(`${property.name} → ${definition.name}: ${coerced.reason}`);
      continue;
    }
    fields.push({
      fieldId: definition.id,
      name: definition.name,
      mode: entry.mode,
      dataTypeId: definition.dataTypeId,
      listOptions: definition.listOptions,
      value: coerced.value,
      onshapeName: property.name
    });
  }

  const unmapped: UnmappedProperty[] = [];
  for (const property of properties) {
    if (used.has(property.propertyId)) continue;
    const value = propertyDisplayValue(property.value);
    if (
      value !== null &&
      !RESERVED_PROPERTY_NAMES.has(String(property.name).trim().toLowerCase())
    ) {
      unmapped.push({
        propertyId: property.propertyId,
        name: property.name,
        valueType: property.valueType,
        value
      });
    }
  }
  return { fields, itemFields, problems, unmapped };
}

/**
 * A create takes every non-null value. An existing item takes the "everyPush"
 * fields only, nulls included, so a property emptied in Onshape is cleared.
 */
export function mappedFieldValues(
  fields: PlanCustomField[],
  isCreate: boolean
): {
  values: Record<string, string | number | boolean | null>;
  fieldIds: Set<string>;
} {
  const values: Record<string, string | number | boolean | null> = {};
  const fieldIds = new Set<string>();
  for (const field of fields) {
    if (isCreate ? field.value === null : field.mode !== "everyPush") continue;
    values[field.fieldId] = field.value;
    fieldIds.add(field.fieldId);
  }
  return { values, fieldIds };
}

export function customFieldDisplayValue(
  field: Pick<PlanCustomField, "value" | "dataTypeId">
): string {
  if (field.dataTypeId === CUSTOM_FIELD_DATA_TYPES.boolean) {
    return field.value === BOOLEAN_TRUE || field.value === true ? "Yes" : "—";
  }
  if (field.value === null) return "—";
  if (typeof field.value === "boolean") return field.value ? "Yes" : "No";
  return String(field.value);
}

/** Only keys in `allowedFieldIds` change; a null deletes its key. */
export function mergeCustomFieldValues(
  current: unknown,
  values: Record<string, string | number | boolean | null>,
  allowedFieldIds: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  for (const [fieldId, value] of Object.entries(values)) {
    if (!allowedFieldIds.has(fieldId)) continue;
    if (value === null) delete out[fieldId];
    else out[fieldId] = value;
  }
  return out;
}

/** The item forms save a blank custom field as `""`. */
function isBlankCustomValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * The "everyPush" fields whose value differs from Carbon's. A clear of a field
 * Carbon does not hold is dropped, so the review says "Clears" only when
 * something is.
 */
export function customFieldWrites(
  current: unknown,
  fields: PlanCustomField[]
): PlanCustomField[] {
  const held = isRecord(current) ? current : {};
  return fields.filter((field) => {
    if (field.mode !== "everyPush") return false;
    const value = held[field.fieldId];
    return field.value === null
      ? !isBlankCustomValue(value)
      : value !== field.value;
  });
}

/** "create" fields Onshape holds another value for: shown, never written. */
export function customFieldKeptDifferences(
  current: unknown,
  fields: PlanCustomField[]
): PlanCustomField[] {
  const held = isRecord(current) ? current : {};
  return fields.filter(
    (field) =>
      field.mode === "create" &&
      field.value !== null &&
      held[field.fieldId] !== field.value
  );
}
