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

/** The one catalog every consumer reads: events, entities, actions and operations. */
export function createWorkflowCatalog(): WorkflowCatalog {
  return {
    getEvent: (id) => EVENTS.get(id),
    getEntity: (name) => ENTITIES.get(name),
    getAction: (id) => ACTIONS.get(id),
    getOperation: (id) => OPERATIONS.get(id),
    getEnum: (entity, property) => ENUMS.get(entity)?.[property]
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
