import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODULE_EXCLUSIONS,
  MODULE_LIST
} from "../../../scripts/lib/service-metadata";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// The MCP tool surface is decided by two hand-kept lists: the generator's
// MODULE_LIST (which service files become tools) and the runtime registry
// (registry.server.ts, which the dispatch resolves a tool name against). A
// module in one but not the other is either unpublished by omission or
// published with nothing behind it. A service file in neither list is a module
// nobody decided about — the gap that left whole modules off the catalog with
// no record of why. Every service file must be listed or excluded with a reason.

const MODULES_DIR = path.resolve(__dirname, "../app/modules");
const REGISTRY_FILE = path.resolve(
  __dirname,
  "../app/routes/api+/v1+/lib/registry.server.ts"
);

/** `<module>/<file>` for every service-shaped file under app/modules. */
function serviceFiles(): string[] {
  return fs
    .readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      fs
        .readdirSync(path.join(MODULES_DIR, d.name))
        .filter((f) => /\.service\.ts$|\.mcp\.server\.ts$/.test(f))
        .map((f) => `${d.name}/${f}`)
    )
    .sort();
}

/** Files the generator scans for a module (see buildAllToolMetadata). */
function publishedFiles(mod: string): string[] {
  return [`${mod}.service.ts`, `${mod}.ee.service.ts`, `${mod}.mcp.server.ts`]
    .map((f) => `${mod}/${f}`)
    .filter((f) => fs.existsSync(path.join(MODULES_DIR, f)));
}

function registryModules(): Record<string, string[]> {
  const source = fs.readFileSync(REGISTRY_FILE, "utf-8");
  const imports = new Map<string, string>();
  for (const m of source.matchAll(
    /import \* as (\w+) from "~\/modules\/([\w/.-]+)";/g
  )) {
    imports.set(m[1], `${m[2]}.ts`);
  }
  const body = source.slice(source.indexOf("functionRegistry = {"));
  const entries: Record<string, string[]> = {};
  for (const m of body.matchAll(/^\s+(\w+):\s*(.+?),?$/gm)) {
    const namespaces = [...m[2].matchAll(/(\w+Functions)/g)].map((n) => n[1]);
    entries[m[1]] = namespaces.map((ns) => imports.get(ns) ?? `?${ns}`);
  }
  return entries;
}

describe("MCP module coverage", () => {
  it("every service file is published or excluded with a reason", () => {
    const published = new Set(MODULE_LIST.flatMap(publishedFiles));
    const undecided = serviceFiles().filter(
      (f) => !published.has(f) && !(f in MODULE_EXCLUSIONS)
    );
    expect(undecided).toEqual([]);
  });

  it("every exclusion names an existing service file and gives a reason", () => {
    for (const [file, reason] of Object.entries(MODULE_EXCLUSIONS)) {
      expect(fs.existsSync(path.join(MODULES_DIR, file)), file).toBe(true);
      expect(reason.length, file).toBeGreaterThan(20);
      const mod = file.split("/")[0];
      expect(
        MODULE_LIST.includes(mod) && publishedFiles(mod).includes(file),
        `${file} is both published and excluded`
      ).toBe(false);
    }
  });

  it("keeps workflows and agent off the tool surface", () => {
    const modules = new Set(metadata.tools.map((t) => t.module));
    expect(modules.has("workflows")).toBe(false);
    expect(modules.has("agent")).toBe(false);
  });
});

describe("runtime registry parity", () => {
  it("registers exactly the generator's modules", () => {
    expect(Object.keys(registryModules()).sort()).toEqual(
      [...MODULE_LIST].sort()
    );
  });

  it("each module's registry entry spreads exactly the files the generator scans", () => {
    const registry = registryModules();
    for (const mod of MODULE_LIST) {
      expect(registry[mod]?.sort(), mod).toEqual(publishedFiles(mod).sort());
    }
  });

  it("every published tool belongs to a registered module", () => {
    const registered = new Set(Object.keys(registryModules()));
    for (const t of metadata.tools) {
      expect(registered.has(t.module), t.name).toBe(true);
    }
  });
});
