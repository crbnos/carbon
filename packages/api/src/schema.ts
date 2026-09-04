// Standard-Schema wrapper for the Carbon API.
//
// Every operation's input is a precomputed JSON Schema (built by the service parser),
// NOT a zod schema. oRPC's `.input()` accepts any Standard Schema v1 object, so we wrap
// the JSON Schema in a pass-through validator (parity with what MCP does today — it does
// not validate input) and carry the raw JSON Schema on the object so the OpenAPI
// generator can emit it verbatim, with no zod round-trip.
//
// Type-only imports from `@orpc/openapi` (a devDependency) are erased at build, so this
// runtime module never pulls the openapi package in — the converter class only needs to
// match the interface shape.

import type { AnySchema } from "@orpc/contract";
import type {
  ConditionalSchemaConverter,
  JSONSchema,
  SchemaConvertOptions
} from "@orpc/openapi";

/** Standard Schema vendor tag identifying a Carbon precomputed-JSON-Schema input. */
export const CARBON_VENDOR = "carbon-json-schema";

/** A Standard Schema v1 object carrying a precomputed JSON Schema. */
export interface CarbonJsonSchema {
  "~standard": {
    version: 1;
    vendor: typeof CARBON_VENDOR;
    validate: (value: unknown) => { value: unknown };
  };
  /** The precomputed JSON Schema, read by `CarbonJsonSchemaConverter`. */
  jsonSchema: Record<string, unknown>;
}

/**
 * Wrap a precomputed JSON Schema as a pass-through Standard Schema. The validator
 * never rejects — it returns `{ value }` unchanged — matching MCP's current
 * no-validation behavior. Opt-in validation (Ajv) is a separate, later concern.
 */
export function jsonSchema(schema: Record<string, unknown>): CarbonJsonSchema {
  return {
    "~standard": {
      version: 1,
      vendor: CARBON_VENDOR,
      validate: (value: unknown) => ({ value })
    },
    jsonSchema: schema
  };
}

/**
 * Teaches oRPC's `OpenAPIGenerator` how to turn a `CarbonJsonSchema` into OpenAPI:
 * it returns the carried JSON Schema verbatim. Registered via
 * `new OpenAPIGenerator({ schemaConverters: [new CarbonJsonSchemaConverter()] })`.
 * Without it, the generator cannot render our custom-vendor inputs.
 */
export class CarbonJsonSchemaConverter implements ConditionalSchemaConverter {
  condition(schema: AnySchema | undefined): boolean {
    return (
      schema !== undefined &&
      (schema as { "~standard"?: { vendor?: string } })["~standard"]?.vendor ===
        CARBON_VENDOR
    );
  }

  convert(
    schema: AnySchema | undefined,
    _options: SchemaConvertOptions
  ): [required: boolean, jsonSchema: Exclude<JSONSchema, boolean>] {
    const carried = (schema as unknown as CarbonJsonSchema).jsonSchema;
    return [true, carried as Exclude<JSONSchema, boolean>];
  }
}
