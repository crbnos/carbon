// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";
import { readSource } from "./read-source";

// The default roots: the ERP's components, hooks, modules and routes, the MES
// app, and the source folders of the packages listed.
const TYPESCRIPT_ROOTS = [
  "apps/erp/app/components",
  "apps/erp/app/hooks",
  "apps/erp/app/modules",
  "apps/erp/app/routes",
  "apps/mes/app",
  "packages/database/supabase/functions",
  "packages/database/src",
  "packages/ee/src",
  "packages/jobs/src",
  "packages/documents/src/pdf",
  "packages/documents/src/utils",
  // Shared packages are in scope too: @carbon/utils is where the standard's own
  // helpers live (a local `round` shadow hid here), and form/react own the
  // number inputs whose formatOptions are part of the storage round-trip.
  "packages/utils/src",
  "packages/files/src",
  "packages/form/src",
  "packages/react/src",
  "packages/query/src",
  "packages/printing/src"
];

const EXCLUDED_DIRS = new Set(["node_modules"]);

// `*-test-fixture.ts` is test support code (live-database fixtures), not
// shipped code, so it is held to the same rules as the tests that import it.
export const isTest = (name: string) =>
  name.endsWith("-test-fixture.ts") ||
  name.endsWith(".test.ts") ||
  name.endsWith(".test.tsx") ||
  name.endsWith(".spec.ts") ||
  name.endsWith(".spec.tsx");

const isTypescript = (name: string) =>
  name.endsWith(".ts") || name.endsWith(".tsx");

function walk(dir: string, out: SourceFile[], repoRootDir: string) {
  // withFileTypes so the directory read already tells us what each entry is —
  // a stat() per entry over the whole app tree is the bulk of this walk.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out, repoRootDir);
    } else if (isTypescript(entry.name) && !isTest(entry.name)) {
      out.push({
        // Repo-relative path so baseline keys are machine-independent
        file: full.slice(repoRootDir.length + 1),
        contents: readSource(full)
      });
    }
  }
}

export function loadTypescriptFiles(
  root: string,
  roots: string[] = TYPESCRIPT_ROOTS
): SourceFile[] {
  const out: SourceFile[] = [];
  for (const dir of roots) {
    walk(join(root, dir), out, root);
  }
  return out;
}
