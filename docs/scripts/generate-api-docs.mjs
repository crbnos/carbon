// Build-time generator: turns the PostgREST Swagger 2.0 spec into Protocol-style
// API reference data (tables only, grouped by module). Run via `predev`/`prebuild`.
//
//   node scripts/generate-api-docs.mjs
//
// Reads packages/database/src/swagger-docs-schema.ts (an `export default {…}` TS
// object literal), keeps table paths, classifies each into a module, derives
// endpoints + attributes + a response example, and pre-renders code samples with
// @httptoolkit/httpsnippet. Emits lib/api-data.generated.json.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import HTTPSnippet from "@httptoolkit/httpsnippet";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(__dirname, "../../packages/database/src/swagger-docs-schema.ts");
const OUT = resolve(__dirname, "../lib/api-data.generated.ts");
const BASE = "https://rest.carbon.ms";

// ── load spec ────────────────────────────────────────────────────────────────
const raw = readFileSync(SCHEMA, "utf8")
  .replace(/^export default\s*/, "")
  .replace(/;\s*$/, "");
// trusted, build-time only: the file is our own generated object literal.
const spec = (0, eval)(`(${raw})`);

// ── module classification (heuristic; refine the keyword map as needed) ───────
const MODULE_ORDER = [
  "Sales",
  "Purchasing",
  "Invoicing",
  "Production",
  "Planning",
  "Inventory",
  "Items",
  "Quality",
  "Maintenance",
  "Accounting",
  "Resources",
  "Training",
  "Users",
  "Documents",
  "Settings",
  "Other",
];
// Matched top-to-bottom, first hit wins. `Documents` sits LAST so the specific
// `documenttemplate`/`documentlabel` Settings keys win before the broad `document`.
const MODULE_RULES = [
  ["Invoicing", ["salesinvoice", "purchaseinvoice", "invoice"]],
  ["Sales", ["salesorder", "salesrfq", "customer", "quote", "opportunity", "salesperson", "noquotereason", "pricing"]],
  ["Purchasing", ["purchaseorder", "purchasingrfq", "supplier", "buymethod"]],
  ["Quality", ["nonconformance", "quality", "gauge", "inspection", "investigation", "issue", "risk"]],
  ["Production", ["job", "makemethod", "methodoperation", "methodmaterial", "production", "scrapreason", "procedure", "workinstruction", "operation"]],
  ["Maintenance", ["maintenance"]],
  ["Planning", ["demand", "supply", "forecast"]],
  ["Inventory", ["itemledger", "shelf", "warehouse", "pickmethod", "trackedentity", "trackedactivity", "kanban", "receipt", "shipment", "stocktransfer", "batch", "serial", "inventory", "warehousetransfer", "shipping", "storage", "fulfillment"]],
  ["Items", ["item", "part", "material", "tool", "consumable", "service", "unitofmeasure", "modeltree", "configuration", "fixture"]],
  ["Accounting", ["account", "currenc", "journal", "fiscal", "paymentterm", "payment", "accountingperiod", "period", "costledger", "costing", "costcenter", "dimension", "exchangerate"]],
  ["Resources", ["employee", "ability", "contractor", "partner", "workcenter", "process", "equipment", "person", "holiday", "shift", "location", "department", "attribute", "address", "timecard", "contact"]],
  ["Training", ["training", "lesson"]],
  ["Users", ["user", "group", "permission", "apikey", "compan", "employeetype", "module", "feature", "challenge", "passkey", "oauth", "membership", "invite"]],
  ["Settings", ["setting", "integration", "customfield", "sequence", "theme", "documenttemplate", "documentlabel", "notification", "webhook", "tag", "approval", "audit", "config", "country", "eventsystem", "feedback", "note", "plan", "printer", "searchindex", "suggestion", "tableview", "terms"]],
  ["Documents", ["document", "externallink", "modelupload"]],
];
function moduleFor(table) {
  const t = table.toLowerCase();
  for (const [mod, keys] of MODULE_RULES) if (keys.some((k) => t.includes(k))) return mod;
  return "Other";
}

// ── text + naming helpers ─────────────────────────────────────────────────────
const kebab = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/(^-|-$)/g, "");
const titleize = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
const cleanDesc = (d = "") =>
  d
    .replace(/<pk\/>/g, "")
    .replace(/<fk[^>]*\/>/g, "")
    .replace(/Note:\s*/gi, "")
    .replace(/This is a Primary Key\.?/gi, "")
    .replace(/This is a Foreign Key to `[^`]*`\.?/gi, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ── attributes from a definition ──────────────────────────────────────────────
function attributesFrom(def) {
  const props = def?.properties || {};
  const required = new Set(def?.required || []);
  return Object.entries(props).map(([name, p]) => {
    const desc = p.description || "";
    const fk = desc.match(/<fk table='([^']+)' column='([^']+)'\/>/);
    return {
      name,
      type: p.type || "string",
      format: p.format,
      description: cleanDesc(desc),
      required: required.has(name),
      pk: /<pk\/>/.test(desc) || /Primary Key/i.test(desc),
      fk: fk ? { table: fk[1], column: fk[2] } : undefined,
    };
  });
}

const AUDIT = new Set(["createdBy", "createdAt", "updatedBy", "updatedAt"]);
function exampleValue(a) {
  const n = a.name.toLowerCase();
  if (a.format && a.format.includes("timestamp")) return "2026-01-01T00:00:00Z";
  if (a.format === "date") return "2026-01-01";
  if (a.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (a.type === "boolean") return true;
  if (a.type === "integer" || a.type === "number")
    return n.includes("quantity") || n.includes("count") ? 10 : 0;
  if (a.type === "array") return [];
  if (a.type === "object") return {};
  if (n === "id") return "abc123def456";
  if (n.endsWith("id")) return "xyz789";
  if (n === "name") return "Example";
  return "string";
}
function sampleRow(attrs, limit = 8) {
  const picked = [
    ...attrs.filter((a) => a.pk),
    ...attrs.filter((a) => !a.pk && (a.name === "name" || a.required)),
    ...attrs.filter((a) => !a.pk && a.name !== "name" && !a.required),
  ].slice(0, limit);
  const row = {};
  for (const a of picked) row[a.name] = exampleValue(a);
  return row;
}
function createBody(attrs) {
  const body = {};
  for (const a of attrs) {
    if (a.pk || AUDIT.has(a.name)) continue;
    if (a.required || a.name === "name" || a.name === "description") body[a.name] = exampleValue(a);
  }
  if (Object.keys(body).length === 0 && attrs[0]) body[attrs[0].name] = exampleValue(attrs[0]);
  return body;
}

// ── code samples (httpsnippet) ────────────────────────────────────────────────
const AUTH_HEADERS = [{ name: "Authorization", value: "Bearer <api-key>" }];

// cURL / Python / PHP via httpsnippet (raw REST); JS uses the supabase-js SDK.
function samplesFor(har, js) {
  const s = new HTTPSnippet(har);
  const conv = (target, client) => {
    try {
      const out = s.convert(target, client);
      return typeof out === "string" ? out : Array.isArray(out) ? out[0] : "";
    } catch {
      return "";
    }
  };
  return {
    curl: conv("shell", "curl"),
    javascript: js,
    python: conv("python", "requests"),
    go: conv("go", "native"),
  };
}

// supabase-js SDK snippet per endpoint, matching Carbon's JS API docs (carbon.from(...)).
function jsObject(obj) {
  return JSON.stringify(obj, null, 2).replace(/\n/g, "\n  ");
}
function jsSdk(kind, table, pk, attrs, writable) {
  const head = "const { data, error } = await carbon";
  switch (kind) {
    case "list":
      return `${head}\n  .from('${table}')\n  .select('*')\n  .limit(10);`;
    case "retrieve":
      return `${head}\n  .from('${table}')\n  .select('*')\n  .eq('${pk}', id)\n  .single();`;
    case "create":
      return `${head}\n  .from('${table}')\n  .insert(${jsObject(createBody(attrs))})\n  .select();`;
    case "update": {
      const f = writable?.[0]?.name || "name";
      const v = JSON.stringify(exampleValue(writable?.[0] || { name: f, type: "string" }));
      return `const { error } = await carbon\n  .from('${table}')\n  .update({ ${JSON.stringify(f)}: ${v} })\n  .eq('${pk}', id);`;
    }
    case "delete":
      return `const { error } = await carbon\n  .from('${table}')\n  .delete()\n  .eq('${pk}', id);`;
    default:
      return head;
  }
}
function har(method, url, { query = [], body } = {}) {
  const headers = [...AUTH_HEADERS];
  const h = { method, url, httpVersion: "HTTP/1.1", queryString: query, headersSize: -1, bodySize: -1 };
  if (body !== undefined) {
    headers.push({ name: "Content-Type", value: "application/json" });
    headers.push({ name: "Prefer", value: "return=representation" });
    h.postData = { mimeType: "application/json", text: JSON.stringify(body) };
  }
  h.headers = headers;
  return h;
}

// ── build resources ───────────────────────────────────────────────────────────
const tablePaths = Object.keys(spec.paths).filter((p) => p !== "/" && !p.startsWith("/rpc/"));
const resources = [];

for (const path of tablePaths) {
  const table = path.slice(1);
  const def = spec.definitions[table];
  if (!def) continue;
  const methods = spec.paths[path];
  const attrs = attributesFrom(def);
  const pk = (attrs.find((a) => a.pk) || attrs.find((a) => a.name === "id") || attrs[0])?.name || "id";
  const single = titleize(table);
  const plural = `${single}s`;
  const row = sampleRow(attrs);
  const writable = attrs.filter((a) => !a.pk && !AUDIT.has(a.name));
  const endpoints = [];

  if (methods.get) {
    endpoints.push({
      id: `list-${kebab(table)}`,
      kind: "list",
      method: "GET",
      path: `/${table}`,
      title: `List ${plural.toLowerCase()}`,
      description: `Retrieve a paginated list of ${plural.toLowerCase()}. Filter, order, and select columns with PostgREST query parameters.`,
      query: [
        { name: "select", type: "string", description: "Comma-separated columns to return. Defaults to all." },
        { name: "order", type: "string", description: "Column to sort by, e.g. `createdAt.desc`." },
        { name: "limit", type: "integer", description: "Maximum rows to return." },
        { name: "offset", type: "integer", description: "Rows to skip, for pagination." },
      ],
      attributes: [],
      response: JSON.stringify([row], null, 2),
      samples: samplesFor(
        har("GET", `${BASE}/${table}?select=*&limit=10`, {
          query: [
            { name: "select", value: "*" },
            { name: "limit", value: "10" },
          ],
        }),
        jsSdk("list", table, pk),
      ),
    });
    endpoints.push({
      id: `retrieve-${kebab(table)}`,
      kind: "retrieve",
      method: "GET",
      path: `/${table}`,
      title: `Retrieve a ${single.toLowerCase()}`,
      description: `Fetch a single ${single.toLowerCase()} by filtering on \`${pk}\`.`,
      query: [{ name: pk, type: "string", description: `Match on the ${single.toLowerCase()}'s \`${pk}\`, e.g. \`eq.{id}\`.` }],
      attributes: [],
      response: JSON.stringify(row, null, 2),
      samples: samplesFor(
        har("GET", `${BASE}/${table}?${pk}=eq.{id}`, { query: [{ name: pk, value: "eq.{id}" }] }),
        jsSdk("retrieve", table, pk),
      ),
    });
  }
  if (methods.post) {
    endpoints.push({
      id: `create-${kebab(table)}`,
      kind: "create",
      method: "POST",
      path: `/${table}`,
      title: `Create a ${single.toLowerCase()}`,
      description: `Create a new ${single.toLowerCase()}.`,
      attributes: writable,
      response: JSON.stringify(row, null, 2),
      samples: samplesFor(
        har("POST", `${BASE}/${table}`, { body: createBody(attrs) }),
        jsSdk("create", table, pk, attrs),
      ),
    });
  }
  if (methods.patch) {
    const one = writable[0]?.name || "name";
    endpoints.push({
      id: `update-${kebab(table)}`,
      kind: "update",
      method: "PATCH",
      path: `/${table}`,
      title: `Update a ${single.toLowerCase()}`,
      description: `Update an existing ${single.toLowerCase()}, matched on \`${pk}\`.`,
      attributes: writable,
      response: JSON.stringify(row, null, 2),
      samples: samplesFor(
        har("PATCH", `${BASE}/${table}?${pk}=eq.{id}`, {
          query: [{ name: pk, value: "eq.{id}" }],
          body: { [one]: exampleValue(writable[0] || { name: one, type: "string" }) },
        }),
        jsSdk("update", table, pk, attrs, writable),
      ),
    });
  }
  if (methods.delete) {
    endpoints.push({
      id: `delete-${kebab(table)}`,
      kind: "delete",
      method: "DELETE",
      path: `/${table}`,
      title: `Delete a ${single.toLowerCase()}`,
      description: `Delete a ${single.toLowerCase()}, matched on \`${pk}\`. Returns 204 No Content.`,
      query: [{ name: pk, type: "string", description: `The \`${pk}\` of the ${single.toLowerCase()} to delete, e.g. \`eq.{id}\`.` }],
      attributes: [],
      response: "",
      samples: samplesFor(
        har("DELETE", `${BASE}/${table}?${pk}=eq.{id}`, { query: [{ name: pk, value: "eq.{id}" }] }),
        jsSdk("delete", table, pk),
      ),
    });
  }
  if (endpoints.length === 0) continue;

  resources.push({
    table,
    name: single,
    slug: kebab(table),
    module: moduleFor(table),
    // PostgREST exposes write methods only for base tables; Carbon's views are GET-only.
    kind: methods.post || methods.patch || methods.delete ? "table" : "view",
    description: cleanDesc(def.description) || `The ${single.toLowerCase()} resource.`,
    pk,
    endpoints,
  });
}

// ── group + sort ──────────────────────────────────────────────────────────────
const byModule = new Map(MODULE_ORDER.map((m) => [m, []]));
for (const r of resources) (byModule.get(r.module) || byModule.get("Other")).push(r);
const modules = MODULE_ORDER.map((name) => ({
  name,
  slug: kebab(name),
  resources: (byModule.get(name) || []).sort((a, b) => a.name.localeCompare(b.name)),
})).filter((m) => m.resources.length > 0);

mkdirSync(dirname(OUT), { recursive: true });
// Emit a .ts that JSON.parses a string literal: keeps tsc cheap (no deep literal
// inference over ~6MB of data) while staying a normal import.
const json = JSON.stringify({ base: BASE, modules });
writeFileSync(
  OUT,
  `// AUTO-GENERATED by scripts/generate-api-docs.mjs — do not edit.\n// @ts-nocheck\nexport default JSON.parse(${JSON.stringify(json)});\n`,
);

// ── stats ─────────────────────────────────────────────────────────────────────
const total = resources.length;
console.log(`[api-docs] ${total} resources, ${modules.length} modules`);
for (const m of modules) console.log(`  ${m.name.padEnd(12)} ${m.resources.length}`);
const other = modules.find((m) => m.name === "Other");
if (other) console.log(`  (Other sample: ${other.resources.slice(0, 12).map((r) => r.table).join(", ")})`);
console.log(`[api-docs] wrote ${OUT}`);

// ── MCP tools catalog ─────────────────────────────────────────────────────────
const TOOLS_SRC = resolve(__dirname, "../../apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json");
const TOOLS_OUT = resolve(__dirname, "../lib/tools-data.generated.ts");
const toolMeta = JSON.parse(readFileSync(TOOLS_SRC, "utf8"));
const allTools = Array.isArray(toolMeta) ? toolMeta : toolMeta.tools;
const toolsByModule = new Map();
for (const t of allTools) {
  if (!toolsByModule.has(t.module)) toolsByModule.set(t.module, []);
  toolsByModule.get(t.module).push({
    name: t.name,
    slug: t.name,
    classification: t.classification,
    description: t.description || "",
    schema: t.schema || {},
  });
}
const toolModules = [...toolsByModule.entries()]
  .map(([mod, tools]) => ({
    name: titleize(mod),
    slug: kebab(mod),
    module: mod,
    tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => b.tools.length - a.tools.length);
const toolsJson = JSON.stringify({ modules: toolModules });
writeFileSync(
  TOOLS_OUT,
  `// AUTO-GENERATED by scripts/generate-api-docs.mjs — do not edit.\n// @ts-nocheck\nexport default JSON.parse(${JSON.stringify(toolsJson)});\n`,
);
console.log(`[api-docs] ${allTools.length} MCP tools, ${toolModules.length} modules → ${TOOLS_OUT}`);
