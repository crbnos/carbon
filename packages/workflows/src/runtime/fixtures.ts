import { createFixtureCatalog } from "../definition/catalog";
import type { EntityLoader, RuntimeContext, RuntimeValue } from "./types";

export type FakeRows = Record<string, Record<string, unknown>>;

/** Rows keyed `${entity}:${id}`; anything absent loads as null. */
export function createFakeLoader(rows: FakeRows): EntityLoader {
  return { load: async (entity, id) => rows[`${entity}:${id}`] ?? null };
}

export function createRuntimeContext(
  options: {
    rows?: FakeRows;
    outputs?: Record<string, Record<string, RuntimeValue>>;
    item?: RuntimeValue;
  } = {}
): RuntimeContext {
  return {
    catalog: createFixtureCatalog(),
    loader: createFakeLoader(options.rows ?? {}),
    outputs: options.outputs ?? {},
    item: options.item
  };
}
