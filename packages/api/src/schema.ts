// Standard-Schema wrapper for the Carbon API.
//
// Every operation's input is a precomputed JSON Schema (built by the service parser),
// NOT a zod schema. oRPC's `.input()` accepts any Standard Schema v1 object, so we wrap
// the JSON Schema in a Standard Schema object that carries the raw JSON Schema, so the
// OpenAPI generator can emit it verbatim.
//
// Two wrappers, and the difference is load-bearing:
//   - `jsonSchemaInput()` VALIDATES. Used for `.input()`.
//   - `jsonSchema()` is a pass-through. Used for `.output()`, where the handler's own
//     body shaping is not described by the operation's response schema, so validating
//     would reject correct responses.
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
import { z } from "zod";

/** Standard Schema vendor tag identifying a Carbon precomputed-JSON-Schema input. */
export const CARBON_VENDOR = "carbon-json-schema";

/** Standard Schema v1 issue shape (structurally what zod's `error.issues` provide). */
export interface CarbonSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

/** A Standard Schema v1 object carrying a precomputed JSON Schema. */
export interface CarbonJsonSchema {
  "~standard": {
    version: 1;
    vendor: typeof CARBON_VENDOR;
    validate: (
      value: unknown
    ) => { value: unknown } | { issues: readonly CarbonSchemaIssue[] };
  };
  /** The precomputed JSON Schema, read by `CarbonJsonSchemaConverter`. */
  jsonSchema: Record<string, unknown>;
}

/**
 * Wrap a precomputed JSON Schema as a pass-through Standard Schema. The validator
 * never rejects — it returns `{ value }` unchanged.
 *
 * This is the OUTPUT wrapper. `shapeHttpBody` rewrites a DispatchResult into the
 * HTTP body, so a response legitimately does not match the operation's declared
 * response schema; validating here would reject correct responses. For request
 * input use `jsonSchemaInput`.
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
 * Wrap a precomputed JSON Schema as a VALIDATING Standard Schema, for `.input()`.
 *
 * The manifest's JSON Schema is converted back to a zod schema with
 * `z.fromJSONSchema` — zod is already a workspace dependency, so this needs no
 * JSON-Schema validator library. The conversion is lazy and memoized: the router
 * builds ~1500 procedures at module load, and only the ones actually called pay
 * for it.
 *
 * Deliberately permissive in two ways, because the dispatcher relies on both:
 *   - Unknown keys are preserved, not stripped (no generated schema sets
 *     `additionalProperties: false`), so the dispatcher's positional fallbacks
 *     still see the payload they were given.
 *   - A schema zod cannot represent falls back to pass-through rather than
 *     failing every request to that operation.
 */
export function jsonSchemaInput(
  schema: Record<string, unknown>
): CarbonJsonSchema {
  let compiled: z.ZodType | null | undefined;
  let unwrapped: z.ZodType | null | undefined;

  return {
    "~standard": {
      version: 1,
      vendor: CARBON_VENDOR,
      validate: (value: unknown) => {
        if (compiled === undefined) compiled = compileJsonSchema(schema);
        if (compiled === null) return { value };

        const result = compiled.safeParse(value);
        if (result.success) return { value: result.data };

        // The dispatcher accepts a lone wrapper's contents sent flat, and the
        // workflow engine's create actions rely on it: job.create sends
        // { itemId, quantity } to an operation whose schema declares
        // { input: {...} }. Validation has to accept every shape dispatch does,
        // or it rejects calls that work today. Deliberately narrow — only when
        // the wrapper is the schema's ONLY required property, so an operation
        // with other required fields still gets checked.
        if (unwrapped === undefined) unwrapped = compileSoleWrapper(schema);
        if (unwrapped && unwrapped.safeParse(value).success) return { value };

        return { issues: result.error.issues };
      }
    },
    jsonSchema: schema
  };
}

function compileJsonSchema(schema: unknown): z.ZodType | null {
  try {
    return z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  } catch {
    return null; // unconvertible — do not reject every request to it
  }
}

/** The schema of the single required object property, when it is the only one required. */
function compileSoleWrapper(schema: Record<string, unknown>): z.ZodType | null {
  const required = schema.required;
  if (!Array.isArray(required) || required.length !== 1) return null;
  const properties = schema.properties as
    | Record<string, { type?: unknown }>
    | undefined;
  const wrapper = properties?.[required[0] as string];
  if (!wrapper || wrapper.type !== "object") return null;
  return compileJsonSchema(wrapper);
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
