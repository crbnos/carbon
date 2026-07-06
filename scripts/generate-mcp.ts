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
    else if (")}]>".includes(ch)) depth--;
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

function findTopLevelColon(str: string): number {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if ("({[<".includes(ch)) depth++;
    else if (")}]>".includes(ch)) depth--;
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

  // (typeof X)[number] — enum array reference
  if (t.match(/\(typeof\s+\w+\)\s*\[number\]/)) return { type: "string" };

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
    const f = field.trim();
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
    else if (")}]>".includes(ch)) depth--;

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
  modelsContent: string
): Record<string, unknown> | null {
  const regex = new RegExp(
    `export\\s+const\\s+${validatorName}\\s*=\\s*z\\.object\\(\\{`
  );
  const match = regex.exec(modelsContent);
  if (!match) return null;

  const braceStart = match.index + match[0].length - 1;
  const braceEnd = findMatchingBrace(modelsContent, braceStart);
  const inner = modelsContent.substring(braceStart + 1, braceEnd).trim();

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

  if (e.startsWith("z.array(")) return { type: "array" };
  if (e.includes("z.number()")) return { type: "number" };
  if (e.includes("z.boolean()")) return { type: "boolean" };
  if (e.includes("z.string()") || e.startsWith("zfd.text("))
    return { type: "string" };
  if (e.includes("z.any()")) return {};
  if (e.startsWith("zfd.numeric(")) return { type: "number" };
  if (e.startsWith("z.preprocess(")) {
    if (e.includes("z.enum(")) return zodExprToJsonSchema(e);
    if (e.includes("z.number()")) return { type: "number" };
    return { type: "string" };
  }

  return { type: "string" };
}

// ---------------------------------------------------------------------------
// Classification & auth
// ---------------------------------------------------------------------------

function classifyFunction(
  name: string
): "READ" | "WRITE" | "DESTRUCTIVE" {
  if (/^delete/.test(name)) return "DESTRUCTIVE";
  if (/^(get|list|fetch|search|find|count|check|is|has)/.test(name))
    return "READ";
  return "WRITE";
}

function computeInjectAuth(
  funcName: string,
  classification: "READ" | "WRITE" | "DESTRUCTIVE"
): AuthField[] {
  const lower = funcName.toLowerCase();
  if (classification === "READ" || classification === "DESTRUCTIVE") {
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

    // Check for validator reference: z.infer<typeof validatorName>
    const validatorMatch = param.typeStr.match(
      /z\.infer<typeof\s+(\w+)>/
    );
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

    // Inline object type
    if (param.typeStr.trim().startsWith("{")) {
      const schema = parseInlineObjectType(param.typeStr);
      const propCount = Object.keys(
        (schema.properties as Record<string, unknown>) || {}
      ).length;
      return { schema, paramCount: propCount };
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
    if (param.typeStr.trim().startsWith("{")) {
      // Inline object — wrap under param name
      properties[param.name] = parseInlineObjectType(param.typeStr);
    } else {
      properties[param.name] = typeToJsonSchema(param.typeStr);
    }
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
    const serviceFile = path.join(MODULES_DIR, mod, `${mod}.service.ts`);
    if (!fs.existsSync(serviceFile)) {
      console.warn(`  ⚠ Service file not found: ${serviceFile}`);
      continue;
    }

    const content = fs.readFileSync(serviceFile, "utf-8");
    const modelsContent = loadModelsContent(mod);
    const functions = parseExportedFunctions(content);

    let toolCount = 0;

    for (const func of functions) {
      const toolName = `${mod}_${func.name}`;
      if (MCP_BLOCKED_TOOL_NAMES.includes(toolName)) continue;

      const classification = classifyFunction(func.name);
      const injectAuth = computeInjectAuth(func.name, classification);
      const description =
        DESCRIPTION_OVERRIDES[toolName] || generateDescription(func.name);
      const serviceParams = func.params.map((p) => p.name);
      const { schema, paramCount } = buildToolSchema(func, modelsContent);

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
