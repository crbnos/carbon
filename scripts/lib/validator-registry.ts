/**
 * Converts every module's zod validators once, up front, into a synchronous lookup
 * the manifest generator can consult while parsing service files.
 *
 * `buildAllToolMetadata` is sync (and worth keeping that way — it is the pure,
 * testable core). Loading validators is inherently async, so the async work happens
 * here and the result is handed in as data.
 */

import type { z } from "zod";
import { createValidatorLoader, isZodSchema } from "./validator-loader";
import {
  type JsonSchema,
  validatorToJsonSchema,
} from "./validator-to-json-schema";

/**
 * Auth/tenancy fields the caller never supplies — they are injected server-side
 * from the authenticated context (`injectAuth`). They exist on the validators
 * because forms submit them, but publishing them in the manifest would invite a
 * caller to set `companyId`.
 *
 * Shared with the textual parser in `service-metadata.ts`: a validator resolved
 * natively and the same one resolved textually must strip the same set, so this is
 * the single copy.
 *
 * `eliminationClient` is a second Supabase client for consolidation reads. Left out
 * of this set it becomes a required field no caller can express.
 */
export const CONTEXT_PARAMS = new Set([
  "client",
  "db",
  "companyId",
  "userId",
  "createdBy",
  "updatedBy",
  "companyGroupId",
  "eliminationClient",
]);

/** A module whose validators are reused across modules when a local lookup misses. */
const FALLBACK_MODULE = "shared";

export interface ValidatorConversionFailure {
  module: string;
  name: string;
  error: string;
}

export interface ValidatorRegistry {
  /**
   * The converted schema for `validatorName`, looked up in `mod` and then in
   * `shared` (cross-module validators). Null when unknown or unconvertible — the
   * caller must fall back to textual parsing.
   */
  getSchema(mod: string, validatorName: string): JsonSchema | null;
  /** Values of an exported `as const` string array, for `(typeof X)[number]` params. */
  getConstArray(mod: string, exportName: string): string[] | null;
  readonly stats: {
    modulesLoaded: number;
    moduleErrors: Array<{ module: string; error: string }>;
    validatorsConverted: number;
    conversionFailures: ValidatorConversionFailure[];
  };
}

/**
 * Strip context params from the top level and from array `items` — a payload param
 * typed as an array of rows carries them per element, which is how `createdBy` used
 * to leak into `items.properties` (pinned by `apps/erp/test/mcp-tool-metadata.test.ts`).
 */
function stripContextParams(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== "object" || node === null) return node;

    const obj = { ...(node as JsonSchema) };
    const properties = obj.properties as Record<string, unknown> | undefined;
    if (properties) {
      const kept: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (CONTEXT_PARAMS.has(key)) continue;
        kept[key] = walk(value);
      }
      obj.properties = kept;

      const required = obj.required as string[] | undefined;
      if (Array.isArray(required)) {
        const keptRequired = required.filter((r) => !CONTEXT_PARAMS.has(r));
        if (keptRequired.length > 0) obj.required = keptRequired;
        else delete obj.required;
      }
    }
    if (obj.items) obj.items = walk(obj.items);
    return obj;
  };

  return walk(schema) as JsonSchema;
}

function isConstStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string")
  );
}

/**
 * Load every module's models file and convert its validators. Never throws: a module
 * that fails to load, or a validator that fails to convert, is recorded in `stats`
 * and simply absent from the lookup, so the generator falls back to textual parsing
 * for exactly those and nothing else.
 */
export async function buildValidatorRegistry(
  modules: readonly string[]
): Promise<ValidatorRegistry> {
  const schemas = new Map<string, JsonSchema>();
  const constArrays = new Map<string, string[]>();
  const stats: ValidatorRegistry["stats"] = {
    modulesLoaded: 0,
    moduleErrors: [],
    validatorsConverted: 0,
    conversionFailures: [],
  };

  const loader = await createValidatorLoader();
  try {
    for (const mod of modules) {
      const { exports, error } = await loader.load(mod);
      if (error) {
        stats.moduleErrors.push({ module: mod, error });
        continue;
      }
      stats.modulesLoaded++;

      for (const [name, value] of Object.entries(exports)) {
        if (isConstStringArray(value)) {
          constArrays.set(`${mod}:${name}`, value);
          continue;
        }
        if (!isZodSchema(value)) continue;
        try {
          const converted = stripContextParams(
            validatorToJsonSchema(value as z.ZodType)
          );
          schemas.set(`${mod}:${name}`, converted);
          stats.validatorsConverted++;
        } catch (err) {
          stats.conversionFailures.push({
            module: mod,
            name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } finally {
    await loader.close();
  }

  return {
    getSchema(mod, validatorName) {
      const found =
        schemas.get(`${mod}:${validatorName}`) ??
        schemas.get(`${FALLBACK_MODULE}:${validatorName}`) ??
        null;
      // Hand out a COPY. One validator backs many operations (supplierValidator
      // backs both insertSupplier and upsertSupplier), and downstream steps mutate
      // the schema in place — `addOperationArg` writes `_operation` onto it. Sharing
      // the object leaked that required argument onto sibling operations that never
      // take it.
      return found ? (structuredClone(found) as JsonSchema) : null;
    },
    getConstArray(mod, exportName) {
      return (
        constArrays.get(`${mod}:${exportName}`) ??
        constArrays.get(`${FALLBACK_MODULE}:${exportName}`) ??
        null
      );
    },
    stats,
  };
}
