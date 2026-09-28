import { parse } from "libpg-query";
import type { Client } from "pg";
import { type Helper, loadHelpers, syncHelpers } from "./helpers";
import { type AnyRule, type Manifest, render } from "./rules";

export type Policy = {
  policyname: string;
  permissive: string;
  roles: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

/**
 * Per-company tables created at runtime (`searchIndex_<companyId>`, `auditLog_<companyId>`).
 * The function that creates each one also creates its policies; sync leaves them alone.
 */
export const DYNAMIC_TABLE_PREFIXES = ["searchIndex_", "auditLog_"];

// Never committed: it only exists inside a savepoint that is always rolled back.
const SCRATCH = "authz_scratch";
const SYNC_LOCK = "carbon.authz.sync";

const rulesOf = (manifest: Manifest) =>
  Object.entries(manifest) as [string, AnyRule][];

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

export const readPolicies = async (db: Client, schema: string, table: string) =>
  (
    await db.query<Policy>(
      `SELECT policyname, permissive, roles::text AS roles, cmd, qual, with_check
         FROM pg_policies
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY policyname`,
      [schema, table]
    )
  ).rows;

const rlsEnabled = async (db: Client, table: string) =>
  (
    await db.query<{ enabled: boolean }>(
      `SELECT relrowsecurity AS enabled FROM pg_class
        WHERE oid = to_regclass(format('public.%I', $1::text))`,
      [table]
    )
  ).rows[0]?.enabled ?? false;

/**
 * Rendered policy SQL may only create policies on the table it is rendered for. Checked
 * with Postgres's own parser before anything runs, so a `custom` entry (or a rendering
 * bug) cannot drop a table, grant a role, or touch another table's policies.
 */
export async function assertOnlyPolicies(
  sql: string,
  schema: string,
  table: string
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: libpg-query's AST is untyped JSON
  const tree: any = await parse(sql);
  for (const { stmt } of tree.stmts ?? []) {
    const target = stmt?.CreatePolicyStmt?.table;
    if (target?.schemaname !== schema || target?.relname !== table) {
      throw new Error(
        `authz: the rule for "${table}" may only CREATE POLICY on ${schema}.${table}`
      );
    }
  }
}

/**
 * The policies each rule produces, as Postgres stores and prints them: rendered into a
 * scratch copy of every table inside a savepoint that is always rolled back. Must run
 * inside a transaction whose search_path is `public`, so both sides print identically.
 */
export async function desiredPolicies(db: Client, manifest: Manifest) {
  // An Error when the rule cannot apply to the table (e.g. `company` on a table with no
  // companyId): a savepoint per table keeps one bad rule from hiding the rest.
  const desired = new Map<string, Policy[] | Error>();
  await db.query("SAVEPOINT authz_scratch");
  try {
    await db.query(`CREATE SCHEMA ${ident(SCRATCH)}`);
    for (const [table, rule] of rulesOf(manifest)) {
      await db.query("SAVEPOINT authz_rule");
      try {
        await db.query(
          `CREATE TABLE ${ident(SCRATCH)}.${ident(table)} (LIKE public.${ident(table)})`
        );
        const sql = render(rule, table, SCRATCH);
        if (sql) {
          await assertOnlyPolicies(sql, SCRATCH, table);
          await db.query(sql);
        }
        desired.set(table, await readPolicies(db, SCRATCH, table));
        await db.query("RELEASE SAVEPOINT authz_rule");
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT authz_rule");
        desired.set(
          table,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT authz_scratch");
  }
  return desired;
}

/**
 * Run `work` in one transaction set up for authz: serialized against other syncs, public
 * search_path, short lock timeout. Everything is transaction-scoped, so it behaves the
 * same through a transaction-mode connection pooler.
 */
export async function inAuthzTransaction<T>(
  db: Client,
  work: () => Promise<T>,
  { commit }: { commit: boolean }
): Promise<T> {
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SYNC_LOCK]);
    await db.query("SET LOCAL search_path = public");
    await db.query("SET LOCAL lock_timeout = '5s'");
    const result = await work();
    await db.query(commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

export type SyncResult = {
  /** Helper functions whose live definition differed from helpers/<name>.sql. */
  helpers: string[];
  /** Tables whose live policies differed from the manifest (rewritten unless dryRun). */
  changed: string[];
  /** Public tables the manifest does not cover. */
  unmanaged: string[];
};

/**
 * Make every manifest table's policies exactly what the manifest renders, in one
 * transaction: every change lands or none does. A table that differs has every existing
 * policy dropped (whatever its name), RLS enabled, and the rendered policies created.
 */
export async function syncAuthz(
  db: Client,
  manifest: Manifest,
  { dryRun = false, helpers }: { dryRun?: boolean; helpers?: Helper[] } = {}
): Promise<SyncResult> {
  const managedHelpers = helpers ?? (await loadHelpers());
  return inAuthzTransaction(
    db,
    async () => {
      // Helpers first: the policies below call them.
      const changedHelpers = await syncHelpers(db, managedHelpers, { dryRun });
      const desired = await desiredPolicies(db, manifest);
      const invalid = [...desired].filter(([, want]) => want instanceof Error);
      if (invalid.length) {
        throw new Error(
          `authz rules that do not apply (nothing was changed):\n${invalid
            .map(([table, error]) => `  ${table}: ${(error as Error).message}`)
            .join("\n")}`
        );
      }

      const changed: string[] = [];
      for (const [table, rule] of rulesOf(manifest)) {
        const live = await readPolicies(db, "public", table);
        const same =
          JSON.stringify(live) === JSON.stringify(desired.get(table)) &&
          (await rlsEnabled(db, table));
        if (same) continue;

        changed.push(table);
        if (dryRun) continue;

        for (const policy of live) {
          await db.query(
            `DROP POLICY ${ident(policy.policyname)} ON public.${ident(table)}`
          );
        }
        await db.query(
          `ALTER TABLE public.${ident(table)} ENABLE ROW LEVEL SECURITY`
        );
        const sql = render(rule, table);
        if (sql) {
          await assertOnlyPolicies(sql, "public", table);
          await db.query(sql);
        }
      }

      const unmanaged = (
        await db.query<{ table: string }>(
          `SELECT relname AS table FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')
              AND NOT (relname = ANY ($1::text[]))
              AND NOT (relname LIKE ANY ($2::text[]))
            ORDER BY 1`,
          [
            Object.keys(manifest),
            DYNAMIC_TABLE_PREFIXES.map((p) => `${p.replaceAll("_", "\\_")}%`)
          ]
        )
      ).rows.map((r) => r.table);

      return { helpers: changedHelpers, changed, unmanaged };
    },
    { commit: !dryRun }
  );
}
