import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";

function validateDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Configure the local database before generating types."
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SUPABASE_DB_URL must be a valid local PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.searchParams.has("host") ||
    url.searchParams.has("hostaddr")
  ) {
    // Never include the URL: even a redacted password can leave private hosts,
    // usernames or query parameters in output copied into public run logs.
    throw new Error(
      "Refusing to generate types: SUPABASE_DB_URL must use a local PostgreSQL host."
    );
  }
  return value;
}

// Strip per-tenant `searchIndex_<companyId>` / `auditLog_<companyId>` tables.
// They are created at runtime per company, so which ones exist depends on the
// local DB's seeded companies — committing them makes types.ts
// machine-dependent. The static `searchIndexRegistry` / `auditLogArchive`
// tables (no underscore) are unaffected.
function stripPerTenantTables(source: string): string {
  const lines: string[] = [];
  let skipping = false;
  for (const line of source.split("\n")) {
    if (
      !skipping &&
      /^      (searchIndex|auditLog)_[A-Za-z0-9]+: \{$/.test(line)
    ) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line === "      }") skipping = false;
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// `supabase gen types` emits a table's `Relationships` entries in catalog order,
// which is not stable across databases built from the same migrations (two
// foreign keys to the same table swap places between runs). Sort each block's
// entries by their text so the output is a pure function of the schema and the
// generated-files drift check can compare it byte for byte.
export function sortRelationships(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    if (!/^\s*Relationships: \[$/.test(line)) continue;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const entries: string[][] = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== `${indent}]`) {
      if (lines[j] === `${indent}  {`) {
        const entry = [lines[j]];
        j++;
        while (j < lines.length && !/^\s*\},?$/.test(lines[j]))
          entry.push(lines[j++]);
        entry.push(lines[j]);
        entries.push(entry);
      }
      j++;
    }
    if (j >= lines.length) continue;
    const closing = lines[j];
    entries.sort((a, b) => {
      const ka = a.slice(1, -1).join("\n");
      const kb = b.slice(1, -1).join("\n");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    entries.forEach((entry, index) => {
      const last = entry[entry.length - 1].replace(/,$/, "");
      out.push(
        ...entry.slice(0, -1),
        index < entries.length - 1 ? `${last},` : last
      );
    });
    out.push(closing);
    i = j;
  }
  return out.join("\n");
}

export function generateDatabaseTypes(databaseUrl: string | undefined): void {
  const dbUrl = validateDatabaseUrl(databaseUrl);
  const targets = [
    resolve("packages/database/src/types.ts"),
    resolve("packages/database/supabase/functions/lib/types.ts")
  ];
  const directory = mkdtempSync(join(dirname(targets[0]!), ".db-types-"));
  try {
    const candidate = join(directory, "types.ts");
    const out = openSync(candidate, "wx");
    try {
      // File-backed stdout avoids truncating large schemas or a maxBuffer cap.
      // Do not inherit stderr: CLI failures can echo the credential-bearing URL.
      const result = spawnSync(
        "supabase",
        [
          "gen",
          "types",
          "typescript",
          "--db-url",
          dbUrl,
          "--schema",
          "public",
          "--schema",
          "storage",
          "--schema",
          "graphql_public"
        ],
        { stdio: ["ignore", out, "pipe"] }
      );
      if (result.error || result.status !== 0) {
        const status =
          result.status === null
            ? "could not complete"
            : `exited ${result.status}`;
        throw new Error(
          `Supabase type generation ${status}; existing type files were preserved.`
        );
      }
    } finally {
      closeSync(out);
    }
    const normalized = sortRelationships(
      stripPerTenantTables(readFileSync(candidate, "utf8"))
    );
    if (!/^export type Database\b/m.test(normalized)) {
      throw new Error(
        "Database type generation did not produce an exported Database type; existing type files were preserved."
      );
    }
    for (const target of targets) {
      const staged = join(directory, "staged.ts");
      writeFileSync(staged, normalized);
      renameSync(staged, target);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
