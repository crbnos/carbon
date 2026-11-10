// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The reads behind the chart of accounts import: the group's chart, its
// companies and their account defaults, and how each account is used. Server-
// only. Takes a Kysely handle or a transaction, so the review page and the
// apply server function read the same context.

import { type Kysely, type RawBuilder, sql, type Transaction } from "kysely";
import {
  type AccountImportContext,
  type AccountReference,
  type AccountUsage,
  FIXED_ASSET_CLASS_COLUMNS,
  REFERENCE_POLICY
} from "./account-import.ts";
import { ACCOUNT_DEFAULT_COLUMNS } from "./accounting-cutover/shared.ts";
import type { KyselyDatabase } from "./client.ts";

type Db = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

/**
 * One SELECT per REFERENCE_POLICY entry, each yielding (accountId, companyId,
 * movable). `movable` is true when a merge would move the row.
 */
function referenceBranch(
  ref: AccountReference,
  companyIds: string[]
): RawBuilder<unknown> {
  const t = sql.table(ref.table);
  const col = sql.ref(`t.${ref.column}`);
  const where = sql`${col} IS NOT NULL AND t."companyId" IN (${sql.join(companyIds)})`;
  switch (ref.policy) {
    case "repoint":
    case "history":
      return sql`SELECT ${col} AS "accountId", t."companyId",
          ${sql.lit(ref.policy === "repoint")} AS movable
        FROM ${t} AS t WHERE ${where}`;
    case "repoint-if-status":
      return sql`SELECT ${col} AS "accountId", t."companyId",
          (t."status"::text IN (${sql.join(ref.statuses.map((s) => sql.lit(s)))})) AS movable
        FROM ${t} AS t WHERE ${where}`;
    case "repoint-if-parent-status":
      return sql`SELECT ${col} AS "accountId", t."companyId",
          COALESCE(p."status"::text IN (${sql.join(ref.statuses.map((s) => sql.lit(s)))}), false) AS movable
        FROM ${t} AS t
        LEFT JOIN ${sql.table(ref.parentTable)} AS p
          ON p."id" = ${sql.ref(`t.${ref.parentColumn}`)} AND p."companyId" = t."companyId"
        WHERE ${where}`;
  }
}

/**
 * The references with no foreign key: an intercompany elimination line moves
 * with its journal line, and an integration's payment fee account moves too.
 */
function softReferenceBranches(companyIds: string[]): RawBuilder<unknown>[] {
  const inCompanies = sql`t."companyId" IN (${sql.join(companyIds)})`;
  return [
    sql`SELECT t."accountId", t."companyId",
        COALESCE(j."status"::text IN ('Draft', 'Provisional'), false) AS movable
      FROM "intercompanyEliminationLine" AS t
      LEFT JOIN "journalLine" AS jl ON jl."id" = t."journalLineId"
      LEFT JOIN "journal" AS j ON j."id" = jl."journalId"
      WHERE t."accountId" IS NOT NULL AND ${inCompanies}`,
    sql`SELECT t."metadata"->>'paymentFeeAccount' AS "accountId", t."companyId",
        true AS movable
      FROM "companyIntegration" AS t
      WHERE t."metadata"->>'paymentFeeAccount' IS NOT NULL AND ${inCompanies}`
  ];
}

export async function loadAccountImportContext(
  db: Db,
  companyGroupId: string,
  importingCompanyId: string
): Promise<AccountImportContext> {
  const chart = await db
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
    // Groups are matched by name, case-insensitively: on a tie the oldest wins.
    .orderBy("createdAt", "desc")
    .orderBy("id", "desc")
    .execute();

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
  if (companyIds.length === 0) {
    return {
      chart,
      companies,
      defaultsByCompany: {},
      fixedAssetClasses: [],
      usage: {},
      importingCompanyId
    };
  }

  const defaultsRows = await db
    .selectFrom("accountDefault")
    .select(["companyId", ...ACCOUNT_DEFAULT_COLUMNS])
    .where("companyId", "in", companyIds)
    .execute();
  const defaultsByCompany = Object.fromEntries(
    defaultsRows.map(({ companyId, ...defaults }) => [companyId, defaults])
  );

  const fixedAssetClasses = (
    await db
      .selectFrom("fixedAssetClass")
      .select(["id", "companyId", "name", ...FIXED_ASSET_CLASS_COLUMNS])
      .where("companyId", "in", companyIds)
      .orderBy("name")
      .execute()
  ).map(({ id, companyId, name, ...accounts }) => ({
    id,
    companyId,
    name,
    accounts
  }));

  // Every reference in one statement, counted per account, company and
  // whether a merge moves it.
  const branches = [
    ...REFERENCE_POLICY.map((ref) => referenceBranch(ref, companyIds)),
    ...softReferenceBranches(companyIds)
  ];
  const references = await sql<{
    accountId: string;
    companyId: string;
    movable: boolean;
    count: number;
  }>`SELECT r."accountId", r."companyId", r.movable, COUNT(*)::int AS count
    FROM (${sql.join(branches, sql` UNION ALL `)}) AS r
    GROUP BY r."accountId", r."companyId", r.movable`.execute(db);
  const usage: Record<string, AccountUsage> = {};
  for (const row of references.rows) {
    const entry = (usage[row.accountId] ??= {
      movableReferencesByCompany: {},
      historyReferences: 0
    });
    if (row.movable) {
      entry.movableReferencesByCompany[row.companyId] =
        (entry.movableReferencesByCompany[row.companyId] ?? 0) + row.count;
    } else {
      entry.historyReferences += row.count;
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

/**
 * True when anything in the group refers to the account: every column
 * REFERENCE_POLICY lists, plus the default accounts, the fixed asset classes
 * and child accounts. Together these are every foreign key to `account` (the
 * apply-account-import live test checks the list), so a false answer means a
 * delete will not be refused.
 */
export async function isAccountInUse(
  db: Db,
  companyGroupId: string,
  accountId: string
): Promise<boolean> {
  const companyIds = sql`(SELECT "id" FROM "company" WHERE "companyGroupId" = ${companyGroupId})`;
  const uses = [
    ...REFERENCE_POLICY.map(
      (ref) => sql`SELECT 1 FROM ${sql.table(ref.table)} AS t
        WHERE t.${sql.id(ref.column)} = ${accountId} AND t."companyId" IN ${companyIds}`
    ),
    sql`SELECT 1 FROM "accountDefault" AS t
      WHERE t."companyId" IN ${companyIds}
        AND ${sql.join(
          ACCOUNT_DEFAULT_COLUMNS.map(
            (c) => sql`t.${sql.id(c)} = ${accountId}`
          ),
          sql` OR `
        )}`,
    sql`SELECT 1 FROM "fixedAssetClass" AS t
      WHERE t."companyId" IN ${companyIds}
        AND ${sql.join(
          FIXED_ASSET_CLASS_COLUMNS.map(
            (c) => sql`t.${sql.id(c)} = ${accountId}`
          ),
          sql` OR `
        )}`,
    sql`SELECT 1 FROM "account" AS t WHERE t."parentId" = ${accountId}`
  ];
  const result = await sql<{ used: boolean }>`SELECT EXISTS (
      ${sql.join(uses, sql` UNION ALL `)}
    ) AS used`.execute(db);
  return result.rows[0]?.used ?? false;
}
