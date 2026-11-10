// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

// A bare import (`import "./x"`) runs a file for what it does, not for what it
// exports. In a package whose package.json says `"sideEffects": false`, or
// lists only some files, the production bundler drops a bare import of any file
// it does not list: `import "./modules/carbon.server"` vanished from the ERP's
// server bundle, so every `carbon()` call threw "the app has not called
// registerCarbon", and `z.config({ jitless: true })` never ran in either app.
// Typecheck, tests and the dev server (which does not tree-shake) cannot see it.
export const SIDE_EFFECT_IMPORT_DECLARED = "side-effect-import-declared";

export type SideEffectPackage = {
  /** Repo-relative package directory, e.g. `apps/erp`. */
  dir: string;
  /** The package.json `sideEffects` value: `false` or a list of files. */
  sideEffects: false | string[];
  /** Every file under the package that exists, repo-relative. */
  paths: Set<string>;
  files: SourceFile[];
};

const BARE_IMPORT = /^import\s+["']([^"']+)["'];?\s*$/gm;
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

const toRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/^\.\//, "")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\/?/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, ".*")}$`
  );

/** Whether a package-relative file is listed by `sideEffects` (webpack's rules). */
export function declaresSideEffects(
  sideEffects: false | string[],
  file: string
): boolean {
  if (sideEffects === false) return false;
  return sideEffects.some((pattern) =>
    toRegExp(pattern).test(
      pattern.replace(/^\.\//, "").includes("/")
        ? file
        : file.slice(file.lastIndexOf("/") + 1)
    )
  );
}

function resolve(pkg: SideEffectPackage, from: string, spec: string) {
  let base: string;
  if (spec.startsWith("~/")) base = `${pkg.dir}/app/${spec.slice(2)}`;
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    const parts = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    base = parts.join("/");
  } else return null; // another package: its own sideEffects decide
  for (const ext of EXTENSIONS) {
    if (pkg.paths.has(base + ext)) return base + ext;
  }
  return null;
}

export function findUndeclaredSideEffectImports(
  packages: SideEffectPackage[]
): Violation[] {
  const violations: Violation[] = [];
  for (const pkg of packages) {
    for (const { file, contents } of pkg.files) {
      for (const match of contents.matchAll(BARE_IMPORT)) {
        const spec = match[1]!;
        if (spec.endsWith(".css")) continue;
        const target = resolve(pkg, file, spec);
        if (!target) continue;
        const relative = target.slice(pkg.dir.length + 1);
        if (declaresSideEffects(pkg.sideEffects, relative)) continue;
        violations.push({
          file,
          line: contents.slice(0, match.index).split("\n").length,
          snippet: spec,
          message: `"${spec}" is imported for its side effects, but ${pkg.dir}/package.json does not list "./${relative}" in "sideEffects", so the production build drops it. Add it there.`
        });
      }
    }
  }
  return violations;
}
