import type {
  CatalogAction,
  CatalogEntity,
  CatalogEvent,
  CatalogOperation,
  WorkflowCatalog
} from "../definition/catalog";
import { WORKFLOW_ENTITIES, WORKFLOW_EVENTS } from "./events.generated";

export interface EventCatalogOptions {
  /** Phase 5 supplies the action catalog through this seam. */
  getAction?: (id: string) => CatalogAction | undefined;
  /** Phase 5 supplies the entity-operation catalog through this seam. */
  getOperation?: (id: string) => CatalogOperation | undefined;
}

// Built once at module load — the same pattern audit.config.ts uses for its
// derived indexes.
const EVENTS: Map<string, CatalogEvent> = new Map(
  Object.entries(WORKFLOW_EVENTS).map(([id, event]) => [id, { id, ...event }])
);

const ENTITIES: Map<string, CatalogEntity> = new Map(
  Object.entries(WORKFLOW_ENTITIES).map(([name, properties]) => [
    name,
    { name, properties }
  ])
);

/**
 * The real catalog, backed by the generated event file. `getAction` and
 * `getOperation` answer nothing until phase 5 plugs them in.
 */
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
