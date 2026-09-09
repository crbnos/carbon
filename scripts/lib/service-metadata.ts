/**
 * Service metadata parser — the pure core behind the MCP tool manifest and the
 * Carbon API contract.
 *
 * Textually parses every `apps/erp/app/modules/*.service.ts` (+ `.ee` / `.mcp.server`
 * companions) into operation metadata: classification, description, positional
 * service params, the audit fields to inject, the required permission, and a JSON
 * Schema for the input. NO filesystem writes and no process side effects — callers
 * (`scripts/generate-mcp.ts`) own emitting the manifest. Grounded against the
 * long-standing generator logic; the parsing helpers are moved verbatim.
 */

import * as fs from "fs";
import * as path from "path";

import type {
  AuthField,
  Classification,
  ManifestEntry,
  PermissionAction,
  ToolPermission,
} from "@carbon/api";
import { MCP_BLOCKED_TOOL_NAMES } from "../../apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools";
import {
  buildResponseSchemaIndex,
  type ResponseSchemaIndex,
} from "./response-schema";
import { getDbEnumValues, getDbTableTypeFields } from "./db-types";
import {
  buildValidatorRegistry,
  CONTEXT_PARAMS,
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

// Per-tool overrides of the auto-computed injectAuth set. The default rule
// (insert* → companyId + createdBy + updatedBy) is wrong for tools that spread
// their argument object straight into an INSERT on an append-only ledger table.
// Those tables now carry an updatedBy column (schema uniformity, migration
// 20260701143512), but by convention it must stay NULL — an "edit" is a new
// offsetting row, never an in-place mutation. Injecting updatedBy would stamp it
// on the ledger row and destroy the "untouched since creation" guarantee, so we
// drop it here. Both tools below insert([data]) where data is built from the
// spread of their injected args:
//   - inventory_insertManualInventoryAdjustment → itemLedger
//   - accounting_upsertFixedAssetUsageLog       → fixedAssetUsageLog
// account_upsertNotificationPreference spreads its argument into an upsert on
// notificationPreference, which (like userModulePreference) carries no
// createdBy/updatedBy columns at all — injecting them breaks the write.
const INJECT_AUTH_OVERRIDES: Record<string, AuthField[]> = {
  inventory_insertManualInventoryAdjustment: ["companyId", "createdBy"],
  accounting_upsertFixedAssetUsageLog: ["companyId", "createdBy"],
  account_upsertNotificationPreference: ["companyId"],
  // Both operations replace settlement rows in a transaction. Their verbs do
  // not imply INSERT to the name-based rule, but the service requires the
  // authenticated creator for every replacement row.
  invoicing_replaceInvoiceSettlements: ["companyId", "createdBy"],
  invoicing_applyCreditsToInvoices: ["companyId", "createdBy"],
};

// service-module → permission-module. `items` operations are gated by the `parts`
// permission; `account` and `shared` gate only on a valid key of the company (no
// module permission), so they map to null. Every other module is identity.
const PERMISSION_MODULE_MAP: Record<string, string | null> = {
  items: "parts",
  account: null,
  shared: null,
};

// Per-tool permission overrides, for operations whose route gates on a DIFFERENT
// module than their service module (spot-checked against the real routes). Keep
// this hand-curated list small and grounded — each entry needs a verified route.
const PERMISSION_OVERRIDES: Record<string, ToolPermission> = {
  // API-key management is an admin capability: every route in the family —
  // x+/settings+/api-keys.tsx (list loader), api-keys.new.tsx, api-keys.$id.tsx,
  // api-keys.delete.$id.tsx — gates on { update: "users" }, not "settings".
  // Deriving "settings" would let a settings-scoped key mint new API keys.
  settings_getApiKeys: { module: "users", actions: ["update"] },
  settings_upsertApiKey: { module: "users", actions: ["update"] },
  settings_deleteApiKey: { module: "users", actions: ["update"] },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedParam {
  name: string;
  typeStr: string;
  optional: boolean;
  description?: string;
}

interface ParsedFunction {
  name: string;
  params: ParsedParam[];
}

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

/** Index of the first `char` at nesting depth 0, or -1. A defaulted parameter
 *  splits on `=`, so that scan skips `=>` and `==`/`!=`/`<=`/`>=`. */
function findTopLevel(str: string, char: ":" | "="): number {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const j = skipComment(str, i);
    if (j !== i) {
      i = j - 1;
      continue;
    }
    const ch = str[i];
    if ("({[<".includes(ch)) depth++;
    else if (")}]>".includes(ch) && !isArrowClose(str, i)) depth--;
    if (ch !== char || depth !== 0) continue;
    if (char === "=") {
      const prev = str[i - 1];
      if (str[i + 1] === ">" || str[i + 1] === "=" || "!<>=".includes(prev)) {
        continue;
      }
    }
    return i;
  }
  return -1;
}

function inferTypeFromDefaultLiteral(literal: string): string {
  const t = literal.trim();
  if (t === "true" || t === "false") return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(t)) return "number";
  if (/^["'`].*["'`]$/.test(t)) return "string";
  return "unknown";
}

// A destructuring pattern is not a name; storing the raw source text put braces and
// newlines into the manifest, so reformatting a signature churned the committed
// digest. The synthetic name only has to avoid `CONTEXT_PARAMS` and the dispatcher's
// `args` branch — nothing else reads a param name for meaning.
function destructuredParamName(raw: string, existing: ParsedParam[]): string {
  if (!raw.startsWith("{")) return raw;
  const base = "destructured";
  if (!existing.some((p) => p.name === base)) return base;
  let i = 2;
  while (existing.some((p) => p.name === `${base}${i}`)) i++;
  return `${base}${i}`;
}

function parseExportedFunctions(content: string): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const regex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const openParen = match.index + match[0].length - 1;
    const closeParen = findMatchingBrace(content, openParen);
    const rawParams = content.substring(openParen + 1, closeParen).trim();

    if (!rawParams) {
      results.push({ name, params: [] });
      continue;
    }

    const paramStrings = splitAtTopLevel(rawParams, ",");
    const params: ParsedParam[] = [];

    for (const p of paramStrings) {
      if (!p) continue;
      // With comment-inert splitting, a param keeps the comment that precedes
      // it: keep a `/** doc */` as its description, drop everything else.
      const doc = p.match(/\/\*\*([\s\S]*?)\*\//);
      const description = doc
        ? doc[1]
            .split("\n")
            .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
            .join(" ")
            .trim() || undefined
        : undefined;
      const stripped = p
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n")
        .trim();
      if (!stripped) continue;
      const colonIdx = findTopLevel(stripped, ":");
      if (colonIdx === -1) {
        const eqIdx = findTopLevel(stripped, "=");
        if (eqIdx === -1) {
          params.push({
            name: destructuredParamName(stripped, params),
            typeStr: "unknown",
            optional: false
          });
        } else {
          const paramName = stripped.substring(0, eqIdx).trim();
          const defaultLiteral = stripped.substring(eqIdx + 1).trim();
          params.push({
            name: paramName,
            typeStr: inferTypeFromDefaultLiteral(defaultLiteral),
            optional: true,
            description
          });
        }
        continue;
      }
      const before = stripped.substring(0, colonIdx).trim();
      const optional = before.endsWith("?");
      const rawName = before.replace(/\?$/, "").trim();
      const typeStr = stripped.substring(colonIdx + 1).trim();
      params.push({
        name: destructuredParamName(rawName, params),
        typeStr,
        optional,
        description
      });
    }

    results.push({ name, params });
  }

  return results;
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
  modelsContent: string | null;
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
        limit: { type: "integer", default: 100 },
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

/** Registry-first, textual-fallback validator lookup, mirroring the top-level
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
  if (ctx.modelsContent) {
    const textual = parseValidatorFields(validatorName, ctx.modelsContent);
    if (textual) {
      ctx.onResolved?.(validatorName, "textual");
      return textual;
    }
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

    const fieldSchema = typeToJsonSchema(fieldType, ctx);
    properties[fieldName] = description
      ? { ...fieldSchema, description }
      : fieldSchema;
    if (!optional) required.push(fieldName);
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

function parseValidatorFields(
  validatorName: string,
  modelsContent: string,
  seen: Set<string> = new Set()
): Record<string, unknown> | null {
  // Cycle guard for mutually-referential validators.
  if (seen.has(validatorName)) return null;
  seen = new Set(seen).add(validatorName);

  const rhs = extractValidatorRhs(validatorName, modelsContent);
  if (rhs === null) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const mergeIn = (sub: Record<string, unknown> | null) => {
    if (!sub) return;
    Object.assign(properties, sub.properties as Record<string, unknown>);
    for (const r of (sub.required as string[] | undefined) ?? []) {
      if (!required.includes(r)) required.push(r);
    }
  };

  // Base validators pulled in by `Base.merge(...)` / `Base.extend(...)` — resolve
  // each referenced `*Validator` (same file) and fold its fields in first, so the
  // extension below can override. This is what makes
  // `applyX(itemValidator.merge(z.object({...})))` resolvable instead of opaque.
  const refs = new Set(
    (rhs.match(/\b\w+Validator\b/g) ?? []).filter((n) => n !== validatorName)
  );
  for (const ref of refs) {
    mergeIn(parseValidatorFields(ref, modelsContent, seen));
  }

  // This validator's own object literal — for a `.merge(z.object({...}))` /
  // wrapped chain the FIRST z.object is the extension; for a plain
  // `z.object({...})` it is the whole thing. Wrappers (`applyX(...)`, `.refine`,
  // `.superRefine`) are transparent to this scan.
  mergeIn(parseFirstZObject(rhs));

  if (Object.keys(properties).length === 0) return null;
  const result: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

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

// The assignment expression of `export const {name} = <expr>;`, captured to the
// first top-level `;` (arrow-guarded) so a `*Validator` reference or `z.object`
// from a later declaration is never pulled in.
function extractValidatorRhs(
  validatorName: string,
  modelsContent: string
): string | null {
  const regex = new RegExp(`export\\s+const\\s+${validatorName}\\s*=\\s*`);
  const match = regex.exec(modelsContent);
  if (!match) return null;
  const start = match.index + match[0].length;

  let depth = 0;
  for (let i = start; i < modelsContent.length; i++) {
    const ch = modelsContent[i];
    if ("({[<".includes(ch)) depth++;
    else if (")}]>".includes(ch) && !isArrowClose(modelsContent, i)) depth--;
    else if (ch === ";" && depth === 0) {
      return modelsContent.substring(start, i);
    }
  }
  return modelsContent.substring(start);
}

// Parse the first `z.object({ ... })` in an expression into a JSON-Schema object.
function parseFirstZObject(expr: string): Record<string, unknown> | null {
  const idx = expr.indexOf("z.object(");
  if (idx === -1) return null;
  const braceStart = expr.indexOf("{", idx);
  if (braceStart === -1) return null;
  const braceEnd = findMatchingBrace(expr, braceStart);
  const inner = expr.substring(braceStart + 1, braceEnd).trim();

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  // Validator fields are comma-separated, not semicolon-separated
  const fields = splitAtTopLevel(inner, ",");

  for (const field of fields) {
    const f = field.trim();
    if (!f || f.startsWith("//")) continue;

    const colonMatch = f.match(/^(\w+)\s*:/);
    if (!colonMatch) continue;
    const fieldName = colonMatch[1];

    if (CONTEXT_PARAMS.has(fieldName)) continue;

    const zodExpr = f.substring(colonMatch[0].length).trim();
    const schema = zodExprToJsonSchema(zodExpr);
    const isOptional =
      zodExpr.includes(".optional()") ||
      zodExpr.includes(".nullable()") ||
      zodExpr.startsWith("zfd.text(") ||
      zodExpr.startsWith("zfd.numeric(") ||
      zodExpr.includes(".default(");

    properties[fieldName] = schema;
    if (!isOptional) required.push(fieldName);
  }

  if (Object.keys(properties).length === 0) return null;
  const result: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

function zodExprToJsonSchema(expr: string): Record<string, unknown> {
  const e = expr.trim();

  if (e.includes("z.enum(")) {
    const enumMatch = e.match(/z\.enum\(\[([^\]]+)\]\)/);
    if (enumMatch) {
      const values = enumMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      return { type: "string", enum: values };
    }
  }

  if (e.startsWith("z.array(")) {
    // Resolve the element schema so the array is well-formed rather than a bare
    // `{type:"array"}` a caller can't fill.
    const open = e.indexOf("(");
    const close = findMatchingBrace(e, open);
    const inner = e.substring(open + 1, close).trim();
    return { type: "array", items: inner ? zodExprToJsonSchema(inner) : {} };
  }
  if (e.includes("z.number()")) return { type: "number" };
  if (e.includes("z.boolean()")) return { type: "boolean" };
  if (e.includes("z.string()") || e.startsWith("zfd.text("))
    return { type: "string" };
  if (e.includes("z.any()")) return {};
  if (e.startsWith("zfd.numeric(")) return { type: "number" };
  if (e.startsWith("z.preprocess(")) {
    // A preprocessed enum whose values aren't an inline array can't be
    // enumerated (the top-of-function z.enum check already ran on this same
    // expr), so treat it as a string. Recursing on `e` here looped forever.
    if (e.includes("z.enum(")) return { type: "string" };
    if (e.includes("z.number()")) return { type: "number" };
    return { type: "string" };
  }

  return { type: "string" };
}

// ---------------------------------------------------------------------------
// Classification, auth & permission
// ---------------------------------------------------------------------------

function classifyFunction(
  name: string,
  content?: string
): Classification {
  if (/^delete/.test(name)) return "DESTRUCTIVE";
  // Require a camelCase boundary after the read prefix so a mutating name that merely starts with
  // those letters is not misread as a reader — e.g. `issueMaterial` ("is"+lowercase) is a WRITE,
  // while `isBlocked`/`getJob` ("is"/"get"+uppercase) stay READ.
  if (/^(get|list|fetch|search|find|count|check|is|has|compute)(?![a-z])/.test(name))
    return "READ";
  // Destructive-by-omission: a write whose body deletes rows (e.g. the
  // delete-then-reinsert `upsert*Prices` rewrite) can silently drop data the
  // caller didn't include. Flag it so the client treats it as destructive, even
  // though its name says `upsert`/`update`. injectAuth stays name-based below, so
  // the insert branch still gets its createdBy.
  if (content && functionBodyDeletes(content, name)) return "DESTRUCTIVE";
  return "WRITE";
}

// True when the function body issues a row delete (supabase `.delete(` or Kysely
// `.deleteFrom(`). Comment/URL-safe via stripComments.
function functionBodyDeletes(content: string, funcName: string): boolean {
  const body = extractFunctionBody(content, funcName);
  if (body === null) return false;
  const stripped = stripComments(body);
  return /\.delete\s*\(/.test(stripped) || /\.deleteFrom\s*\(/.test(stripped);
}

function extractFunctionBody(content: string, funcName: string): string | null {
  const regex = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${funcName}\\s*\\(`
  );
  const match = regex.exec(content);
  if (!match) return null;
  const closeParen = findMatchingBrace(
    content,
    match.index + match[0].length - 1
  );
  const nextExport = content.indexOf("\nexport ", closeParen);
  return content.substring(
    closeParen,
    nextExport === -1 ? content.length : nextExport
  );
}

function computeInjectAuth(
  funcName: string,
  classification: Classification
): AuthField[] {
  const lower = funcName.toLowerCase();
  // Only READ tools take no audit fields. A DESTRUCTIVE label is just a caller
  // hint — a delete-then-reinsert `upsert*` still inserts rows and needs its
  // createdBy/updatedBy, so audit injection is keyed off the name verb, not the
  // classification. A genuine `delete*` matches neither verb group and falls
  // through to companyId-only.
  if (classification === "READ") {
    return ["companyId"];
  }
  if (
    /^(upsert|create|insert|add|new|copy|duplicate|generate)/.test(lower)
  ) {
    return ["companyId", "createdBy", "updatedBy"];
  }
  if (
    /^(update|modify|set|change|edit|approve|reject|finalize|toggle|move|reorder|recalculate|sync|favorite|unfavorite|send|release|close|convert|run)/.test(
      lower
    )
  ) {
    return ["companyId", "updatedBy"];
  }
  return ["companyId"];
}

// The permission an API-key caller must hold. `module` follows the service→permission
// map; `actions` are derived from the operation verb, mirroring `computeInjectAuth`'s
// verb groups but split into CRUD actions. An unmatched write verb (issue/post/ship/
// complete/...) requires `update` — the conservative mutation gate.
function derivePermission(
  toolName: string,
  mod: string,
  funcName: string,
  classification: Classification
): ToolPermission {
  if (PERMISSION_OVERRIDES[toolName]) return PERMISSION_OVERRIDES[toolName];

  const permModule =
    mod in PERMISSION_MODULE_MAP ? PERMISSION_MODULE_MAP[mod] : mod;

  return { module: permModule, actions: permissionActionsFor(funcName, classification) };
}

function permissionActionsFor(
  funcName: string,
  classification: Classification
): PermissionAction[] {
  if (classification === "READ") return ["view"];
  const lower = funcName.toLowerCase();
  if (/^upsert/.test(lower)) return ["create", "update"];
  if (/^delete/.test(lower)) return ["delete"];
  if (/^(insert|create|add|new|copy|duplicate|generate)/.test(lower))
    return ["create"];
  // Everything else that writes — the explicit update group plus unmatched
  // mutation verbs (issue/post/ship/receive/complete/...) — gates on update.
  return ["update"];
}

// Services that pick insert-vs-update by testing for an audit field on the
// payload are the only ones MCP can't infer, so they need the `_operation` flag.
// BOTH directions count: `"createdBy" in` (create-branch first, e.g.
// upsertQuoteOperation) and `"updatedBy" in` (update-branch first, e.g.
// upsertQuoteMaterial / upsertJobMaterial). The dispatch stamps createdBy on
// create and updatedBy on update and suppresses the other, so either convention
// lands on the branch the caller asked for.
function usesOperationDiscriminator(
  content: string,
  funcName: string
): boolean {
  const body = extractFunctionBody(content, funcName);
  if (body === null) return false;
  const stripped = stripComments(body);
  return (
    stripped.includes('"createdBy" in') || stripped.includes('"updatedBy" in')
  );
}

// The `:` guard keeps `https://` intact.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function addOperationArg(schema: Record<string, unknown>): void {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  properties._operation = {
    type: "string",
    enum: ["create", "update"],
    description:
      "Required. 'create' inserts a new record, 'update' modifies the existing record with this id.",
  };
  schema.properties = properties;
  const required = ((schema.required as string[] | undefined) ?? []).slice();
  if (!required.includes("_operation")) required.push("_operation");
  schema.required = required;
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
  func: ParsedFunction,
  modelsContent: string | null,
  ctx: SchemaBuildContext = {}
): { schema: Record<string, unknown>; paramCount: number } {
  const userParams = func.params.filter((p) => !CONTEXT_PARAMS.has(p.name));
  const resolveCtx: TypeResolveContext = { ...ctx, modelsContent };

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

      // Preferred path: the REAL validator, converted by zod itself. Carries enum
      // values, numeric bounds and nested shapes the source-text parser cannot see.
      const native = ctx.validators?.getSchema(ctx.module ?? "", validatorName);
      if (native) {
        ctx.onResolved?.(validatorName, "native");
        const propCount = Object.keys(
          (native.properties as Record<string, unknown>) || {}
        ).length;
        return { schema: native, paramCount: propCount };
      }

      // Fallback: parse the validator's source text. Reached when the module failed
      // to load or zod could not represent the validator — never a silent downgrade,
      // the caller records it.
      if (modelsContent) {
        const resolved = parseValidatorFields(validatorName, modelsContent);
        if (resolved) {
          ctx.onResolved?.(validatorName, "textual");
          const propCount = Object.keys(
            (resolved.properties as Record<string, unknown>) || {}
          ).length;
          return { schema: resolved, paramCount: propCount };
        }
      }
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
export type ValidatorResolution = "native" | "textual" | "unresolved";

/** Per-module state threaded into `buildToolSchema`. */
interface SchemaBuildContext {
  module?: string;
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
   * Pre-converted validators. When absent every `z.infer<typeof X>` param falls
   * back to source-text parsing, which is the long-standing behavior — so callers
   * that cannot run the async loader still get a manifest.
   */
  validators?: ValidatorRegistry;
  /** Reflected response schemas, keyed `{module}_{fn}`. Absent = inputs only. */
  responses?: ResponseSchemaIndex;
  /** Called once per `z.infer` param with how its schema was resolved. */
  onValidatorResolved?: (
    toolName: string,
    validatorName: string,
    how: ValidatorResolution
  ) => void;
}

/**
 * Parse every module's service file(s) into the full operation manifest. Pure —
 * reads source files, returns metadata, writes nothing.
 */
export function buildAllToolMetadata(opts: BuildOptions = {}): ManifestEntry[] {
  const allTools: ManifestEntry[] = [];

  for (const mod of MODULE_LIST) {
    let serviceFile = path.join(MODULES_DIR, mod, `${mod}.service.ts`);
    if (!fs.existsSync(serviceFile)) {
      // Fall back to the `.ee`-licensed variant (see root LICENSE) when a
      // module keeps its single service file under that name (e.g.
      // accounting.ee.service.ts).
      const eeServiceFile = path.join(MODULES_DIR, mod, `${mod}.ee.service.ts`);
      if (!fs.existsSync(eeServiceFile)) {
        console.warn(`  ⚠ Service file not found: ${serviceFile}`);
        continue;
      }
      serviceFile = eeServiceFile;
    }

    let content = fs.readFileSync(serviceFile, "utf-8");
    const modelsContent = loadModelsContent(mod);
    const functions = parseExportedFunctions(content);

    // A module may expose MCP tools from a server-only companion file
    // (`{mod}.mcp.server.ts`) when those functions must import `*.server`
    // modules and therefore cannot live in the client-reachable service file.
    const mcpServerFile = path.join(MODULES_DIR, mod, `${mod}.mcp.server.ts`);
    if (fs.existsSync(mcpServerFile)) {
      const mcpServerContent = fs.readFileSync(mcpServerFile, "utf-8");
      content = `${content}\n${mcpServerContent}`;
      functions.push(...parseExportedFunctions(mcpServerContent));
    }

    // Sources searched when a param references a bare type alias, most
    // specific first: the service file itself, the module's types.ts and
    // models, then the shared module's equivalents (the common cross-module
    // import target).
    const aliasSources = [
      content,
      readIfExists(path.join(MODULES_DIR, mod, "types.ts")),
      modelsContent,
      readIfExists(path.join(MODULES_DIR, "shared", "types.ts")),
      readIfExists(path.join(MODULES_DIR, "shared", "shared.models.ts"))
    ].filter((s): s is string => s !== null);

    let toolCount = 0;

    for (const func of functions) {
      const toolName = `${mod}_${func.name}`;
      if (MCP_BLOCKED_TOOL_NAMES.includes(toolName)) continue;

      const classification = classifyFunction(func.name, content);
      const injectAuth =
        INJECT_AUTH_OVERRIDES[toolName] ||
        computeInjectAuth(func.name, classification);
      const description =
        DESCRIPTION_OVERRIDES[toolName] || generateDescription(func.name);
      const serviceParams = func.params.map((p) => p.name);
      const permission = derivePermission(
        toolName,
        mod,
        func.name,
        classification
      );
      const { schema, paramCount } = buildToolSchema(func, modelsContent, {
        module: mod,
        validators: opts.validators,
        aliasSources,
        onResolved: (validatorName, how) =>
          opts.onValidatorResolved?.(toolName, validatorName, how),
      });
      if (
        injectAuth.includes("createdBy") &&
        usesOperationDiscriminator(content, func.name)
      ) {
        addOperationArg(schema);
      }

      const responseSchema = opts.responses?.get(mod, func.name) ?? undefined;

      allTools.push({
        name: toolName,
        module: mod,
        classification,
        description,
        paramCount,
        serviceParams,
        injectAuth,
        permission,
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
 * The production entry point: load and convert the real validators, then build the
 * manifest against them. Falls back per-validator to source-text parsing, so a
 * module that fails to load degrades exactly one module's schemas rather than the
 * whole run — and `registryStats` / `resolutions` report every such case.
 */
export async function buildAllToolMetadataWithValidators(
  opts: Omit<BuildOptions, "validators"> = {}
): Promise<BuildWithValidatorsResult> {
  const validators = await buildValidatorRegistry(MODULE_LIST);
  const responses = buildResponseSchemaIndex(MODULE_LIST);
  const resolutions: ValidatorResolutionRecord[] = [];

  const tools = buildAllToolMetadata({
    ...opts,
    validators,
    responses,
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
