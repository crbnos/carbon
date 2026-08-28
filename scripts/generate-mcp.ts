/**
 * MCP Tool Metadata Generator
 *
 * Parses all *.service.ts files and generates tool-metadata.json
 * with descriptions and JSON Schema for each tool's parameters.
 *
 * Usage: npx tsx scripts/generate-mcp.ts
 */

import * as fs from "fs";
import * as path from "path";

import { MCP_BLOCKED_TOOL_NAMES } from "../apps/erp/app/routes/api+/mcp+/lib/mcp-blocked-tools";
import type { AuthField } from "../apps/erp/app/routes/api+/mcp+/lib/types";

const ROOT = path.resolve(__dirname, "..");
const MODULES_DIR = path.join(ROOT, "apps/erp/app/modules");
const METADATA_FILE = path.join(
  ROOT,
  "apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json"
);

const MODULE_LIST = [
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

const CONTEXT_PARAMS = new Set([
  "client",
  "db",
  "companyId",
  "userId",
  "createdBy",
  "updatedBy",
  "companyGroupId",
]);

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
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedParam {
  name: string;
  typeStr: string;
  optional: boolean;
}

interface ParsedFunction {
  name: string;
  params: ParsedParam[];
}

interface ToolMetadata {
  name: string;
  module: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  description: string;
  paramCount: number;
  serviceParams: string[];
  injectAuth: AuthField[];
  schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function findMatchingBrace(content: string, openPos: number): number {
  const open = content[openPos];
  const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : ">";
  let depth = 1;
  let i = openPos + 1;
  while (i < content.length && depth > 0) {
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

function findTopLevelColon(str: string): number {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if ("({[<".includes(ch)) depth++;
    else if (")}]>".includes(ch) && !isArrowClose(str, i)) depth--;
    if (ch === ":" && depth === 0) return i;
  }
  return -1;
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
      const colonIdx = findTopLevelColon(p);
      if (colonIdx === -1) {
        params.push({ name: p.trim(), typeStr: "unknown", optional: false });
        continue;
      }
      const before = p.substring(0, colonIdx).trim();
      const optional = before.endsWith("?");
      const paramName = before.replace(/\?$/, "").trim();
      const typeStr = p.substring(colonIdx + 1).trim();
      params.push({ name: paramName, typeStr, optional });
    }

    results.push({ name, params });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Type → JSON Schema conversion
// ---------------------------------------------------------------------------

function typeToJsonSchema(typeStr: string): Record<string, unknown> {
  const t = typeStr.trim();

  // Nullable: "Type | null"
  const nullableMatch = t.match(/^(.+?)\s*\|\s*null$/);
  if (nullableMatch) {
    const inner = typeToJsonSchema(nullableMatch[1].trim());
    if (inner.type) {
      return { ...inner, type: [inner.type, "null"] };
    }
    return inner;
  }

  // String literal union: "A" | "B" | "C"
  const literalParts = splitAtTopLevel(t, "|").map((s) => s.trim());
  if (literalParts.length > 1 && literalParts.every((p) => /^"[^"]*"$/.test(p))) {
    return {
      type: "string",
      enum: literalParts.map((p) => p.slice(1, -1)),
    };
  }

  // Primitives
  if (t === "string") return { type: "string" };
  if (t === "number") return { type: "number" };
  if (t === "boolean") return { type: "boolean" };

  // Arrays
  if (t === "string[]") return { type: "array", items: { type: "string" } };
  if (t === "number[]") return { type: "array", items: { type: "number" } };
  if (t.endsWith("[]")) {
    const inner = typeToJsonSchema(t.slice(0, -2).trim());
    return { type: "array", items: inner };
  }

  // Json type
  if (t === "Json" || t === "Json | null") return {};

  // (typeof X)[number] — enum array reference. Anchored: an unanchored match
  // also fired for any inline object type that merely CONTAINS such a field,
  // collapsing the whole object to a string.
  if (/^\(typeof\s+\w+\)\s*\[number\]$/.test(t)) return { type: "string" };

  // Inline object: { field: Type; ... }
  if (t.startsWith("{")) {
    return parseInlineObjectType(t);
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
      const extra = parseInlineObjectType(intersectMatch[1]);
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

function parseInlineObjectType(typeStr: string): Record<string, unknown> {
  let inner = typeStr.trim();
  if (inner.startsWith("{")) inner = inner.slice(1);
  if (inner.endsWith("}")) inner = inner.slice(0, -1);
  inner = inner.trim();

  if (!inner) return { type: "object", properties: {} };

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  const fields = splitObjectFields(inner);

  for (const field of fields) {
    // Strip `//` line comments so an inline comment above a field (common in
    // service arg type literals) never gets absorbed into the property key.
    const f = field
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n")
      .trim();
    if (!f) continue;

    const optional = f.includes("?:");
    const colonIdx = f.indexOf("?:") !== -1 ? f.indexOf("?:") : f.indexOf(":");
    if (colonIdx === -1) continue;

    const fieldName = f.substring(0, colonIdx).replace("?", "").trim();
    if (CONTEXT_PARAMS.has(fieldName)) continue;

    const fieldType = f
      .substring(colonIdx + (optional ? 2 : 1))
      .trim()
      .replace(/;$/, "")
      .trim();

    properties[fieldName] = typeToJsonSchema(fieldType);
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
// Classification & auth
// ---------------------------------------------------------------------------

function classifyFunction(
  name: string,
  content?: string
): "READ" | "WRITE" | "DESTRUCTIVE" {
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
  classification: "READ" | "WRITE" | "DESTRUCTIVE"
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

// Services that pick insert-vs-update this way are the only ones MCP can't infer.
function usesCreatedByDiscriminator(
  content: string,
  funcName: string
): boolean {
  const body = extractFunctionBody(content, funcName);
  if (body === null) return false;
  return stripComments(body).includes('"createdBy" in');
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
  modelsContent: string | null
): { schema: Record<string, unknown>; paramCount: number } {
  const userParams = func.params.filter((p) => !CONTEXT_PARAMS.has(p.name));

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
    const isInlineObject = param.typeStr.trim().startsWith("{");
    const validatorMatch = isInlineObject
      ? null
      : param.typeStr.match(/z\.infer<typeof\s+(\w+)>/);
    if (validatorMatch && modelsContent) {
      const validatorName = validatorMatch[1];
      const resolved = parseValidatorFields(validatorName, modelsContent);
      if (resolved) {
        const propCount = Object.keys(
          (resolved.properties as Record<string, unknown>) || {}
        ).length;
        return { schema: resolved, paramCount: propCount };
      }
    }

    // Inline object type — flatten its fields to the top level. An
    // array-of-objects (`{...}[]`) can't be flattened, so wrap it under the
    // param name instead (typeToJsonSchema returns `{type:"array",...}`).
    if (param.typeStr.trim().startsWith("{")) {
      const resolved = typeToJsonSchema(param.typeStr);
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
      const innerSchema = typeToJsonSchema(param.typeStr);
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
    const propSchema = typeToJsonSchema(param.typeStr);
    const schema: Record<string, unknown> = {
      type: "object",
      properties: { [param.name]: propSchema },
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
    properties[param.name] = typeToJsonSchema(param.typeStr);
    if (!param.optional) required.push(param.name);
  }

  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return { schema, paramCount: Object.keys(properties).length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

export function generateToolMetadata(): void {
  console.log("Generating tool metadata from service files...");

  const allTools: ToolMetadata[] = [];

  for (const mod of MODULE_LIST) {
    let serviceFile = path.join(MODULES_DIR, mod, `${mod}.service.ts`);
    if (!fs.existsSync(serviceFile)) {
      // Fall back to the `.ee`-licensed variant (see root LICENSE) when a
      // module keeps its single service file under that name (e.g.
      // accounting.ee.service.ts).
      const eeServiceFile = path.join(
        MODULES_DIR,
        mod,
        `${mod}.ee.service.ts`
      );
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
      const { schema, paramCount } = buildToolSchema(func, modelsContent);
      if (
        injectAuth.includes("createdBy") &&
        usesCreatedByDiscriminator(content, func.name)
      ) {
        addOperationArg(schema);
      }

      allTools.push({
        name: toolName,
        module: mod,
        classification,
        description,
        paramCount,
        serviceParams,
        injectAuth,
        schema,
      });
      toolCount++;
    }

    console.log(`  ✓ ${mod}: ${toolCount} tools`);
  }

  const metadata = {
    generated: new Date().toISOString(),
    totalTools: allTools.length,
    modules: [...new Set(allTools.map((t) => t.module))].length,
    tools: allTools,
  };

  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  console.log(`\n✓ Generated metadata for ${allTools.length} tools`);
  console.log(`  Output: ${path.relative(ROOT, METADATA_FILE)}`);
}

if (require.main === module) {
  generateToolMetadata();
}
