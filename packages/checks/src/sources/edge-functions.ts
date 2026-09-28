import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SourceFile } from "../check";

const FUNCTIONS_ROOT = "packages/database/supabase/functions";

/** Shared code, not deployable functions. */
const NOT_FUNCTIONS = new Set(["lib", "shared", "node_modules"]);

function collectTs(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collectTs(path, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(path);
    }
  }
}

/**
 * One SourceFile per deployable edge function: every directory with an
 * index.ts deploys, config.toml entry or not. Its contents are all of the
 * function's own .ts files joined, because a function's auth call can live
 * beside index.ts (post-card-transaction/handler.ts).
 */
export function loadEdgeFunctions(root: string): SourceFile[] {
  const base = join(root, FUNCTIONS_ROOT);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter(
      (name) =>
        !NOT_FUNCTIONS.has(name) && existsSync(join(base, name, "index.ts"))
    )
    .sort()
    .map((name) => {
      const paths: string[] = [];
      collectTs(join(base, name), paths);
      return {
        file: relative(root, join(base, name)),
        contents: paths
          .sort()
          .map((path) => readFileSync(path, "utf8"))
          .join("\n")
      };
    });
}
