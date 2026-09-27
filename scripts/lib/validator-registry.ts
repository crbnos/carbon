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
          // Identity fields are NOT stripped here: whether a field is filled
          // from the authenticated context depends on the operation that uses
          // the validator, so the generator strips per operation, exactly the
          // fields its declared context contract fills (service-signatures.ts).
          const converted = validatorToJsonSchema(value as z.ZodType);
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
