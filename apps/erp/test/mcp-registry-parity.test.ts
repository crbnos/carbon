import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import toolMetadataJson from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// Guards the server-only companion seam (`{module}.mcp.server.ts`).
//
// `scripts/generate-mcp.ts` publishes every exported function of every
// `{module}.service.ts` AND every `{module}.mcp.server.ts` it finds, while the
// dispatch resolves tools through `api+/v1+/lib/registry.server.ts`, which
// imports modules statically. A companion the generator publishes but the
// registry never imports is a tool that answers "Operation not found"; a
// companion that reaches Kysely or the service role without re-checking the
// route's permission is an OAuth-callable RLS bypass. Both are caught here by
// reading source text, so the test needs no database and no app runtime.

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(HERE, "../app");
const MODULES_DIR = join(APP_DIR, "modules");
const REGISTRY_FILE = join(APP_DIR, "routes/api+/v1+/lib/registry.server.ts");
const REPO_ROOT = resolve(HERE, "../../..");
const MIGRATIONS_DIR = join(
  REPO_ROOT,
  "packages/database/supabase/migrations"
);
const FUNCTIONS_DIR = join(REPO_ROOT, "packages/database/supabase/functions");

interface Tool {
  name: string;
  module: string;
}
const tools = (toolMetadataJson as unknown as { tools: Tool[] }).tools;

const read = (file: string) => readFileSync(file, "utf8");

/** Strip comments so commented-out code never counts as a call. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** name → body text of each `export (async) function` in a source file. */
function exportedFunctionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const re = /export\s+(?:async\s+)?function\s+(\w+)\s*[(<]/g;
  const matches = [...source.matchAll(re)];
  matches.forEach((match, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length;
    bodies.set(match[1], source.slice(match.index, end));
  });
  return bodies;
}

function companionModules(): string[] {
  return readdirSync(MODULES_DIR).filter((mod) =>
    existsSync(join(MODULES_DIR, mod, `${mod}.mcp.server.ts`))
  );
}

/** The registry's static imports: namespace → module path. */
function registryImports(): Map<string, string> {
  const source = read(REGISTRY_FILE);
  const imports = new Map<string, string>();
  for (const m of source.matchAll(
    /import\s+\*\s+as\s+(\w+)\s+from\s+"~\/modules\/([^"]+)"/g
  )) {
    imports.set(m[1], m[2]);
  }
  return imports;
}

/** The registry literal: module key → the namespaces it spreads/assigns. */
function registryEntries(): Map<string, string[]> {
  const source = read(REGISTRY_FILE);
  const body = source.slice(source.indexOf("functionRegistry = {"));
  const entries = new Map<string, string[]>();
  for (const m of body.matchAll(/^\s*(\w+):\s*(\{[^}]*\}|\w+)\s*,?\s*$/gm)) {
    const value = m[2];
    const namespaces = value.startsWith("{")
      ? [...value.matchAll(/\.\.\.(\w+)/g)].map((s) => s[1])
      : [value];
    entries.set(m[1], namespaces);
  }
  return entries;
}

describe("registry ↔ generator companion parity", () => {
  it("imports every {module}.mcp.server.ts on disk, and nothing else", () => {
    const imported = [...registryImports().values()]
      .filter((p) => p.endsWith(".mcp.server"))
      .map((p) => p.split("/")[0])
      .sort();
    expect(imported).toEqual(companionModules().sort());
  });

  it("spreads each companion into its own module's namespace", () => {
    const imports = registryImports();
    const entries = registryEntries();
    for (const mod of companionModules()) {
      const namespace = [...imports].find(
        ([, p]) => p === `${mod}/${mod}.mcp.server`
      )?.[0];
      expect(namespace, mod).toBeDefined();
      const spread = entries.get(mod) ?? [];
      expect(spread, mod).toContain(namespace);
      // The companion spreads LAST so a same-named wrapper shadows the service
      // function, matching the generator's dedupe.
      expect(spread[spread.length - 1], mod).toBe(namespace);
    }
  });

  it("resolves every manifest tool to an export of a registry-imported file", () => {
    const imports = registryImports();
    const entries = registryEntries();
    const exportsByModule = new Map<string, Set<string>>();
    for (const [mod, namespaces] of entries) {
      const names = new Set<string>();
      for (const ns of namespaces) {
        const modulePath = imports.get(ns);
        if (!modulePath) continue;
        const file = join(MODULES_DIR, `${modulePath}.ts`);
        for (const name of exportedFunctionBodies(read(file)).keys()) {
          names.add(name);
        }
      }
      exportsByModule.set(mod, names);
    }

    const unresolved = tools
      .filter((tool) => {
        const fn = tool.name.slice(tool.module.length + 1);
        return !exportsByModule.get(tool.module)?.has(fn);
      })
      .map((t) => t.name);
    expect(unresolved).toEqual([]);
  });

  it("publishes every companion export (the generator parsed it)", () => {
    const published = new Set(tools.map((t) => t.name));
    const missing: string[] = [];
    for (const mod of companionModules()) {
      const source = read(join(MODULES_DIR, mod, `${mod}.mcp.server.ts`));
      for (const name of exportedFunctionBodies(source).keys()) {
        if (!published.has(`${mod}_${name}`)) missing.push(`${mod}_${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Companion permission guard
// ---------------------------------------------------------------------------

const PRIVILEGED_CALL = /\b(getDatabaseClient|getCarbonServiceRole)\s*\(/;

/** SECURITY DEFINER functions, by the LAST migration that defines them. */
function securityDefinerFunctions(names: Set<string>): Set<string> {
  const definer = new Map<string, boolean>();
  if (names.size === 0) return new Set();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = read(join(MIGRATIONS_DIR, file));
    for (const name of names) {
      const create = new RegExp(
        `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?public"?\\.)?"?${name}"?\\s*\\(`,
        "gi"
      );
      for (const m of sql.matchAll(create)) {
        // The statement runs to the first `;` after its dollar-quoted body.
        const rest = sql.slice(m.index);
        const tag = /\$[A-Za-z_]*\$/.exec(rest);
        if (!tag) continue;
        const bodyEnd = rest.indexOf(tag[0], tag.index + tag[0].length);
        const stmtEnd = rest.indexOf(";", bodyEnd + tag[0].length);
        const header = rest.slice(0, tag.index);
        const trailer = rest.slice(bodyEnd + tag[0].length, stmtEnd);
        definer.set(name, /SECURITY\s+DEFINER/i.test(header + trailer));
      }
      const alter = new RegExp(
        `ALTER\\s+FUNCTION\\s+(?:"?public"?\\.)?"?${name}"?[^;]*SECURITY\\s+(DEFINER|INVOKER)`,
        "gi"
      );
      for (const m of sql.matchAll(alter)) {
        definer.set(name, m[1].toUpperCase() === "DEFINER");
      }
    }
  }
  return new Set([...definer].filter(([, d]) => d).map(([n]) => n));
}

/** Local named imports: local name → { file, imported name }. */
function localImports(
  source: string,
  fromFile: string
): Map<string, { file: string; name: string }> {
  const out = new Map<string, { file: string; name: string }>();
  for (const m of source.matchAll(
    /import\s+(?!type\b)\{([^}]+)\}\s+from\s+"((?:\.|~\/)[^"]+)"/g
  )) {
    const spec = m[2];
    const base = spec.startsWith("~/")
      ? join(APP_DIR, spec.slice(2))
      : resolve(dirname(fromFile), spec);
    const file = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(
      existsSync
    );
    if (!file) continue;
    for (const part of m[1].split(",")) {
      const cleaned = part.trim().replace(/^type\s+/, "");
      if (!cleaned) continue;
      const [imported, local] = cleaned.split(/\s+as\s+/);
      out.set((local ?? imported).trim(), { file, name: imported.trim() });
    }
  }
  return out;
}

/** Why a companion export bypasses RLS, or null when it does not. */
function privilegeReasons(
  body: string,
  imports: Map<string, { file: string; name: string }>,
  definerRpcs: Set<string>
): string[] {
  const reasons: string[] = [];
  const code = stripComments(body);
  const direct = PRIVILEGED_CALL.exec(code);
  if (direct) reasons.push(`calls ${direct[1]}()`);
  for (const m of code.matchAll(/\.rpc\(\s*["'](\w+)["']/g)) {
    if (definerRpcs.has(m[1])) reasons.push(`calls SECURITY DEFINER ${m[1]}`);
  }
  for (const [local, target] of imports) {
    if (!new RegExp(`\\b${local}\\s*\\(`).test(code)) continue;
    const targetBody = exportedFunctionBodies(read(target.file)).get(
      target.name
    );
    if (targetBody && PRIVILEGED_CALL.test(stripComments(targetBody))) {
      reasons.push(`calls ${target.name} (${target.file.slice(APP_DIR.length + 1)})`);
    }
  }
  return reasons;
}

describe("companion permission guard", () => {
  const companions = companionModules().map((mod) => {
    const file = join(MODULES_DIR, mod, `${mod}.mcp.server.ts`);
    const source = read(file);
    return {
      mod,
      source,
      bodies: exportedFunctionBodies(source),
      imports: localImports(source, file)
    };
  });
  const rpcNames = new Set(
    companions.flatMap(({ source }) =>
      [...stripComments(source).matchAll(/\.rpc\(\s*["'](\w+)["']/g)].map(
        (m) => m[1]
      )
    )
  );
  const definerRpcs = securityDefinerFunctions(rpcNames);

  it("finds the privileged paths it is meant to police", () => {
    // Sanity: the scan recognises the known cases, so a regex regression
    // cannot turn the guard below into a silent pass.
    expect(definerRpcs.has("complete_job_to_inventory")).toBe(true);
    const quality = companions.find((c) => c.mod === "quality");
    expect(
      privilegeReasons(
        quality!.bodies.get("dispositionInspection")!,
        quality!.imports,
        definerRpcs
      )
    ).not.toEqual([]);
  });

  it("every companion export that bypasses RLS calls requireToolPermission first", () => {
    const offenders: string[] = [];
    for (const { mod, bodies, imports } of companions) {
      for (const [name, body] of bodies) {
        const reasons = privilegeReasons(body, imports, definerRpcs);
        if (reasons.length === 0) continue;
        if (!/\brequireToolPermission\s*\(/.test(stripComments(body))) {
          offenders.push(`${mod}_${name}: ${reasons.join(", ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Posting edge functions reachable from the tool surface
// ---------------------------------------------------------------------------

// Posting edge functions whose only callers are still route actions, with the
// follow-up that moves each call into a command the registry can reach. The
// test fails when one becomes reachable (shrink this list) or when a new
// posting function appears unreachable and unlisted.
const ROUTE_ONLY_POSTINGS: Record<string, string> = {
  "post-stock-transfer": "inventory document commands (stock transfer lines)",
  "post-inventory-count": "inventory document commands (inventory count post)",
  "post-nonconformance":
    "inspection reject + nonconformance task/approval generation",
  "post-sales-invoice": "invoicing post/void commands",
  "post-purchase-invoice": "invoicing post/void commands",
  "post-payment": "invoicing post/void commands",
  "post-memo": "invoicing post/void commands",
  "post-card-transaction": "invoicing post/void commands"
};

/** Every app file transitively imported (value imports) from the registry. */
function registryReachableSources(): string[] {
  const seen = new Set<string>();
  const queue = [REGISTRY_FILE];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    for (const m of source.matchAll(
      /(?:import|export)\s+(?!type\b)[^"';]*?from\s+"((?:\.|~\/)[^"]+)"/g
    )) {
      const spec = m[1];
      const base = spec.startsWith("~/")
        ? join(APP_DIR, spec.slice(2))
        : resolve(dirname(file), spec);
      const next = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(
        existsSync
      );
      if (next && !next.includes(`${join(APP_DIR, "routes")}/x+`)) {
        queue.push(next);
      }
    }
  }
  return [...seen].map(read);
}

function invokes(source: string, fn: string): boolean {
  const escaped = fn.replace(/[-]/g, "\\-");
  return new RegExp(
    `functions\\s*\\.\\s*invoke\\s*(?:<[\\s\\S]{0,400}?>)?\\s*\\(\\s*["'\`]${escaped}["'\`]`
  ).test(source);
}

describe("posting edge functions reachable from the tool surface", () => {
  const postings = readdirSync(FUNCTIONS_DIR).filter(
    (d) => d.startsWith("post-") || d === "create"
  );
  const reachable = registryReachableSources();
  const isReachable = (fn: string) => reachable.some((s) => invokes(s, fn));

  it("every posting function is invoked from registry-reachable code or baselined", () => {
    const unreachable = postings.filter(
      (fn) => !isReachable(fn) && !(fn in ROUTE_ONLY_POSTINGS)
    );
    expect(unreachable).toEqual([]);
  });

  it("the baseline lists only functions that are still unreachable", () => {
    const nowReachable = Object.keys(ROUTE_ONLY_POSTINGS).filter(
      (fn) => !postings.includes(fn) || isReachable(fn)
    );
    expect(nowReachable).toEqual([]);
  });

  it("post-production-event is reachable (the event tools post)", () => {
    expect(isReachable("post-production-event")).toBe(true);
  });

  it("receipt and shipment posting and creation are reachable (the inventory document tools)", () => {
    expect(isReachable("post-receipt")).toBe(true);
    expect(isReachable("post-shipment")).toBe(true);
    expect(isReachable("create")).toBe(true);
  });
});
