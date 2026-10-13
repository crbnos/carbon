// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Applies a chart of accounts import (.ai/specs/2026-10-12-chart-of-accounts-import.md)
// in one transaction: the customer's chart of accounts and their default
// accounts. The plan is computed again here from the same pure planner the
// review page used, so the client never decides what is written. Only before
// accounting is activated in every company of the group, so no account has
// Posted history: a merge re-points Draft and Provisional records and deletes
// the source.

import {
  ACCOUNT_TYPES,
  type AccountDefaultColumn,
  type AccountType,
  FIXED_ASSET_CLASS_COLUMNS,
  incomeBalanceOf,
  isApplicable,
  planAccountImport,
  REFERENCE_POLICY,
  requiredRoles
} from "@carbon/database/account-import";
import { loadAccountImportContext } from "@carbon/database/account-import-reads";
import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { sql, type Transaction, type Updateable } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";

const logger = getLogger("server-functions", "apply-account-import");

const accountClass = z.enum([
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense"
]);

export const applyAccountImportInput = z.object({
  chart: z
    .array(
      z.object({
        line: z.number().int(),
        number: z.string().min(1),
        name: z.string().min(1),
        class: accountClass.nullable(),
        accountType: z
          .enum(ACCOUNT_TYPES as [AccountType, ...AccountType[]])
          .nullable(),
        group: z.string().min(1)
      })
    )
    .min(1),
  defaults: z
    .array(
      z.object({
        line: z.number().int(),
        key: z.string().min(1),
        number: z.string().nullable()
      })
    )
    .min(1),
  resolutions: z.object({ targets: z.record(z.string(), z.number().int()) })
});

export type ApplyAccountImportResult = {
  counts: { updated: number; created: number; merged: number; deleted: number };
};

type Trx = Transaction<KyselyDatabase>;

const key = (value: string) => value.trim().toLowerCase();

/** `(VALUES (source, target), …)` for every merge. */
function mergeValues(pairs: { source: string; target: string }[]) {
  return sql`(VALUES ${sql.join(
    pairs.map((p) => sql`(${p.source}, ${p.target})`)
  )}) AS m(source, target)`;
}

/** Re-point every reference REFERENCE_POLICY lets a merge move. */
async function repointReferences(
  trx: Trx,
  pairs: { source: string; target: string }[],
  companyIds: string[]
) {
  const m = mergeValues(pairs);
  const inCompanies = sql`t."companyId" IN (${sql.join(companyIds)})`;
  for (const ref of REFERENCE_POLICY) {
    if (ref.policy === "history") continue;
    const t = sql.table(ref.table);
    const col = sql.id(ref.column);
    if (ref.policy === "repoint") {
      await sql`UPDATE ${t} AS t SET ${col} = m.target FROM ${m}
        WHERE t.${col} = m.source AND ${inCompanies}`.execute(trx);
      continue;
    }
    const parent = ref.parent!;
    const statuses = sql.join(parent.statuses.map((s) => sql.lit(s)));
    if (parent.table === null) {
      await sql`UPDATE ${t} AS t SET ${col} = m.target FROM ${m}
        WHERE t.${col} = m.source AND ${inCompanies}
          AND t."status"::text IN (${statuses})`.execute(trx);
      continue;
    }
    const p = sql.table(parent.table);
    const fk = sql.id(parent.column!);
    await sql`UPDATE ${t} AS t SET ${col} = m.target FROM ${m}, ${p} AS p
      WHERE t.${col} = m.source AND ${inCompanies}
        AND p."id" = t.${fk} AND p."companyId" = t."companyId"
        AND p."status"::text IN (${statuses})`.execute(trx);
    if (ref.dedupeOn) {
      const cols = sql.join(ref.dedupeOn.map((c) => sql.ref(`t.${c}`)));
      await sql`DELETE FROM ${t} AS t USING (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY "companyId", ${cols} ORDER BY "createdAt", id
          ) AS n FROM ${t} AS t WHERE ${inCompanies}
        ) AS d WHERE t.id = d.id AND d.n > 1`.execute(trx);
    }
  }

  // The references with no foreign key.
  await sql`UPDATE "intercompanyEliminationLine" AS t
    SET "accountId" = m.target
    FROM ${m}, "journalLine" AS jl, "journal" AS j
    WHERE t."accountId" = m.source AND ${inCompanies}
      AND jl."id" = t."journalLineId" AND j."id" = jl."journalId"
      AND j."status" IN ('Draft', 'Provisional')`.execute(trx);
  await sql`DELETE FROM "externalIntegrationMapping" AS t
    WHERE t."entityType" = 'account'
      AND t."entityId" IN (${sql.join(pairs.map((p) => p.source))})
      AND ${inCompanies}`.execute(trx);
  await sql`UPDATE "companyIntegration" AS t
    SET "metadata" = jsonb_set(t."metadata"::jsonb, '{paymentFeeAccount}', to_jsonb(m.target::text))::json
    FROM ${m}
    WHERE t."metadata"->>'paymentFeeAccount' = m.source AND ${inCompanies}`.execute(
    trx
  );
}

const applyAccountImport = defineServerFn({
  name: "apply-account-import",
  input: applyAccountImportInput,
  permissions: { update: "accounting" },
  async run(
    { db, companyId, userId },
    { chart, defaults, resolutions }
  ): Promise<ApplyAccountImportResult> {
    return db.transaction().execute(async (trx) => {
      const company = await trx
        .selectFrom("company")
        .select("companyGroupId")
        .where("id", "=", companyId)
        .executeTakeFirst();
      if (!company?.companyGroupId) {
        throw new NotFoundError("Company not found");
      }
      const groupId = company.companyGroupId;

      // Nothing else may change the chart, or activate accounting, while the
      // plan is applied.
      await sql`SELECT "id" FROM "account" WHERE "companyGroupId" = ${groupId} FOR UPDATE`.execute(
        trx
      );
      await sql`SELECT cs."id" FROM "companySettings" cs
        JOIN "company" c ON c."id" = cs."id"
        WHERE c."companyGroupId" = ${groupId} FOR SHARE OF cs`.execute(trx);

      const ctx = await loadAccountImportContext(trx, groupId, companyId);
      const plan = planAccountImport(chart, defaults, ctx, resolutions);
      if (!isApplicable(plan)) {
        logger.warn("Refused an account import that is not applicable", {
          companyId,
          errors: plan.errors.map((e) => e.code),
          exceptions: plan.exceptions.length
        });
        throw new InvalidInputError(
          plan.errors.some((e) => e.code === "accounting-activated")
            ? "Accounting is already set up, so the chart of accounts cannot be imported."
            : `The import has ${plan.errors.length} error(s) and ${plan.exceptions.length} account(s) that need a target.`
        );
      }

      const companyIds = ctx.companies.map((c) => c.id);
      const now = datetime.timestamp();

      // Groups.
      const groupIdByName = new Map(
        ctx.chart.filter((a) => a.isGroup).map((g) => [key(g.name), g.id])
      );
      const rootByBalance = new Map(
        ctx.chart
          .filter((a) => a.isGroup && a.isSystem && a.parentId === null)
          .map((r) => [r.incomeBalance, r.id])
      );
      if (plan.groupCreates.length > 0) {
        const created = await trx
          .insertInto("account")
          .values(
            plan.groupCreates.map((g) => {
              const incomeBalance = incomeBalanceOf(g.class);
              const parentId = rootByBalance.get(incomeBalance);
              if (!parentId) {
                throw new InvalidInputError(`No ${incomeBalance} root account`);
              }
              return {
                name: g.name,
                number: null,
                isGroup: true,
                class: g.class,
                incomeBalance,
                parentId,
                companyGroupId: groupId,
                createdBy: userId
              };
            })
          )
          .returning(["id", "name"])
          .execute();
        for (const g of created) groupIdByName.set(key(g.name), g.id);
      }
      const groupIdOf = (name: string) => {
        const id = groupIdByName.get(key(name));
        if (!id) throw new InvalidInputError(`Unknown group "${name}"`);
        return id;
      };

      // Free every number and name that changes or goes: two accounts may
      // swap, and a created account may reuse a deleted one's number.
      const freed = [...plan.updates.map((u) => u.accountId), ...plan.deletes];
      if (freed.length > 0) {
        await trx
          .updateTable("account")
          .set({
            number: sql`'__import_' || "id"`,
            name: sql`'__import_' || "id"`
          })
          .where("id", "in", freed)
          .where("companyGroupId", "=", groupId)
          .execute();
      }

      // Updates: the account keeps its id, so everything that points at it
      // follows.
      if (plan.updates.length > 0) {
        const values = sql.join(
          plan.updates.map(
            (u) =>
              sql`(${u.accountId}, ${u.number}, ${u.name}, ${u.accountType}, ${u.class}, ${incomeBalanceOf(u.class)}, ${groupIdOf(u.group)})`
          )
        );
        await sql`UPDATE "account" AS a SET
            "number" = v.number,
            "name" = v.name,
            "accountType" = v."accountType"::"accountType",
            "class" = v.class::"glAccountClass",
            "incomeBalance" = v."incomeBalance"::"glIncomeBalance",
            "parentId" = v."parentId",
            "active" = true,
            "updatedBy" = ${userId},
            "updatedAt" = ${now}
          FROM (VALUES ${values}) AS v(id, number, name, "accountType", class, "incomeBalance", "parentId")
          WHERE a."id" = v.id AND a."companyGroupId" = ${groupId}`.execute(trx);
      }

      // Creates.
      const accountIdByLine = new Map(
        plan.claims.map((c) => [c.line, c.accountId])
      );
      if (plan.creates.length > 0) {
        const created = await trx
          .insertInto("account")
          .values(
            plan.creates.map((c) => ({
              number: c.number,
              name: c.name,
              class: c.class,
              accountType: c.accountType,
              incomeBalance: incomeBalanceOf(c.class),
              parentId: groupIdOf(c.group),
              isGroup: false,
              companyGroupId: groupId,
              createdBy: userId
            }))
          )
          .returning(["id", "number"])
          .execute();
        const idByNumber = new Map(created.map((c) => [c.number, c.id]));
        for (const c of plan.creates) {
          accountIdByLine.set(c.line, idByNumber.get(c.number)!);
        }
      }
      const accountOfLine = (line: number) => {
        const id = accountIdByLine.get(line);
        if (!id) throw new InvalidInputError(`Row ${line} has no account`);
        return id;
      };

      // Defaults, one statement per company of the group.
      const movesByCompany = new Map<string, Record<string, string | null>>();
      for (const move of plan.roleMoves) {
        const set = movesByCompany.get(move.companyId) ?? {};
        set[move.role satisfies AccountDefaultColumn] =
          move.toLine === null ? null : accountOfLine(move.toLine);
        movesByCompany.set(move.companyId, set);
      }
      for (const [moveCompanyId, set] of movesByCompany) {
        await trx
          .updateTable("accountDefault")
          .set({
            ...(set as Updateable<KyselyDatabase["accountDefault"]>),
            updatedBy: userId
          })
          .where("companyId", "=", moveCompanyId)
          .execute();
      }

      // Fixed asset class accounts, one statement per class.
      const classSets = new Map<
        string,
        { companyId: string; set: Record<string, string> }
      >();
      for (const move of plan.assetClassMoves) {
        const entry = classSets.get(move.classId) ?? {
          companyId: move.companyId,
          set: {}
        };
        entry.set[move.column] = accountOfLine(move.toLine);
        classSets.set(move.classId, entry);
      }
      for (const [classId, { companyId: classCompanyId, set }] of classSets) {
        await trx
          .updateTable("fixedAssetClass")
          .set({
            ...(set as Updateable<KyselyDatabase["fixedAssetClass"]>),
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", classId)
          .where("companyId", "=", classCompanyId)
          .execute();
      }

      // Merges: Draft and Provisional records follow the source to its target.
      const pairs = plan.merges.map((m) => ({
        source: m.sourceId,
        target: accountOfLine(m.targetLine)
      }));
      if (pairs.length > 0) {
        await repointReferences(trx, pairs, companyIds);
      }

      // Deletes. Journal and document lines refuse it (ON DELETE RESTRICT)
      // if anything still points at an account.
      if (plan.deletes.length > 0) {
        await trx
          .deleteFrom("account")
          .where("id", "in", plan.deletes)
          .where("companyGroupId", "=", groupId)
          .execute();
      }

      // Groups left with no children.
      for (;;) {
        const removed = await sql`DELETE FROM "account" AS g
          WHERE g."companyGroupId" = ${groupId} AND g."isGroup" AND NOT g."isSystem"
            AND NOT EXISTS (SELECT 1 FROM "account" AS c WHERE c."parentId" = g."id")
          RETURNING g."id"`.execute(trx);
        if (removed.rows.length === 0) break;
      }

      await assertPostcondition(trx, groupId, companyIds, chart);

      return {
        counts: {
          updated: plan.updates.length,
          created: plan.creates.length,
          merged: plan.merges.length,
          deleted: plan.deletes.length
        }
      };
    });
  }
});

/** The chart now equals the file, and every company can still post. */
async function assertPostcondition(
  trx: Trx,
  groupId: string,
  companyIds: string[],
  chart: { number: string; name: string }[]
) {
  const leaves = await trx
    .selectFrom("account")
    .select(["id", "number", "name", "class", "active"])
    .where("companyGroupId", "=", groupId)
    .where("isGroup", "=", false)
    .where("isSystem", "=", false)
    .execute();
  const expected = new Set(
    chart.map((r) => `${r.number.trim()}|${r.name.trim()}`)
  );
  const actual = new Set(leaves.map((a) => `${a.number ?? ""}|${a.name}`));
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new InvalidInputError(
      "The chart does not match the file after the import",
      { missing, extra }
    );
  }

  const byId = new Map(leaves.map((a) => [a.id, a]));
  const defaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "in", companyIds)
    .execute();
  for (const row of defaults) {
    for (const role of requiredRoles()) {
      const accountId = row[role] as string | null;
      if (!accountId || !byId.has(accountId)) {
        throw new InvalidInputError(
          `The import would leave the default "${role}" without an account`
        );
      }
    }
    const clearing = byId.get(row.migrationClearingAccount ?? "");
    if (clearing && clearing.class !== "Equity") {
      throw new InvalidInputError(
        "Migration Clearing must be an Equity account"
      );
    }
  }
  const classes = await trx
    .selectFrom("fixedAssetClass")
    .select(["name", ...FIXED_ASSET_CLASS_COLUMNS])
    .where("companyId", "in", companyIds)
    .execute();
  for (const fac of classes) {
    for (const column of FIXED_ASSET_CLASS_COLUMNS) {
      if (!byId.has(fac[column] as string)) {
        throw new InvalidInputError(
          `The import would leave fixed asset class "${fac.name}" without an account`
        );
      }
    }
  }
}

export default applyAccountImport;
