// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase as DB } from "@carbon/database/client";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { inOrder } from "@carbon/database/rows";
import {
  accountTypeFromClass,
  buildJournalLineDimensionInserts,
  credit,
  debit,
  equals,
  round
} from "@carbon/utils";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { assertCompanyRecords } from "../company-records";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError, ServerFnError } from "../errors";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import {
  buildProjectLedgerRow,
  insertProjectLedgerRows,
  loadProjectPostingContexts,
  ProjectChargeError,
  projectPostingKey,
  resolveProjectPostingAccount,
  resolveProjectTreatment
} from "../lib/project-posting";
import { allocateJournalLineIds } from "../post-charge/journal-line-ids";

export const postProjectBurdenInput = z.object({
  indirectRateRunId: z.string(),
  accountingPeriodId: z.string(),
  /** YYYY-MM-DD, the period end. */
  postingDate: z.string(),
  postApplied: z.boolean(),
  rows: z
    .array(
      z.object({
        projectId: z.string(),
        projectElementId: z.string().nullable(),
        indirectPoolId: z.string(),
        indirectRateType: z.enum(["Provisional", "Actual", "Final"]),
        burdenFiscalYear: z.number().int(),
        amount: z.number(),
        unallowable: z.boolean()
      })
    )
    .max(10000)
});

export type PostProjectBurdenInput = z.infer<typeof postProjectBurdenInput>;

export type PostProjectBurdenResult = {
  success: true;
  journalId: string | null;
  projectLedgerIds: string[];
};

export const ACCOUNTING_PERIOD_CLOSED = "Accounting period is closed.";

/**
 * Writes the Burden rows an indirect rate run computed (one per project,
 * element, pool and unallowable flag; each amount is the catch-up delta) in
 * one transaction. The rows are memo rows unless `postApplied`: then the rows
 * of Contract projects also post applied burden, Dr the project account /
 * Cr the pool's applied account, in one journal with source type Burden. The
 * journal is Provisional before the company's accounting cutover (no
 * period) and Posted in `accountingPeriodId` after it. A Locked period
 * accepts the call (an accounting adjustment); a Closed one refuses it.
 * Called only by the commercial indirect rate runs, after their own checks.
 */
const postProjectBurden = defineServerFn({
  name: "post-project-burden",
  input: postProjectBurdenInput,
  permissions: "system",
  async run(ctx, input): Promise<PostProjectBurdenResult> {
    const { db, companyId, userId } = ctx;
    const rows = input.rows.filter((row) => !equals(round(row.amount), 0));

    return db.transaction().execute(async (trx) => {
      const period = await trx
        .selectFrom("accountingPeriod")
        .select(["id", "closeStatus", "closedAt"])
        .where("id", "=", input.accountingPeriodId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!period) throw new NotFoundError("Accounting period not found");
      if (period.closeStatus === "Closed" || period.closedAt !== null) {
        throw new ServerFnError(ACCOUNTING_PERIOD_CLOSED, 422);
      }

      const run = await trx
        .selectFrom("indirectRateRun")
        .select("id")
        .where("id", "=", input.indirectRateRunId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!run) throw new NotFoundError("Indirect rate run not found");

      if (rows.length === 0) {
        return { success: true, journalId: null, projectLedgerIds: [] };
      }

      const poolIds = [...new Set(rows.map((row) => row.indirectPoolId))];
      const [, pools] = await inOrder([
        () =>
          assertCompanyRecords(
            trx,
            "project",
            rows.map((row) => row.projectId),
            companyId,
            "Project"
          ),
        () =>
          trx
            .selectFrom("indirectPool")
            .select(["id", "name", "appliedAccountId"])
            .where("id", "in", poolIds)
            .where("companyId", "=", companyId)
            .execute()
      ]);
      if (pools.length !== poolIds.length) {
        throw new NotFoundError("Indirect pool not found");
      }
      const poolById = new Map(pools.map((pool) => [pool.id, pool]));

      // Burden catch-up is system cost: it posts to a closed project too, so
      // no assertChargeable.
      const contexts = await loadProjectPostingContexts(trx, companyId, rows);
      const contextOf = (row: (typeof rows)[number]) => {
        const context = contexts.get(
          projectPostingKey(row.projectId, row.projectElementId)
        );
        if (!context) throw new NotFoundError("Project element not found");
        return context;
      };

      // Applied burden: only the rows of Contract projects carry a journal.
      const applied = input.postApplied
        ? rows.flatMap((row, index) => {
            const context = contextOf(row);
            if (
              resolveProjectTreatment(context, input.postingDate) !== "Contract"
            ) {
              return [];
            }
            const debitAccountId = resolveProjectPostingAccount(
              context,
              input.postingDate
            ).accountId;
            const pool = poolById.get(row.indirectPoolId)!;
            if (!pool.appliedAccountId) {
              throw new ProjectChargeError(
                `Set the applied account of pool ${pool.name}.`
              );
            }
            if (!debitAccountId) return [];
            return [
              {
                index,
                row,
                debitAccountId,
                creditAccountId: pool.appliedAccountId
              }
            ];
          })
        : [];

      const debitLineIdByIndex = new Map<number, string>();
      let journalId: string | null = null;
      if (applied.length > 0) {
        journalId = await postAppliedBurdenJournal(trx, {
          companyId,
          userId,
          accountingPeriodId: period.id,
          postingDate: input.postingDate,
          indirectRateRunId: input.indirectRateRunId,
          applied,
          debitLineIdByIndex
        });
      }

      const inserted = await insertProjectLedgerRows(trx, {
        companyId,
        userId,
        rows: rows.map((row, index) => ({
          ...buildProjectLedgerRow({
            companyId,
            projectId: row.projectId,
            projectElementId: row.projectElementId,
            postingDate: input.postingDate,
            costType: "Burden",
            documentType: "Indirect Burden",
            documentId: input.indirectRateRunId,
            amount: row.amount,
            journalLineId: debitLineIdByIndex.get(index) ?? null,
            unallowable: row.unallowable,
            createdBy: userId
          }),
          indirectPoolId: row.indirectPoolId,
          indirectRateType: row.indirectRateType,
          burdenFiscalYear: row.burdenFiscalYear
        }))
      });

      return {
        success: true,
        journalId,
        projectLedgerIds: inserted.map((row) => row.id)
      };
    });
  }
});

/**
 * One journal for the applied burden of a run: a debit line on the project
 * account and a credit line on the pool's applied account per row, each
 * signed by its account's class and tagged with the Project and
 * ProjectElement dimensions. Writes each row's debit line id into
 * `debitLineIdByIndex`. Returns the journal id.
 */
async function postAppliedBurdenJournal(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    accountingPeriodId: string;
    postingDate: string;
    indirectRateRunId: string;
    applied: {
      index: number;
      row: PostProjectBurdenInput["rows"][number];
      debitAccountId: string;
      creditAccountId: string;
    }[];
    debitLineIdByIndex: Map<number, string>;
  }
): Promise<string> {
  const { companyId, applied } = args;
  // FOR SHARE holds the status until the transaction commits.
  const status = await journalPostingStatus(trx, companyId);

  const accountIds = [
    ...new Set(
      applied.flatMap((line) => [line.debitAccountId, line.creditAccountId])
    )
  ];
  const [accounts, dimensions] = await inOrder([
    () =>
      trx
        .selectFrom("account")
        .innerJoin(
          "company",
          "company.companyGroupId",
          "account.companyGroupId"
        )
        .select(["account.id", "account.class"])
        .where("company.id", "=", companyId)
        .where("account.id", "in", accountIds)
        .execute(),
    () =>
      trx
        .selectFrom("dimension")
        .innerJoin(
          "company",
          "company.companyGroupId",
          "dimension.companyGroupId"
        )
        .select(["dimension.id", "dimension.entityType"])
        .where("company.id", "=", companyId)
        .where("dimension.active", "=", true)
        .where("dimension.entityType", "in", ["Project", "ProjectElement"])
        .execute()
  ]);
  const classById = new Map(
    accounts.map((account) => [account.id, account.class])
  );
  const accountType = (accountId: string) => {
    const accountClass = classById.get(accountId);
    if (!accountClass) throw new NotFoundError("Account not found");
    return accountTypeFromClass(accountClass);
  };

  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    // A Provisional journal has no period; a Posted one takes the run's.
    accountingPeriodId: status === "Posted" ? args.accountingPeriodId : null,
    status,
    description: "Applied burden",
    postingDate: args.postingDate,
    userId: args.userId,
    sourceType: "Burden"
  });

  const lines = applied.flatMap((line) => {
    const amount = round(line.row.amount);
    return [
      {
        accountId: line.debitAccountId,
        description: "Applied burden",
        amount: debit(accountType(line.debitAccountId), amount)
      },
      {
        accountId: line.creditAccountId,
        description: "Applied burden",
        amount: credit(accountType(line.creditAccountId), amount)
      }
    ];
  });
  const lineIds = await allocateJournalLineIds(trx, lines.length);
  const journalLineReference = nanoid();
  await trx
    .insertInto("journalLine")
    .values(
      lines.map((line, i) => ({
        id: lineIds[i]!,
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: line.amount,
        quantity: 1,
        documentType: "Burden" as const,
        documentId: args.indirectRateRunId,
        documentLineReference: `burden:${args.indirectRateRunId}`,
        journalLineReference,
        companyId
      }))
    )
    .execute();

  applied.forEach((line, i) => {
    args.debitLineIdByIndex.set(line.index, lineIds[i * 2]!);
  });

  const dimensionMap = new Map<string, string>();
  for (const dimension of dimensions) {
    if (dimension.entityType) {
      dimensionMap.set(dimension.entityType, dimension.id);
    }
  }
  const tags = buildJournalLineDimensionInserts({
    journalLineIds: lineIds,
    meta: applied.flatMap((line) => {
      const meta = {
        projectId: line.row.projectId,
        projectElementId: line.row.projectElementId
      };
      return [meta, meta];
    }),
    dimensionMap,
    companyId
  });
  if (tags.length > 0) {
    await trx.insertInto("journalLineDimension").values(tags).execute();
  }

  return journalId;
}

export default postProjectBurden;
