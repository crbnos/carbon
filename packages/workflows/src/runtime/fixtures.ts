import { createFixtureCatalog } from "../definition/catalog";
import type {
  EntityLoader,
  RuntimeContext,
  RuntimeValue,
  WorkflowServices
} from "./types";

export type FakeRows = Record<string, Record<string, unknown>>;

/** Rows keyed `${entity}:${id}`; anything absent loads as null. */
export function createFakeLoader(rows: FakeRows): EntityLoader {
  return { load: async (entity, id) => rows[`${entity}:${id}`] ?? null };
}

const NOT_STUBBED = { ok: false as const, error: "not stubbed" };

export function createFixtureServices(
  overrides: Partial<WorkflowServices> = {}
): WorkflowServices {
  return {
    runAction: async () => NOT_STUBBED,
    runOperation: async () => NOT_STUBBED,
    search: async () => NOT_STUBBED,
    ...overrides
  };
}

export function createRuntimeContext(
  options: {
    rows?: FakeRows;
    outputs?: Record<string, Record<string, RuntimeValue>>;
    item?: RuntimeValue;
    services?: Partial<WorkflowServices>;
    /** Supplied by the engine in production; omit to render records as plain ids. */
    linkFor?: (of: string, id: string) => string | null;
  } = {}
): RuntimeContext {
  return {
    catalog: createFixtureCatalog(),
    loader: createFakeLoader(options.rows ?? {}),
    services: createFixtureServices(options.services),
    outputs: options.outputs ?? {},
    item: options.item,
    linkFor: options.linkFor
  };
}
