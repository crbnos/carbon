import type {
  CatalogAction,
  CatalogEntity,
  CatalogEvent,
  CatalogOperation,
  WorkflowCatalog
} from "../definition/catalog";
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_OPERATION_CATALOG
} from "./actions.generated";
import {
  type CatalogOverlay,
  EMPTY_OVERLAY,
  resolveCustomFieldEvent
} from "./custom-fields";
import { REGISTRY_ENTRIES } from "./entities";
import {
  WORKFLOW_ENTITIES,
  WORKFLOW_ENTITY_ENUMS,
  WORKFLOW_EVENTS
} from "./events.generated";

// Built once at module load, as audit.config.ts does for its derived indexes.
const EVENTS: Map<string, CatalogEvent> = new Map(
  Object.entries(WORKFLOW_EVENTS).map(([id, event]) => [id, { id, ...event }])
);

const ENTITIES: Map<string, CatalogEntity> = new Map(
  Object.entries(WORKFLOW_ENTITIES).map(([name, properties]) => {
    const entry = REGISTRY_ENTRIES[name];
    const base: CatalogEntity = { name, properties };
    if (entry?.permission !== undefined)
      base.permission = { module: entry.permission, action: "view" };
    if (entry?.describe !== undefined) base.descriptions = entry.describe;
    if (entry?.display !== undefined) base.display = entry.display;
    return [name, base];
  })
);

const ACTIONS: Map<string, CatalogAction> = new Map(
  Object.entries(WORKFLOW_ACTION_CATALOG).map(([id, action]) => [
    id,
    { id, ...action }
  ])
);

const OPERATIONS: Map<string, CatalogOperation> = new Map(
  Object.entries(WORKFLOW_OPERATION_CATALOG).map(([id, operation]) => [
    id,
    { id, ...operation }
  ])
);

const ENUMS: Map<string, Record<string, readonly string[]>> = new Map(
  Object.entries(WORKFLOW_ENTITY_ENUMS)
);

/**
 * Shipped entries first, then the ones this company added — a generated key always wins,
 * so a customer cannot shadow a real column, and the shipped ones keep their order at the
 * top of every picker.
 */
function merge<T>(base: Record<string, T>, extra: Record<string, T>) {
  const merged: Record<string, T> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (key in base) continue;
    merged[key] = value;
  }
  return merged;
}

/**
 * The single event lookup: the committed catalog first, then the parsed custom-field
 * pattern. Every consumer goes through here, so `WORKFLOW_EVENTS` stays closed.
 */
export function getCatalogEvent(id: string): CatalogEvent | undefined {
  return EVENTS.get(id) ?? resolveCustomFieldEvent(id);
}

/**
 * The one catalog every consumer reads: events, entities, actions and operations.
 *
 * `overlay` carries a company's custom fields. It is merged generated-first so a real
 * column always wins — a customer cannot shadow one.
 */
export function createWorkflowCatalog(
  overlay: CatalogOverlay = EMPTY_OVERLAY
): WorkflowCatalog {
  return {
    getEvent: getCatalogEvent,
    getEntity: (name) => {
      const base = ENTITIES.get(name);
      const extra = overlay.properties[name];
      if (base === undefined || extra === undefined) return base;
      return { ...base, properties: merge(base.properties, extra) };
    },
    getAction: (id) => {
      const base = ACTIONS.get(id);
      const extra = overlay.actionInputs[id];
      if (base === undefined || extra === undefined) return base;
      return { ...base, inputs: merge(base.inputs, extra) };
    },
    getOperation: (id) => OPERATIONS.get(id),
    getEnum: (entity, property) =>
      ENUMS.get(entity)?.[property] ?? overlay.enums[entity]?.[property],
    // Custom field names are customer data and are deliberately never translated, so
    // they arrive as plain strings rather than through WORKFLOW_LABELS.
    getPropertyLabel: (entity, property) =>
      overlay.labels[`entity.${entity}.${property}`],
    getInputLabel: (actionId, input) =>
      overlay.labels[`action.${actionId}.input.${input}`]
  };
}

/** How a job-side action is actually run. Kept off `CatalogAction`, which the validator reads. */
export function getActionRoute(
  id: string
): { call?: string; update?: { entity: string } } | undefined {
  const action = WORKFLOW_ACTION_CATALOG[id];
  if (action === undefined) return undefined;
  return {
    ...(action.call === undefined ? {} : { call: action.call }),
    ...(action.update === undefined ? {} : { update: action.update })
  };
}
