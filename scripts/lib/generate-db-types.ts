import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

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

function validateTypes(source: string): void {
  if (!source.trim())
    throw new Error("Database type generation produced empty output.");
  const parsed = ts.createSourceFile(
    "types.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const result = ts.transpileModule(source, { reportDiagnostics: true });
  const hasDatabase = parsed.statements.some(
    (statement) =>
      (ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)) &&
      statement.name.text === "Database" &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      )
  );
  if (
    result.diagnostics?.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
    ) ||
    !hasDatabase
  ) {
    throw new Error(
      "Database type generation did not produce valid TypeScript with an exported Database type."
    );
  }
}

// Runtime-created per-tenant tables depend on locally seeded companies. Keep
// the existing filter while validating both the original and normalized output.
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
        while (j < lines.length && !/^\s*\},?$/.test(lines[j])) entry.push(lines[j++]);
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
      out.push(...entry.slice(0, -1), index < entries.length - 1 ? `${last},` : last);
    });
    out.push(closing);
    i = j;
  }
  return out.join("\n");
}

type StagedOutput = {
  target: string;
  directory: string;
  candidate: string;
  backup: string;
  existed: boolean;
  replaced: boolean;
};

export function generateDatabaseTypes(databaseUrl: string | undefined): void {
  const dbUrl = validateDatabaseUrl(databaseUrl);
  const targets = [
    resolve("packages/database/src/types.ts"),
    resolve("packages/database/supabase/functions/lib/types.ts")
  ];
  const staged: StagedOutput[] = [];
  let preserveBackups = false;
  try {
    for (const target of targets) {
      const directory = mkdtempSync(join(dirname(target), ".db-types-"));
      const entry = {
        target,
        directory,
        candidate: join(directory, "types.ts"),
        backup: join(directory, "previous.ts"),
        existed: existsSync(target),
        replaced: false
      };
      staged.push(entry);
      if (entry.existed) copyFileSync(target, entry.backup);
    }
    const first = staged[0];
    if (!first)
      throw new Error("Database type generation has no output destination.");
    const out = openSync(first.candidate, "wx");
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
    const source = readFileSync(first.candidate, "utf8");
    validateTypes(source);
    const normalized = sortRelationships(stripPerTenantTables(source));
    validateTypes(normalized);
    for (const entry of staged) writeFileSync(entry.candidate, normalized);
    try {
      for (const entry of staged) {
        renameSync(entry.candidate, entry.target);
        entry.replaced = true;
      }
    } catch {
      const failedRollbacks: string[] = [];
      for (const entry of staged.toReversed()) {
        if (!entry.replaced) continue;
        try {
          if (entry.existed) renameSync(entry.backup, entry.target);
          else rmSync(entry.target);
        } catch {
          failedRollbacks.push(entry.backup);
        }
      }
      if (failedRollbacks.length) {
        preserveBackups = true;
        throw new Error(
          `Database type replacement and rollback failed. Recover the previous files from: ${failedRollbacks.join(", ")}`
        );
      }
      throw new Error(
        "Database type replacement failed; both previous output files were preserved."
      );
    }
  } finally {
    if (!preserveBackups) {
      for (const entry of staged)
        rmSync(entry.directory, { recursive: true, force: true });
    }
  }
}
