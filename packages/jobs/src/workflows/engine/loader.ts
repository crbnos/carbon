import type { Database } from "@carbon/database";
import {
  type EntityLoader,
  entityValue,
  REGISTRY_ENTRIES,
  type RunTrigger,
  type RuntimeValue,
  type WorkflowCatalog
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EntityCache = Map<string, Record<string, unknown> | null>;

/** Reads as the workflow owner, so anything they may not see comes back as null.
 * `client` must never be a privileged one. */
export function createEntityLoader(params: {
  client: SupabaseClient<Database>;
  companyId: string;
  cache: EntityCache;
}): EntityLoader {
  const { client, companyId, cache } = params;

  return {
    load: async (entity, id) => {
      const key = `${entity}:${id}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const table = REGISTRY_ENTRIES[entity]?.table;
      if (table === undefined) {
        cache.set(key, null);
        return null;
      }

      // The entity is only known at run time; typing it costs a 350-way instantiation.
      const untyped = client as unknown as SupabaseClient;
      const { data, error } = await untyped
        .from(table)
        .select("*")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle();

      // Denied by row-level security and genuinely absent are the same answer here.
      const row = error || !data ? null : (data as Record<string, unknown>);
      cache.set(key, row);
      return row;
    }
  };
}

/** The variables a trigger hands out. `before` keeps its row inline because it
 * shares an id with `after` and so cannot be cached by that id. */
export function triggerOutputs(params: {
  eventId: string;
  trigger: RunTrigger;
  catalog: WorkflowCatalog;
  cache: EntityCache;
}): Record<string, RuntimeValue> {
  const { eventId, trigger, catalog, cache } = params;
  const declared = catalog.getEvent(eventId)?.outputs ?? {};
  const outputs: Record<string, RuntimeValue> = {};

  // A schedule starts with no record, so the trigger node hands out nothing and seeds no cache.
  // This mirrors NODE_KINDS.trigger.outputs, which already returns {} for a scheduled trigger.
  if (trigger.kind === "schedule") return outputs;

  if (trigger.kind === "moment") {
    for (const [name, type] of Object.entries(declared)) {
      const supplied = trigger.outputs[name];
      if (type.kind !== "entity" || supplied === undefined) continue;
      outputs[name] = entityValue(type.of, supplied.id);
    }
    return outputs;
  }

  const rows: Record<string, Record<string, unknown> | null> = {
    record: trigger.record,
    before: trigger.before,
    after: trigger.after
  };

  for (const [name, type] of Object.entries(declared)) {
    const row = rows[name];
    if (type.kind !== "entity" || row === null || row === undefined) continue;
    const id = row.id;
    if (typeof id !== "string") continue;

    outputs[name] = entityValue(type.of, id, row);
    // Only the current state may seed the shared cache; `before` would poison it.
    if (name !== "before") cache.set(`${type.of}:${id}`, row);
  }

  return outputs;
}
