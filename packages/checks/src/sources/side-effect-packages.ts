// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";
import { loadTypescriptFiles } from "./typescript";

export type SideEffectPackage = {
  /** Repo-relative package directory, e.g. `apps/erp`. */
  dir: string;
  /** The package.json `sideEffects` value: `false` or a list of files. */
  sideEffects: false | string[];
  /** Every file under the package that exists, repo-relative. */
  paths: Set<string>;
  files: SourceFile[];
};

const PACKAGE_ROOTS = ["apps", "packages"];

/** Every workspace package whose package.json limits `sideEffects`. */
export function loadSideEffectPackages(root: string): SideEffectPackage[] {
  const packages: SideEffectPackage[] = [];
  for (const top of PACKAGE_ROOTS) {
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
