// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "libpg-query";
import type { Client } from "pg";

/**
 * The managed functions: the RLS and auth helpers (`helpers/<name>.sql`) and the event
 * system's functions (`../event-system/functions/<name>.sql`). Each file is the only place
 * its function is defined; migrations must not create or redefine one. Sync applies a file
 * only when the function it produces differs from the live one.
 *
 * A file is named for its function. One outside `public` carries its schema:
 * `util.wake_event_queue.sql`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HELPERS_DIR = path.join(HERE, "helpers");
export const EVENT_SYSTEM_DIR = path.join(HERE, "../event-system/functions");
/** The functions attachments.ts attaches to tables: interceptors and statement handlers. */
export const EVENT_HANDLERS_DIR = path.join(HERE, "../event-system/handlers");
export const HELPER_DIRS = [HELPERS_DIR, EVENT_SYSTEM_DIR, EVENT_HANDLERS_DIR];

/** `schema` defaults to `public`. */
export type Helper = { name: string; sql: string; schema?: string };

export const helperSchema = (helper: Helper) => helper.schema ?? "public";

/** How a helper is named everywhere it is reported: `name`, or `schema.name` outside public. */
export const helperKey = (helper: Helper) =>
  helperSchema(helper) === "public"
    ? helper.name
    : `${helperSchema(helper)}.${helper.name}`;

/**
 * Helpers that were managed here and have been dropped from the database (by a later
 * migration), keyed like `helperKey`, each with the one generated migration that shipped
 * its last definition.
 * `unshipped()` accepts a retired definition in that file only; in any other generated
 * migration it is reported, so no later file can bring the helper back. (`has_role` was
 * retired too, but no generated migration ever defined it.)
 */
const SECURITY_FIXES = "20260927172338_authz-security-fixes.sql";
const EVENT_SYSTEM_TAKEOVER = "20261002114954_event-system-functions.sql";
export const RETIRED_HELPERS: Readonly<Record<string, string>> = {
  get_companies_with_permission: SECURITY_FIXES,
  get_permission_companies: SECURITY_FIXES,
  has_company_permission: SECURITY_FIXES,
  "util.anon_key": EVENT_SYSTEM_TAKEOVER,
  "util.invoke_edge_function": EVENT_SYSTEM_TAKEOVER,
  "util.process_embeddings": EVENT_SYSTEM_TAKEOVER
};

// biome-ignore lint/suspicious/noExplicitAny: libpg-query's AST is untyped JSON
type Ast = any;

/**
 * A helper file must be exactly one `CREATE OR REPLACE FUNCTION <schema>.<name>(…)` — so a
 * file can never smuggle in a second statement, or define a function it is not named for.
 */
export async function validateHelper(helper: Helper): Promise<void> {
  const { sql } = helper;
  const expected = `${helperSchema(helper)}.${helper.name}`;
  const tree: Ast = await parse(sql);
  const statements = tree.stmts ?? [];
  const fn = statements[0]?.stmt?.CreateFunctionStmt;
  const qualified = (fn?.funcname ?? []).map((n: Ast) => n.String?.sval);
  if (
    statements.length !== 1 ||
    !fn ||
    !fn.replace ||
    fn.is_procedure ||
    qualified.join(".") !== expected
  ) {
    throw new Error(
      `${helperKey(helper)}.sql must be exactly one CREATE OR REPLACE FUNCTION ${expected}(…)`
    );
  }
}

/** `name.sql` is public.name; `schema.name.sql` is schema.name. */
const parseFileName = (file: string) => {
  const [first = "", second] = file.replace(/\.sql$/, "").split(".");
  return second ? { schema: first, name: second } : { name: first };
};

export async function loadHelpers(
  dirs: string | string[] = HELPER_DIRS
): Promise<Helper[]> {
  const helpers = [dirs].flat().flatMap((dir) =>
    readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => ({
        ...parseFileName(file),
        sql: readFileSync(path.join(dir, file), "utf8")
      }))
  );
  for (const helper of helpers) await validateHelper(helper);
  return calleesFirst(helpers);
}

/**
 * The helpers in file order, except that each comes after the helpers it calls:
 * Postgres checks a SQL-language body when the function is created, so a
 * migration or a sync on a database without the callee would fail.
 */
export function calleesFirst(helpers: Helper[]): Helper[] {
  const calls = (caller: Helper, callee: Helper) => {
    if (caller === callee) return false;
    const name =
      helperSchema(callee) === "public"
        ? String.raw`(?<![\w.])(?:public\.)?${callee.name}`
        : String.raw`(?<![\w.])${helperSchema(callee)}\.${callee.name}`;
    const body = caller.sql.slice(caller.sql.indexOf("$function$"));
    return new RegExp(String.raw`${name}\s*\(`).test(body);
  };
  const done = new Set<Helper>();
  const visiting = new Set<Helper>();
  const ordered: Helper[] = [];
  const visit = (helper: Helper) => {
    if (done.has(helper) || visiting.has(helper)) return;
    visiting.add(helper);
    for (const callee of helpers) if (calls(helper, callee)) visit(callee);
    visiting.delete(helper);
    done.add(helper);
    ordered.push(helper);
  };
  for (const helper of helpers) visit(helper);
  return ordered;
}

const definitions = async (db: Client, helper: Helper) =>
  (
    await db.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.proname = $2
        ORDER BY p.oid`,
      [helperSchema(helper), helper.name]
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
  for (const helper of helpers) {
    const name = helperKey(helper);
    const before = await definitions(db, helper);
    if (before.length > 1) {
      throw new Error(
        `helper ${name} has ${before.length} overloads; expected one`
      );
    }
    await db.query("SAVEPOINT authz_helper");
    await db.query(helper.sql);
    const after = await definitions(db, helper);
    if (after.length !== 1) {
      await db.query("ROLLBACK TO SAVEPOINT authz_helper");
      throw new Error(
        `${name}.sql changes the signature of ${name}; that needs a migration`
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
