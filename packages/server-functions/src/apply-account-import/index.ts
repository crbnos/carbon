// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Applies a chart of accounts import (.ai/specs/2026-10-12-chart-of-accounts-import.md)
// in one transaction. The plan is computed again here from the same pure
// planner the review page used, so the client never decides what is written.
// The chart is group-scoped: a re-point moves references in every company of
// the group that uses the account.

import { getCompanyTimeZone } from "@carbon/database";
import {
  type AccountImportContext,
  type AccountImportPlan,
  incomeBalanceOf,
  isApplicable,
  planAccountImport,
  REFERENCE_POLICY,
  requiredRoles
} from "@carbon/database/account-import";
import { loadAccountImportContext } from "@carbon/database/account-import-reads";
import type { KyselyDatabase } from "@carbon/database/client";
import { getNextSequence } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { sql, type Transaction, type Updateable } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";

const logger = getLogger("server-functions", "apply-account-import");

export const applyAccountImportInput = z.object({
  rows: z
    .array(
      z.object({
        line: z.number().int(),
        number: z.string().min(1),
        name: z.string().min(1),
        class: z
          .enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
          .nullable(),
        accountType: z.string().nullable(),
        group: z.string().min(1),
        carbonAccounts: z.array(z.string())
      })
    )
    .min(1),
  resolutions: z.object({
    targets: z.record(z.string(), z.number().int())
  })
});

export type ApplyAccountImportResult = {
  counts: {
    renamed: number;
    reactivated: number;
    created: number;
    merged: number;
    deleted: number;
    deactivated: number;
  };
  reclassJournalIds: string[];
};

export const RECLASS_DESCRIPTION = "Chart of accounts import";

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
    SET "metadata" = jsonb_set(t."metadata", '{paymentFeeAccount}', to_jsonb(m.target))
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
    { rows, resolutions }
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

      // Nothing else may change the chart while the plan is applied.
      await sql`SELECT "id" FROM "account" WHERE "companyGroupId" = ${groupId} FOR UPDATE`.execute(
        trx
      );

      const ctx = await loadAccountImportContext(trx, groupId, companyId);
      const plan = planAccountImport(rows, ctx, resolutions);
      if (!isApplicable(plan)) {
        logger.warn("Refused an account import that is not applicable", {
          companyId,
          errors: plan.errors.length,
          exceptions: plan.exceptions.length
        });
        throw new InvalidInputError(
          `The import has ${plan.errors.length} error(s) and ${plan.exceptions.length} account(s) that need a target`
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
      for (const group of plan.groupCreates) {
        const incomeBalance = incomeBalanceOf(group.class);
        const parentId = rootByBalance.get(incomeBalance);
        if (!parentId) {
          throw new InvalidInputError(`No ${incomeBalance} root account`);
        }
        const inserted = await trx
          .insertInto("account")
          .values({
            name: group.name,
            number: null,
            isGroup: true,
            class: group.class,
            incomeBalance,
            parentId,
            companyGroupId: groupId,
            createdBy: userId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        groupIdByName.set(key(group.name), inserted.id);
      }
      const groupIdOf = (name: string) => {
        const id = groupIdByName.get(key(name));
        if (!id) throw new InvalidInputError(`Unknown group "${name}"`);
        return id;
      };

      // Free the numbers and names that are about to change or go: renamed
      // accounts may swap, and a deleted account's number may be reused.
      const freed = [
        ...plan.renames.map((r) => r.accountId),
        ...plan.retires
          .filter((r) => r.mode === "delete")
          .map((r) => r.accountId)
      ];
      if (freed.length > 0) {
        await sql`UPDATE "account"
          SET "number" = '__import_' || "id", "name" = '__import_' || "id"
          WHERE "id" IN (${sql.join(freed)}) AND "companyGroupId" = ${groupId}`.execute(
          trx
        );
      }

      // Renames.
      if (plan.renames.length > 0) {
        const values = sql.join(
          plan.renames.map(
            (r) =>
              sql`(${r.accountId}, ${r.number}, ${r.name}, ${r.accountType}, ${r.class}, ${incomeBalanceOf(r.class)}, ${groupIdOf(r.group)}, ${r.reactivate})`
          )
        );
        await sql`UPDATE "account" AS a SET
            "number" = v.number,
            "name" = v.name,
            "accountType" = v."accountType"::"accountType",
            "class" = v.class::"glAccountClass",
            "incomeBalance" = v."incomeBalance"::"glIncomeBalance",
            "parentId" = v."parentId",
            "active" = CASE WHEN v.reactivate THEN true ELSE a."active" END,
            "updatedBy" = ${userId},
            "updatedAt" = ${now}
          FROM (VALUES ${values}) AS v(id, number, name, "accountType", class, "incomeBalance", "parentId", reactivate)
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

      // Merges: re-point every movable reference.
      const pairs = plan.merges.map((m) => ({
        source: m.sourceId,
        target: accountOfLine(m.targetLine)
      }));
      if (pairs.length > 0) {
        await repointReferences(trx, pairs, companyIds);
      }

      // Default roles, one statement per company of the group.
      const movesByCompany = new Map<string, AccountImportPlan["roleMoves"]>();
      for (const move of plan.roleMoves) {
        const list = movesByCompany.get(move.companyId) ?? [];
        list.push(move);
        movesByCompany.set(move.companyId, list);
      }
      for (const [moveCompanyId, moves] of movesByCompany) {
        const set: Record<string, string | null> = {};
        for (const move of moves) {
          set[move.role] =
            move.toLine === null ? null : accountOfLine(move.toLine);
        }
        await trx
          .updateTable("accountDefault")
          .set({
            ...(set as Updateable<KyselyDatabase["accountDefault"]>),
            updatedBy: userId
          })
          .where("companyId", "=", moveCompanyId)
          .execute();
      }

      // Reclass journals, one per company with a posted balance to move.
      const reclassJournalIds: string[] = [];
      const reclassesByCompany = new Map<
        string,
        AccountImportPlan["reclasses"]
      >();
      for (const reclass of plan.reclasses) {
        const list = reclassesByCompany.get(reclass.companyId) ?? [];
        list.push(reclass);
        reclassesByCompany.set(reclass.companyId, list);
      }
      const numberOf = new Map(
        ctx.chart.map((a) => [a.id, a.number ?? a.name])
      );
      for (const [reclassCompanyId, reclasses] of reclassesByCompany) {
        const today = datetime
          .today(await getCompanyTimeZone(trx, reclassCompanyId))
          .toString();
        const period = await resolveAccountingPeriod(
          trx,
          reclassCompanyId,
          today,
          "current"
        );
        const journal = await trx
          .insertInto("journal")
          .values({
            journalEntryId: await getNextSequence(
              trx,
              "journalEntry",
              reclassCompanyId
            ),
            accountingPeriodId: period.id,
            description: RECLASS_DESCRIPTION,
            postingDate: period.postingDate,
            sourceType: "Manual",
            status: "Posted",
            postedAt: now,
            postedBy: userId,
            companyId: reclassCompanyId,
            createdBy: userId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("journalLine")
          .values(
            reclasses.flatMap((r) => {
              const target = accountOfLine(r.targetLine);
              const description = `${RECLASS_DESCRIPTION}: ${numberOf.get(r.sourceId)} → ${
                rows.find((row) => row.line === r.targetLine)?.number ?? ""
              }`;
              // Both accounts share a class, so the stored amount moves as is.
              return [
                {
                  journalId: journal.id,
                  accountId: r.sourceId,
                  amount: -r.amount,
                  description,
                  journalLineReference: nanoid(),
                  companyId: reclassCompanyId,
                  createdBy: userId
                },
                {
                  journalId: journal.id,
                  accountId: target,
                  amount: r.amount,
                  description,
                  journalLineReference: nanoid(),
                  companyId: reclassCompanyId,
                  createdBy: userId
                }
              ];
            })
          )
          .execute();
        reclassJournalIds.push(journal.id);
      }

      // Retires.
      const deleteIds = plan.retires
        .filter((r) => r.mode === "delete")
        .map((r) => r.accountId);
      const deactivateIds = plan.retires
        .filter((r) => r.mode === "deactivate")
        .map((r) => r.accountId);
      if (deleteIds.length > 0) {
        await trx
          .deleteFrom("account")
          .where("id", "in", deleteIds)
          .where("companyGroupId", "=", groupId)
          .execute();
      }
      if (deactivateIds.length > 0) {
        await trx
          .updateTable("account")
          .set({ active: false, updatedBy: userId, updatedAt: now })
          .where("id", "in", deactivateIds)
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

      await assertPostcondition(trx, groupId, companyIds, rows, ctx);

      return {
        counts: {
          renamed: plan.renames.length,
          reactivated: plan.renames.filter((r) => r.reactivate).length,
          created: plan.creates.length,
          merged: plan.merges.length,
          deleted: deleteIds.length,
          deactivated: deactivateIds.length
        },
        reclassJournalIds
      };
    });
  }
});

/** The chart now equals the sheet, and every company can still post. */
async function assertPostcondition(
  trx: Trx,
  groupId: string,
  companyIds: string[],
  rows: { number: string; name: string }[],
  before: AccountImportContext
) {
  const active = await trx
    .selectFrom("account")
    .select(["id", "number", "name", "class"])
    .where("companyGroupId", "=", groupId)
    .where("isGroup", "=", false)
    .where("active", "=", true)
    .execute();
  const sheetNumbers = new Set(rows.map((r) => r.number.trim()));
  const chartNumbers = new Set(active.map((a) => a.number ?? ""));
  const missing = [...sheetNumbers].filter((n) => !chartNumbers.has(n));
  const extra = [...chartNumbers].filter((n) => !sheetNumbers.has(n));
  if (missing.length > 0 || extra.length > 0) {
    throw new InvalidInputError(
      "The chart does not match the sheet after the import",
      { missing, extra }
    );
  }

  const activeById = new Map(active.map((a) => [a.id, a]));
  const defaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "in", companyIds)
    .execute();
  for (const row of defaults) {
    for (const role of requiredRoles()) {
      // A role that was empty before the import is readiness's to report.
      if (!before.defaultsByCompany[row.companyId]?.[role]) continue;
      const accountId = row[role] as string | null;
      if (!accountId || !activeById.has(accountId)) {
        throw new InvalidInputError(
          `The import would leave the default "${role}" without an active account`
        );
      }
    }
    const clearing = activeById.get(row.migrationClearingAccount ?? "");
    if (clearing && clearing.class !== "Equity") {
      throw new InvalidInputError(
        "Migration Clearing must be an Equity account"
      );
    }
  }
}

export default applyAccountImport;
