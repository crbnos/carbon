import type {
  CatalogAction,
  CatalogEntity,
  CatalogEvent,
  CatalogOperation,
  WorkflowCatalog
} from "../definition/catalog";
import { WORKFLOW_ENTITIES, WORKFLOW_EVENTS } from "./events.generated";

export interface EventCatalogOptions {
  getAction?: (id: string) => CatalogAction | undefined;
  getOperation?: (id: string) => CatalogOperation | undefined;
}

// Built once at module load, as audit.config.ts does for its derived indexes.
const EVENTS: Map<string, CatalogEvent> = new Map(
  Object.entries(WORKFLOW_EVENTS).map(([id, event]) => [id, { id, ...event }])
);

const ENTITIES: Map<string, CatalogEntity> = new Map(
  Object.entries(WORKFLOW_ENTITIES).map(([name, properties]) => [
    name,
    { name, properties }
  ])
);

/** Backed by the generated event file; actions and operations answer only if supplied. */
export function createEventCatalog(
  options: EventCatalogOptions = {}
): WorkflowCatalog {
  return {
    getEvent: (id) => EVENTS.get(id),
    getEntity: (name) => ENTITIES.get(name),
    getAction: (id) => options.getAction?.(id),
    getOperation: (id) => options.getOperation?.(id)
  };
}
