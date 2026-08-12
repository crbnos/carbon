import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SqlFile } from "./migrations";

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
  "packages/documents/src/utils"
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

function walk(dir: string, out: SqlFile[], repoRootDir: string) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out, repoRootDir);
    } else if (isTypescript(entry) && !isTest(entry)) {
      out.push({
        // Repo-relative path so baseline keys are machine-independent
        file: full.slice(repoRootDir.length + 1),
        contents: readFileSync(full, "utf8")
      });
    }
  }
}

export function loadTypescriptFiles(root: string): SqlFile[] {
  const out: SqlFile[] = [];
  for (const dir of TYPESCRIPT_ROOTS) {
    walk(join(root, dir), out, root);
  }
  return out;
}
