// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Where a push reads the values it always needs: part number, revision, name
 * and description, and a BOM's Item and Quantity columns. Each is Onshape's own
 * property unless the company's property map names another. A BOM template or
 * a language relabels a column, never its property id or `propertyName`, so
 * nothing here matches a label first.
 */

import type { PropertyMapEntry } from "./properties";

export const IDENTITY_FIELDS = [
  "partNumber",
  "revision",
  "name",
  "description"
] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export const BOM_LINE_FIELDS = ["item", "quantity"] as const;
export type BomLineField = (typeof BOM_LINE_FIELDS)[number];

/** A value type an identity field can be read from: text, or a list's label. */
export const IDENTITY_VALUE_TYPES: readonly string[] = ["STRING", "ENUM"];

type OnshapeProperty = {
  /** The same in every Onshape company. */
  propertyId: string;
  /** The BOM header's `propertyName`. */
  propertyName: string;
  /** Onshape's default label; a template or a language may show another. */
  label: string;
};

/** Onshape's own properties the panel reads or never offers as "not mapped". */
export const ONSHAPE_PROPERTIES = {
  name: {
    propertyId: "57f3fb8efa3416c06701d60d",
    propertyName: "name",
    label: "Name"
  },
  description: {
    propertyId: "57f3fb8efa3416c06701d60e",
    propertyName: "description",
    label: "Description"
  },
  partNumber: {
    propertyId: "57f3fb8efa3416c06701d60f",
    propertyName: "partNumber",
    label: "Part number"
  },
  revision: {
    propertyId: "57f3fb8efa3416c06701d610",
    propertyName: "revision",
    label: "Revision"
  },
  state: {
    propertyId: "57f3fb8efa3416c06701d611",
    propertyName: "state",
    label: "State"
  },
  notRevisionManaged: {
    propertyId: "57f3fb8efa3416c06701d61d",
    propertyName: "notRevisionManaged",
    label: "Not revision managed"
  },
  excludeFromBom: {
    propertyId: "57f3fb8efa3416c06701d61e",
    propertyName: "excludeFromBom",
    label: "Exclude from BOM"
  },
  bomBehavior: {
    propertyId: "57f3fb8efa3416c06701d633",
    propertyName: "bomBehavior",
    label: "Subassembly BOM behavior"
  },
  item: {
    propertyId: "5ace8269c046ad612c65a0ba",
    propertyName: "item",
    label: "Item"
  },
  quantity: {
    propertyId: "5ace84d3c046ad611c65a0dd",
    propertyName: "quantity",
    label: "Quantity"
  }
} as const satisfies Record<string, OnshapeProperty>;

export type OnshapePropertyField = keyof typeof ONSHAPE_PROPERTIES;

const labelKey = (label: string) => label.trim().toLowerCase();

const FIELD_BY_PROPERTY_ID = new Map<string, OnshapePropertyField>();
const FIELD_BY_PROPERTY_NAME = new Map<string, OnshapePropertyField>();
const FIELD_BY_EXACT_LABEL = new Map<string, OnshapePropertyField>();
const FIELD_BY_LABEL = new Map<string, OnshapePropertyField>();
for (const [field, property] of Object.entries(ONSHAPE_PROPERTIES) as [
  OnshapePropertyField,
  OnshapeProperty
][]) {
  FIELD_BY_PROPERTY_ID.set(property.propertyId, field);
  FIELD_BY_PROPERTY_NAME.set(property.propertyName, field);
  FIELD_BY_EXACT_LABEL.set(property.label, field);
  FIELD_BY_LABEL.set(labelKey(property.label), field);
}

/**
 * Which of Onshape's own properties this is: by id, by `propertyName` (a BOM
 * header), then by its default label in any case.
 */
export function onshapePropertyField(property: {
  propertyId?: unknown;
  id?: unknown;
  propertyName?: unknown;
  name?: unknown;
}): OnshapePropertyField | null {
  const id =
    typeof property.propertyId === "string" ? property.propertyId : property.id;
  if (typeof id === "string") {
    const byId = FIELD_BY_PROPERTY_ID.get(id);
    if (byId) return byId;
  }
  if (typeof property.propertyName === "string") {
    const byName = FIELD_BY_PROPERTY_NAME.get(property.propertyName);
    if (byName) return byName;
  }
  return typeof property.name === "string"
    ? (FIELD_BY_LABEL.get(labelKey(property.name)) ?? null)
    : null;
}

const RESERVED_FIELDS: ReadonlySet<OnshapePropertyField> = new Set([
  ...IDENTITY_FIELDS,
  "state",
  "notRevisionManaged",
  "excludeFromBom"
]);

/** Identity, description and lifecycle properties: never "not mapped". */
export function isReservedProperty(property: {
  propertyId?: unknown;
  name?: unknown;
}): boolean {
  const field = onshapePropertyField(property);
  return field !== null && RESERVED_FIELDS.has(field);
}

/** Part number, revision, name or description: never offered as a mapping. */
export function isIdentityProperty(property: {
  propertyId?: unknown;
  name?: unknown;
}): boolean {
  const field = onshapePropertyField(property);
  return (
    field !== null && (IDENTITY_FIELDS as readonly string[]).includes(field)
  );
}

export type StandardSources = {
  /** The property each overridden identity field is read from. */
  identity: Partial<
    Record<IdentityField, { propertyId: string; name: string }>
  >;
  /** The BOM column each overridden line field is read from. */
  bomLine: Partial<Record<BomLineField, { headerId: string; name: string }>>;
};

export const DEFAULT_STANDARD_SOURCES: StandardSources = {
  identity: {},
  bomLine: {}
};

/** The overrides the company's property map holds. */
export function standardSources(
  map: readonly PropertyMapEntry[]
): StandardSources {
  const sources: StandardSources = { identity: {}, bomLine: {} };
  for (const entry of map) {
    if (entry.target.kind === "identity") {
      sources.identity[entry.target.field] = {
        propertyId: entry.onshapePropertyId,
        name: entry.onshapeName
      };
    } else if (entry.target.kind === "bomLine") {
      sources.bomLine[entry.target.field] = {
        headerId: entry.onshapePropertyId,
        name: entry.onshapeName
      };
    }
  }
  return sources;
}

export function hasIdentityOverride(sources: StandardSources): boolean {
  return Object.keys(sources.identity).length > 0;
}

/**
 * Release pushes read Onshape's own Part number and Revision: Onshape's release
 * records name them, and the Releases tab matches by them.
 */
export function releaseSources(sources: StandardSources): StandardSources {
  const {
    partNumber: _partNumber,
    revision: _revision,
    ...identity
  } = sources.identity;
  return { identity, bomLine: sources.bomLine };
}

/** The label a value is known by in messages: the override's, else Onshape's. */
export function sourceLabel(
  field: IdentityField | BomLineField,
  sources: StandardSources
): string {
  const override =
    field === "item" || field === "quantity"
      ? sources.bomLine[field]
      : sources.identity[field];
  return override?.name || ONSHAPE_PROPERTIES[field].label;
}

export type BomColumnField = IdentityField | BomLineField | "bomBehavior";

type BomHeaderLike = { id: string; name?: unknown; propertyName?: unknown };

/**
 * The BOM column id for each field the parser reads, null when the BOM has
 * none. An identity override names its own column (by id, then its label) and
 * never falls back to Onshape's: a part number read from another property
 * would link other items. A line override whose column is gone falls back to
 * Onshape's own.
 */
export function bomColumnIds(
  headers: readonly BomHeaderLike[],
  sources: StandardSources = DEFAULT_STANDARD_SOURCES
): Record<BomColumnField, string | null> {
  const ids = new Set(headers.map((header) => header.id));
  const own = new Map<OnshapePropertyField, string>();
  // Property name first: a custom column may carry a standard label. The exact
  // label before the label in any case: "Part number" beats a custom "PART NUMBER".
  for (const pass of ["propertyName", "id", "exactLabel", "label"] as const) {
    for (const header of headers) {
      const field =
        pass === "propertyName"
          ? typeof header.propertyName === "string"
            ? FIELD_BY_PROPERTY_NAME.get(header.propertyName)
            : undefined
          : pass === "id"
            ? FIELD_BY_PROPERTY_ID.get(header.id)
            : typeof header.name !== "string"
              ? undefined
              : pass === "exactLabel"
                ? FIELD_BY_EXACT_LABEL.get(header.name)
                : FIELD_BY_LABEL.get(labelKey(header.name));
      if (field && !own.has(field)) own.set(field, header.id);
    }
  }
  const identity = (field: IdentityField) => {
    const override = sources.identity[field];
    if (!override) return own.get(field) ?? null;
    if (ids.has(override.propertyId)) return override.propertyId;
    // A column whose id is not the property id still matches by its label,
    // as a mapped custom field's cell does (`resolveMappedFields`).
    const label = override.name ? labelKey(override.name) : null;
    return (
      headers.find(
        (header) =>
          label !== null &&
          typeof header.name === "string" &&
          labelKey(header.name) === label
      )?.id ?? null
    );
  };
  const line = (field: BomLineField) => {
    const override = sources.bomLine[field];
    if (override && ids.has(override.headerId)) return override.headerId;
    return own.get(field) ?? null;
  };
  return {
    partNumber: identity("partNumber"),
    revision: identity("revision"),
    name: identity("name"),
    description: identity("description"),
    item: line("item"),
    quantity: line("quantity"),
    bomBehavior: own.get("bomBehavior") ?? null
  };
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? null : text;
  }
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const display = (value as { displayName?: unknown }).displayName;
    return typeof display === "string" && display.trim() !== ""
      ? display.trim()
      : null;
  }
  return null;
}

type PropertyLike = { propertyId?: unknown; name?: unknown; value?: unknown };

/**
 * An identity value from Onshape metadata: the override's property, else
 * Onshape's own (by id, then by label in any case). An override never falls
 * back to Onshape's own property.
 */
export function identityValue(
  properties: readonly PropertyLike[],
  field: IdentityField,
  sources: StandardSources = DEFAULT_STANDARD_SOURCES
): string | null {
  const override = sources.identity[field];
  if (override) {
    const property = properties.find(
      (p) => p.propertyId === override.propertyId
    );
    return property ? textValue(property.value) : null;
  }
  const own = ONSHAPE_PROPERTIES[field];
  const property =
    properties.find((p) => p.propertyId === own.propertyId) ??
    properties.find(
      (p) =>
        typeof p.name === "string" && labelKey(p.name) === labelKey(own.label)
    );
  return property ? textValue(property.value) : null;
}

/** The parts API's identity fields, with each override read from metadata. */
export function withIdentitySources<
  P extends {
    partId: string;
    partNumber?: string | null;
    revision?: string | null;
    name: string;
    description?: string | null;
  }
>(
  parts: readonly P[],
  propertiesByPartId: ReadonlyMap<string, readonly PropertyLike[]>,
  sources: StandardSources
): P[] {
  if (!hasIdentityOverride(sources)) return [...parts];
  return parts.map((part) => {
    const properties = propertiesByPartId.get(part.partId) ?? [];
    const read = (field: IdentityField) =>
      sources.identity[field]
        ? identityValue(properties, field, sources)
        : undefined;
    const partNumber = read("partNumber");
    const revision = read("revision");
    const name = read("name");
    const description = read("description");
    return {
      ...part,
      ...(partNumber !== undefined ? { partNumber } : {}),
      ...(revision !== undefined ? { revision } : {}),
      // The parts API always names a part; an empty override keeps that name.
      ...(name ? { name } : {}),
      ...(description !== undefined ? { description } : {})
    };
  });
}

/**
 * Why the Fields save refuses a standard source entry; empty when it takes
 * it, and for any other target. Guards a hand-made payload: the editor offers
 * neither case.
 */
export function standardSourceErrors(
  entry: Pick<PropertyMapEntry, "onshapePropertyId" | "valueType" | "target">
): string[] {
  const { target } = entry;
  if (target.kind !== "identity" && target.kind !== "bomLine") return [];
  const label = ONSHAPE_PROPERTIES[target.field].label;
  const own = onshapePropertyField({ propertyId: entry.onshapePropertyId });
  const errors: string[] = [];
  if (own && own !== target.field) {
    errors.push(
      `That is Onshape's ${ONSHAPE_PROPERTIES[own].label}. Choose the ${
        target.kind === "identity" ? "property" : "column"
      } that holds ${label}.`
    );
  }
  if (
    target.kind === "identity" &&
    !IDENTITY_VALUE_TYPES.includes(entry.valueType)
  ) {
    errors.push(
      `${label} is read from a text or list property, not ${entry.valueType}.`
    );
  }
  return errors;
}
