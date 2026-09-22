import type { CatalogEvent, CatalogInput } from "../definition/catalog";
import { t, type ValueType } from "../definition/types";
import { REGISTRY_ENTRIES } from "./entities";

/**
 * The property path is ONE segment — the literal string `customFields.<fieldId>` — not a
 * two-hop drill. That keeps `walkPath` and the runtime `walk` single-step, and it matches
 * the differ, which emits nested keys and so never produces the bare `customFields` key.
 */
export const CUSTOM_FIELD_PREFIX = "customFields.";

/**
 * Custom fields attach to the item SUBTYPES (`part`, `material`, `tool`, `consumable`,
 * `fixture`) while the workflow catalog triggers on the shared `item` table. Merging them
 * needs a collision rule and is its own change.
 */
const EXCLUDED_ENTITIES = new Set(["item"]);

/** The shape the ERP already loads, from `customField` / the `customFieldTables` view. */
export type CustomFieldDef = {
  table: string;
  /** The key inside the JSONB blob — an id, never the customer-visible name. */
  id: string;
  name: string;
  dataTypeId: number;
  listOptions: string[] | null;
  active: boolean;
};

/**
 * What a company adds to the shipped catalog. Merged in at the two places a catalog is
 * built: the builder (client) and the engine (server). The catalog itself is build-time
 * and global, so per-company fields cannot be generated into it.
 */
export type CatalogOverlay = {
  /** entity -> property path -> type */
  properties: Record<string, Record<string, ValueType>>;
  /** label key -> the customer's own field name, verbatim and untranslated */
  labels: Record<string, string>;
  /** entity -> property path -> allowed values */
  enums: Record<string, Record<string, readonly string[]>>;
  /** action id -> input name -> spec, for the generated `<entity>.update` family */
  actionInputs: Record<string, Record<string, CatalogInput>>;
};

export const EMPTY_OVERLAY: CatalogOverlay = {
  properties: {},
  labels: {},
  enums: {},
  actionInputs: {}
};

/** table -> registry entity name. Built once; the registry is committed data. */
export const ENTITY_BY_TABLE: Record<string, string> = Object.fromEntries(
  Object.entries(REGISTRY_ENTRIES).map(([name, entry]) => [entry.table, name])
);

/**
 * The ONE place `DataType` (`apps/erp/app/modules/shared/types.ts`) maps to a `ValueType`.
 * A File field is exposed as the stored path — comparable and printable, but not a link
 * and not a record to drill into.
 */
function valueTypeFor(dataTypeId: number): ValueType | undefined {
  switch (dataTypeId) {
    case 1:
      return t.boolean;
    case 2:
      return t.date;
    // List: a string, whose allowed values come from `listOptions`.
    case 3:
      return t.string;
    case 4:
      return t.number;
    case 5:
      return t.string;
    case 6:
      return t.entity("user");
    case 7:
      return t.entity("customer");
    case 8:
      return t.entity("supplier");
    // File: the stored path.
    case 9:
      return t.string;
    default:
      return undefined;
  }
}

export function buildCatalogOverlay(defs: CustomFieldDef[]): CatalogOverlay {
  const overlay: CatalogOverlay = {
    properties: {},
    labels: {},
    enums: {},
    actionInputs: {}
  };

  for (const def of defs) {
    if (!def.active) continue;
    const entity = ENTITY_BY_TABLE[def.table];
    if (entity === undefined || EXCLUDED_ENTITIES.has(entity)) continue;
    const type = valueTypeFor(def.dataTypeId);
    if (type === undefined) continue;

    const property = `${CUSTOM_FIELD_PREFIX}${def.id}`;
    const choices =
      def.dataTypeId === 3 && def.listOptions && def.listOptions.length > 0
        ? def.listOptions
        : undefined;

    (overlay.properties[entity] ??= {})[property] = type;
    overlay.labels[`entity.${entity}.${property}`] = def.name;
    if (choices) (overlay.enums[entity] ??= {})[property] = choices;

    // Writable through the generated update action. An entity with no `write` block
    // has no `<entity>.update`, in which case `getAction` simply never finds a base to
    // merge this onto.
    const actionId = `${entity}.update`;
    (overlay.actionInputs[actionId] ??= {})[property] = {
      type,
      required: false,
      ...(choices ? { choices } : {})
    };
    overlay.labels[`action.${actionId}.input.${property}`] = def.name;
  }

  return overlay;
}

/** `<entity>.customFields.<fieldId>.changed`. */
export function customFieldEventId(entity: string, fieldId: string): string {
  return `${entity}.${CUSTOM_FIELD_PREFIX}${fieldId}.changed`;
}

const CUSTOM_FIELD_EVENT =
  /^([A-Za-z][A-Za-z0-9]*)\.customFields\.([^.]+)\.changed$/;

/** The entity and property path a custom-field trigger id names, or undefined when the id
 * is a shipped event. The label a customer sees is keyed by that property. */
export function parseCustomFieldEventId(
  id: string
): { entity: string; property: string } | undefined {
  const match = CUSTOM_FIELD_EVENT.exec(id);
  if (match === null) return undefined;

  const [, entity, fieldId] = match;
  if (entity === undefined || fieldId === undefined) return undefined;

  return { entity, property: `${CUSTOM_FIELD_PREFIX}${fieldId}` };
}

/**
 * Parses a custom-field event id into a synthetic `CatalogEvent`, deliberately parallel
 * to the generated `<entity>.<column>.changed`.
 *
 * `WORKFLOW_EVENTS` stays a closed, committed, drift-checked record — a per-company id
 * cannot live there — so the id is PARSED rather than looked up. Company-blind by design:
 * whether the field actually exists for the company is decided by the
 * `workflowTriggerEvent` join the matcher already does, not here.
 */
export function resolveCustomFieldEvent(id: string): CatalogEvent | undefined {
  const parsed = parseCustomFieldEventId(id);
  if (parsed === undefined) return undefined;

  const { entity, property } = parsed;
  if (EXCLUDED_ENTITIES.has(entity)) return undefined;

  const entry = REGISTRY_ENTRIES[entity];
  // A reference-only entity has no `watch` block and so no change events at all.
  if (entry === undefined || entry.watch === undefined) return undefined;

  return {
    id,
    outputs: {
      record: t.entity(entity),
      before: t.entity(entity),
      after: t.entity(entity)
    },
    permission: entry.permission,
    match: {
      table: entry.table,
      operation: "UPDATE",
      field: property
    }
  };
}
