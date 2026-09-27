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
export function validatorToJsonSchema(
  validator: z.ZodType,
  source?: { module: string; validator: string }
): JsonSchema {
  const raw = z.toJSONSchema(validator, CONVERT_OPTIONS) as JsonSchema;
  const normalized = normalizeJsonSchema(raw);
  annotateStringEncodedBooleans(validator, normalized);
  if (source) {
    // A standalone field validator (`optionalTiptapDoc`) that a service types a
    // field with — `notes?: z.infer<typeof optionalTiptapDoc>` — carries the
    // marker on its own root. An OBJECT validator never does: dispatch runs
    // field sub-schemas only, never a whole validator.
    if (unwrapToContainer(validator) === null && isTransformField(validator)) {
      const marker: CoerceSource = { ...source, field: [] };
      normalized[COERCE_MARKER] = marker;
    } else {
      markTransformFields(validator, normalized, source, []);
    }
  }
  return normalized;
}

/**
 * The schema keyword a transform-bearing property carries between validator
 * conversion and manifest assembly. It rides along wherever the property's
 * schema is copied (flattened, nested under a param name, through `Omit<>` /
 * indexed access), and the generator lifts it out of the published schema into
 * the tool's `coercers` list (`extractFieldCoercers` in service-metadata.ts).
 * It never reaches a caller.
 */
export const COERCE_MARKER = "x-carbon-coerce";

/** Where a transform-bearing field lives: the models module, the exported
 *  validator, and the field path inside it (`*` = every array element). */
export interface CoerceSource {
  module: string;
  validator: string;
  field: string[];
}

/**
 * Mark every field whose validator transforms the value it receives.
 *
 * The manifest publishes the INPUT side of a validator (see CONVERT_OPTIONS),
 * and the service is typed from its OUTPUT (`z.infer`). The UI bridges the two
 * by running the validator on the form post; the API dispatch never does, so a
 * transform — `toTiptapDoc` on a rich-text description, `JSON.parse` on a
 * `lines` field, `"true"` → `true` on a string-encoded boolean — simply did not
 * happen and the service received the wire value. Marking the field lets
 * dispatch run exactly that field's sub-schema on the value the caller sent,
 * and nothing else.
 *
 * A field counts when its io:"input" and io:"output" JSON Schemas differ once
 * `default` is ignored (a default is not a transform, and the update path must
 * not materialise one — see `stripUpdateDefaults`). `zfd.checkbox()` is left
 * out: a JSON caller already sends the boolean it produces.
 */
function markTransformFields(
  node: unknown,
  json: JsonSchema | undefined,
  source: { module: string; validator: string },
  path: string[]
): void {
  if (!json || typeof json !== "object") return;
  const target = unwrapToContainer(node);
  if (!target) return;

  if (target.kind === "array") {
    const items = json.items as JsonSchema | undefined;
    markTransformFields(target.element, items, source, [...path, "*"]);
    return;
  }

  const props = json.properties as Record<string, JsonSchema> | undefined;
  if (!props) return;
  for (const [key, field] of Object.entries(target.shape)) {
    const prop = props[key];
    if (!prop || typeof prop !== "object") continue;
    if (isTransformField(field)) {
      const marker: CoerceSource = {
        module: source.module,
        validator: source.validator,
        field: [...path, key],
      };
      prop[COERCE_MARKER] = marker;
      continue;
    }
    markTransformFields(field, prop, source, [...path, key]);
  }
}

type ZodDefLike = {
  type?: string;
  innerType?: unknown;
  in?: unknown;
  element?: unknown;
  shape?: Record<string, unknown>;
};

const WRAPPER_TYPES = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "readonly",
  "catch",
  "nonoptional",
]);

function defOf(node: unknown): ZodDefLike | undefined {
  return (node as { _zod?: { def?: ZodDefLike } } | null)?._zod?.def;
}

/** Strip optional/nullable/default-style wrappers. */
export function unwrapZodWrappers(node: unknown): unknown {
  let current = node;
  for (let i = 0; i < 16; i++) {
    const def = defOf(current);
    if (!def?.type || !WRAPPER_TYPES.has(def.type)) return current;
    current = def.innerType;
  }
  return current;
}

/** The object shape or array element under a field, looking through wrappers
 *  and an object-level `.transform()` / preprocess (`pipe`, input side). */
function unwrapToContainer(
  node: unknown
):
  | { kind: "object"; shape: Record<string, unknown> }
  | { kind: "array"; element: unknown }
  | null {
  let current = node;
  for (let i = 0; i < 16; i++) {
    current = unwrapZodWrappers(current);
    const def = defOf(current);
    if (!def) return null;
    if (def.type === "object") {
      const shape =
        (current as { shape?: Record<string, unknown> }).shape ?? def.shape;
      return shape ? { kind: "object", shape } : null;
    }
    if (def.type === "array") return { kind: "array", element: def.element };
    if (def.type === "pipe") {
      current = def.in;
      continue;
    }
    return null;
  }
  return null;
}

function isTransformField(field: unknown): boolean {
  const def = defOf(unwrapZodWrappers(field));
  if (def?.type !== "pipe" && def?.type !== "transform") return false;
  try {
    const input = withoutDefaults(
      z.toJSONSchema(field as z.ZodType, CONVERT_OPTIONS)
    );
    const output = withoutDefaults(
      z.toJSONSchema(field as z.ZodType, { ...CONVERT_OPTIONS, io: "output" })
    );
    if (JSON.stringify(input) === JSON.stringify(output)) return false;
    return collapseCheckbox(input as JsonSchema) === null;
  } catch {
    return false;
  }
}

function withoutDefaults(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutDefaults);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "default" || key === "$schema") continue;
    out[key] = withoutDefaults(value);
  }
  return out;
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
    // A JSON-parsing transform ALSO maps "true"/"false" to the booleans —
    // `JSON.parse("true") === true` — so those two probes alone false-positive on
    // fields whose string is a JSON payload (methodMaterial.storageUnitIds's
    // location→bin map, the issue-workflow `content`, gauge/risk `notes`), which
    // then published a bogus `enum: ["true","false"]` and rejected any real value.
    // A genuine string-encoded boolean maps EVERY string to a boolean; a JSON
    // parser maps an arbitrary non-JSON string to a non-boolean (its object/array
    // fallback) or rejects it. One extra probe tells the two apart.
    const asOther = f.safeParse("__carbon_not_a_boolean__");
    return (
      asTrue.success &&
      asTrue.data === true &&
      asFalse.success &&
      asFalse.data === false &&
      (!asOther.success || typeof asOther.data === "boolean")
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
