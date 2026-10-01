// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "libpg-query";
import type { Client } from "pg";

/**
 * The RLS and auth helper functions. `helpers/<name>.sql` is the only place each is
 * defined; migrations must not create or redefine them. Sync applies a file only when the
 * function it produces differs from the live one.
 */

export const HELPERS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "helpers"
);

export type Helper = { name: string; sql: string };

/**
 * Helpers that were managed here and have been dropped from the database (by a later
 * migration), each with the one generated migration that shipped its last definition.
 * `unshipped()` accepts a retired definition in that file only; in any other generated
 * migration it is reported, so no later file can bring the helper back. (`has_role` was
 * retired too, but no generated migration ever defined it.)
 */
const SECURITY_FIXES = "20260927172338_authz-security-fixes.sql";
export const RETIRED_HELPERS: Readonly<Record<string, string>> = {
  get_companies_with_permission: SECURITY_FIXES,
  get_permission_companies: SECURITY_FIXES,
  has_company_permission: SECURITY_FIXES
};

// biome-ignore lint/suspicious/noExplicitAny: libpg-query's AST is untyped JSON
type Ast = any;

/**
 * A helper file must be exactly one `CREATE OR REPLACE FUNCTION public.<name>(…)` — so a
 * file can never smuggle in a second statement, or define a function it is not named for.
 */
export async function validateHelper({ name, sql }: Helper): Promise<void> {
  const tree: Ast = await parse(sql);
  const statements = tree.stmts ?? [];
  const fn = statements[0]?.stmt?.CreateFunctionStmt;
  const qualified = (fn?.funcname ?? []).map((n: Ast) => n.String?.sval);
  if (
    statements.length !== 1 ||
    !fn ||
    !fn.replace ||
    fn.is_procedure ||
    qualified.join(".") !== `public.${name}`
  ) {
    throw new Error(
      `helpers/${name}.sql must be exactly one CREATE OR REPLACE FUNCTION public.${name}(…)`
    );
  }
}

export async function loadHelpers(dir = HELPERS_DIR): Promise<Helper[]> {
  const helpers = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      name: file.replace(/\.sql$/, ""),
      sql: readFileSync(path.join(dir, file), "utf8")
    }));
  for (const helper of helpers) await validateHelper(helper);
  return helpers;
}

const definitions = async (db: Client, name: string) =>
  (
    await db.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1
        ORDER BY p.oid`,
      [name]
    )
  ).rows.map((r) => r.def);

/**
 * Make every helper match its file. Must run inside the authz transaction. Each file is
 * applied in a savepoint and kept only if the function it produces differs from the live
 * one; a file that would add a second overload fails, since changing a signature (and
 * everything that depends on it) needs a reviewed migration.
 */
export async function syncHelpers(
  db: Client,
  helpers: Helper[],
  { dryRun }: { dryRun: boolean }
): Promise<string[]> {
  const changed: string[] = [];
  for (const { name, sql } of helpers) {
    const before = await definitions(db, name);
    if (before.length > 1) {
      throw new Error(
        `helper ${name} has ${before.length} overloads; expected one`
      );
    }
    await db.query("SAVEPOINT authz_helper");
    await db.query(sql);
    const after = await definitions(db, name);
    if (after.length !== 1) {
      await db.query("ROLLBACK TO SAVEPOINT authz_helper");
      throw new Error(
        `helpers/${name}.sql changes the signature of ${name}; that needs a migration`
      );
    }
    const differs = after[0] !== before[0];
    if (differs) changed.push(name);
    await db.query(
      differs && !dryRun
        ? "RELEASE SAVEPOINT authz_helper"
        : "ROLLBACK TO SAVEPOINT authz_helper"
    );
  }
  return changed;
}
