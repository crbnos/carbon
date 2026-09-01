/**
 * Onshape properties → Carbon custom fields.
 *
 * Onshape objects carry properties — standard (Name, Part number, Vendor,
 * Project, …) and company-defined custom ones — each with a stable
 * `propertyId` and a value type. Carbon custom fields are per-table
 * definitions (`customField`, table "part") whose values live as JSON on the
 * row, keyed by field id. The bridge is one explicit map per company, stored
 * on the Onshape integration's settings metadata: which Onshape property
 * feeds which Carbon field, and who owns the value afterwards.
 *
 * `mode` per mapping:
 * - "owned": Onshape writes the field on every push and the ERP treats it
 *   like name/description — locked while the item is linked.
 * - "default": Onshape fills it at create (editable in the review); Carbon
 *   owns it afterwards and pushes never touch it again.
 *
 * Everything here is pure so the plan a user reviewed is the plan that runs.
 */

/** One property on an Onshape object, as the metadata API returns it. */
export type OnshapePropertyValue = {
  propertyId: string;
  name: string;
  /** STRING | BOOL | INT | DOUBLE | DATE | ENUM | USER | OBJECT | BLOB … */
  valueType: string;
  value: unknown;
  editable?: boolean;
};

/** One entry of the company's property map (integration settings metadata). */
export type PropertyMapEntry = {
  onshapePropertyId: string;
  /** Display only; the propertyId is the join. */
  onshapeName: string;
  valueType: string;
  carbonFieldId: string;
  mode: "owned" | "default";
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
  mode: "owned" | "default";
  dataTypeId: number;
  listOptions: string[] | null;
  /** Coerced to the Carbon type; null when Onshape holds no value. */
  value: string | number | boolean | null;
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

/**
 * Which Carbon data types an Onshape value type may map onto. First entry is
 * what "Create field" provisions. Types absent here (USER, BLOB, computed
 * OBJECTs other than Material's display name) are not mappable.
 */
export const MAPPABLE_VALUE_TYPES: Record<string, readonly number[]> = {
  STRING: [CUSTOM_FIELD_DATA_TYPES.text, CUSTOM_FIELD_DATA_TYPES.list],
  BOOL: [CUSTOM_FIELD_DATA_TYPES.boolean],
  INT: [CUSTOM_FIELD_DATA_TYPES.numeric],
  DOUBLE: [CUSTOM_FIELD_DATA_TYPES.numeric],
  DATE: [CUSTOM_FIELD_DATA_TYPES.date],
  ENUM: [CUSTOM_FIELD_DATA_TYPES.list, CUSTOM_FIELD_DATA_TYPES.text],
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
      value: property.value,
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
      const asDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
      if (
        Number.isNaN(asDate.getTime()) ||
        asDate.getUTCFullYear() !== Number(year) ||
        asDate.getUTCMonth() + 1 !== Number(month) ||
        asDate.getUTCDate() !== Number(day)
      ) {
        return { ok: false, reason: `"${text}" is not a date` };
      }
      return { ok: true, value: `${year}-${month}-${day}` };
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

/** The stored property map, tolerating absent/malformed metadata. */
export function parsePropertyMap(metadata: unknown): PropertyMapEntry[] {
  const raw = isRecord(metadata) ? metadata.propertyMap : null;
  if (!Array.isArray(raw)) return [];
  const out: PropertyMapEntry[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { onshapePropertyId, onshapeName, valueType, carbonFieldId, mode } =
      entry;
    if (
      typeof onshapePropertyId !== "string" ||
      typeof carbonFieldId !== "string"
    ) {
      continue;
    }
    out.push({
      onshapePropertyId,
      onshapeName: typeof onshapeName === "string" ? onshapeName : "",
      valueType: typeof valueType === "string" ? valueType : "STRING",
      carbonFieldId,
      mode: mode === "default" ? "default" : "owned"
    });
  }
  return out;
}

/**
 * Resolve one object's properties through the map: the fields apply would
 * write (with coercion problems surfaced, not silently dropped) and the
 * valued properties nothing maps yet — the review shows those as "not
 * mapped" so the map grows from real parts.
 */
export function resolveMappedFields({
  properties,
  map,
  definitions
}: {
  properties: OnshapePropertyValue[];
  map: PropertyMapEntry[];
  definitions: PlanCustomFieldDefinition[];
}): {
  fields: PlanCustomField[];
  problems: string[];
  unmapped: UnmappedProperty[];
} {
  const definitionById = new Map(definitions.map((d) => [d.id, d]));
  const entryByPropertyId = new Map(
    map.map((entry) => [entry.onshapePropertyId, entry])
  );
  const fields: PlanCustomField[] = [];
  const problems: string[] = [];
  const unmapped: UnmappedProperty[] = [];

  for (const property of properties) {
    const entry = entryByPropertyId.get(property.propertyId);
    if (!entry) {
      const value = propertyDisplayValue(property.value);
      if (value !== null && !RESERVED_PROPERTY_NAMES.has(property.name)) {
        unmapped.push({
          propertyId: property.propertyId,
          name: property.name,
          valueType: property.valueType,
          value
        });
      }
      continue;
    }
    const definition = definitionById.get(entry.carbonFieldId);
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
  return { fields, problems, unmapped };
}

/**
 * The user's edits over a row's mapped fields. Only `default`-mode fields
 * take edits (an `owned` value is Onshape's); values are validated against
 * the field's type. Keyed by field id.
 */
export function mergeCustomFieldEdits(
  fields: PlanCustomField[],
  edits: Record<string, unknown> | null | undefined
):
  | { ok: true; values: Record<string, string | number | boolean | null> }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const values: Record<string, string | number | boolean | null> = {};
  for (const field of fields) {
    // Owned fields carry their null through: mergeCustomFieldValues deletes
    // the key, so emptying a property in Onshape empties it in Carbon. A
    // default field with no value simply writes nothing.
    if (field.mode === "owned" || field.value !== null) {
      values[field.fieldId] = field.value;
    }
  }
  for (const [fieldId, raw] of Object.entries(edits ?? {})) {
    const field = fields.find((f) => f.fieldId === fieldId);
    if (!field) continue; // not part of the reviewed plan: ignored
    if (field.mode === "owned") {
      errors.push(`${field.name}: Onshape owns this field`);
      continue;
    }
    const coerced = coerceOnshapeValue(
      raw,
      field.dataTypeId,
      field.listOptions
    );
    if (!coerced.ok) {
      errors.push(`${field.name}: ${coerced.reason}`);
      continue;
    }
    if (coerced.value === null) delete values[fieldId];
    else values[fieldId] = coerced.value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}

/**
 * Merge mapped values into a row's stored customFields JSON: only the given
 * keys change, everything Carbon owns survives. `modes` restricts which keys
 * an update may touch (owned only); creates pass every mapped key.
 */
export function mergeCustomFieldValues(
  current: unknown,
  values: Record<string, string | number | boolean | null>,
  allowedFieldIds: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  for (const [fieldId, value] of Object.entries(values)) {
    if (!allowedFieldIds.has(fieldId)) continue;
    // An owned field emptied in Onshape empties in Carbon: "owned" means the
    // ERP shows what CAD holds, exactly as name/description do. A field the
    // caller does not list is untouched, so this only ever clears values the
    // push is responsible for.
    if (value === null) delete out[fieldId];
    else out[fieldId] = value;
  }
  return out;
}

/** List options a List field is missing for the values about to be written. */
export function missingListOptions(
  definition: PlanCustomFieldDefinition,
  values: Array<string | number | boolean | null>
): string[] {
  if (definition.dataTypeId !== CUSTOM_FIELD_DATA_TYPES.list) return [];
  const have = new Set(definition.listOptions ?? []);
  const missing: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value === "") continue;
    if (!have.has(value) && !missing.includes(value)) missing.push(value);
  }
  return missing;
}
