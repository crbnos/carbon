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
  "packages/form/src",
  "packages/react/src",
  "packages/printing/src",
  "packages/workflows/src"
];

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "image-resizer",
  "logo-resizer"
]);

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

export function loadTypescriptFiles(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const dir of TYPESCRIPT_ROOTS) {
    walk(join(root, dir), out, root);
  }
  return out;
}
