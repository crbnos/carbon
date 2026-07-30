export type { EventCatalogOptions } from "./catalog";
export { createEventCatalog } from "./catalog";
export type { RegistryEntityName } from "./entities";
export { REGISTRY_ENTRIES, WORKFLOW_ENTITY_REGISTRY } from "./entities";
// `labels.generated` is not re-exported: `msg` is a build-time macro, so only a
// Vite-built consumer may import it, by its explicit deep path.
export type { GeneratedEvent } from "./events.generated";
export { WORKFLOW_ENTITIES, WORKFLOW_EVENTS } from "./events.generated";
export type { MomentEntityRef, MomentKey, MomentPayload } from "./moments";
export { WORKFLOW_MOMENTS } from "./moments";
