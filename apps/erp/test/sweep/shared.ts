// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What the read and write sweeps share: the company and user they run as, the
// schema they plan arguments from, and the guards around a call.

import { readdirSync } from "node:fs";
import path from "node:path";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import type { Column } from "./inputs";

const MIGRATIONS = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../packages/database/supabase/migrations"
);
export const CALL_TIMEOUT_MS = 30_000;

type Db = Kysely<KyselyDatabase>;

export async function target(db: Db) {
  const companyId = process.env.SWEEP_COMPANY_ID;
  const userId = process.env.SWEEP_USER_ID;
  if (companyId && userId) return { companyId, userId };

  // The dev seed's own user, in whichever of its companies has the most data.
  const email = process.env.DEV_BYPASS_EMAIL;
  if (!email) {
    throw new Error(
      "Set SWEEP_COMPANY_ID and SWEEP_USER_ID, or DEV_BYPASS_EMAIL for a seeded stack."
    );
  }
  const found = await sql<{ userId: string; companyId: string }>`
    select u."id" as "userId", m."companyId"
    from "user" u
    join "userToCompany" m on m."userId" = u."id" and m."role" = 'employee'
    where u."email" = ${email}
    order by (select count(*) from "item" i where i."companyId" = m."companyId") desc
    limit 1`.execute(db);
  const row = found.rows[0];
  if (!row) throw new Error(`No employee membership found for ${email}.`);
  return row;
}

export async function companyGroupOf(db: Db, companyId: string) {
  const company = await sql<{ companyGroupId: string }>`
    select "companyGroupId" from "company" where "id" = ${companyId}`.execute(db);
  const companyGroupId = company.rows[0]?.companyGroupId;
  if (!companyGroupId) {
    // Dispatching with no group would fail the group-scoped tools for a
    // reason that is the setup's, and a person could then baseline them.
    throw new Error(`Company ${companyId} not found, or it has no company group.`);
  }
  return companyGroupId;
}

/** Every public column with its type, and the first label of every enum. */
export async function loadSchema(db: Db) {
  const columns = await sql<{ table: string; column: string; type: string }>`
    select table_name as "table", column_name as "column", udt_name as "type"
    from information_schema.columns where table_schema = 'public'`.execute(db);
  const tables = new Map<string, Set<string>>();
  const types = new Map<string, string>();
  for (const { table, column, type } of columns.rows) {
    tables.set(table, (tables.get(table) ?? new Set()).add(column));
    types.set(`${table}.${column}`, type);
  }
  const labels = await sql<{ type: string; label: string }>`
    select distinct on (t.typname) t.typname as "type", e.enumlabel as "label"
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    order by t.typname, e.enumsortorder`.execute(db);
  const enums = new Map(labels.rows.map(({ type, label }) => [type, label]));
  return { tables, types, enums };
}

/**
 * A value of the column's type that matches no row. `text` is the marker a
 * text column gets, so a sweep can look for rows it wrote by mistake.
 */
export function placeholders(
  types: Map<string, string>,
  enums: Map<string, string>,
  day: string,
  text = "sweep-no-such-row"
) {
  return ({ table, column }: Column): unknown => {
    const type = types.get(`${table}.${column}`);
    switch (type) {
      case "text":
      case "varchar":
      case "bpchar":
      case "citext":
        return text;
      case "uuid":
        return "00000000-0000-0000-0000-000000000000";
      case "bool":
        return false;
      case "date":
        return day;
      case "timestamp":
      case "timestamptz":
        return `${day}T00:00:00+00:00`;
      case "int2":
      case "int4":
      case "int8":
      case "numeric":
      case "float4":
      case "float8":
        return 0;
      default:
        return type ? enums.get(type) : undefined;
    }
  };
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer after ${CALL_TIMEOUT_MS / 1000} s`)),
      CALL_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Migrations on this branch that the stack has not applied, and the reverse.
 * A tool that calls a function the database does not have yet fails for a
 * reason that is not the tool's, so a sweep refuses to run on a stack that is
 * behind unless told the drift is known.
 */
export async function schemaDrift(db: Db) {
  const applied = await sql<{ version: string }>`
    select version from supabase_migrations.schema_migrations`.execute(db);
  const inDatabase = new Set(applied.rows.map((row) => row.version));
  const onBranch = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.slice(0, file.indexOf("_")));
  const branch = new Set(onBranch);
  return {
    notApplied: onBranch.filter((version) => !inDatabase.has(version)),
    notOnBranch: [...inDatabase].filter((version) => !branch.has(version))
  };
}

export async function refuseDrift(db: Db) {
  const drift = await schemaDrift(db);
  if (drift.notApplied.length > 0 && process.env.CARBON_SWEEP_ALLOW_DRIFT !== "1") {
    throw new Error(
      `The stack has not applied ${drift.notApplied.length} migration(s) on this branch (${drift.notApplied.join(", ")}). Run pnpm db:migrate, or set CARBON_SWEEP_ALLOW_DRIFT=1 to sweep anyway.`
    );
  }
  return drift;
}
