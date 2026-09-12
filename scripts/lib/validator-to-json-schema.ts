/**
 * The one place a zod validator becomes a manifest JSON Schema.
 *
 * Conversion is native (`z.toJSONSchema`, zod >= 4). Everything else here is the
 * normalization the raw converter output needs before it can be published as the
 * caller contract for MCP, the v1 OpenAPI spec, and the docs.
 */

import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

/**
 * `io: "input"` is deliberate: the manifest documents what a CALLER SENDS.
 *
 * The output side is the post-parse shape the service function receives — defaults
 * already applied (so they read as required), transforms already run — which is
 * neither the request contract nor the API response. Response schemas need
 * ReturnType reflection over the service functions and are a separate concern.
 *
 * `unrepresentable: "any"` maps `z.custom`/exotic transforms to `{}` instead of
 * throwing, so one odd field degrades to "any JSON" rather than losing the operation.
 */
const CONVERT_OPTIONS = {
  io: "input",
  unrepresentable: "any",
} as const;

/** Convert a zod validator, then normalize. Throws if zod cannot represent it. */
export function validatorToJsonSchema(validator: z.ZodType): JsonSchema {
  const raw = z.toJSONSchema(validator, CONVERT_OPTIONS) as JsonSchema;
  const normalized = normalizeJsonSchema(raw);
  annotateStringEncodedBooleans(validator, normalized);
  return normalized;
}

/**
 * `zfd.text(z.string().transform((v) => v === "true"))` — the form-post
 * boolean — converts to a bare `{type: "string"}`, which invites a JSON caller
 * to send a real boolean the validator then rejects with no hint why
 * (production_upsertJobMaterial's requiresBatchTracking/requiresSerialTracking
 * did exactly that to an MCP agent). The transform is unrepresentable in JSON
 * Schema but PROBEABLE: a field that parses the string "true" to boolean
 * `true` and "false" to boolean `false` is a string-encoded boolean, and no
 * other field shape in the codebase does that (`z.coerce.boolean()` maps
 * "false" to `true`; `z.enum(["true","false"])` keeps strings). Publish the
 * two legal values so a schema-reading client cannot guess wrong.
 */
function annotateStringEncodedBooleans(
  validator: unknown,
  json: JsonSchema
): void {
  // An array validator (rows payload): annotate its element against `items`.
  const element = (validator as { element?: unknown } | null)?.element;
  if (element && json.items && typeof json.items === "object") {
    annotateStringEncodedBooleans(element, json.items as JsonSchema);
    return;
  }

  const shape = (validator as { shape?: Record<string, unknown> } | null)
    ?.shape;
  const props = json.properties as Record<string, JsonSchema> | undefined;
  if (!shape || typeof shape !== "object" || !props) return;

  for (const [key, field] of Object.entries(shape)) {
    const prop = props[key];
    if (!prop || typeof prop !== "object") continue;
    if (isStringEncodedBoolean(field)) {
      if (prop.type === "string" && prop.enum === undefined) {
        prop.enum = ["true", "false"];
      }
      continue;
    }
    annotateStringEncodedBooleans(field, prop);
  }
}

function isStringEncodedBoolean(field: unknown): boolean {
  const f = field as {
    safeParse?: (value: unknown) => { success: boolean; data?: unknown };
  } | null;
  if (typeof f?.safeParse !== "function") return false;
  try {
    const asTrue = f.safeParse("true");
    const asFalse = f.safeParse("false");
    return (
      asTrue.success &&
      asTrue.data === true &&
      asFalse.success &&
      asFalse.data === false
    );
  } catch {
    return false;
  }
}

/**
 * Post-conversion cleanup, applied depth-first:
 *
 * 1. Drop `$schema` — the manifest embeds these as property schemas, not documents.
 * 2. Collapse the `zfd.checkbox()` shape to a plain boolean (see below).
 * 3. Inline `$ref`s against the schema's own `$defs`, then drop `$defs` — MCP
 *    clients and the docs renderer both want a self-contained tree. A `$ref` that
 *    cannot be resolved (a genuinely recursive validator) is left in place rather
 *    than silently emptied; the caller's fallback reports it.
 * 4. Split a multi-type `type` array (beyond `[x, "null"]`) into `anyOf` — the
 *    same JSON Schema, but the form strict generators (Go's oapi-codegen)
 *    actually handle. `z.union([z.boolean(), z.string()])` emits
 *    `type: ["boolean","string"]`, which such generators reject outright.
 */
export function normalizeJsonSchema(schema: JsonSchema): JsonSchema {
  const defs = (schema.$defs ?? schema.definitions) as
    | Record<string, JsonSchema>
    | undefined;

  const walk = (node: unknown, seenRefs: ReadonlySet<string>): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item, seenRefs));
    if (typeof node !== "object" || node === null) return node;

    const obj = node as JsonSchema;

    // Inline a $ref against $defs. Guard on the ref path already being expanded in
    // this branch: a self-referential validator would otherwise recurse forever.
    const ref = obj.$ref;
    if (typeof ref === "string") {
      const name = ref.replace(/^#\/(?:\$defs|definitions)\//, "");
      const target = defs?.[name];
      if (!target || seenRefs.has(ref)) return obj;
      return walk(target, new Set(seenRefs).add(ref));
    }

    const checkbox = collapseCheckbox(obj);
    if (checkbox) return checkbox;

    const out: JsonSchema = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "$schema" || key === "$defs" || key === "definitions") continue;
      out[key] = walk(value, seenRefs);
    }

    const type = out.type;
    if (
      Array.isArray(type) &&
      type.filter((t) => t !== "null").length > 1 &&
      !out.anyOf &&
      !out.oneOf
    ) {
      delete out.type;
      out.anyOf = type.map((t) => ({ type: t }));
    }
    return out;
  };

  return walk(schema, new Set()) as JsonSchema;
}

/**
 * `zfd.checkbox()` converts to `anyOf: [{const:"on"}, {}, {type:"boolean"}]` — an
 * honest description of what an HTML form posts, and useless to a JSON caller (the
 * bare `{}` member makes it read as "any"). JSON callers send a boolean, so publish
 * that. Returns null when the node is not that shape.
 */
function collapseCheckbox(node: JsonSchema): JsonSchema | null {
  const anyOf = node.anyOf;
  if (!Array.isArray(anyOf) || anyOf.length !== 3) return null;

  const members = anyOf as JsonSchema[];
  const hasOnConst = members.some(
    (m) => m && m.const === "on" && m.type === "string"
  );
  const hasBoolean = members.some((m) => m && m.type === "boolean");
  const hasEmpty = members.some((m) => m && Object.keys(m).length === 0);
  if (!hasOnConst || !hasBoolean || !hasEmpty) return null;

  const { anyOf: _dropped, ...rest } = node;
  return { ...rest, type: "boolean" };
}
