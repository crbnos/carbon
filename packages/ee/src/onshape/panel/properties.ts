// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Onshape properties → Carbon fields.
 *
 * Onshape objects carry properties — standard (Name, Part number, Vendor,
 * Project, …) and company-defined custom ones — each with a stable
 * `propertyId` and a value type. A property can feed one of two targets:
 * a part custom field (`customField`, table "part", values as JSON on the
 * row keyed by field id), or a Carbon item field from the target list
 * (`standard-fields.ts`). The bridge is one explicit map per company, stored
 * on the Onshape integration's settings metadata.
 *
 * Each mapping has a mode. "create" (Set at creation) writes the value only
 * when a push creates the item. "everyPush" (Update on every push) also
 * writes it to an existing item the push links, replacing Carbon's value.
 * Name and Description are not mappings; their modes are on
 * `descriptionModes`.
 *
 * Everything here is pure so the plan a user reviewed is the plan that runs.
 */

import { parseDate } from "@internationalized/date";
import type { PlanUnitOfMeasure } from "./plan";
import type { StandardFieldId, ValueTranslation } from "./standard-fields";
import {
  defaultTranslations,
  isStandardFieldId,
  standardField,
  translateValue
} from "./standard-fields";

/** One property on an Onshape object, as the metadata API returns it. */
export type OnshapePropertyValue = {
  propertyId: string;
  name: string;
  /** STRING | BOOL | INT | DOUBLE | DATE | ENUM | USER | OBJECT | BLOB … */
  valueType: string;
  value: unknown;
  editable?: boolean;
};

/**
 * "create": Set at creation — the value reaches an item the push creates, and
 * Carbon owns the field after that. "everyPush": Update on every push — the
 * value also replaces Carbon's on an existing item the push links.
 */
export const MAPPING_MODES = ["create", "everyPush"] as const;
export type MappingMode = (typeof MAPPING_MODES)[number];

/** What a mapping writes: a part custom field or an item field. */
export type PropertyMapTarget =
  | { kind: "customField"; fieldId: string }
  | { kind: "item"; field: StandardFieldId };

/** One entry of the company's property map (integration settings metadata). */
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

/** The modes of the two descriptions, which every push reads from Onshape. */
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

/** A Carbon custom field definition the panel needs (customField row). */
export type PlanCustomFieldDefinition = {
  id: string;
  name: string;
  /** attributeDataType id: 1 Yes/No, 2 Date, 3 List, 4 Numeric, 5 Text. */
  dataTypeId: number;
  listOptions: string[] | null;
};

/** A mapped field on a plan row: what apply would write, shown for review. */
export type PlanCustomField = {
  fieldId: string;
  name: string;
  mode: MappingMode;
  dataTypeId: number;
  listOptions: string[] | null;
  /** Coerced to the Carbon type; null when Onshape holds no value. */
  value: string | number | boolean | null;
  /** The Onshape property it came from, for the review's provenance line. */
  onshapeName: string;
  /**
   * A write to an existing item only: Carbon's value it replaces, as display
   * text; null when Carbon holds none.
   */
  replaces?: string | null;
};

/** A mapped item field on a plan row, with the property it came from. */
export type PlanItemField = {
  field: StandardFieldId;
  label: string;
  /**
   * The Carbon value after translation. Null is "No value": nothing is
   * written, and the next rule in the precedence order decides.
   */
  value: string | null;
  mode: MappingMode;
  /** The Onshape property it came from, for the review's provenance line. */
  onshapeName: string;
};

/** An Onshape property with a value that no map entry covers. */
export type UnmappedProperty = {
  propertyId: string;
  name: string;
  valueType: string;
  value: string;
};

/** What a ticked Yes/No custom field stores (the ERP checkbox's post value). */
export const BOOLEAN_TRUE = "on";

export const CUSTOM_FIELD_DATA_TYPES = {
  boolean: 1,
  date: 2,
  list: 3,
  numeric: 4,
  text: 5
} as const;

/** A custom field type's name, as Carbon's custom field settings show it. */
export const CUSTOM_FIELD_TYPE_LABELS: Record<number, string> = {
  [CUSTOM_FIELD_DATA_TYPES.boolean]: "Yes/No",
  [CUSTOM_FIELD_DATA_TYPES.date]: "Date",
  [CUSTOM_FIELD_DATA_TYPES.list]: "List",
  [CUSTOM_FIELD_DATA_TYPES.numeric]: "Numeric",
  [CUSTOM_FIELD_DATA_TYPES.text]: "Text"
};

/**
 * Which Carbon data types an Onshape value type may map onto. Types absent
 * here (USER, BLOB, computed OBJECTs other than Material's display name) are
 * not mappable.
 *
 * One target per value type, and every textual type lands on Text. A pushed
 * property is REFERENCE data: Onshape is where it is authored and validated,
 * and Carbon holds a copy. A List target would constrain a value Carbon does
 * not own — Onshape's option set can gain a value mid-push, and a free-text
 * property pointed at a dropdown turns the list into a bin for its typos.
 *
 * Numbers and dates keep their real types because Carbon sorts, filters and
 * renders those columns by type; a numeric shipped as text sorts "10" before
 * "9".
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

/** Properties the panel already writes through first-class item fields. */
const RESERVED_PROPERTY_NAMES = new Set([
  "Name",
  "Part number",
  "Revision",
  "Description",
  "State",
  "Exclude from BOM",
  "Not revision managed"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A list value as its option's label. The metadata API sends a list's stored
 * value ("2"), the BOM table its label ("Released"). Reading the label here
 * gives a mapping the same text from a part push and a BOM row. A value with
 * no option, or an option with no label, stays as it is.
 */
function enumLabel(value: unknown, options: unknown): unknown {
  if (typeof value !== "string" || !Array.isArray(options)) return value;
  const option = options.find(
    (entry) => isRecord(entry) && entry.value === value
  );
  const label = isRecord(option) ? option.label : null;
  return typeof label === "string" && label.trim() !== "" ? label : value;
}

/** The `properties` array of a metadata payload, normalised. */
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
    out.push({
      propertyId,
      name,
      valueType: typeof valueType === "string" ? valueType : "STRING",
      value:
        valueType === "ENUM"
          ? enumLabel(property.value, property.enumValues)
          : property.value,
      editable:
        typeof property.editable === "boolean" ? property.editable : undefined
    });
  }
  return out;
}

/**
 * Per-part properties from an element metadata read at part depth
 * (`depth=2`), or null when the payload does not nest parts — the caller
 * then falls back to per-part metadata reads.
 */
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

/** A property's value as display text; null when absent/blank. */
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

/**
 * An Onshape value coerced to a Carbon custom field's type. `ok: false`
 * carries the reason for the review ("2026-13-40 is not a date"); an absent
 * Onshape value is `ok: true, value: null` — the field is simply not written.
 */
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
      // The ERP stores a Yes/No custom field the way its checkbox posts it:
      // the string "on" when ticked, and no key at all when not — tables read
      // `customFields[id] === "on"` (apps/erp useCustomColumns). A JSON `true`
      // written here would render unticked everywhere, so emit "on"/null.
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
      // Onshape dates arrive ISO; Carbon date fields store YYYY-MM-DD. The
      // shape is not enough — "2026-13-40" matches it and is not a day.
      const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return { ok: false, reason: `"${text}" is not a date` };
      const [, year, month, day] = match as unknown as [
        string,
        string,
        string,
        string
      ];
      // `parseDate` refuses a day the month does not have.
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
      // Membership is not enforced here: apply adds unseen options to the
      // list (add-only) right before the write.
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
 * The stored property map, tolerating absent/malformed metadata.
 *
 * It also reads the earlier shape: a `carbonFieldId` is a custom field
 * target, and a stored mode of "owned" is Update on every push, which is how
 * every push behaved when that map was saved. Any other mode reads as Set at
 * creation. A list item field saved without a translation gets the default
 * rows.
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

/** The two descriptions' modes; a missing or unknown value is Set at creation. */
export function parseDescriptionModes(metadata: unknown): DescriptionModes {
  const raw = isRecord(metadata) ? metadata.descriptionModes : null;
  const modes = isRecord(raw) ? raw : {};
  return {
    name: isMappingMode(modes.name) ? modes.name : "create",
    description: isMappingMode(modes.description) ? modes.description : "create"
  };
}

/**
 * The Carbon fields every push replaces, read from the integration's
 * metadata: the descriptions and the mapping targets in "everyPush" mode. The
 * item card names them so a person knows which edits a push overwrites.
 */
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

/** A target as one string, for a Select value or a duplicate check. */
export function targetKey(target: PropertyMapTarget): string {
  return target.kind === "customField"
    ? `customField:${target.fieldId}`
    : `item:${target.field}`;
}

/**
 * What a mapping decision is, for comparing two maps. Looser than
 * `PropertyMapEntry`: `onshapeName` and `valueType` are display, re-read from
 * Onshape on every load, and a change in either is not a decision the user
 * made.
 */
type PropertyMapDecision = {
  onshapePropertyId: string;
  target: PropertyMapTarget;
  mode: MappingMode;
  translations?: ValueTranslation[];
};

/** A mapping's decisions as one comparable string. */
function decisionKey(entry: PropertyMapDecision): string {
  return JSON.stringify([
    targetKey(entry.target),
    entry.mode,
    (entry.translations ?? []).map((row) => [row.onshape, row.carbon])
  ]);
}

/**
 * Whether two property maps say the same thing, order ignored. The Fields
 * editor's Save posts the whole map, so it needs to know whether the draft
 * differs from what the company holds. Order is ignored because editing one
 * row moves it to the end of the draft.
 */
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
 * Resolve one object's properties through the map: the custom fields and
 * item fields a push would write, the values that cannot be written (shown,
 * never dropped silently) and the valued properties nothing maps yet. The
 * review shows those as "not mapped" so the map grows from real parts.
 *
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
    // The object does not carry the property: there is nothing to write.
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
    if (value !== null && !RESERVED_PROPERTY_NAMES.has(property.name)) {
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
 * The values a push writes for a row's mapped fields, keyed by field id. On
 * an item the push creates, every non-empty value. On an existing item, the
 * "everyPush" fields only, and their nulls too: `mergeCustomFieldValues`
 * deletes the key, so a property emptied in Onshape empties in Carbon.
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

/**
 * A mapped value as review text; "—" when nothing will be written. A Yes/No
 * field stores BOOLEAN_TRUE or no key, so the raw "on" never reaches the
 * review text.
 */
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

/**
 * Merge mapped values into a row's stored customFields JSON: only the given
 * keys change, everything Carbon owns survives.
 */
export function mergeCustomFieldValues(
  current: unknown,
  values: Record<string, string | number | boolean | null>,
  allowedFieldIds: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  for (const [fieldId, value] of Object.entries(values)) {
    if (!allowedFieldIds.has(fieldId)) continue;
    // A field the caller does not list is untouched, so this only ever clears
    // values the push is responsible for.
    if (value === null) delete out[fieldId];
    else out[fieldId] = value;
  }
  return out;
}

/**
 * A custom field Carbon holds no value for. The item forms save a blank field
 * as `""`, so an empty string is as empty as a missing key.
 */
function isBlankCustomValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * The fields an existing item takes: the "everyPush" ones whose value differs
 * from Carbon's. A clear of a field Carbon doesn't hold is dropped, so the
 * review says "will be cleared" only when something is. A part whose CAD is
 * unchanged still needs a push when this is not empty: a property was mapped,
 * or remapped, after its last push.
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

/**
 * The "create" fields Onshape holds a different value for, on an existing
 * item. The push writes none of them; the review shows each one.
 */
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
