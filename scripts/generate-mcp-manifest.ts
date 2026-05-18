// scripts/generate-mcp-manifest.ts
//
// Statically parses every annotated service module for mcpTool({...}, fn)
// calls and emits two artifacts:
//
//   1. apps/erp/app/services/mcp/mcp-tools.json
//      Slim manifest view (id/module/name/description/classification +
//      descriptionHash + contentHash) consumed by the embeddings worker.
//
//   2. apps/erp/app/services/mcp/mcp-tools.generated.ts
//      Runtime registration file: imports every service module and calls
//      `registry.registerParsed(fn, { module, name, argOrder })` once per
//      tool. Committed to git; bootstrap.ts invokes its `registerAll()`.
//
// We avoid importing the service files at runtime because doing so
// transitively pulls UI / browser code that cannot be loaded in a plain
// Node tsx context. A TypeScript AST walk recovers everything we need:
// the annotation literal for `classification`/`description`/`injectAuth`/
// `disable`, the named function expression for `name`, the function's
// parameter list for `argOrder`, and the file path for `module`.
//
// Run via: pnpm --filter erp mcp:manifest

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { buildManifest } from "../apps/erp/app/services/mcp/manifest";
import { McpToolRegistry } from "../apps/erp/app/services/mcp/registry";
import type { McpClassification } from "../apps/erp/app/services/mcp/types";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_FILE_JSON = resolve(ROOT, "apps/erp/app/services/mcp/mcp-tools.json");
const OUT_FILE_TS = resolve(ROOT, "apps/erp/app/services/mcp/mcp-tools.generated.ts");

// Mirror bootstrap.ts exactly. Update both lists together when modules are added.
const SERVICE_MODULES = [
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
  "users"
] as const;

interface ParsedAnnotation {
  module: string;
  name: string;
  description: string;
  classification: McpClassification;
  disable: boolean;
  argOrder: string[];
  injectAuth: string[];
  inject: InjectEntry[];
}

function readStringLiteral(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function readBooleanLiteral(node: ts.Node): boolean | undefined {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function readStringArray(node: ts.Node): string[] | undefined {
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  const out: string[] = [];
  for (const el of node.elements) {
    const s = readStringLiteral(el);
    if (s === undefined) return undefined;
    out.push(s);
  }
  return out;
}

// Acronyms that appear in service-function names and must survive as a
// single lowercased token (not get split letter-by-letter). Verified
// exhaustive against `async function` names across all service modules:
// only RFQ and MRP occur. Extend this set if a new acronym is introduced;
// the build will visibly mangle it in descriptions otherwise.
const FN_NAME_ACRONYMS = ["RFQ", "MRP"];

// Derive a human description from a camelCase function name. Known acronyms
// are protected so `RFQ` -> `rfq` (not `r f q`); everything else splits on
// the lower/UPPER boundary.
//   upsertSalesOrder -> "upsert sales order"
//   deleteSalesRFQ   -> "delete sales rfq"
//   getSalesRFQs     -> "get sales rfqs"
function deCamelCase(fnName: string): string {
  // Title-case known acronyms (RFQ -> Rfq) so the camelCase splitter treats
  // each as a single word and never fragments it letter-by-letter. A
  // trailing plural stays attached (RFQs -> Rfqs -> "rfqs").
  let s = fnName;
  for (const ac of FN_NAME_ACRONYMS) {
    const title = ac[0] + ac.slice(1).toLowerCase();
    s = s.replace(new RegExp(ac, "g"), title);
  }
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const VALID_INJECT_AS = new Set([
  "companyId",
  "userId",
  "createdBy",
  "updatedBy"
]);

interface InjectEntry {
  param?: string;
  as: string;
}

// Read `inject: [{ param: "x", as: "companyId" }, ...]` from the literal.
// The caller guards field presence; this throws on a malformed shape so the
// build fails loudly rather than silently dropping an auth binding.
function readInjectList(
  node: ts.Node,
  where: string
): InjectEntry[] {
  if (!ts.isArrayLiteralExpression(node)) {
    throw new Error(`${where}: \`inject\` must be an array literal`);
  }
  const out: InjectEntry[] = [];
  for (const el of node.elements) {
    if (!ts.isObjectLiteralExpression(el)) {
      throw new Error(`${where}: each \`inject\` entry must be an object literal`);
    }
    let param: string | undefined;
    let as: string | undefined;
    for (const p of el.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const k =
        ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)
          ? p.name.text
          : undefined;
      if (k === "param") param = readStringLiteral(p.initializer);
      else if (k === "as") as = readStringLiteral(p.initializer);
    }
    // `param` is optional (omitted = top-level identity flow). `as` is
    // mandatory — without it the binding is meaningless.
    if (!as) {
      throw new Error(`${where}: \`inject\` entry needs a string \`as\``);
    }
    out.push(param ? { param, as } : { as });
  }
  return out;
}

// Normalize the legacy injectAuth/injectInto pair into the unified inject
// list. injectInto names the object param identity is stamped into; when
// absent, `param` is omitted entirely — identity flows top-level and the
// registry's existing default-target heuristic resolves the shape.
function legacyToInject(
  injectAuth: string[],
  injectInto: string | undefined
): InjectEntry[] {
  return injectAuth.map((as) =>
    injectInto ? { param: injectInto, as } : { as }
  );
}

// Extract the function name and argOrder from the second mcpTool() argument.
// The argument must be a named function expression / declaration; arrow
// functions and anonymous expressions fail loudly.
function parseFunctionArg(
  fnArg: ts.Expression,
  file: string,
  line: number
): { name: string; argOrder: string[] | null } {
  if (!ts.isFunctionExpression(fnArg) && !ts.isArrowFunction(fnArg)) {
    throw new Error(
      `${file}:${line}: mcpTool() expects a function expression as its second argument`
    );
  }
  const fnName = ts.isFunctionExpression(fnArg) && fnArg.name ? fnArg.name.text : undefined;
  if (!fnName) {
    throw new Error(
      `${file}:${line}: mcpTool() function must be a named function expression (e.g. \`async function getThing(...) {}\`)`
    );
  }
  const argOrder: string[] = [];
  // If any param is destructured we cannot infer a positional name for it; fall
  // back to whatever argOrder the annotation declares. The codemod skips these
  // (it leaves the explicit argOrder key in place).
  for (const p of fnArg.parameters) {
    if (!ts.isIdentifier(p.name)) {
      return { name: fnName, argOrder: null };
    }
    const isOptional = p.questionToken !== undefined || p.initializer !== undefined;
    argOrder.push(isOptional ? `${p.name.text}?` : p.name.text);
  }
  return { name: fnName, argOrder };
}

function parseAnnotationObject(
  obj: ts.ObjectLiteralExpression,
  fileModuleHint: string,
  fnInfo: { name: string; argOrder: string[] | null },
  file: string,
  line: number
): ParsedAnnotation | null {
  const fields: Record<string, ts.Expression> = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = prop.name;
    let keyName: string | undefined;
    if (ts.isIdentifier(key) || ts.isStringLiteral(key)) keyName = key.text;
    if (!keyName) continue;
    fields[keyName] = prop.initializer;
  }

  // Validate-or-derive name / module / argOrder.
  // Annotations might still carry these during the transition; if present, we
  // assert they match the source-of-truth (function name, file path, fn params)
  // and fail loud on mismatch. Once the codemod runs, they vanish entirely.
  // Function signature is the source of truth for name/module/argOrder.
  // During the slim-annotation transition the literal may still carry these
  // keys; we warn on mismatch (a pre-existing bug surfaced by the refactor)
  // but always trust the parsed-from-source value.
  const name = fnInfo.name;
  if (fields.name) {
    const declared = readStringLiteral(fields.name);
    if (declared && declared !== name) {
      console.warn(
        `[mcp-manifest] ${file}:${line}: annotation.name="${declared}" != fn name "${name}" — using fn name`
      );
    }
  }

  const moduleName = fileModuleHint;
  if (fields.module) {
    const declared = readStringLiteral(fields.module);
    if (declared && declared !== moduleName) {
      console.warn(
        `[mcp-manifest] ${file}:${line}: annotation.module="${declared}" != file module "${moduleName}" — using file module`
      );
    }
  }

  // Prefer fn-derived argOrder; if the function has a destructured param we
  // can't infer positional names for, fall back to the annotation literal.
  let argOrder: string[] = fnInfo.argOrder ?? [];
  const declaredArgOrder = fields.argOrder ? readStringArray(fields.argOrder) : undefined;
  if (fnInfo.argOrder === null) {
    if (!declaredArgOrder) {
      throw new Error(
        `${file}:${line}: mcpTool() "${name}" has destructured params and no argOrder in the annotation literal — at least one source must declare the positional shape`
      );
    }
    argOrder = declaredArgOrder;
  } else if (declaredArgOrder && JSON.stringify(declaredArgOrder) !== JSON.stringify(argOrder)) {
    console.warn(
      `[mcp-manifest] ${file}:${line}: annotation.argOrder=${JSON.stringify(declaredArgOrder)} != fn params ${JSON.stringify(argOrder)} — using fn params`
    );
  }

  // Description is derived from the fn name. During the codemod transition
  // the literal may still carry it; assert it matches the derived value so a
  // stale hand-written description can't silently diverge.
  const derivedDescription = deCamelCase(name);
  const literalDescription = fields.description
    ? readStringLiteral(fields.description)
    : undefined;
  if (literalDescription && literalDescription !== derivedDescription) {
    console.warn(
      `[mcp-manifest] ${file}:${line}: annotation.description="${literalDescription}" != derived "${derivedDescription}" — using derived`
    );
  }
  const description = derivedDescription;

  const classification = fields.classification ? readStringLiteral(fields.classification) : undefined;
  if (!classification) return null;
  if (classification !== "READ" && classification !== "WRITE" && classification !== "DESTRUCTIVE") {
    return null;
  }

  const disable =
    fields.disable !== undefined ? readBooleanLiteral(fields.disable) ?? false : false;

  const injectAuth = fields.injectAuth ? readStringArray(fields.injectAuth) ?? [] : [];
  const injectInto = fields.injectInto
    ? readStringLiteral(fields.injectInto)
    : undefined;

  // Unified inject: prefer the new `inject` list; otherwise normalize the
  // legacy injectAuth/injectInto pair. Build fails loudly on a binding that
  // names a non-existent param or an unknown identity (auth boundary).
  const where = `${file}:${line} (${moduleName}_${name})`;
  const inject = fields.inject
    ? readInjectList(fields.inject, where)
    : legacyToInject(injectAuth, injectInto);

  const argNames = new Set(argOrder.map((a) => (a.endsWith("?") ? a.slice(0, -1) : a)));
  for (const b of inject) {
    if (!VALID_INJECT_AS.has(b.as)) {
      throw new Error(
        `${where}: inject.as="${b.as}" is not a valid identity ` +
          `(companyId|userId|createdBy|updatedBy)`
      );
    }
    // Omitted param = top-level identity flow; registry's default-target
    // heuristic resolves it. A present param must name a real positional.
    if (b.param !== undefined && !argNames.has(b.param)) {
      throw new Error(
        `${where}: inject.param="${b.param}" is not a parameter ` +
          `[${[...argNames].join(", ")}]`
      );
    }
  }

  return {
    module: moduleName,
    name,
    description,
    classification,
    disable,
    argOrder,
    injectAuth,
    inject
  };
}

function extractFromFile(filePath: string, moduleHint: string): ParsedAnnotation[] {
  const source = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, /*setParentNodes*/ true);
  const out: ParsedAnnotation[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isMcpTool = ts.isIdentifier(callee) && callee.text === "mcpTool";
      if (isMcpTool && node.arguments.length >= 2) {
        const first = node.arguments[0];
        const second = node.arguments[1];
        if (ts.isObjectLiteralExpression(first)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const fnInfo = parseFunctionArg(second, filePath, line + 1);
          const ann = parseAnnotationObject(first, moduleHint, fnInfo, filePath, line + 1);
          if (ann) out.push(ann);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

function emitGeneratedTs(rows: ParsedAnnotation[]): string {
  // Group by module for stable, human-readable output.
  const byModule = new Map<string, ParsedAnnotation[]>();
  for (const r of rows) {
    if (!byModule.has(r.module)) byModule.set(r.module, []);
    byModule.get(r.module)!.push(r);
  }
  const modules = [...byModule.keys()].sort();
  let out = "";
  out += "// AUTO-GENERATED by scripts/generate-mcp-manifest.ts. Do not edit by hand.\n";
  out += "// Source of truth: mcpTool() call sites under apps/erp/app/modules/<module>/<module>.service.ts.\n";
  out += "//\n";
  out += "// Imports every annotated service module (so the wrapper's symbol-tag\n";
  out += "// side effect runs) and calls registry.registerParsed() once per tool.\n";
  out += "\n";
  for (const m of modules) {
    out += `import * as ${m} from "~/modules/${m}/${m}.service";\n`;
  }
  out += "import { McpToolRegistry } from \"./registry\";\n";
  out += "\n";
  out += "export function registerAll(): void {\n";
  out += "  const registry = McpToolRegistry.getInstance();\n";
  for (const m of modules) {
    const tools = byModule.get(m)!.slice().sort((a, b) => a.name.localeCompare(b.name));
    out += `\n  // ${m} (${tools.length} tools)\n`;
    for (const t of tools) {
      const argOrderLit = "[" + t.argOrder.map((a) => JSON.stringify(a)).join(", ") + "]";
      // `inject` is the build-resolved identity contract (from `inject` /
      // legacy injectAuth/injectInto). It MUST travel to runtime here — the
      // slim annotation does not carry it, so omitting it would silently
      // disable server identity injection on every write tool.
      const injectLit =
        "[" +
        t.inject
          .map((b) =>
            b.param
              ? `{ param: ${JSON.stringify(b.param)}, as: ${JSON.stringify(b.as)} }`
              : `{ as: ${JSON.stringify(b.as)} }`
          )
          .join(", ") +
        "]";
      // Multi-line object: matches biome's preferred format so the file is a
      // fixed-point under `biome check --write`.
      out += `  registry.registerParsed(${m}.${t.name}, {\n`;
      out += `    module: "${m}",\n`;
      out += `    name: "${t.name}",\n`;
      out += `    argOrder: ${argOrderLit},\n`;
      out += `    description: ${JSON.stringify(t.description)},\n`;
      out += `    inject: ${injectLit}\n`;
      out += `  });\n`;
    }
  }
  out += "}\n";
  return out;
}

function main(): void {
  // Populate the registry by feeding each parsed annotation through the real
  // McpToolRegistry. That keeps a single source of truth for `disable`,
  // blocklist filtering, etc.
  const registry = McpToolRegistry.getInstance();
  registry.resetForTesting();

  const allRows: ParsedAnnotation[] = [];

  for (const m of SERVICE_MODULES) {
    const file = resolve(ROOT, `apps/erp/app/modules/${m}/${m}.service.ts`);
    const anns = extractFromFile(file, m);
    for (const a of anns) {
      allRows.push(a);
      const fn = (() => undefined) as unknown as (...args: unknown[]) => unknown;
      const argOrder = a.argOrder.length > 0 ? a.argOrder : ["_"];
      // Registry contract is unchanged in this phase (Option B): feed it the
      // identity set derived from the unified `inject` list so legacy and
      // new annotations register identically. Phase 3 teaches the registry
      // to consume `inject` directly.
      const injectAuth = [...new Set(a.inject.map((b) => b.as))];
      try {
        registry.register(
          {
            module: a.module,
            name: a.name,
            description: a.description,
            classification: a.classification,
            disable: a.disable,
            paramSchema: z.unknown(),
            argOrder,
            injectAuth: injectAuth as never
          },
          fn
        );
      } catch (err) {
        console.warn(`[mcp-manifest] register failed for ${a.module}_${a.name}:`, (err as Error).message);
      }
    }
  }

  const manifest = buildManifest(registry.list());
  const next = JSON.stringify(manifest, null, 2) + "\n";

  let jsonChanged = true;
  if (existsSync(OUT_FILE_JSON)) {
    const prev = JSON.parse(readFileSync(OUT_FILE_JSON, "utf8")) as { contentHash?: string };
    if (prev.contentHash === manifest.contentHash) {
      jsonChanged = false;
    }
  }
  if (jsonChanged) {
    writeFileSync(OUT_FILE_JSON, next);
    console.log(
      `[mcp-manifest] wrote ${OUT_FILE_JSON} (${manifest.tools.length} tools, ${manifest.contentHash})`
    );
  } else {
    console.log(`[mcp-manifest] unchanged json (${manifest.tools.length} tools, ${manifest.contentHash})`);
  }

  const tsBody = emitGeneratedTs(allRows);
  let tsChanged = true;
  if (existsSync(OUT_FILE_TS)) {
    const prev = readFileSync(OUT_FILE_TS, "utf8");
    if (prev === tsBody) tsChanged = false;
  }
  if (tsChanged) {
    writeFileSync(OUT_FILE_TS, tsBody);
    console.log(`[mcp-manifest] wrote ${OUT_FILE_TS} (${allRows.length} registrations)`);
  } else {
    console.log(`[mcp-manifest] unchanged ts (${allRows.length} registrations)`);
  }
}

try {
  main();
} catch (err) {
  console.error("[mcp-manifest] failed:", err);
  process.exit(1);
}
