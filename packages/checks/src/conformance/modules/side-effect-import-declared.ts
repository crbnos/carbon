// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineCheck, type SourceFile, type Violation } from "../../check";
import { lineOf } from "../../sources/text";
import { loadTypescriptFiles } from "../../sources/typescript";

// A bare import (`import "./x"`) runs a file for what it does, not for what it
// exports. In a package whose package.json says `"sideEffects": false`, or
// lists only some files, the production bundler drops a bare import of any file
// it does not list: `import "./modules/carbon.server"` vanished from the ERP's
// server bundle, so every `carbon()` call threw "the app has not called
// registerCarbon", and `z.config({ jitless: true })` never ran in either app.
// Typecheck, tests and the dev server (which does not tree-shake) cannot see it.
//
// Only a bare import of a file in the importer's own package is checked
// (`./x`, `../x`, `~/x`). A bare import of another package is left to that
// package's own `sideEffects`. A `.css` import is ignored.
export const sideEffectImportDeclared = defineCheck({
  id: "side-effect-import-declared",
  description:
    'In a package whose package.json says `"sideEffects": false`, or lists only some files, the production bundler drops a bare import of any file it does not list.',
  reads: {
    // Every workspace package whose package.json limits `sideEffects`.
    packages: (root) => {
      const packages: {
        /** Repo-relative, e.g. `apps/erp`. */
        dir: string;
        sideEffects: false | string[];
        /** Every non-test TypeScript file under the package, repo-relative. */
        paths: Set<string>;
        files: SourceFile[];
      }[] = [];
      for (const top of ["apps", "packages"]) {
        if (!existsSync(join(root, top))) continue;
        for (const name of readdirSync(join(root, top))) {
          const manifest = join(root, top, name, "package.json");
          if (!existsSync(manifest)) continue;
          const { sideEffects } = JSON.parse(readFileSync(manifest, "utf8"));
          if (sideEffects !== false && !Array.isArray(sideEffects)) continue;
          const dir = `${top}/${name}`;
          const files = loadTypescriptFiles(root, [dir]);
          packages.push({
            dir,
            sideEffects,
            paths: new Set(files.map((f) => f.file)),
            files
          });
        }
      }
      return packages;
    }
  },
  rule() {
    const bareImport = /^import\s+["']([^"']+)["'];?\s*$/gm;
    const extensions = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

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
    function declaresSideEffects(
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

    function resolve(
      pkg: { dir: string; paths: Set<string> },
      from: string,
      spec: string
    ) {
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
      for (const ext of extensions) {
        if (pkg.paths.has(base + ext)) return base + ext;
      }
      return null;
    }

    return ({ packages }) => {
      const violations: Violation[] = [];
      for (const pkg of packages) {
        for (const { file, contents } of pkg.files) {
          for (const match of contents.matchAll(bareImport)) {
            const spec = match[1] ?? "";
            if (spec.endsWith(".css")) continue;
            const target = resolve(pkg, file, spec);
            if (!target) continue;
            const relative = target.slice(pkg.dir.length + 1);
            if (declaresSideEffects(pkg.sideEffects, relative)) continue;
            violations.push({
              file,
              line: lineOf(contents, match.index),
              snippet: spec,
              message: `"${spec}" is imported for its side effects, but ${pkg.dir}/package.json does not list "./${relative}" in "sideEffects", so the production build drops it. Add it there.`
            });
          }
        }
      }
      return violations;
    };
  }
});
