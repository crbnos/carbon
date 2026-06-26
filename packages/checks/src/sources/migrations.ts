import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SqlFile = { file: string; contents: string };

const MIGRATIONS_REL = "packages/database/supabase/migrations";

/**
 * Repo root, resolved from this source file (not cwd) so checks run correctly
 * from any working directory. This file is packages/checks/src/sources/ → 4 up.
 */
export function repoRoot(): string {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  if (!existsSync(join(root, MIGRATIONS_REL))) {
    throw new Error(
      `Could not locate repo root from ${import.meta.url} (resolved ${root}); ${MIGRATIONS_REL} not found.`
    );
  }
  return root;
}

export function migrationsDir(root: string): string {
  return join(root, MIGRATIONS_REL);
}

export function loadSqlFiles(dir: string): SqlFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, contents: readFileSync(join(dir, f), "utf8") }));
}
