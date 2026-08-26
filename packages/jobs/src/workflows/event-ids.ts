import {
  CUSTOM_FIELD_PREFIX,
  createWorkflowCatalog,
  customFieldEventId,
  ENTITY_BY_TABLE,
  WORKFLOW_EVENTS
} from "@carbon/workflows";
import { computeDiff } from "../inngest/functions/events/diff";

// A facade over module-load maps; building it once here keeps the hot path allocation-free.
const CATALOG = createWorkflowCatalog();

type TableIndex = {
  created?: string;
  deleted?: string;
  /** field -> event id, in catalog (insertion) order. */
  changed: Map<string, string>;
};

// Built once from the catalog's match blocks. Moments carry no table.
const INDEX: Map<string, TableIndex> = (() => {
  const index = new Map<string, TableIndex>();
  for (const [id, event] of Object.entries(WORKFLOW_EVENTS)) {
    const match = event.match;
    if (!match || !("table" in match)) continue;
    let entry = index.get(match.table);
    if (!entry) {
      entry = { changed: new Map() };
      index.set(match.table, entry);
    }
    if (match.operation === "INSERT") entry.created = id;
    else if (match.operation === "DELETE") entry.deleted = id;
    else if (match.field) entry.changed.set(match.field, id);
  }
  return index;
})();

/**
 * One announcement -> the catalog event ids it raises. UPDATEs go through
 * computeDiff, so an update touching no watched column produces [].
 */
export function computeEventIds(input: {
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
}): string[] {
  const entry = INDEX.get(input.table);
  if (!entry) return [];

  if (input.operation === "INSERT") {
    return entry.created ? [entry.created] : [];
  }
  if (input.operation === "DELETE") {
    return entry.deleted ? [entry.deleted] : [];
  }

  if (!input.old || !input.new || entry.changed.size === 0) return [];
  const diff = computeDiff(input.old, input.new);
  if (!diff) return [];

  const ids: string[] = [];
  for (const [field, id] of entry.changed) {
    if (field in diff) ids.push(id);
  }

  // A custom field's event id is DERIVED from the diff key, never looked up: the id is
  // per company and the catalog is not, so no company lookup enters the hot path. The
  // existing workflowTriggerEvent join does the filtering it already did.
  //
  // Appended after the generated ids, so "one run per workflow per announcement, first
  // id wins" picks the same winner it does today for a workflow watching both.
  const entity = ENTITY_BY_TABLE[input.table];
  if (entity !== undefined) {
    for (const key of Object.keys(diff)) {
      if (!key.startsWith(CUSTOM_FIELD_PREFIX)) continue;
      const fieldId = key.slice(CUSTOM_FIELD_PREFIX.length);
      if (fieldId === "") continue;
      const id = customFieldEventId(entity, fieldId);
      // The one place the item exclusion and the reference-only rule are decided.
      if (CATALOG.getEvent(id) !== undefined) ids.push(id);
    }
  }

  return ids;
}
