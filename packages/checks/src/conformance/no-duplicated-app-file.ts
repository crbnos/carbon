// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

// ERP and MES grew the same components and hooks by copying them, so a fix
// landed in one app and not the other — the login route's lost redirect was
// copied along with the route. A file needed by both lives in a package
// (@carbon/react, @carbon/auth, @carbon/utils); each app may keep a file of
// that name that only re-exports it.
export const NO_DUPLICATED_APP_FILE = "no-duplicated-app-file";

export const SHARED_APP_DIRS = [
  "apps/erp/app/components",
  "apps/erp/app/hooks",
  "apps/mes/app/components",
  "apps/mes/app/hooks"
];

// Names every folder has; they hold different things in each app.
const GENERIC = new Set(["index.ts", "index.tsx", "types.ts", "utils.ts"]);

const RE_EXPORT_ONLY =
  /^(?:\s*\/\/[^\n]*\n|\s*\n|\s*export\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["'][^"']+["'];?\s*\n?)*$/;

const appOf = (file: string) => file.split("/")[1];
const nameOf = (file: string) => file.slice(file.lastIndexOf("/") + 1);

export function findDuplicatedAppFiles(files: SourceFile[]): Violation[] {
  const byName = new Map<string, SourceFile[]>();
  for (const source of files) {
    const name = nameOf(source.file);
    if (GENERIC.has(name) || /\.test\.tsx?$/.test(name)) continue;
    if (RE_EXPORT_ONLY.test(source.contents)) continue;
    byName.set(name, [...(byName.get(name) ?? []), source]);
  }

  const violations: Violation[] = [];
  for (const [name, sources] of byName) {
    if (new Set(sources.map((s) => appOf(s.file))).size < 2) continue;
    violations.push({
      file: name,
      line: 0,
      snippet: sources.map((s) => s.file).join(" + "),
      message: `${name} exists in both apps; move it to a shared package and re-export it`
    });
  }
  return violations;
}
