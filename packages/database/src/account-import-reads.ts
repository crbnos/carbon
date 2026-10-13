// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The reads behind the chart of accounts import: the group's chart, its
// companies and their account defaults, and how each account is used. Server-
// only. Takes a Kysely handle or a transaction, so the review page and the
// apply server function read the same context.

import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import {
  type AccountDefaultsRow,
  type AccountImportContext,
  type AccountUsage,
  type ChartAccount,
  FIXED_ASSET_CLASS_COLUMNS,
  type FixedAssetClassRow,
  REFERENCE_POLICY
} from "./account-import.ts";
import { ACCOUNT_DEFAULT_COLUMNS } from "./accounting-cutover/shared.ts";
import type { KyselyDatabase } from "./client.ts";
import { isAccountClass } from "./ledger.ts";

type Db = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

/**
 * One SELECT per REFERENCE_POLICY entry, each yielding (accountId, companyId,
 * movable). `movable` is true when the policy would move the row.
 */
function referenceBranch(
  ref: (typeof REFERENCE_POLICY)[number],
  companyIds: string[]
): RawBuilder<unknown> {
  const t = sql.table(ref.table);
  const col = sql.ref(`t.${ref.column}`);
  const inCompanies = sql`t."companyId" IN (${sql.join(companyIds)})`;
  if (ref.policy === "repoint") {
    return sql`SELECT ${col} AS "accountId", t."companyId", true AS movable
      FROM ${t} AS t WHERE ${col} IS NOT NULL AND ${inCompanies}`;
  }
  if (ref.policy === "history") {
    return sql`SELECT ${col} AS "accountId", t."companyId", false AS movable
      FROM ${t} AS t WHERE ${col} IS NOT NULL AND ${inCompanies}`;
  }
  const parent = ref.parent!;
  const statuses = sql.join(parent.statuses.map((s) => sql.lit(s)));
  if (parent.table === null) {
    return sql`SELECT ${col} AS "accountId", t."companyId",
        (t."status"::text IN (${statuses})) AS movable
      FROM ${t} AS t WHERE ${col} IS NOT NULL AND ${inCompanies}`;
  }
  const p = sql.table(parent.table);
  const fk = sql.ref(`t.${parent.column!}`);
  return sql`SELECT ${col} AS "accountId", t."companyId",
      COALESCE(p."status"::text IN (${statuses}), false) AS movable
    FROM ${t} AS t
    LEFT JOIN ${p} AS p ON p."id" = ${fk} AND p."companyId" = t."companyId"
    WHERE ${col} IS NOT NULL AND ${inCompanies}`;
}

export async function loadAccountImportContext(
  db: Db,
  companyGroupId: string,
  importingCompanyId: string
): Promise<AccountImportContext> {
  const chartRows = await db
    .selectFrom("account")
    .select([
      "id",
      "number",
      "name",
      "class",
      "accountType",
      "incomeBalance",
      "parentId",
      "isGroup",
      "isSystem",
      "active"
    ])
    .where("companyGroupId", "=", companyGroupId)
    .execute();
  const chart: ChartAccount[] = chartRows.map((a) => ({
    id: a.id,
    number: a.number,
    name: a.name,
    class: isAccountClass(a.class) ? a.class : null,
    accountType: a.accountType,
    incomeBalance: a.incomeBalance,
    parentId: a.parentId,
    isGroup: a.isGroup,
    isSystem: a.isSystem,
    active: a.active
  }));

  const companyRows = await db
    .selectFrom("company")
    .leftJoin("companySettings", "companySettings.id", "company.id")
    .select([
      "company.id",
      "company.name",
      "companySettings.accountingCutoverDate"
    ])
    .where("company.companyGroupId", "=", companyGroupId)
    .orderBy("company.name")
    .execute();
  const companies = companyRows.map((c) => ({
    id: c.id,
    name: c.name,
    hasCutover: c.accountingCutoverDate !== null
  }));
  const companyIds = companies.map((c) => c.id);

  const defaultsRows =
    companyIds.length === 0
      ? []
      : await db
          .selectFrom("accountDefault")
          .selectAll()
          .where("companyId", "in", companyIds)
          .execute();
  const defaultsByCompany: Record<string, AccountDefaultsRow> = {};
  for (const row of defaultsRows) {
    const defaults = {} as AccountDefaultsRow;
    for (const column of ACCOUNT_DEFAULT_COLUMNS) {
      defaults[column] = (row[column] as string | null) ?? null;
    }
    defaultsByCompany[row.companyId] = defaults;
  }

  const fixedAssetClassRows =
    companyIds.length === 0
      ? []
      : await db
          .selectFrom("fixedAssetClass")
          .select(["id", "companyId", "name", ...FIXED_ASSET_CLASS_COLUMNS])
          .where("companyId", "in", companyIds)
          .orderBy("name")
          .execute();
  const fixedAssetClasses: FixedAssetClassRow[] = fixedAssetClassRows.map(
    (row) => ({
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      accounts: Object.fromEntries(
        FIXED_ASSET_CLASS_COLUMNS.map((column) => [column, row[column] ?? null])
      ) as FixedAssetClassRow["accounts"]
    })
  );

  const usage: Record<string, AccountUsage> = {};
  if (companyIds.length > 0) {
    // Every reference REFERENCE_POLICY knows, in one statement. A journal
    // line is movable while its journal is Draft or Provisional; anything
    // else is posted history.
    const branches = REFERENCE_POLICY.map((ref) =>
      referenceBranch(ref, companyIds)
    );
    const references = await sql<{
      accountId: string;
      companyId: string;
      movable: boolean;
      count: number;
    }>`SELECT r."accountId", r."companyId", r.movable, COUNT(*)::int AS count
      FROM (${sql.join(branches, sql` UNION ALL `)}) AS r
      GROUP BY r."accountId", r."companyId", r.movable`.execute(db);
    for (const row of references.rows) {
      const entry = (usage[row.accountId] ??= {
        movableReferencesByCompany: {},
        historyReferences: 0
      });
      if (row.movable) {
        entry.movableReferencesByCompany[row.companyId] =
          (entry.movableReferencesByCompany[row.companyId] ?? 0) +
          Number(row.count);
      } else {
        entry.historyReferences += Number(row.count);
      }
    }
  }

  return {
    chart,
    companies,
    defaultsByCompany,
    fixedAssetClasses,
    usage,
    importingCompanyId
  };
}
