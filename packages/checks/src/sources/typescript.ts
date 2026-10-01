// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";

// Directories the numeric-precision checks cover: everywhere app code does
// arithmetic or builds number formatters. The two image functions are pure
// binary plumbing and the resizers' `Math.round` is pixel geometry.
const TYPESCRIPT_ROOTS = [
  "apps/erp/app/components",
  "apps/erp/app/hooks",
  "apps/erp/app/modules",
  "apps/erp/app/routes",
  "apps/mes/app",
  "packages/database/supabase/functions",
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
  "packages/printing/src"
  // (workflows source now lives under packages/ee/src, already scanned above)
];

const EXCLUDED_DIRS = new Set(["node_modules"]);

const isTest = (name: string) =>
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
        contents: readFileSync(full, "utf8")
      });
    }
  }
}

// Every app and every package that handles a request: no-raw-forwarded-headers
// covers auth and the smaller apps, which the numeric checks do not.
export const REQUEST_HANDLING_ROOTS = [
  "apps/erp/app",
  "apps/mes/app",
  "apps/academy/app",
  "apps/starter/app",
  "packages/auth/src",
  "packages/database/supabase/functions",
  "packages/ee/src",
  "packages/jobs/src",
  "packages/lib/src",
  "packages/utils/src"
];

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
