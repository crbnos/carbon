// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Applies a chart of accounts import (.ai/specs/2026-10-12-chart-of-accounts-import.md)
// in one transaction: the customer's chart of accounts and their default
// accounts. The plan is computed again here from the same pure planner the
// review page used, so the client never decides what is written. Only before
// accounting is activated in every company of the group, so no account has
// Posted history: a merge re-points the source's documents and Draft or
// Provisional journal lines, then deletes the source.

import {
  ACCOUNT_TYPES,
  type AccountImportPlan,
  type AccountType,
  FIXED_ASSET_CLASS_COLUMNS,
  incomeBalanceOf,
  isApplicable,
  planAccountImport,
  REFERENCE_POLICY,
  requiredRoles
} from "@carbon/database/account-import";
import { loadAccountImportContext } from "@carbon/database/account-import-reads";
import { MIGRATION_CLEARING_ACCOUNT_CLASS } from "@carbon/database/accounting-cutover";
import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";

const logger = getLogger("server-functions", "apply-account-import");

/** A trimmed, non-empty text value. */
const text = () => z.string().trim().min(1);

export const applyAccountImportInput = z.object({
  chart: z
    .array(
      z.object({
        line: z.number().int(),
        number: text(),
        name: text(),
        class: z
          .enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
          .nullable(),
        accountType: z
          .enum(ACCOUNT_TYPES as [AccountType, ...AccountType[]])
          .nullable(),
        group: text()
      })
    )
    .min(1)
    .max(10000),
  defaults: z
    .array(
      z.object({
        line: z.number().int(),
        key: text(),
        number: text().nullable()
      })
    )
    .min(1)
    .max(2000),
  resolutions: z.object({ targets: z.record(z.string(), z.number().int()) })
});

export type ApplyAccountImportResult = {
  counts: { updated: number; created: number; merged: number; deleted: number };
};

type Trx = Transaction<KyselyDatabase>;
type ChartRow = z.infer<typeof applyAccountImportInput>["chart"][number];

const key = (value: string) => value.trim().toLowerCase();

/** Re-point every reference a merge moves, from each source to its target. */
async function repointReferences(
  trx: Trx,
  pairs: { source: string; target: string }[],
  companyIds: string[]
) {
  const m = sql`(VALUES ${sql.join(
    pairs.map((p) => sql`(${p.source}, ${p.target})`)
  )}) AS m(source, target)`;
  const inCompanies = sql`t."companyId" IN (${sql.join(companyIds)})`;
  for (const ref of REFERENCE_POLICY) {
    const t = sql.table(ref.table);
    const col = sql.id(ref.column);
    const matches = sql`t.${col} = m.source AND ${inCompanies}`;
    switch (ref.policy) {
      case "history":
        continue;
      case "repoint":
        await sql`UPDATE ${t} AS t SET ${col} = m.target FROM ${m}
          WHERE ${matches}`.execute(trx);
        continue;
      case "repoint-if-status":
        await sql`UPDATE ${t} AS t SET ${col} = m.target FROM ${m}
          WHERE ${matches}
            AND t."status"::text IN (${sql.join(ref.statuses.map((x) => sql.lit(x)))})`.execute(
          trx
        );
        continue;
      case "repoint-if-parent-status":
        await sql`UPDATE ${t} AS t SET ${col} = m.target
          FROM ${m}, ${sql.table(ref.parentTable)} AS p
          WHERE ${matches}
            AND p."id" = t.${sql.id(ref.parentColumn)} AND p."companyId" = t."companyId"
            AND p."status"::text IN (${sql.join(ref.statuses.map((x) => sql.lit(x)))})`.execute(
          trx
        );
        continue;
    }
  }

  // The references with no foreign key.
  await sql`UPDATE "intercompanyEliminationLine" AS t
    SET "accountId" = m.target
    FROM ${m}, "journalLine" AS jl, "journal" AS j
    WHERE t."accountId" = m.source AND ${inCompanies}
      AND jl."id" = t."journalLineId" AND j."id" = jl."journalId"
      AND j."status" IN ('Draft', 'Provisional')`.execute(trx);
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

      // Nothing may activate accounting, or change the chart, while the plan
      // is applied. Settings first, in the order activation takes them.
      await sql`SELECT cs."id" FROM "companySettings" cs
        JOIN "company" c ON c."id" = cs."id"
        WHERE c."companyGroupId" = ${groupId} FOR SHARE OF cs`.execute(trx);
      await sql`SELECT "id" FROM "account" WHERE "companyGroupId" = ${groupId} FOR UPDATE`.execute(
        trx
      );
      // Lets the charge and reimbursement guards accept the account change
      // of a posted row, for this transaction only (20261013035046).
      await sql`SELECT set_config('app.account_import', 'true', true)`.execute(
        trx
      );

      const ctx = await loadAccountImportContext(trx, groupId, companyId);
      const plan = planAccountImport(chart, defaults, ctx, resolutions);
      if (!isApplicable(plan)) {
        const open = plan.replacements.filter((r) => r.targetLine === null);
        throw new InvalidInputError(
          plan.errors.some((e) => e.code === "accounting-activated")
            ? "Accounting is already set up, so the chart of accounts cannot be imported."
            : `The import has ${plan.errors.length} error(s) and ${open.length} account(s) that need a replacement.`,
          { errors: plan.errors.map((e) => e.code) }
        );
      }

      const companyIds = ctx.companies.map((c) => c.id);
      const now = datetime.timestamp();
      const removed = [...plan.deletes, ...plan.merges.map((m) => m.sourceId)];

      // Groups. A group's name is unique among groups only, so a new group
      // never meets a leaf's name.
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
              if (!parentId)
                throw new Error(`No ${incomeBalance} root account`);
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
        if (!id) throw new Error(`Unknown group "${name}"`);
        return id;
      };

      // Free every leaf number and name that changes or goes: two accounts
      // may swap, and a created account may reuse a removed one's.
      const freed = [...plan.updates.map((u) => u.accountId), ...removed];
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
        const lineByNumber = new Map(
          plan.creates.map((c) => [c.number, c.line])
        );
        for (const c of created) {
          const line =
            c.number === null ? undefined : lineByNumber.get(c.number);
          if (line !== undefined) accountIdByLine.set(line, c.id);
        }
      }
      const accountOfLine = (line: number) => {
        const id = accountIdByLine.get(line);
        if (!id) throw new Error(`Row ${line} has no account`);
        return id;
      };

      await setDefaults(trx, plan, accountOfLine, companyIds, userId);
      await setAssetClasses(trx, plan, accountOfLine, userId, now);

      // Merges: the source's documents and unposted journal lines follow it
      // to its target.
      if (plan.merges.length > 0) {
        await repointReferences(
          trx,
          plan.merges.map((m) => ({
            source: m.sourceId,
            target: accountOfLine(m.targetLine)
          })),
          companyIds
        );
      }

      // Removed accounts: their integration mappings go with them. Journal
      // and document lines refuse the delete (ON DELETE RESTRICT) if anything
      // still points at one.
      if (removed.length > 0) {
        await trx
          .deleteFrom("externalIntegrationMapping")
          .where("entityType", "=", "account")
          .where("entityId", "in", removed)
          .where("companyId", "in", companyIds)
          .execute();
        await trx
          .deleteFrom("account")
          .where("id", "in", removed)
          .where("companyGroupId", "=", groupId)
          .execute();
      }

      // Groups left with no children, deepest first.
      for (;;) {
        const emptied = await sql`DELETE FROM "account" AS g
          WHERE g."companyGroupId" = ${groupId} AND g."isGroup" AND NOT g."isSystem"
            AND NOT EXISTS (SELECT 1 FROM "account" AS c WHERE c."parentId" = g."id")
          RETURNING g."id"`.execute(trx);
        if (emptied.rows.length === 0) break;
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

/** Every company's defaults, in one statement: the file names the same
 *  account for a role in every company. */
async function setDefaults(
  trx: Trx,
  plan: AccountImportPlan,
  accountOfLine: (line: number) => string,
  companyIds: string[],
  userId: string
) {
  const set = Object.fromEntries(
    plan.roleMoves.map((m) => [
      m.role,
      m.toLine === null ? null : accountOfLine(m.toLine)
    ])
  );
  await trx
    .updateTable("accountDefault")
    .set({ ...set, updatedBy: userId })
    .where("companyId", "in", companyIds)
    .execute();
}

/** Every fixed asset class's accounts, in one statement. */
async function setAssetClasses(
  trx: Trx,
  plan: AccountImportPlan,
  accountOfLine: (line: number) => string,
  userId: string,
  now: string
) {
  if (plan.assetClassMoves.length === 0) return;
  const columns = sql.join(FIXED_ASSET_CLASS_COLUMNS.map((c) => sql.id(c)));
  const values = sql.join(
    plan.assetClassMoves.map(
      (m) =>
        sql`(${m.classId}, ${m.companyId}, ${sql.join(
          FIXED_ASSET_CLASS_COLUMNS.map((c) => accountOfLine(m.toLines[c]))
        )})`
    )
  );
  const assignments = sql.join(
    FIXED_ASSET_CLASS_COLUMNS.map((c) => sql`${sql.id(c)} = v.${sql.id(c)}`)
  );
  await sql`UPDATE "fixedAssetClass" AS t SET ${assignments},
      "updatedBy" = ${userId}, "updatedAt" = ${now}
    FROM (VALUES ${values}) AS v(id, "companyId", ${columns})
    WHERE t."id" = v.id AND t."companyId" = v."companyId"`.execute(trx);
}

/**
 * The chart now equals the file, and every company can still post. A failure
 * means the apply and the plan disagree: a server bug, so a plain Error (500),
 * and the transaction rolls back.
 */
async function assertPostcondition(
  trx: Trx,
  groupId: string,
  companyIds: string[],
  chart: ChartRow[]
) {
  const accounts = await trx
    .selectFrom("account")
    .select([
      "id",
      "number",
      "name",
      "class",
      "accountType",
      "parentId",
      "isGroup",
      "isSystem"
    ])
    .where("companyGroupId", "=", groupId)
    .execute();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const leaves = accounts.filter((a) => !a.isGroup && !a.isSystem);
  const describe = (r: {
    number: string | null;
    name: string;
    class: string | null;
    accountType: string | null;
    group: string;
  }) =>
    [
      r.number ?? "",
      r.name,
      r.class ?? "",
      r.accountType ?? "",
      key(r.group)
    ].join("|");
  const actual = new Set(
    leaves.map((a) =>
      describe({ ...a, group: byId.get(a.parentId ?? "")?.name ?? "" })
    )
  );
  const failures: string[] = [];
  // A row with no class or type takes them from the plan; compare by number,
  // name and group for those.
  const expected = chart.map((r) =>
    r.class && r.accountType ? describe(r) : null
  );
  const loose = new Set(
    leaves.map((a) =>
      [
        a.number ?? "",
        a.name,
        key(byId.get(a.parentId ?? "")?.name ?? "")
      ].join("|")
    )
  );
  chart.forEach((r, i) => {
    const exact = expected[i];
    const found = exact
      ? actual.has(exact)
      : loose.has([r.number, r.name, key(r.group)].join("|"));
    if (!found)
      failures.push(`line ${r.line} was not written as the file says`);
  });
  if (leaves.length !== chart.length) {
    failures.push(`${leaves.length} accounts for ${chart.length} rows`);
  }
  if (
    accounts.some(
      (g) =>
        g.isGroup && !g.isSystem && !accounts.some((c) => c.parentId === g.id)
    )
  ) {
    failures.push("an empty group is left");
  }

  const leafIds = new Set(leaves.map((a) => a.id));
  const defaults = await trx
    .selectFrom("accountDefault")
    .select(["companyId", ...requiredRoles(), "migrationClearingAccount"])
    .where("companyId", "in", companyIds)
    .execute();
  for (const row of defaults) {
    for (const role of requiredRoles()) {
      if (!leafIds.has(row[role] ?? "")) {
        failures.push(`${row.companyId}: the default "${role}" has no account`);
      }
    }
    const clearing = byId.get(row.migrationClearingAccount ?? "");
    if (clearing && clearing.class !== MIGRATION_CLEARING_ACCOUNT_CLASS) {
      failures.push(`${row.companyId}: Migration Clearing is not Equity`);
    }
  }
  const classes = await trx
    .selectFrom("fixedAssetClass")
    .select(["name", ...FIXED_ASSET_CLASS_COLUMNS])
    .where("companyId", "in", companyIds)
    .execute();
  for (const fac of classes) {
    for (const column of FIXED_ASSET_CLASS_COLUMNS) {
      if (!leafIds.has(fac[column])) {
        failures.push(`fixed asset class "${fac.name}" has no ${column}`);
      }
    }
  }

  if (failures.length > 0) {
    logger.error("The chart of accounts import broke its postcondition", {
      groupId,
      failures
    });
    throw new Error("The chart of accounts import could not be applied.");
  }
}

export default applyAccountImport;
