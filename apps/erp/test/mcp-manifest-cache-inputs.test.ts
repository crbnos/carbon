// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The tool manifest is CACHED by turbo (`//#generate:mcp` in the root
// turbo.json), keyed on a list of input globs. A file the generator reads that
// is missing from that list is how a stale manifest ships: turbo sees nothing
// changed, restores the old output, and the app validates requests against a
// schema the code no longer has.
//
// The generator reads each published service function's TYPE, from the
// `<module>.server.ts` files the router imports: their inputs are validators
// from `*.models.ts` or a package (`@carbon/ee`), and whatever those import
// can change a schema (an enum array in `sales.utils.ts`, a helper in
// `@carbon/utils`). This pins every import of both to the cache inputs.
const ROOT = resolve(__dirname, "../../..");
const APP = join(ROOT, "apps/erp/app");
const MODULES = join(APP, "modules");

const inputs: string[] = JSON.parse(
  readFileSync(join(ROOT, "turbo.json"), "utf8")
).tasks["//#generate:mcp"].inputs;
const covered = (file: string) =>
  inputs.some((glob) => matchesGlob(relative(ROOT, file), glob));

// @carbon/* → its directory, from the workspace's own package.json files.
const packageDirs = new Map<string, string>();
for (const dir of [
  ...readdirSync(join(ROOT, "packages")).map((d) => join(ROOT, "packages", d)),
  join(ROOT, "docs/content")
]) {
  const manifest = join(dir, "package.json");
  if (existsSync(manifest)) {
    packageDirs.set(JSON.parse(readFileSync(manifest, "utf8")).name, dir);
  }
}

/** The repo file an import lands on, or null for a third-party package. */
function resolveImport(from: string, specifier: string): string | null {
  const onDisk = (base: string) =>
    [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base].find(
      (candidate) => existsSync(candidate) && !candidate.endsWith("/")
    ) ?? `${base}.ts`;

  if (specifier.startsWith(".")) return onDisk(resolve(dirname(from), specifier));
  if (specifier.startsWith("~/")) return onDisk(join(APP, specifier.slice(2)));
  const scoped = /^(@carbon\/[^/]+)/.exec(specifier)?.[1];
  const dir = scoped ? packageDirs.get(scoped) : undefined;
  // Any file under the package's source stands for the package.
  return dir ? join(dir, "src/index.ts") : null;
}

const moduleDirs = readdirSync(MODULES, { withFileTypes: true }).filter(
  (entry) => entry.isDirectory()
);
const modelsFiles = moduleDirs.flatMap(({ name: module }) =>
  readdirSync(join(MODULES, module))
    .filter((file) => file.endsWith(".models.ts"))
    .map((file) => join(MODULES, module, file))
);
const serverFiles = moduleDirs
  .map(({ name: module }) => join(MODULES, module, `${module}.server.ts`))
  .filter((file) => existsSync(file));

describe("the manifest cache inputs", () => {
  it("found the models and server files", () => {
    expect(modelsFiles.length).toBeGreaterThan(10);
    expect(serverFiles.length).toBeGreaterThan(10);
  });

  it("cover every file a models or server file imports", () => {
    const missing: string[] = [];
    for (const file of [...modelsFiles, ...serverFiles]) {
      if (!covered(file)) missing.push(relative(ROOT, file));
      for (const { fileName } of ts.preProcessFile(readFileSync(file, "utf8"))
        .importedFiles) {
        const target = resolveImport(file, fileName);
        if (target && !covered(target)) {
          missing.push(
            `${relative(ROOT, target)}  (imported by ${relative(ROOT, file)})`
          );
        }
      }
    }
    expect(
      missing,
      "add these to the //#generate:mcp inputs in turbo.json (and to the manifest trigger in scripts/git-hooks/pre-commit)"
    ).toEqual([]);
  });
});
