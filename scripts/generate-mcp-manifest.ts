// scripts/generate-mcp-manifest.ts
//
// Statically parses every annotated service module for `mcpTool({...}, fn)`
// calls and emits a single artifact:
//
//   apps/erp/app/services/mcp/mcp-tools.json
//
// Runtime consumers (server.ts, direct-executor.ts) read this JSON directly.
// There is no separate generated registration file and no in-memory tool
// registry — the JSON is the source of truth for discovery and the
// `direct-executor.ts` static-import map is the source of truth for
// execution.
//
// Run via: pnpm --filter erp mcp:manifest

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_FILE_JSON = resolve(ROOT, "apps/erp/app/services/mcp/mcp-tools.json");

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

type McpClassification = "READ" | "WRITE" | "DESTRUCTIVE";

interface InjectEntry {
  param?: string;
  as: string;
}

interface ParsedAnnotation {
  module: string;
  name: string;
  description: string;
  classification: McpClassification;
  disable: boolean;
  argOrder: string[];
  inject: InjectEntry[];
}

interface ManifestTool {
  id: string;
  module: string;
  name: string;
  description: string;
  classification: McpClassification;
  serviceParams: string[];
  injectAuth: string[];
  injectInto?: string;
  disable: boolean;
  descriptionHash: string;
}

interface Manifest {
  generatedAt: string;
  contentHash: string;
  tools: ManifestTool[];
}

function sha256(input: string): string {
  return "sha256:" + createHash("sha256").update(input).digest("hex");
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

const FN_NAME_ACRONYMS = ["RFQ", "MRP"];

function deCamelCase(fnName: string): string {
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

function readInjectList(node: ts.Node, where: string): InjectEntry[] {
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
    if (!as) {
      throw new Error(`${where}: \`inject\` entry needs a string \`as\``);
    }
    out.push(param ? { param, as } : { as });
  }
  return out;
}

function legacyToInject(
  injectAuth: string[],
  injectInto: string | undefined
): InjectEntry[] {
  return injectAuth.map((as) =>
    injectInto ? { param: injectInto, as } : { as }
  );
}

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
  const fnName =
    ts.isFunctionExpression(fnArg) && fnArg.name ? fnArg.name.text : undefined;
  if (!fnName) {
    throw new Error(
      `${file}:${line}: mcpTool() function must be a named function expression`
    );
  }
  const argOrder: string[] = [];
  for (const p of fnArg.parameters) {
    if (!ts.isIdentifier(p.name)) {
      return { name: fnName, argOrder: null };
    }
    const isOptional =
      p.questionToken !== undefined || p.initializer !== undefined;
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

  const name = fnInfo.name;
  const moduleName = fileModuleHint;

  let argOrder: string[] = fnInfo.argOrder ?? [];
  const declaredArgOrder = fields.argOrder
    ? readStringArray(fields.argOrder)
    : undefined;
  if (fnInfo.argOrder === null) {
    if (!declaredArgOrder) {
      throw new Error(
        `${file}:${line}: mcpTool() "${name}" has destructured params and no argOrder in the annotation literal`
      );
    }
    argOrder = declaredArgOrder;
  }

  const description = deCamelCase(name);

  const classification = fields.classification
    ? readStringLiteral(fields.classification)
    : undefined;
  if (!classification) return null;
  if (
    classification !== "READ" &&
    classification !== "WRITE" &&
    classification !== "DESTRUCTIVE"
  ) {
    return null;
  }

  const disable =
    fields.disable !== undefined
      ? readBooleanLiteral(fields.disable) ?? false
      : false;

  const injectAuth = fields.injectAuth
    ? readStringArray(fields.injectAuth) ?? []
    : [];
  const injectInto = fields.injectInto
    ? readStringLiteral(fields.injectInto)
    : undefined;

  const where = `${file}:${line} (${moduleName}_${name})`;
  const inject = fields.inject
    ? readInjectList(fields.inject, where)
    : legacyToInject(injectAuth, injectInto);

  const argNames = new Set(
    argOrder.map((a) => (a.endsWith("?") ? a.slice(0, -1) : a))
  );
  for (const b of inject) {
    if (!VALID_INJECT_AS.has(b.as)) {
      throw new Error(
        `${where}: inject.as="${b.as}" is not a valid identity (companyId|userId|createdBy|updatedBy)`
      );
    }
    if (b.param !== undefined && !argNames.has(b.param)) {
      throw new Error(
        `${where}: inject.param="${b.param}" is not a parameter [${[...argNames].join(", ")}]`
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
    inject
  };
}

function extractFromFile(
  filePath: string,
  moduleHint: string
): ParsedAnnotation[] {
  const source = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2022,
    /*setParentNodes*/ true
  );
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
          const ann = parseAnnotationObject(
            first,
            moduleHint,
            fnInfo,
            filePath,
            line + 1
          );
          if (ann) out.push(ann);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

// Map the unified `inject` list to main's legacy shape so the runtime
// executor (direct-executor.ts) can consume identity rules with the simpler
// `injectAuth: string[]` + optional `injectInto: string` pair. Build fails
// loudly if different auth fields target different parameters, since the
// legacy shape can only encode one target.
function toLegacyInject(
  inject: InjectEntry[],
  where: string
): { injectAuth: string[]; injectInto?: string } {
  const injectAuth = [...new Set(inject.map((b) => b.as))];
  const targets = new Set(
    inject.map((b) => b.param).filter((p): p is string => p !== undefined)
  );
  if (targets.size > 1) {
    throw new Error(
      `${where}: inject targets multiple params [${[...targets].join(", ")}]; legacy shape supports at most one`
    );
  }
  const injectInto = targets.size === 1 ? [...targets][0] : undefined;
  return injectInto ? { injectAuth, injectInto } : { injectAuth };
}

function buildManifestTool(p: ParsedAnnotation): ManifestTool {
  // `serviceParams` is main's shape: the full positional parameter list
  // including the leading `client`. The annotation `argOrder` already
  // captures this verbatim (with trailing `?` markers on optionals, which
  // the runtime executor strips).
  const serviceParams = p.argOrder.map((a) =>
    a.endsWith("?") ? a.slice(0, -1) : a
  );
  const { injectAuth, injectInto } = toLegacyInject(
    p.inject,
    `${p.module}_${p.name}`
  );
  const id = `${p.module}_${p.name}`;
  const descriptionHash = sha256(
    `${id}\n${p.description}\n${p.classification}`
  );
  const base: ManifestTool = {
    id,
    module: p.module,
    name: p.name,
    description: p.description,
    classification: p.classification,
    serviceParams,
    injectAuth,
    disable: p.disable,
    descriptionHash
  };
  return injectInto ? { ...base, injectInto } : base;
}

function buildManifest(rows: ParsedAnnotation[]): Manifest {
  const tools = rows
    .map(buildManifestTool)
    .sort((a, b) => a.id.localeCompare(b.id));
  // Content hash is deterministic over the tool set so CI / boot code can
  // tell whether the manifest semantically changed across regenerations.
  const contentHash = sha256(
    tools.map((t) => t.descriptionHash).join("\n")
  );
  return {
    generatedAt: new Date().toISOString(),
    contentHash,
    tools
  };
}

function main(): void {
  const allRows: ParsedAnnotation[] = [];
  for (const m of SERVICE_MODULES) {
    const file = resolve(
      ROOT,
      `apps/erp/app/modules/${m}/${m}.service.server.ts`
    );
    const anns = extractFromFile(file, m);
    allRows.push(...anns);
  }

  const manifest = buildManifest(allRows);
  const next = JSON.stringify(manifest, null, 2) + "\n";

  let changed = true;
  if (existsSync(OUT_FILE_JSON)) {
    const prev = JSON.parse(readFileSync(OUT_FILE_JSON, "utf8")) as {
      contentHash?: string;
    };
    if (prev.contentHash === manifest.contentHash) changed = false;
  }
  if (changed) {
    writeFileSync(OUT_FILE_JSON, next);
    // Match the repo's biome config so the file is a fixed point under
    // `biome check --write` / lint-staged. Without this, every regeneration
    // would leave the JSON in a state lint-staged would reformat on commit.
    spawnSync("npx", ["biome", "format", "--write", OUT_FILE_JSON], {
      stdio: "inherit",
      cwd: ROOT
    });
    console.log(
      `[mcp-manifest] wrote ${OUT_FILE_JSON} (${manifest.tools.length} tools, ${manifest.contentHash})`
    );
  } else {
    console.log(
      `[mcp-manifest] unchanged (${manifest.tools.length} tools, ${manifest.contentHash})`
    );
  }
}

try {
  main();
} catch (err) {
  console.error("[mcp-manifest] failed:", err);
  process.exit(1);
}
