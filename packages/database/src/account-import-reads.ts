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
  REFERENCE_POLICY
} from "./account-import.ts";
import { ACCOUNT_DEFAULT_COLUMNS } from "./accounting-cutover/shared.ts";
import { GL_JOURNAL_STATUSES } from "./accounting-posting.ts";
import type { KyselyDatabase } from "./client.ts";
import { isAccountClass } from "./ledger.ts";
import { equals } from "./precision.ts";

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

  const usage: Record<string, AccountUsage> = {};
  const usageOf = (accountId: string) => {
    usage[accountId] ??= {
      hasPostedLines: false,
      reclassBalanceByCompany: {},
      movableReferencesByCompany: {},
      historyReferences: 0
    };
    return usage[accountId];
  };

  if (companyIds.length > 0) {
    // Lines on Posted, Reversed and Superseded journals. Any of them is
    // history; only Posted and Reversed carry the balance a reclass moves.
    const journalUsage = await db
      .selectFrom("journalLine")
      .innerJoin("journal", "journal.id", "journalLine.journalId")
      .select([
        "journalLine.accountId",
        "journal.companyId",
        "journal.status",
        sql<number>`SUM("journalLine"."amount")`.as("amount")
      ])
      .where("journal.companyId", "in", companyIds)
      .where("journal.status", "in", [...GL_JOURNAL_STATUSES, "Superseded"])
      .where("journalLine.accountId", "is not", null)
      .groupBy(["journalLine.accountId", "journal.companyId", "journal.status"])
      .execute();
    const glStatuses: readonly string[] = GL_JOURNAL_STATUSES;
    for (const row of journalUsage) {
      if (!row.accountId) continue;
      const entry = usageOf(row.accountId);
      entry.hasPostedLines = true;
      if (glStatuses.includes(row.status)) {
        entry.reclassBalanceByCompany[row.companyId] =
          (entry.reclassBalanceByCompany[row.companyId] ?? 0) +
          Number(row.amount);
      }
    }

    // Every other reference, in one statement.
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
      const entry = usageOf(row.accountId);
      if (row.movable) {
        entry.movableReferencesByCompany[row.companyId] =
          (entry.movableReferencesByCompany[row.companyId] ?? 0) +
          Number(row.count);
      } else {
        entry.historyReferences += Number(row.count);
      }
    }
  }

  // Drop zero balances, so an account whose lines net to zero needs no target.
  for (const entry of Object.values(usage)) {
    for (const [companyId, amount] of Object.entries(
      entry.reclassBalanceByCompany
    )) {
      if (equals(amount, 0)) delete entry.reclassBalanceByCompany[companyId];
    }
  }

  return {
    chart,
    companies,
    defaultsByCompany,
    usage,
    importingCompanyId
  };
}
