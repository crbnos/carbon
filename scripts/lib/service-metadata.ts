// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Service metadata parser — the pure core behind the MCP tool manifest and the
 * Carbon API contract.
 *
 * Turns every `apps/erp/app/modules/*.service.ts` (+ `.ee` / `.mcp.server`
 * companions) into operation metadata: classification, description, positional
 * service params, the audit fields to inject, the required permission, and a JSON
 * Schema for the input. NO filesystem writes and no process side effects — callers
 * (`scripts/generate-mcp.ts`) own emitting the manifest.
 *
 * Which functions exist, their parameters, their doc tags and what their bodies
 * do all come from the AST (`service-ast.ts`). The one thing still read as TEXT
 * is a parameter's declared type, which `typeToJsonSchema` below turns into a
 * JSON Schema.
 */

import * as fs from "fs";
import * as path from "path";

import type {
  AuthField,
  Classification,
  ContextSource,
  ManifestEntry,
  PermissionAction,
  ToolPermission,
} from "@carbon/api";
import { MCP_BLOCKED_TOOL_NAMES } from "../../apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools";
import {
  MCP_DESTRUCTIVE,
  MCP_EXPOSURE_TAG,
  MCP_MODULE_ALLOWLIST,
  MCP_SETTINGS,
  MCP_VERBS,
  type McpVerb
} from "../../apps/erp/app/routes/api+/mcp+/lib/mcp-exposure";
import type { Node, Type } from "ts-morph";
import {
  buildResponseSchemaIndex,
  type ResponseSchemaIndex,
  typeToJsonSchema as reflectType,
} from "./response-schema";
import {
  loadSqlFunctionEffects,
  type SqlFunctionEffects
} from "../../packages/database/src/sql-effects";
import { getDbEnumValues, getDbTableTypeFields } from "./db-types";
import {
  auditParams,
  branchesOnKeyPresence,
  buildServiceAst,
  dbWrites,
  idDistinguishesUpdate,
  namedTables,
  rpcCalls,
  paginates as bodyPaginates,
  type ServiceAst,
  type ServiceFunction
} from "./service-ast";
import {
  AUDIT_FIELDS,
  buildValidatorRegistry,
  CONTEXT_PARAMS,
  POSITIONAL_CONTEXT,
  type ValidatorRegistry,
} from "./validator-registry";

const ROOT = path.resolve(__dirname, "../..");
const MODULES_DIR = path.join(ROOT, "apps/erp/app/modules");

export const MODULE_LIST = [
  "account",
  "accounting",
  "documents",
  "inventory",
  "invoicing",
  "items",
  "people",
  "production",
  "purchasing",
  "quality",
  "resources",
  "sales",
  "settings",
  "shared",
  "users",
];

const DESCRIPTION_OVERRIDES: Record<string, string> = {
  purchasing_insertPurchaseOrder:
    "Create a new purchase order with all business logic - generates sequence, creates supplier interaction, resolves payment/shipping defaults from supplier. LLM can create a PO with just supplierId.",
  purchasing_updatePurchaseOrder:
    "Update an existing purchase order - handles exchange rate updates when currency changes",
  purchasing_insertSupplierQuote:
    "Create a new supplier quote with all business logic - generates sequence, creates supplier interaction, sets up external link. LLM can create a quote with just supplierId.",
  purchasing_updateSupplierQuote:
    "Update an existing supplier quote - handles exchange rate updates when currency changes",
  sales_insertQuote:
    "Create a new quote with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer. LLM can create a quote with just customerId.",
  sales_updateQuote:
    "Update an existing quote - handles exchange rate updates when currency changes, syncs customer to opportunity",
  sales_upsertQuoteLine:
    "Create or update a quote line. Keep description to a short one-line label - it is truncated on the digital quote. Long specifications belong in externalNotes (TipTap doc JSON, rendered in full under the line on the digital quote and PDF); internalNotes takes the same shape and is never shown to the customer.",
  sales_insertSalesOrder:
    "Create a new sales order with all business logic - generates sequence, creates opportunity, resolves payment/shipping defaults from customer. LLM can create a sales order with just customerId.",
  sales_updateSalesOrder:
    "Update an existing sales order - handles exchange rate updates when currency changes, syncs customer to opportunity",
  production_insertJob:
    "Create a new job with all business logic - generates sequence, resolves location, copies method from item, recalculates requirements. LLM can create a job with just itemId and quantity.",
  production_updateJob:
    "Update an existing job - handles priority recalculation when deadline changes",
  inventory_insertStockTransfer:
    "Create a stock transfer with lines. Generates sequence ID automatically.",
  inventory_updateStockTransfer: "Update an existing stock transfer",
  inventory_insertWarehouseTransfer:
    "Create a warehouse transfer between locations. Generates sequence ID automatically.",
  inventory_updateWarehouseTransfer: "Update an existing warehouse transfer",
};

// service-module → permission-module. `items` operations are gated by the `parts`
// permission; `account` and `shared` gate only on a valid key of the company (no
// module permission), so they map to null. Every other module is identity.
const PERMISSION_MODULE_MAP: Record<string, string | null> = {
  items: "parts",
  account: null,
  shared: null,
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

// Comments must be structurally INERT to every scanner below: an unmatched `)`
// inside a `/** [from, to) … */` doc ended a param scan early, and a comma
// inside a `// …composer,` line split a parameter mid-comment — both published
// comment text as schema property names, which strict codegen (Go's
// oapi-codegen) rightly rejects. Returns the index just past a comment starting
// at i, or i when none does.
function skipComment(str: string, i: number): number {
  if (str[i] !== "/") return i;
  if (str[i + 1] === "/") {
    const nl = str.indexOf("\n", i);
    return nl === -1 ? str.length : nl;
  }
  if (str[i + 1] === "*") {
    const end = str.indexOf("*/", i + 2);
    return end === -1 ? str.length : end + 2;
  }
  return i;
}

function findMatchingBrace(content: string, openPos: number): number {
  const open = content[openPos];
  const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : ">";
  let depth = 1;
  let i = openPos + 1;
  while (i < content.length && depth > 0) {
    const j = skipComment(content, i);
    if (j !== i) {
      i = j;
      continue;
    }
    if (content[i] === open) depth++;
    else if (content[i] === close) depth--;
    i++;
  }
  return i - 1;
}

function splitAtTopLevel(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < str.length; i++) {
    const j = skipComment(str, i);
    if (j !== i) {
      current += str.slice(i, j);
      i = j - 1;
      continue;
    }
    const ch = str[i];
    if ("({[<".includes(ch)) depth++;
    else if (")}]>".includes(ch) && !isArrowClose(str, i)) depth--;
    if (ch === delimiter && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// The `>` in an arrow function (`() => ...`) is not a generic close. Counting it
// as one drives brace depth negative, so every top-level delimiter after the
// first arrow (e.g. a validator field after an `errorMap: () => ({...})`) stops
// splitting — silently truncating a tool's schema to the fields before it.
function isArrowClose(str: string, i: number): boolean {
  return str[i] === ">" && str[i - 1] === "=";
}

/**
 * Reduce a function-level JSDoc body to a one-line tool description: the prose
 * before the first `@tag`, first sentence only, whitespace collapsed. The
 * trailing period is stripped and the leading letter lowercased (unless it
 * starts an acronym) to match the name-derived convention — the docs site
 * capitalizes and appends its own period, so a sentence-cased summary would
 * render doubled there.
 */
export function extractJsdocSummary(raw: string): string | undefined {
  const prose = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, ""))
    .join("\n");
  const beforeTags = prose.split(/^\s*@\w/m)[0];
  const text = beforeTags.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const sentence = text.match(/^(.*?[.!?])(?:\s|$)/)?.[1] ?? text;
  const normalized = sentence.replace(/[.!?]+$/, "").trim();
  if (!normalized) return undefined;
  const cased = /^[A-Z][a-z]/.test(normalized)
    ? normalized.charAt(0).toLowerCase() + normalized.slice(1)
    : normalized;
  return cased.length > 160 ? `${cased.slice(0, 159).trimEnd()}…` : cased;
}

// ---------------------------------------------------------------------------
// Type → JSON Schema conversion
// ---------------------------------------------------------------------------

/**
 * Threaded into the type converters so a `z.infer<typeof X>` NESTED inside an
 * inline object type (`contact: PickPartial<z.infer<typeof V>, "email">`) can
 * resolve through the validator registry instead of publishing `{}`. An untyped
 * `{}` on a write tool is an invitation for an MCP client to guess field names
 * — a guessed `contact.phone` reached the insert and failed with PGRST204.
 */
type TypeResolveContext = SchemaBuildContext & {
  /** Module-local sources searched for `type X = …` / `interface X {…}`. */
  aliasSources?: string[];
  /** Cycle guard for alias-to-alias references. */
  aliasSeen?: Set<string>;
};

function typeToJsonSchema(
  typeStr: string,
  ctx?: TypeResolveContext
): Record<string, unknown> {
  const t = typeStr.trim();

  // Nullable: "Type | null"
  const nullableMatch = t.match(/^(.+?)\s*\|\s*null$/);
  if (nullableMatch) {
    const inner = typeToJsonSchema(nullableMatch[1].trim(), ctx);
    if (Array.isArray(inner.anyOf)) {
      return { anyOf: [...(inner.anyOf as unknown[]), { type: "null" }] };
    }
    if (inner.type) {
      return { ...inner, type: [inner.type, "null"] };
    }
    return inner;
  }

  // String literal union: "A" | "B" | "C". A leading-pipe union style
  // (`| (A) | (B)`) yields an empty first part — drop it, or it becomes a
  // spurious `{}` member of the anyOf. `undefined` members are dropped too:
  // JSON has no undefined, and a `null | undefined` field otherwise published
  // an opaque `{}` member.
  const literalParts = splitAtTopLevel(t, "|")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "undefined");
  if (literalParts.length === 1 && literalParts[0] !== t) {
    return typeToJsonSchema(literalParts[0], ctx);
  }
  if (literalParts.length > 1 && literalParts.every((p) => /^"[^"]*"$/.test(p))) {
    return {
      type: "string",
      enum: literalParts.map((p) => p.slice(1, -1)),
    };
  }

  // General union: "string | string[]" and friends. MUST run before the
  // array-suffix check below — a union whose last member is an array ends with
  // "[]", and slicing two characters off the whole union recursed on garbage
  // ("string | string"), publishing `any[]` where the type was `string[]`.
  if (literalParts.length > 1) {
    const members: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const part of literalParts) {
      const member = typeToJsonSchema(part, ctx);
      const key = JSON.stringify(member);
      if (seen.has(key)) continue;
      seen.add(key);
      members.push(member);
    }
    if (members.length === 1) return members[0];
    return { anyOf: members };
  }

  // Primitives
  if (t === "string") return { type: "string" };
  if (t === "number") return { type: "number" };
  if (t === "boolean") return { type: "boolean" };
  if (t === "null") return { type: "null" };

  // A single string-literal type ("customer") — a one-value enum.
  if (/^"[^"]*"$/.test(t)) {
    return { type: "string", enum: [t.slice(1, -1)] };
  }

  // Arrays
  if (t === "string[]") return { type: "array", items: { type: "string" } };
  if (t === "number[]") return { type: "array", items: { type: "number" } };
  if (t.endsWith("[]")) {
    const inner = typeToJsonSchema(t.slice(0, -2).trim(), ctx);
    return { type: "array", items: inner };
  }
  const arrayGeneric = genericInner(t, "Array") ?? genericInner(t, "ReadonlyArray");
  if (arrayGeneric !== null) {
    return { type: "array", items: typeToJsonSchema(arrayGeneric, ctx) };
  }

  // Json type
  if (t === "Json" || t === "Json | null") return {};

  // Record<string, V> — an open string-keyed map.
  const recordInner = genericInner(t, "Record");
  if (recordInner !== null) {
    const args = splitAtTopLevel(recordInner, ",").map((s) => s.trim());
    if (args.length === 2 && args[0] === "string") {
      if (args[1] === "any" || args[1] === "unknown") {
        return { type: "object" };
      }
      return {
        type: "object",
        additionalProperties: typeToJsonSchema(args[1], ctx)
      };
    }
    return { type: "object" };
  }

  // (typeof X)[number] — enum array reference; the loaded const array gives the
  // real values, else degrade to a bare string. Anchored: an unanchored match
  // also fired for any inline object type that merely CONTAINS such a field,
  // collapsing the whole object to a string.
  const constArrayField = t.match(/^\(typeof\s+(\w+)\)\s*\[number\]$/);
  if (constArrayField) {
    const values = ctx?.validators?.getConstArray(
      ctx.module ?? "",
      constArrayField[1]
    );
    return values ? { type: "string", enum: values } : { type: "string" };
  }

  // Generated database types — `Database["public"]["Enums"]["x"]` and
  // `Database["public"]["Tables"]["t"]["Row"|"Insert"|"Update"]` (optionally
  // with one more `["field"]` accessor) resolve from the generated types file.
  const dbEnum = t.match(/^Database\["public"\]\["Enums"\]\["(\w+)"\]$/);
  if (dbEnum) {
    const values = getDbEnumValues(dbEnum[1]);
    return values ? { type: "string", enum: values } : { type: "string" };
  }
  const dbTable = t.match(
    /^Database\["public"\]\["Tables"\]\["(\w+)"\]\["(Row|Insert|Update)"\](?:\["(\w+)"\])?$/
  );
  if (dbTable) {
    const fields = getDbTableTypeFields(
      dbTable[1],
      dbTable[2] as "Row" | "Insert" | "Update"
    );
    if (fields) {
      if (dbTable[3]) {
        const field = fields.find((f) => f.name === dbTable[3]);
        return field ? typeToJsonSchema(field.typeStr, ctx) : {};
      }
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const field of fields) {
        if (CONTEXT_PARAMS.has(field.name)) continue;
        properties[field.name] = typeToJsonSchema(field.typeStr, ctx);
        if (!field.optional) required.push(field.name);
      }
      const schema: Record<string, unknown> = { type: "object", properties };
      if (required.length > 0) schema.required = required;
      return schema;
    }
  }

  // A parenthesized type — `(Omit<z.infer<...>> & {...})`, the usual shape of a
  // discriminated-upsert union branch. Unwrap so the branch resolves instead of
  // publishing `{}`.
  if (t.startsWith("(") && t.endsWith(")") && wrapsWholeType(t)) {
    return typeToJsonSchema(t.slice(1, -1), ctx);
  }

  // Partial<X> — X's schema with nothing required.
  const partialInner = genericInner(t, "Partial");
  if (partialInner !== null) {
    const inner = typeToJsonSchema(partialInner, ctx);
    if (inner.type === "object") {
      const { required: _required, ...rest } = inner;
      return rest;
    }
    return inner;
  }

  // A validator reference nested inside a larger type — `z.infer<typeof V>`,
  // optionally wrapped (Partial/PickPartial/Omit, an `& {...}` intersection, an
  // indexed access). The guard excludes inline objects, which merely CONTAIN
  // such fields and must be flattened field-by-field below.
  if (ctx && !t.startsWith("{") && t.includes("z.infer<")) {
    const resolved = resolveNestedInferType(t, ctx);
    if (resolved) return resolved;
  }

  // General intersection (`A & B`) — merge the object members. Covers shapes
  // like `Record<string, any> & { id: string }` and
  // `{ ... } & ({ createdBy: string } | { updatedBy: string })`, which the
  // inline-object parser would otherwise mangle (it strips one brace pair and
  // treats the rest as fields). GenericQueryFilters keeps its dedicated branch.
  if (!t.includes("GenericQueryFilters")) {
    const intersection = splitAtTopLevel(t, "&")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (intersection.length > 1) {
      const properties: Record<string, unknown> = {};
      const required = new Set<string>();
      for (const part of intersection) {
        const member = typeToJsonSchema(part, ctx);
        if (member.type === "object") {
          Object.assign(
            properties,
            (member.properties as Record<string, unknown>) ?? {}
          );
          for (const r of (member.required as string[] | undefined) ?? []) {
            required.add(r);
          }
        } else if (Object.keys(member).length > 0) {
          // A non-object member (a scalar, an anyOf) can't be merged — a
          // partial schema would misdocument the type, so publish nothing.
          return {};
        }
        // An unresolved `{}` member contributes nothing but doesn't block the
        // members that did resolve.
      }
      if (Object.keys(properties).length === 0) return {};
      const schema: Record<string, unknown> = { type: "object", properties };
      if (required.size > 0) schema.required = [...required];
      return schema;
    }
  }

  // Inline object: { field: Type; ... }
  if (t.startsWith("{")) {
    return parseInlineObjectType(t, ctx);
  }

  // A bare identifier — try the module's own type aliases before giving up.
  if (ctx?.aliasSources && /^[A-Za-z_$][\w$]*$/.test(t)) {
    const resolved = resolveTypeAlias(t, ctx);
    if (resolved) return resolved;
  }

  // GenericQueryFilters & { ... }
  if (t.includes("GenericQueryFilters")) {
    const base: Record<string, unknown> = {
      type: "object",
      properties: {
        // No default: setGenericQueryFilters pages only when it is given a
        // limit, so one left out means the whole result, as it always has.
        // Publishing `default: 100` claimed a page size no caller ever got.
        limit: {
          type: "integer",
          description: "Rows per page. Left out, the read is not paged.",
        },
        offset: { type: "integer", default: 0 },
      },
    };
    const intersectMatch = t.match(/&\s*(\{.+\})\s*$/s);
    if (intersectMatch) {
      const extra = parseInlineObjectType(intersectMatch[1], ctx);
      if (extra.properties) {
        base.properties = {
          ...(base.properties as Record<string, unknown>),
          ...(extra.properties as Record<string, unknown>),
        };
      }
      // What the service cannot run without stays required. `getDocuments`
      // filters on `active` unconditionally, and with it published as optional
      // a call without it sent `active = undefined` to Postgres. A field that
      // admits null (`search: string | null`) is left optional: omitting it
      // says the same thing, and every caller already does.
      const properties = extra.properties as
        | Record<string, { type?: unknown }>
        | undefined;
      const required = ((extra.required as string[] | undefined) ?? []).filter(
        (name) => {
          const type = properties?.[name]?.type;
          return !(Array.isArray(type) && type.includes("null"));
        }
      );
      if (required.length > 0) base.required = required;
    }
    return base;
  }

  // Fallback
  return {};
}

/**
 * The type argument of `Name<...>` when the generic wraps the WHOLE type —
 * null for a bare name, a different generic, or trailing content
 * (`Array<A> & B`). Depth-tracked so nested generics don't end the match early.
 */
function genericInner(t: string, name: string): string | null {
  if (!t.startsWith(`${name}<`) || !t.endsWith(">")) return null;
  let depth = 0;
  for (let i = name.length; i < t.length; i++) {
    if (t[i] === "<") depth++;
    else if (t[i] === ">" && !isArrowClose(t, i) && --depth === 0) {
      return i === t.length - 1 ? t.slice(name.length + 1, i).trim() : null;
    }
  }
  return null;
}

/** Does the leading "(" close only at the very end? Distinguishes a wrapping
 *  paren (`(A & B)`) from siblings (`(A) | (B)`), which must not be unwrapped. */
function wrapsWholeType(t: string): boolean {
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")" && --depth === 0) return i === t.length - 1;
  }
  return false;
}

/**
 * Resolve a type expression whose subject is a `z.infer<typeof X>` reference:
 * the bare form, `Partial<...>` / `PickPartial<..., "k">` / `Omit<..., "k">`
 * wrappers, an indexed access (`z.infer<...>["lines"]`), and an `& { ... }`
 * intersection folding inline extras on top. Returns null for any shape it
 * cannot resolve faithfully — the caller falls through to the `{}` fallback,
 * which is lossy but never wrong.
 */
function resolveNestedInferType(
  typeStr: string,
  ctx: TypeResolveContext
): Record<string, unknown> | null {
  const parts = splitAtTopLevel(typeStr, "&");
  const base = resolveInferExpression(parts[0].trim(), ctx);
  if (!base || base.type !== "object") return base;

  for (const part of parts.slice(1)) {
    const extra = part.trim();
    // An intersection member that isn't an inline object literal (a named type,
    // another generic) can't be folded in — publishing just the validator's
    // fields would misdocument the type, so give up entirely.
    if (!extra.startsWith("{")) return null;
    const extraSchema = parseInlineObjectType(extra, ctx);
    base.properties = {
      ...((base.properties as Record<string, unknown>) ?? {}),
      ...((extraSchema.properties as Record<string, unknown>) ?? {})
    };
    const required = new Set([
      ...((base.required as string[] | undefined) ?? []),
      ...((extraSchema.required as string[] | undefined) ?? [])
    ]);
    if (required.size > 0) base.required = [...required];
  }
  return base;
}

function resolveInferExpression(
  t: string,
  ctx: TypeResolveContext
): Record<string, unknown> | null {
  let m = t.match(/^z\.infer<typeof\s+(\w+)>$/);
  if (m) return lookupValidatorSchema(m[1], ctx);

  // z.infer<typeof V>["field"] — the schema of one field.
  m = t.match(/^z\.infer<typeof\s+(\w+)>\[\s*"(\w+)"\s*\]$/);
  if (m) {
    const schema = lookupValidatorSchema(m[1], ctx);
    const prop = (schema?.properties as Record<string, unknown> | undefined)?.[
      m[2]
    ];
    return prop && typeof prop === "object"
      ? (prop as Record<string, unknown>)
      : null;
  }

  // Partial<z.infer<typeof V>> — every field optional.
  m = t.match(/^Partial<\s*z\.infer<typeof\s+(\w+)>\s*>$/);
  if (m) {
    const schema = lookupValidatorSchema(m[1], ctx);
    if (schema) delete schema.required;
    return schema;
  }

  // PickPartial<z.infer<typeof V>, "a" | "b"> — the listed keys turn optional.
  // Omit<z.infer<typeof V>, "a" | "b"> — the listed keys are removed.
  m = t.match(/^(PickPartial|Omit)<\s*z\.infer<typeof\s+(\w+)>\s*,\s*([\s\S]+)>$/);
  if (m) {
    const schema = lookupValidatorSchema(m[2], ctx);
    if (!schema) return null;
    const keys = [...m[3].matchAll(/"(\w+)"/g)].map((k) => k[1]);
    if (m[1] === "Omit") {
      for (const key of keys) {
        delete (schema.properties as Record<string, unknown> | undefined)?.[key];
      }
    }
    if (Array.isArray(schema.required)) {
      schema.required = (schema.required as string[]).filter(
        (r) => !keys.includes(r)
      );
      if ((schema.required as string[]).length === 0) delete schema.required;
    }
    return schema;
  }

  return null;
}

/** Registry lookup for a nested validator reference, mirroring the top-level
 *  param resolution in `buildToolSchema` (including its provenance report). */
function lookupValidatorSchema(
  validatorName: string,
  ctx: TypeResolveContext
): Record<string, unknown> | null {
  const native = ctx.validators?.getSchema(ctx.module ?? "", validatorName);
  if (native) {
    ctx.onResolved?.(validatorName, "native");
    return native as Record<string, unknown>;
  }
  ctx.onResolved?.(validatorName, "unresolved");
  return null;
}

function parseInlineObjectType(
  typeStr: string,
  ctx?: TypeResolveContext
): Record<string, unknown> {
  let inner = typeStr.trim();
  if (inner.startsWith("{")) inner = inner.slice(1);
  if (inner.endsWith("}")) inner = inner.slice(0, -1);
  inner = inner.trim();

  if (!inner) return { type: "object", properties: {} };

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  const fields = splitObjectFields(inner);

  for (const field of fields) {
    // A `/** doc */` above a field is its description — capture it for the
    // schema, then strip EVERY comment form before reading the property name.
    // Absorbing one into the key published names like
    // `"/** Policy enforced… */\n expiredEntityPolicy"`, which strict codegen
    // (Go's oapi-codegen) rightly rejects.
    let description: string | undefined;
    const doc = field.match(/\/\*\*([\s\S]*?)\*\//);
    if (doc) {
      description =
        doc[1]
          .split("\n")
          .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
          .join(" ")
          .trim() || undefined;
    }
    const f = field
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n")
      .trim();
    if (!f) continue;

    // Anchor on the field's OWN name and colon. Searching for the first `?:`
    // anywhere found the one inside a NESTED object literal first
    // (`address: { addressLine1?: … }`), publishing the property name
    // "address: {\n addressLine1" — which strict codegen rightly rejects.
    const head = f.match(/^([A-Za-z_$][\w$]*)\s*(\?)?\s*:/);
    if (!head) continue;
    const fieldName = head[1];
    const optional = head[2] === "?";
    if (CONTEXT_PARAMS.has(fieldName)) continue;

    const fieldType = f
      .slice(head[0].length)
      .trim()
      .replace(/;$/, "")
      .trim();

    // A type that admits `undefined` is optional whether or not it is written
    // with `?`. `assignee: null | undefined` used to publish as required, so a
    // caller had to send `assignee: null` and every status change cleared it.
    const admitsUndefined = splitAtTopLevel(fieldType, "|").some(
      (part) => part.trim() === "undefined"
    );

    const fieldSchema = typeToJsonSchema(fieldType, ctx);
    properties[fieldName] = description
      ? { ...fieldSchema, description }
      : fieldSchema;
    if (!optional && !admitsUndefined) required.push(fieldName);
  }

  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function splitObjectFields(inner: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < inner.length; i++) {
    const j = skipComment(inner, i);
    if (j !== i) {
      current += inner.slice(i, j);
      i = j - 1;
      continue;
    }
    const ch = inner[i];
    if ("({[<".includes(ch)) depth++;
    else if (")}]>".includes(ch) && !isArrowClose(inner, i)) depth--;

    if (ch === ";" && depth === 0) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Validator resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a bare type-alias name against the module's own sources (service
 * file, `types.ts`, models, and the shared equivalents): `type X = <rhs>` and
 * non-extending `interface X { ... }`. The rhs goes back through
 * `typeToJsonSchema`, so aliases of unions, `(typeof x)[number]`, `Record`,
 * generated-DB references and inline objects all land as real schemas. Null
 * when the alias is unknown, generic, cyclic, or resolves to nothing — the
 * caller's `{}` fallback stands.
 */
function resolveTypeAlias(
  name: string,
  ctx: TypeResolveContext
): Record<string, unknown> | null {
  if (!ctx.aliasSources || ctx.aliasSeen?.has(name)) return null;
  const seen = ctx.aliasSeen ?? new Set<string>();
  seen.add(name);
  const nested: TypeResolveContext = { ...ctx, aliasSeen: seen };

  for (const source of ctx.aliasSources) {
    const typeMatch = new RegExp(
      `(?:export\\s+)?type\\s+${name}\\s*=\\s*`
    ).exec(source);
    if (typeMatch) {
      const start = typeMatch.index + typeMatch[0].length;
      let depth = 0;
      let end = source.length;
      for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if ("({[<".includes(ch)) depth++;
        else if (")}]>".includes(ch) && !isArrowClose(source, i)) depth--;
        else if (ch === ";" && depth === 0) {
          end = i;
          break;
        }
      }
      const resolved = typeToJsonSchema(source.slice(start, end).trim(), nested);
      return Object.keys(resolved).length > 0 ? resolved : null;
    }

    // A non-extending interface is an inline object by another name. One that
    // extends is skipped — its own block alone would misdocument the type.
    const ifaceMatch = new RegExp(`(?:export\\s+)?interface\\s+${name}\\s*\\{`).exec(
      source
    );
    if (ifaceMatch) {
      const braceStart = source.indexOf("{", ifaceMatch.index);
      const braceEnd = findMatchingBrace(source, braceStart);
      if (braceEnd > braceStart) {
        const resolved = parseInlineObjectType(
          source.slice(braceStart, braceEnd + 1),
          nested
        );
        return Object.keys(
          (resolved.properties as Record<string, unknown>) ?? {}
        ).length > 0
          ? resolved
          : null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classification, auth & permission
// ---------------------------------------------------------------------------

const AUTH_FIELDS: readonly AuthField[] = [
  "companyId",
  "companyGroupId",
  "createdBy",
  "updatedBy",
  "userId"
];
const PERMISSION_ACTIONS: readonly PermissionAction[] = [
  "view",
  "create",
  "update",
  "delete"
];

type McpSetting = keyof typeof MCP_SETTINGS;

/** Every `@mcp …` line on a function: its first word, and the rest. */
function mcpLines(fn: ServiceFunction): { word: string; rest: string }[] {
  return fn.tags
    .filter((tag) => `@${tag.name}` === MCP_EXPOSURE_TAG)
    .map((tag) => {
      const [word = "", ...rest] = tag.comment.split(/\s+/);
      return { word, rest: rest.join(" ") };
    });
}

/** What follows `@mcp <setting>` on each such line. */
function settingLines(fn: ServiceFunction, setting: McpSetting): string[] {
  return mcpLines(fn)
    .filter((line) => line.word === MCP_SETTINGS[setting])
    .map((line) => line.rest);
}

/** A setting that may be given once. Twice is two answers to one question,
 *  read differently depending on which came first. */
function singleSetting(
  fn: ServiceFunction,
  setting: McpSetting
): string | undefined {
  const lines = settingLines(fn, setting);
  if (lines.length > 1) {
    throw new Error(
      `${fn.toolName} has ${lines.length} \`${MCP_EXPOSURE_TAG} ${setting}\` lines. Keep one.`
    );
  }
  return lines[0];
}

export interface Declaration {
  verb: McpVerb;
  destructive: boolean;
}

/**
 * What the function declares itself to be: `@mcp <verb> [destructive]`.
 * Undefined when it carries no `@mcp` line — then it is simply not a tool.
 * Anything else the generator needs follows from the verb (`MCP_VERBS`); the
 * function's NAME is never consulted.
 *
 * The declaration is checked against what the body does, in the direction that
 * matters: `read` on a body that writes, or a write whose body deletes rows
 * without `destructive`, fails generation. The reverse cannot be checked — a
 * body with no write of its own may hand the work to a helper, an RPC or an
 * edge function — which is exactly why it has to be declared.
 */
export function declarationOf(fn: ServiceFunction): Declaration | undefined {
  const lines = mcpLines(fn);
  if (lines.length === 0) return undefined;

  const settings: readonly string[] = Object.values(MCP_SETTINGS);
  const verbs = lines.filter((line) => !settings.includes(line.word));
  if (verbs.length !== 1) {
    throw new Error(
      `${fn.toolName} must declare exactly one \`${MCP_EXPOSURE_TAG} <verb>\` line; it has ${verbs.length}.`
    );
  }
  const { word, rest } = verbs[0];
  if (!Object.hasOwn(MCP_VERBS, word)) {
    throw new Error(
      `${fn.toolName}: \`${MCP_EXPOSURE_TAG} ${word}\` is not a verb. Use one of ${Object.keys(MCP_VERBS).join(", ")}.`
    );
  }
  const verb = word as McpVerb;
  const destructive = rest.split(/\s+/)[0] === MCP_DESTRUCTIVE;

  const writes = dbWrites(fn.node);
  if (verb === "read") {
    if (destructive) {
      throw new Error(`${fn.toolName}: a read cannot be ${MCP_DESTRUCTIVE}.`);
    }
    if (writes.length > 0) {
      throw new Error(
        `${fn.toolName} declares \`${MCP_EXPOSURE_TAG} read\` but its body writes to ${writes[0]?.table ?? "the database"}. Declare the verb it really is.`
      );
    }
  } else if (
    verb !== "delete" &&
    !destructive &&
    writes.some((w) => w.kind === "delete")
  ) {
    throw new Error(
      `${fn.toolName} declares \`${MCP_EXPOSURE_TAG} ${verb}\` but its body deletes rows. Declare \`${MCP_EXPOSURE_TAG} ${verb} ${MCP_DESTRUCTIVE}\`.`
    );
  }
  return { verb, destructive };
}

/** `@mcp audit a, b` → the fields to stamp, companyId always among them. */
function declaredAudit(fn: ServiceFunction): AuthField[] | undefined {
  const line = singleSetting(fn, "audit");
  if (line === undefined) return undefined;
  const fields = line
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  for (const field of fields) {
    if (!AUTH_FIELDS.includes(field as AuthField)) {
      throw new Error(
        `${fn.toolName}: \`${MCP_EXPOSURE_TAG} audit\` names "${field}". Use ${AUTH_FIELDS.join(", ")}.`
      );
    }
  }
  return [...new Set<AuthField>(["companyId", ...(fields as AuthField[])])];
}

/** `@mcp permission module:action+action` → the permission to gate on. */
function declaredPermission(fn: ServiceFunction): ToolPermission | undefined {
  const line = singleSetting(fn, "permission");
  if (line === undefined) return undefined;
  const [module = "", actionList = ""] = line.split(/\s+/)[0].split(":");
  const actions = actionList.split("+").filter(Boolean);
  if (
    !module ||
    actions.length === 0 ||
    actions.some(
      (action) => !PERMISSION_ACTIONS.includes(action as PermissionAction)
    )
  ) {
    throw new Error(
      `${fn.toolName}: \`${MCP_EXPOSURE_TAG} permission\` must read <module>:<action>[+<action>] with actions from ${PERMISSION_ACTIONS.join(", ")}.`
    );
  }
  return { module, actions: actions as PermissionAction[] };
}

/** The keys an upsert branches on to pick insert vs update. */
const OPERATION_FIELDS = ["createdBy", "updatedBy"] as const;

/**
 * Drop `createdBy` / `updatedBy` when the function's ONE table has no such
 * column. The verb says which audit fields a tool is handed, and
 * `enrichWithAuthContext` stamps them onto the payload OBJECT — so a
 * service that spreads its argument into the write (`insert([row])`,
 * `update(sanitize(row))`) sends a nonexistent column to PostgREST and the call
 * fails with PGRST204. The HTML form routes build the row from their validator
 * and never saw it, so this only ever broke MCP and the v1 API.
 *
 * The generated types are the source of truth (`pnpm run generate:types` runs
 * after every migration, so they cannot lag a new table). Ambiguity is left
 * alone: zero or several tables keeps the computed set, as does a table missing
 * from the generated types. `companyId` is never derived away — it is frequently
 * an `.eq()` filter argument rather than a column.
 */
export function withoutAbsentAuditColumns(
  fields: AuthField[],
  fn: ServiceFunction,
  onDrop?: (table: string, dropped: AuthField[]) => void
): AuthField[] {
  const audit: AuthField[] = ["createdBy", "updatedBy"];
  if (!audit.some((f) => fields.includes(f))) return fields;

  const tables = namedTables(fn.node);
  if (tables.length !== 1) return fields;
  const columns = getDbTableTypeFields(tables[0], "Row");
  if (!columns) return fields;

  const present = new Set(columns.map((c) => c.name));
  const dropped = audit.filter((f) => fields.includes(f) && !present.has(f));
  if (dropped.length === 0) return fields;

  onDrop?.(tables[0], dropped);
  return fields.filter((f) => !dropped.includes(f));
}

/**
 * The positional params the dispatcher fills from the authenticated context,
 * and with what.
 *
 * `client`, `db`, `userId`, `companyId` and `companyGroupId` are the positional
 * contract (`POSITIONAL_CONTEXT`). The acting user under any other name is read
 * from the body: a param the function writes to `createdBy` / `updatedBy`
 * (`auditParams`) is who made the write, so it is filled with the caller.
 *
 * A param NAMED for an audit column that the body is never seen writing to one
 * fails generation. Published as an ordinary argument it would let a caller name
 * the author; hidden without a slot, nobody would fill it.
 */
export function contextParamsOf(
  fn: Pick<ServiceFunction, "node" | "params" | "toolName">
): Record<string, ContextSource> {
  const actors = new Set(auditParams(fn.node));
  const named: Record<string, ContextSource> = POSITIONAL_CONTEXT;
  const out: Record<string, ContextSource> = {};
  for (const param of fn.params) {
    if (param.name in named) {
      out[param.name] = named[param.name];
    } else if (actors.has(param.name)) {
      out[param.name] = "userId";
    } else if ((AUDIT_FIELDS as readonly string[]).includes(param.name)) {
      throw new Error(
        `${fn.toolName} takes a positional \`${param.name}\`, but its body is not seen writing it to a createdBy/updatedBy column, so it cannot be filled with the acting user. Name it \`userId\`, or write it to the audit column directly.`
      );
    }
  }
  return out;
}

/**
 * A tool declared `read` may only call SQL functions that read.
 *
 * The compiler sees the `.rpc()` call but not the SQL behind it, so a read
 * that writes through a function went unnoticed: `settings_getNextSequence`
 * advanced a sequence while published as a READ gated on `settings:view`. The
 * function's own definition answers it (`sql-effects.ts`, Postgres's parser).
 * "Cannot tell" refuses too — a read is a promise, not a default.
 */
export function assertReadCallsOnlyReads(
  fn: Pick<ServiceFunction, "node" | "toolName">,
  effects: Pick<SqlFunctionEffects, "effectOf">
): void {
  for (const name of rpcCalls(fn.node)) {
    if (name === null) {
      throw new Error(
        `${fn.toolName} is declared \`${MCP_EXPOSURE_TAG} read\` but calls .rpc() with a name that is not a string literal, so what it runs cannot be read. Name the function, or declare a write verb.`
      );
    }
    const effect = effects.effectOf(name);
    if (effect.kind === "writes") {
      throw new Error(
        `${fn.toolName} is declared \`${MCP_EXPOSURE_TAG} read\` but calls the SQL function ${name}, which writes (${effect.reason}). Declare the verb that says what it does.`
      );
    }
    if (effect.kind === "unknown") {
      throw new Error(
        `${fn.toolName} is declared \`${MCP_EXPOSURE_TAG} read\` but calls the SQL function ${name}, and whether that writes cannot be told: ${effect.reason}. Resolve it in packages/database/src/sql-effects.ts, or declare a write verb.`
      );
    }
  }
}

export function withPayloadUserId(
  fields: AuthField[],
  func: Pick<ServiceFunction, "params">
): AuthField[] {
  if (fields.includes("userId")) return fields;
  const declaresUserId = func.params.some(
    (p) => p.name !== "userId" && /(^|[{;,\s])userId\s*\??\s*:/.test(p.typeStr)
  );
  return declaresUserId ? [...fields, "userId"] : fields;
}

/**
 * A payload object that declares `companyGroupId` gets it from the caller's
 * session: the schema never publishes the field, so nobody else can supply
 * it. Read off the parameter's type, so a named or inferred type counts as
 * much as an inline one. Every pivot report failed without it — the SQL
 * function was called with no group at all.
 */
export function withPayloadCompanyGroup(
  fields: AuthField[],
  func: Pick<ServiceFunction, "node" | "name">
): AuthField[] {
  if (fields.includes("companyGroupId")) return fields;
  let declares = false;
  for (const param of func.node.getParameters()) {
    const type = param.getType();
    // An optional parameter is a union with `undefined`, which is not a shape.
    const members = (type.isUnion() ? type.getUnionTypes() : [type]).filter(
      (member) => !member.isUndefined() && !member.isNull()
    );
    const declaring = members.filter((member) =>
      member.getProperty("companyGroupId")
    );
    if (declaring.length === 0) continue;
    // The dispatcher cannot tell the shapes of a union apart, so it stamps all
    // of them. A shape that does not expect the field would spread it into its
    // row — `upsertPurchaseOrder`'s update wrote it to a table with no such column.
    if (declaring.length < members.length) {
      throw new Error(
        `${func.name}: only some shapes of \`${param.getName()}\` declare companyGroupId, and the API fills it on all of them. Declare it on each (optional where unused) and keep it out of the row.`
      );
    }
    declares = true;
  }
  return declares ? [...fields, "companyGroupId"] : fields;
}

/** A schema that says nothing about its value (a description aside). */
function saysNothing(schema: unknown): boolean {
  return (
    schema !== null &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    Object.keys(schema).every((key) => key === "description")
  );
}

/**
 * `any`, `unknown` and the database's `Json` really are anything. `Json` is
 * recognised by what it is — a string, a number, a boolean, a list or a map —
 * because `customFields?: Json` reaches the checker as a flattened union with
 * the alias gone.
 */
function isFreeForm(type: Type): boolean {
  if (type.isAny() || type.isUnknown()) return true;
  if (!type.isUnion()) return false;
  const members = type.getUnionTypes();
  return (
    members.some((member) => member.isString()) &&
    members.some((member) => member.isNumber()) &&
    members.some((member) => member.isArray()) &&
    members.some(
      (member) => member.isObject() && member.getStringIndexType() !== undefined
    )
  );
}

/** The type of `name` on an object type, or on the first shape of a union that has it. */
function propertyType(type: Type, name: string, at: Node): Type | undefined {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  for (const member of members) {
    const property = member.getProperty(name);
    if (property) return property.getTypeAtLocation(at);
  }
  return undefined;
}

function elementType(type: Type): Type | undefined {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  return members.find((member) => member.isArray())?.getArrayElementType();
}

function typed(schema: unknown, type: Type, at: Node): unknown {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }
  const node = schema as Record<string, unknown>;
  if (saysNothing(node)) {
    return isFreeForm(type) ? node : { ...reflectType(type, at), ...node };
  }
  if (node.properties && typeof node.properties === "object") {
    const properties = node.properties as Record<string, unknown>;
    for (const [name, property] of Object.entries(properties)) {
      const inner = propertyType(type, name, at);
      if (inner) properties[name] = typed(property, inner, at);
    }
  }
  if (node.items && typeof node.items === "object") {
    const element = elementType(type);
    if (element) node.items = typed(node.items, element, at);
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const alternatives = node[keyword];
    if (Array.isArray(alternatives)) {
      node[keyword] = alternatives.map((alternative) => typed(alternative, type, at));
    }
  }
  return node;
}

/**
 * Describe every argument the schema left blank from the parameter's own
 * TYPE. The schema is built from the signature's text and the validators, and
 * what neither resolves — a named row type, a `ReturnType<…>`, an enum from
 * another module — used to be published as `{}`: an argument with no shape,
 * which a caller can only guess at (`getDocumentTemplate`'s `documentType` is
 * one of eleven strings). The type checker knows; only `any`, `unknown` and `Json`
 * stay blank, because they are.
 */
export function describeUntypedArguments(
  schema: Record<string, unknown>,
  func: Pick<ServiceFunction, "node">,
  contextParams: Record<string, unknown>
): void {
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties) return;
  const params = func.node
    .getParameters()
    .filter((param) => !(param.getName() in contextParams));
  const payload = params.length === 1 ? params[0].getType() : undefined;
  for (const [name, property] of Object.entries(properties)) {
    // A flat schema's property is a field of the one payload; otherwise it is
    // the parameter of that name.
    const type =
      (payload && propertyType(payload, name, func.node)) ??
      params.find((param) => param.getName() === name)?.getType();
    if (type) properties[name] = typed(property, type, func.node);
  }
}

/**
 * When the dispatcher fills a default the schema publishes. A default is a
 * promise to the caller: "leave this out and you get X". It can be kept where
 * the call supplies a whole value — a read's options, a new row, an action's
 * arguments. On an update a field left out means "leave it alone", so filling
 * it would overwrite the stored value; and an upsert the dispatcher cannot tell
 * apart (no rule) might be one.
 */
export function defaultsPolicy(
  verb: McpVerb,
  upsert: ManifestEntry["upsert"]
): ManifestEntry["defaults"] {
  if (verb === "read" || verb === "create" || verb === "action") return "always";
  if (verb === "upsert" && upsert) return "create";
  return undefined;
}

const CREATE_ONLY_NOTE = "Applied when creating; on update a field left out keeps its value.";

/**
 * Make the schema's defaults say only what the dispatcher does. It fills a
 * default on an object it was sent, through `properties`, an array's `items`,
 * and a union's one object (or one array) alternative; one anywhere else
 * (a union of several objects, a record's values) is never applied, and with
 * no policy none is. Those are removed, so no schema promises a value the
 * caller will not get. Returns whether any is left. `withSchemaDefaults` in
 * the dispatcher is the same walk over a value.
 */
export function publishDefaults(
  schema: Record<string, unknown>,
  policy: ManifestEntry["defaults"]
): boolean {
  let kept = false;
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  const visit = (node: unknown, applied: boolean): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, false);
      return;
    }
    if (!isObject(node)) return;
    if ("default" in node) {
      if (policy && applied) {
        kept = true;
        if (policy === "create") {
          node.description =
            typeof node.description === "string" && node.description
              ? `${node.description} ${CREATE_ONLY_NOTE}`
              : CREATE_ONLY_NOTE;
        }
      } else {
        delete node.default;
      }
    }
    for (const [keyword, child] of Object.entries(node)) {
      // Values, not schemas: a default of `{ default: … }` is not a keyword.
      if (keyword === "default" || keyword === "enum" || keyword === "const") {
        continue;
      }
      if (keyword === "properties" && isObject(child)) {
        for (const property of Object.values(child)) visit(property, applied);
      } else if (keyword === "items" && isObject(child)) {
        visit(child, applied);
      } else if (
        (keyword === "anyOf" || keyword === "oneOf") &&
        Array.isArray(child)
      ) {
        for (const kind of ["object", "array"]) {
          const fitting = child.filter(
            (alternative) => isObject(alternative) && alternative.type === kind
          );
          for (const alternative of fitting) {
            visit(alternative, applied && fitting.length === 1);
          }
        }
        for (const alternative of child) {
          if (
            !isObject(alternative) ||
            (alternative.type !== "object" && alternative.type !== "array")
          ) {
            visit(alternative, false);
          }
        }
      } else {
        // A record's values, several object alternatives: never filled.
        visit(child, false);
      }
    }
  };

  // The root is the payload itself, never a property with a default of its own.
  for (const property of Object.values(
    isObject(schema.properties) ? schema.properties : {}
  )) {
    visit(property, true);
  }
  for (const [keyword, child] of Object.entries(schema)) {
    if (keyword !== "properties") visit(child, false);
  }
  return kept;
}

/**
 * Delete `pattern` wherever a sibling `format` is present, recursively. zod
 * v4's email conversion emits BOTH — `format: "email"` plus a ~200-character
 * regex — on every email field of every validator-derived schema. The format
 * keyword carries the same contract for a fraction of the tokens, and MCP
 * clients read these schemas far more often than they validate against them.
 */
function stripRedundantPatterns(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripRedundantPatterns(item);
    return;
  }
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.format === "string" && "pattern" in record) {
      delete record.pattern;
    }
    for (const value of Object.values(record)) stripRedundantPatterns(value);
  }
}

/**
 * How the dispatcher tells create from update for a service that branches on an
 * audit field. Never the caller's job: the answer is either in the payload or
 * in the database.
 *
 *  - `@mcp key <table> <column>[=<field>], …` on the function — look the row
 *    up, `column` compared with the payload's `field` (same name by default).
 *    Several lines are alternatives: a part's `id` may be its item id or its
 *    part number.
 *  - otherwise the parameter's type must make `id` decisive (sent = update).
 *
 * Anything else fails generation, so a new upsert cannot quietly become a tool
 * that needs to be told what it is doing.
 */
export function upsertRule(
  fn: ServiceFunction,
  schema: Record<string, unknown>
): NonNullable<ManifestEntry["upsert"]> {
  const keyLines = settingLines(fn, "key");
  if (keyLines.length === 0) {
    if (idDistinguishesUpdate(fn.node, CONTEXT_PARAMS)) return { keys: ["id"] };
    throw new Error(
      `${fn.toolName} branches on createdBy/updatedBy, but its payload cannot say whether it creates or updates: \`id\` is required (or absent) in both shapes. Declare the row it updates: \`${MCP_EXPOSURE_TAG} key <table> <column>[, <column>]\`.`
    );
  }

  // The dispatcher reads a key at the top level or inside the one object the
  // payload is wrapped in, so the schema must declare it at one of the two.
  const properties = (schema.properties ?? {}) as Record<
    string,
    { properties?: Record<string, unknown> }
  >;
  const declares = (field: string) =>
    field in properties ||
    Object.values(properties).some(
      (property) => property?.properties && field in property.properties
    );
  const fail = (message: string): never => {
    throw new Error(`${fn.toolName}: \`${MCP_EXPOSURE_TAG} key\` ${message}`);
  };

  // Each line is one row to look for; several lines are alternatives.
  const lookups = keyLines.map((line) => {
    const [table = "", ...rest] = line.split(/\s+/);
    const columns = getDbTableTypeFields(table, "Row")?.map((c) => c.name);
    if (!columns) {
      return fail(
        `names "${table}", which is not a table or view in the generated types.`
      );
    }
    // The lookup is always scoped to the caller's company.
    if (!columns.includes("companyId")) {
      return fail(`"${table}" has no companyId column to scope the lookup by.`);
    }
    const match: Record<string, string> = {};
    for (const pair of rest.join(" ").split(",")) {
      const [column = "", field = column] = pair
        .split("=")
        .map((part) => part.trim());
      if (!column) continue;
      if (!columns.includes(column)) {
        return fail(`"${table}" has no "${column}" column.`);
      }
      if (!declares(field)) {
        return fail(`field "${field}" is not part of the tool's input.`);
      }
      match[column] = field;
    }
    if (Object.keys(match).length === 0) {
      return fail(`${table} names no key column.`);
    }
    return { table, match };
  });

  return {
    keys: [...new Set(lookups.flatMap((lookup) => Object.values(lookup.match)))],
    lookups
  };
}

/** Say on the key field itself what sending it does — the one place a caller
 *  reading the schema is certain to look. */
function describeUpsertKeys(
  schema: Record<string, unknown>,
  rule: NonNullable<ManifestEntry["upsert"]>
): void {
  type Property = Record<string, unknown> & {
    properties?: Record<string, Property>;
  };
  const note = rule.lookups
    ? "Updates the existing record with this key; creates one when there is none."
    : "Send to update that record; omit to create a new one.";
  const annotate = (properties: Record<string, Property> | undefined) => {
    if (!properties) return false;
    let found = false;
    for (const key of rule.keys) {
      const property = properties[key];
      if (!property || typeof property !== "object") continue;
      const existing =
        typeof property.description === "string" ? property.description : "";
      properties[key] = {
        ...property,
        description: existing ? `${existing} ${note}` : note
      };
      found = true;
    }
    return found;
  };

  const top = schema.properties as Record<string, Property> | undefined;
  if (annotate(top)) return;
  // The payload is wrapped (`{ job: {…} }`): the key lives one level down, or
  // in an object the schema does not spell out — say it on the wrapper then.
  for (const property of Object.values(top ?? {})) {
    if (!property || typeof property !== "object") continue;
    if (annotate(property.properties)) return;
  }
  const wrapper = Object.entries(top ?? {}).find(
    ([, property]) =>
      property && typeof property === "object" && property.type !== "array"
  );
  if (wrapper && top) {
    const [name, property] = wrapper;
    const hint = `Include \`${rule.keys.join("`, `")}\` to update that record; leave it out to create a new one.`;
    top[name] = {
      ...property,
      description:
        typeof property.description === "string"
          ? `${property.description} ${hint}`
          : hint
    };
  }
}

function generateDescription(funcName: string): string {
  return funcName
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Schema building for a function
// ---------------------------------------------------------------------------

function buildToolSchema(
  func: Pick<ServiceFunction, "params">,
  ctx: SchemaBuildContext = {}
): { schema: Record<string, unknown>; paramCount: number } {
  const context = ctx.contextParams;
  const userParams = func.params.filter((p) =>
    context ? !(p.name in context) : !CONTEXT_PARAMS.has(p.name)
  );
  const resolveCtx: TypeResolveContext = { ...ctx };

  if (userParams.length === 0) {
    return { schema: { type: "object", properties: {} }, paramCount: 0 };
  }

  // Single object param — flatten its fields into the schema
  if (userParams.length === 1) {
    const param = userParams[0];

    // Check for validator reference: z.infer<typeof validatorName>. Skip when the
    // type is an inline object literal (`{ ... }`) that merely CONTAINS a nested
    // `z.infer<...>` field — that object should be flattened, not replaced by the
    // nested schema.
    const trimmedType = param.typeStr.trim();
    const isInlineObject = trimmedType.startsWith("{");

    // A union/intersection AROUND a validator reference — the discriminated
    // upsert shape `(z.infer<V> & { jobId; …; createdBy }) | (z.infer<V> &
    // { jobId; …; updatedBy })`. The unanchored validatorMatch below used to
    // win here and publish the validator VERBATIM, silently dropping every
    // intersection extra: `jobId` (NOT NULL in the DB) was absent from
    // production_upsertJobMaterial's schema, quoteId/quoteLineId from
    // sales_upsertQuoteMaterial's. Resolve each union branch through the
    // intersection-aware machinery and merge them flat — properties from every
    // branch, required only where required in EVERY branch (so a create-only
    // Omit<…, "id"> branch demotes `id` to optional, and auth fields never
    // appear at all: CONTEXT_PARAMS strips them). Falls through untouched when
    // any branch fails to resolve — the `& ({createdBy} | {updatedBy})` audit
    // union resolves to {} by design and keeps the verbatim-validator path.
    const looksComposed =
      !isInlineObject &&
      !trimmedType.endsWith("[]") &&
      trimmedType.includes("z.infer<") &&
      (splitAtTopLevel(trimmedType, "|").filter((s) => s.trim() !== "")
        .length > 1 ||
        splitAtTopLevel(trimmedType, "&").length > 1);
    if (looksComposed) {
      const branches = splitAtTopLevel(trimmedType, "|")
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .map((branch) => typeToJsonSchema(branch, resolveCtx));
      const allResolved = branches.every(
        (b) =>
          b.type === "object" &&
          Object.keys((b.properties as Record<string, unknown>) ?? {}).length >
            0
      );
      if (allResolved) {
        const properties: Record<string, unknown> = {};
        for (const branch of branches) {
          Object.assign(
            properties,
            branch.properties as Record<string, unknown>
          );
        }
        const required = [
          ...new Set(
            branches.flatMap((b) => (b.required as string[] | undefined) ?? [])
          ),
        ].filter((name) =>
          branches.every((b) =>
            ((b.required as string[] | undefined) ?? []).includes(name)
          )
        );
        const schema: Record<string, unknown> = { type: "object", properties };
        if (required.length > 0) schema.required = required;
        return { schema, paramCount: Object.keys(properties).length };
      }
    }

    // The regex is unanchored, so it also matches a `z.infer<…>` NESTED inside a
    // wrapper (`lines: (Omit<z.infer<…>> & {…})[]`) — returning the validator's
    // schema verbatim there publishes one line's fields flat and drops the array.
    // Array-suffixed or parenthesized types fall through to typeToJsonSchema.
    const isWrappedType = trimmedType.endsWith("[]") || trimmedType.startsWith("(");
    const validatorMatch =
      isInlineObject || isWrappedType
        ? null
        : param.typeStr.match(/z\.infer<typeof\s+(\w+)>/);
    if (validatorMatch) {
      const validatorName = validatorMatch[1];

      // The REAL validator, converted by zod itself: enum values, numeric
      // bounds and nested shapes come from the schema object, not its source.
      const native = ctx.validators?.getSchema(ctx.module ?? "", validatorName);
      if (native) {
        ctx.onResolved?.(validatorName, "native");
        const propCount = Object.keys(
          (native.properties as Record<string, unknown>) || {}
        ).length;
        return { schema: native, paramCount: propCount };
      }

      // No fallback. A validator that cannot be loaded is reported as
      // `unresolved` and the generator FAILS — see the note on
      // ValidatorResolution.
      ctx.onResolved?.(validatorName, "unresolved");
    }

    // `(typeof someConstArray)[number]` — a union of string literals. The textual
    // parser flattens these to a bare "string"; the loaded const array gives the
    // real values.
    const constArrayMatch = param.typeStr.match(
      /^\(?typeof\s+(\w+)\)?\[number\]$/
    );
    if (constArrayMatch) {
      const values = ctx.validators?.getConstArray(
        ctx.module ?? "",
        constArrayMatch[1]
      );
      if (values) {
        return {
          schema: {
            type: "object",
            properties: { [param.name]: { type: "string", enum: values } },
            required: param.optional ? undefined : [param.name],
          },
          paramCount: 1,
        };
      }
    }

    // Inline object type — flatten its fields to the top level. An
    // array-of-objects (`{...}[]`) can't be flattened, so wrap it under the
    // param name instead (typeToJsonSchema returns `{type:"array",...}`).
    if (param.typeStr.trim().startsWith("{")) {
      const resolved = typeToJsonSchema(param.typeStr, resolveCtx);
      if (resolved.type === "array") {
        const schema: Record<string, unknown> = {
          type: "object",
          properties: { [param.name]: resolved },
          required: param.optional ? undefined : [param.name],
        };
        return { schema, paramCount: 1 };
      }
      const propCount = Object.keys(
        (resolved.properties as Record<string, unknown>) || {}
      ).length;
      return { schema: resolved, paramCount: propCount };
    }

    // GenericQueryFilters
    if (param.typeStr.includes("GenericQueryFilters")) {
      const innerSchema = typeToJsonSchema(param.typeStr, resolveCtx);
      const schema: Record<string, unknown> = {
        type: "object",
        properties: { [param.name]: innerSchema },
      };
      // The wrapper is required exactly when something inside it is.
      if (
        Array.isArray(innerSchema.required) &&
        innerSchema.required.length > 0 &&
        !param.optional
      ) {
        schema.required = [param.name];
      }
      const propCount = Object.keys(
        (innerSchema.properties as Record<string, unknown>) || {}
      ).length;
      return { schema, paramCount: propCount };
    }

    // Simple primitive param
    const propSchema = typeToJsonSchema(param.typeStr, resolveCtx);
    const schema: Record<string, unknown> = {
      type: "object",
      properties: {
        [param.name]: param.description
          ? { ...propSchema, description: param.description }
          : propSchema,
      },
      required: param.optional ? undefined : [param.name],
    };
    return { schema, paramCount: 1 };
  }

  // Multiple params — each becomes a property (or flattened if inline object)
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of userParams) {
    // typeToJsonSchema handles inline objects AND arrays-of-objects (`{...}[]`),
    // checking the `[]` suffix before the `{` prefix. Calling parseInlineObjectType
    // directly here dropped the suffix, publishing an array param as a bare object.
    const propSchema = typeToJsonSchema(param.typeStr, resolveCtx);
    properties[param.name] = param.description
      ? { ...propSchema, description: param.description }
      : propSchema;
    if (!param.optional) required.push(param.name);
  }

  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return { schema, paramCount: Object.keys(properties).length };
}

function loadModelsContent(mod: string): string | null {
  const modelsPath = path.join(MODULES_DIR, mod, `${mod}.models.ts`);
  if (fs.existsSync(modelsPath)) {
    return fs.readFileSync(modelsPath, "utf-8");
  }
  // Fall back to the `.ee`-licensed variant (see root LICENSE) when a module
  // keeps its single models file under that name.
  const eeModelsPath = path.join(MODULES_DIR, mod, `${mod}.ee.models.ts`);
  if (fs.existsSync(eeModelsPath)) {
    return fs.readFileSync(eeModelsPath, "utf-8");
  }
  // Try shared models for cross-module validators
  const sharedPath = path.join(MODULES_DIR, "shared", "index.ts");
  if (fs.existsSync(sharedPath)) {
    return fs.readFileSync(sharedPath, "utf-8");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** How a `z.infer<typeof X>` param's schema was obtained, for the accuracy report. */
/**
 * How a `z.infer<typeof v>` parameter's schema was obtained. `native` is the only
 * good answer: the REAL validator, converted by zod's own `z.toJSONSchema`.
 *
 * There used to be a `textual` route that re-parsed the validator's SOURCE TEXT
 * when the module would not load — a hand-rolled zod-expression evaluator that
 * could not see enum values, numeric bounds or nested shapes, so it published a
 * lossy contract to MCP, the v1 OpenAPI spec and the docs. Measured over the real
 * tree it fired ZERO times out of 342, so it was 145 lines of the most fragile
 * code in this file standing in for a case that never happens. It is gone;
 * `unresolved` now fails the generator instead of degrading quietly.
 */
export type ValidatorResolution = "native" | "unresolved";

/** Per-module state threaded into `buildToolSchema`. */
interface SchemaBuildContext {
  module?: string;
  /** The positional params the dispatcher fills (`contextParamsOf`); they are
   *  left out of the published schema. */
  contextParams?: Record<string, ContextSource>;
  validators?: ValidatorRegistry;
  /** Module-local sources for bare type-alias resolution (see `resolveTypeAlias`). */
  aliasSources?: string[];
  onResolved?: (validatorName: string, how: ValidatorResolution) => void;
}

function readIfExists(filePath: string): string | null {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
}

export interface BuildOptions {
  /** Optional per-module progress callback (module name, tool count). */
  onModule?: (mod: string, count: number) => void;
  /**
   * Pre-converted validators. When absent every `z.infer<typeof X>` param is
   * reported `unresolved` and published without its fields.
   */
  validators?: ValidatorRegistry;
  /** Reflected response schemas, keyed `{module}_{fn}`. Absent = inputs only. */
  responses?: ResponseSchemaIndex;
  /** What each SQL function does. Absent = `read` tools' rpc calls go unchecked. */
  sqlEffects?: SqlFunctionEffects;
  /** Called once per `z.infer` param with how its schema was resolved. */
  onValidatorResolved?: (
    toolName: string,
    validatorName: string,
    how: ValidatorResolution
  ) => void;
  /**
   * The parsed service files. Passed in by the async entry point so the response
   * index reflects return types over the same ts-morph project; built here when
   * absent, which keeps this function sync and self-contained.
   */
  ast?: ServiceAst;
  /** An exported function with no `@mcp` tag, so it is not a tool. */
  onUntagged?: (toolName: string) => void;
  /** A module absent from `MCP_MODULE_ALLOWLIST`, so none of it is exposed. */
  onModuleSkipped?: (module: string, functionCount: number) => void;
  /**
   * Reported whenever the verb's audit fields include a column the tool's
   * table does not have. Surfaced by the generator so a wrong drop is
   * visible in the run output, not only in the digest diff.
   */
  onAuditColumnsDropped?: (
    toolName: string,
    table: string,
    dropped: AuthField[]
  ) => void;
}

/**
 * Build the full operation manifest from every module's service file(s). Pure —
 * reads source files, returns metadata, writes nothing.
 */
export function buildAllToolMetadata(opts: BuildOptions = {}): ManifestEntry[] {
  const allTools: ManifestEntry[] = [];
  const ast = opts.ast ?? buildServiceAst(MODULE_LIST);

  for (const mod of MODULE_LIST) {
    const parsed = ast.modules.get(mod);
    if (!parsed) {
      console.warn(`  ⚠ Service file not found for module: ${mod}`);
      continue;
    }

    if (!MCP_MODULE_ALLOWLIST.includes(mod)) {
      opts.onModuleSkipped?.(mod, parsed.functions.length);
      continue;
    }

    // Sources searched when a param references a bare type alias, most
    // specific first: the service file itself, the module's types.ts and
    // models, then the shared module's equivalents (the common cross-module
    // import target).
    const aliasSources = [
      parsed.text,
      readIfExists(path.join(MODULES_DIR, mod, "types.ts")),
      loadModelsContent(mod),
      readIfExists(path.join(MODULES_DIR, "shared", "types.ts")),
      readIfExists(path.join(MODULES_DIR, "shared", "shared.models.ts"))
    ].filter((s): s is string => s !== null);

    let toolCount = 0;

    for (const func of parsed.functions) {
      const { toolName } = func;
      if (MCP_BLOCKED_TOOL_NAMES.includes(toolName)) continue;

      // A function is a tool because it says so, and it says what kind.
      const declared = declarationOf(func);
      if (!declared) {
        opts.onUntagged?.(toolName);
        continue;
      }
      const verb = MCP_VERBS[declared.verb];
      const classification: Classification = declared.destructive
        ? "DESTRUCTIVE"
        : verb.classification;
      if (classification === "READ" && opts.sqlEffects) {
        assertReadCallsOnlyReads(func, opts.sqlEffects);
      }
      // The dispatcher fills one positional argument per parameter from a JSON
      // object; a variadic tail has no such slot.
      const rest = func.params.find((p) => p.rest);
      if (rest) {
        throw new Error(
          `${toolName} takes a rest parameter (...${rest.name}), which the API cannot express. Give it an array parameter, or add it to MCP_BLOCKED_TOOL_NAMES.`
        );
      }
      // A declared `@mcp audit` states INTENT and wins outright (a ledger row
      // keeps `updatedBy` NULL even though the column exists); only the verb's
      // own set is checked against the real schema.
      const injectAuth = withPayloadCompanyGroup(
        withPayloadUserId(
          declaredAudit(func) ??
            withoutAbsentAuditColumns(
              ["companyId", ...verb.audit],
              func,
              (table, dropped) =>
                opts.onAuditColumnsDropped?.(toolName, table, dropped)
            ),
          func
        ),
        func
      );
      // A JSDoc on the function itself beats the override table (code closest
      // wins); the de-camelCased name remains the fallback.
      const description =
        (func.jsdoc && extractJsdocSummary(func.jsdoc)) ||
        DESCRIPTION_OVERRIDES[toolName] ||
        generateDescription(func.name);
      const serviceParams = func.params.map((p) => p.name);
      const contextParams = contextParamsOf(func);
      const permission: ToolPermission = declaredPermission(func) ?? {
        module: mod in PERMISSION_MODULE_MAP ? PERMISSION_MODULE_MAP[mod] : mod,
        actions: [...verb.actions]
      };
      const { schema, paramCount } = buildToolSchema(func, {
        module: mod,
        contextParams,
        validators: opts.validators,
        aliasSources,
        onResolved: (validatorName, how) =>
          opts.onValidatorResolved?.(toolName, validatorName, how),
      });
      describeUntypedArguments(schema, func, contextParams);
      stripRedundantPatterns(schema);
      // A service that picks insert-vs-update by testing for an audit field on
      // the payload needs exactly ONE of them stamped. BOTH directions count:
      // `"createdBy" in` (create-branch first, upsertQuoteOperation) and
      // `"updatedBy" in` (update-branch first, upsertQuoteMaterial /
      // upsertJobMaterial). Which one is decided by the dispatcher from the
      // rule recorded here, never by an argument the caller has to supply.
      // A service that branches some other way (`"id" in payload`) is given
      // the same rule whenever its type makes `id` decisive. Without one the
      // dispatcher stamped both audit fields on every call, so an update
      // through the API rewrote the row's createdBy.
      const upsert =
        injectAuth.includes("createdBy") &&
        branchesOnKeyPresence(func.node, OPERATION_FIELDS)
          ? upsertRule(func, schema)
          : declared.verb === "upsert" &&
              settingLines(func, "key").length === 0 &&
              idDistinguishesUpdate(func.node, CONTEXT_PARAMS)
            ? { keys: ["id"] }
            : undefined;
      if (upsert) describeUpsertKeys(schema, upsert);
      const defaults = defaultsPolicy(declared.verb, upsert);
      const publishesDefaults = publishDefaults(schema, defaults);

      const responseSchema = opts.responses?.get(mod, func.name) ?? undefined;

      allTools.push({
        name: toolName,
        module: mod,
        classification,
        description,
        paramCount,
        serviceParams,
        contextParams,
        injectAuth,
        resultShape: opts.responses?.shape(mod, func.name) ?? "plain",
        permission,
        // Whether the service applies limit/offset itself. A list operation
        // that does not ignores pagination args entirely (the fetchAll
        // `get*List` reads), so the MCP layer pages the response instead.
        paginates: bodyPaginates(func.node),
        ...(upsert ? { upsert } : {}),
        ...(defaults && publishesDefaults ? { defaults } : {}),
        schema,
        ...(responseSchema ? { responseSchema } : {}),
      });
      toolCount++;
    }

    opts.onModule?.(mod, toolCount);
  }

  return allTools;
}

/** How each `z.infer` param's schema was resolved, per tool. */
export interface ValidatorResolutionRecord {
  toolName: string;
  validatorName: string;
  how: ValidatorResolution;
}

export interface BuildWithValidatorsResult {
  tools: ManifestEntry[];
  registryStats: ValidatorRegistry["stats"];
  responseStats: ResponseSchemaIndex["stats"];
  resolutions: ValidatorResolutionRecord[];
}

/**
 * The production entry point: load and convert the real validators, parse the
 * service files once, and build the manifest and its response schemas against
 * both. `registryStats` / `resolutions` report every validator that failed to
 * load; the generator refuses to write a manifest when any did.
 */
export async function buildAllToolMetadataWithValidators(
  opts: Omit<BuildOptions, "validators"> = {}
): Promise<BuildWithValidatorsResult> {
  const validators = await buildValidatorRegistry(MODULE_LIST);
  const ast = opts.ast ?? buildServiceAst(MODULE_LIST);
  const responses = buildResponseSchemaIndex(ast);
  const sqlEffects = await loadSqlFunctionEffects();
  const resolutions: ValidatorResolutionRecord[] = [];

  const tools = buildAllToolMetadata({
    ...opts,
    ast,
    validators,
    responses,
    sqlEffects,
    onValidatorResolved: (toolName, validatorName, how) => {
      resolutions.push({ toolName, validatorName, how });
      opts.onValidatorResolved?.(toolName, validatorName, how);
    },
  });

  return {
    tools,
    registryStats: validators.stats,
    responseStats: responses.stats,
    resolutions,
  };
}
