// Runs a validator's per-field transforms on an API payload, so a service
// receives what the UI's form bridge would hand it.
//
// Every write route runs `validator(V).validate(formData)` and passes the
// OUTPUT to the service: `toTiptapDoc` has turned a rich-text description into
// a document, `JSON.parse` has turned a `lines` string into rows, a
// string-encoded boolean has become a boolean. The API published the INPUT side
// of the same validator and dispatch never ran it, so those transforms never
// happened: a string scalar landed in a json column, or `lines.map` threw.
//
// The generator records, per operation, the fields whose input and output
// schemas differ (`ManifestEntry.coercers`). Only those field sub-schemas run,
// and only on keys the caller actually sent. The whole validator is never run:
// `zfd.checkbox()` maps an absent key to `false`, `zfd.text` drops `""` and
// rejects `null`, and many services take `Omit<…> & {…}` shapes the validator
// would reject — any of which would clear or refuse fields on a partial update.

import type { FieldCoercer, ManifestEntry } from "@carbon/api";
import { ORPCError } from "@orpc/server";
import type { z } from "zod";

/**
 * The models modules the generator reads validators from, keyed by module.
 * Loaded lazily: only operations with coercers pay for the import, and the
 * dispatch module graph stays free of UI-side validator dependencies.
 */
export const modelsLoaders: Record<
  string,
  () => Promise<Record<string, unknown>>
> = {
  account: () => import("~/modules/account/account.models"),
  accounting: () => import("~/modules/accounting/accounting.models"),
  documents: () => import("~/modules/documents/documents.models"),
  inventory: () => import("~/modules/inventory/inventory.models"),
  invoicing: () => import("~/modules/invoicing/invoicing.models"),
  items: () => import("~/modules/items/items.models"),
  people: () => import("~/modules/people/people.models"),
  production: () => import("~/modules/production/production.models"),
  purchasing: () => import("~/modules/purchasing/purchasing.models"),
  quality: () => import("~/modules/quality/quality.models"),
  resources: () => import("~/modules/resources/resources.models"),
  sales: () => import("~/modules/sales/sales.models"),
  settings: () => import("~/modules/settings/settings.models"),
  shared: () => import("~/modules/shared/shared.models"),
  users: () => import("~/modules/users/users.models")
};

type ZodDef = {
  type?: string;
  innerType?: unknown;
  in?: unknown;
  element?: unknown;
  shape?: Record<string, unknown>;
};

const WRAPPERS = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "readonly",
  "catch",
  "nonoptional"
]);

function defOf(node: unknown): ZodDef | undefined {
  return (node as { _zod?: { def?: ZodDef } } | null)?._zod?.def;
}

/** Step from a zod node to its object field / array element, looking through
 *  wrappers and a `pipe`'s input side — the same walk the generator made. */
function step(node: unknown, key: string): unknown {
  let current = node;
  for (let i = 0; i < 16 && current; i++) {
    const def = defOf(current);
    if (!def) return undefined;
    if (def.type && WRAPPERS.has(def.type)) {
      current = def.innerType;
    } else if (def.type === "pipe") {
      current = def.in;
    } else if (def.type === "object" && key !== "*") {
      const shape =
        (current as { shape?: Record<string, unknown> }).shape ?? def.shape;
      return shape?.[key];
    } else if (def.type === "array" && key === "*") {
      return def.element;
    } else {
      return undefined;
    }
  }
  return undefined;
}

const resolved = new Map<string, z.ZodType | null>();

/** The zod sub-schema a coercer names, or null when it no longer exists (the
 *  manifest is stale). Memoized per process. */
export async function resolveCoercerSchema(
  coercer: FieldCoercer
): Promise<z.ZodType | null> {
  const key = `${coercer.module}:${coercer.validator}:${coercer.field.join(".")}`;
  if (resolved.has(key)) return resolved.get(key) ?? null;
  const models = await modelsLoaders[coercer.module]?.();
  let node: unknown = models?.[coercer.validator];
  for (const part of coercer.field) node = node ? step(node, part) : undefined;
  const schema =
    node && typeof (node as z.ZodType).safeParse === "function"
      ? (node as z.ZodType)
      : null;
  resolved.set(key, schema);
  return schema;
}

function issueMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

/**
 * Walk `value` along `at` and coerce every value found at the end. A key the
 * caller did not send is left absent; `null` is left as sent (a JSON caller's
 * way to clear, which `zfd.text` would reject).
 */
function coerceAt(
  value: unknown,
  at: string[],
  schema: z.ZodType,
  label: string
): unknown {
  if (at.length === 0) {
    if (value === null || value === undefined) return value;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ORPCError("BAD_REQUEST", {
        message: `${label}: ${issueMessage(parsed.error)}`
      });
    }
    return parsed.data;
  }
  const [head, ...rest] = at;
  if (head === "*") {
    if (!Array.isArray(value)) return value;
    return value.map((element) => coerceAt(element, rest, schema, label));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!(head in record)) return value;
  return { ...record, [head]: coerceAt(record[head], rest, schema, label) };
}

/**
 * Apply the operation's field coercers to the caller's input. Returns the
 * input unchanged when the operation has none. Throws BAD_REQUEST, with the
 * validator's own message, when a sent value fails its field schema — the
 * error the UI shows for the same value.
 */
export async function applyFieldCoercers(
  meta: Pick<ManifestEntry, "coercers">,
  input: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  if (!input || !meta.coercers?.length) return input;
  let out: Record<string, unknown> = input;
  for (const coercer of meta.coercers) {
    const schema = await resolveCoercerSchema(coercer);
    if (!schema) continue;
    out = coerceAt(out, coercer.at, schema, coercer.at.join(".")) as Record<
      string,
      unknown
    >;
  }
  return out;
}

/**
 * Fill the validator defaults of a create-capable upsert on its create path.
 * The generator stopped publishing them as JSON Schema `default` (input
 * validation materialised them on updates too); the create path still gets
 * exactly the values the UI form validator would have supplied.
 */
export function applyCreateDefaults(
  meta: Pick<ManifestEntry, "createDefaults">,
  input: Record<string, unknown> | undefined,
  isCreate: boolean
): Record<string, unknown> | undefined {
  if (!isCreate || !meta.createDefaults) return input;
  const out: Record<string, unknown> = { ...(input ?? {}) };
  for (const [key, value] of Object.entries(meta.createDefaults)) {
    if (!(key in out)) out[key] = structuredClone(value);
  }
  return out;
}
