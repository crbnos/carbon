// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { journalReference } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { inOrder, single } from "@carbon/database/rows";
import { datetime } from "@carbon/utils";
import { type Selectable, sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import { buildProjectCipRow, writeProjectCipRows } from "../lib/project-cip";
import {
  buildProjectLedgerRow,
  loadProjectPostingContexts,
  startElementsOnFirstCharge
} from "../lib/project-posting";
import { allocateJournalLineIds } from "../post-charge/journal-line-ids";
import {
  planTimesheetPosting,
  type TimesheetJournalLine,
  type TimesheetOriginal
} from "./plan";

export const postTimesheetInput = z.object({
  timesheetEntryIds: z.array(z.string()).min(1)
});

export type PostTimesheetResult = {
  success: true;
  postedEntryIds: string[];
  journalIds: string[];
};

/**
 * Posts Submitted or Approved timesheet entries: the cost (hours × the labor
 * category's rate, or the original's rate for a reversal) goes Dr the project
 * account / Cr laborAbsorptionAccount, one projectLedger row per entry, and
 * each entry is stamped Posted. A Statistical project writes no journal and no
 * ledger row. Entries that are not postable (Draft, Rejected, already posted)
 * are skipped. The ERP checks who may post (approval routing) before it calls.
 */
const postTimesheet = defineServerFn({
  name: "post-timesheet",
  input: postTimesheetInput,
  permissions: { update: "projects" },
  async run(ctx, { timesheetEntryIds }): Promise<PostTimesheetResult> {
    const { db, companyId, userId } = ctx;
    const entryIds = [...new Set(timesheetEntryIds)];

    const settings = await single(
      db,
      "companySettings",
      { id: companyId },
      { columns: ["accountingEnabled"] }
    );
    const accountingEnabled = settings.data?.accountingEnabled ?? false;

    return db.transaction().execute(async (trx) => {
      // Row locks: two posts of one entry must not both post it.
      const locked = await trx
        .selectFrom("timesheetEntry")
        .select([
          "id",
          "employeeId",
          "entryDate",
          "projectId",
          "projectElementId",
          "laborCategoryId",
          "hours",
          "status",
          "postedAt",
          "reversalOfId"
        ])
        .where("id", "in", entryIds)
        .where("companyId", "=", companyId)
        .orderBy("id")
        .forUpdate()
        .execute();

      const entries = locked
        .filter(
          (entry) =>
            (entry.status === "Submitted" || entry.status === "Approved") &&
            entry.postedAt === null
        )
        .map((entry) => ({
          id: entry.id,
          employeeId: entry.employeeId,
          entryDate: entry.entryDate,
          projectId: entry.projectId,
          projectElementId: entry.projectElementId,
          laborCategoryId: entry.laborCategoryId,
          hours: Number(entry.hours),
          reversalOfId: entry.reversalOfId
        }));
      if (entries.length === 0) {
        return { success: true, postedEntryIds: [], journalIds: [] };
      }

      const categoryIds = [...new Set(entries.map((e) => e.laborCategoryId))];
      const originalIds = [
        ...new Set(
          entries
            .map((e) => e.reversalOfId)
            .filter((id): id is string => Boolean(id))
        )
      ];

      const [contexts, rates, originals, originalLedger, accountDefaults] =
        await inOrder([
          () =>
            loadProjectPostingContexts(
              trx,
              companyId,
              entries.map((e) => ({
                projectId: e.projectId,
                projectElementId: e.projectElementId
              }))
            ),
          () =>
            trx
              .selectFrom("laborCategoryRate")
              .select(["laborCategoryId", "effectiveFrom", "costRate"])
              .where("laborCategoryId", "in", categoryIds)
              .where("companyId", "=", companyId)
              .execute(),
          async () =>
            originalIds.length === 0
              ? ([] as Pick<
                  Selectable<DB["timesheetEntry"]>,
                  "id" | "costRate"
                >[])
              : trx
                  .selectFrom("timesheetEntry")
                  .select(["id", "costRate"])
                  .where("id", "in", originalIds)
                  .where("companyId", "=", companyId)
                  .execute(),
          async () =>
            originalIds.length === 0
              ? ([] as Pick<
                  Selectable<DB["projectLedger"]>,
                  "id" | "documentId"
                >[])
              : trx
                  .selectFrom("projectLedger")
                  .select(["id", "documentId"])
                  .where("documentType", "=", "Timesheet")
                  .where("documentId", "in", originalIds)
                  .where("reversalOfId", "is", null)
                  .where("companyId", "=", companyId)
                  .execute(),
          () =>
            trx
              .selectFrom("accountDefault")
              .select(["laborAbsorptionAccount"])
              .where("companyId", "=", companyId)
              .executeTakeFirst()
        ]);

      const ledgerRowByEntry = new Map(
        originalLedger.map((row) => [row.documentId, row.id])
      );
      const originalById = new Map<string, TimesheetOriginal>(
        originals.map((original) => [
          original.id,
          {
            id: original.id,
            costRate:
              original.costRate === null ? null : Number(original.costRate),
            ledgerRowId: ledgerRowByEntry.get(original.id) ?? null
          }
        ])
      );

      const plan = planTimesheetPosting(
        entries,
        contexts,
        rates.map((rate) => ({
          laborCategoryId: rate.laborCategoryId,
          effectiveFrom: rate.effectiveFrom,
          costRate: Number(rate.costRate)
        })),
        originalById,
        {
          accountingEnabled,
          laborAbsorptionAccount:
            accountDefaults?.laborAbsorptionAccount ?? null
        }
      );

      // Journals: one per accounting period the entries fall in, dated the
      // period's latest entry date.
      const journalIdByEntry = new Map<string, string>();
      const debitLineIdByEntry = new Map<string, string>();
      const journalIds: string[] = [];

      if (plan.lines.length > 0) {
        const periodByDate = new Map<string, string>();
        for (const date of [
          ...new Set(plan.lines.map((l) => l.postingDate))
        ].sort()) {
          const period = await resolveAccountingPeriod(
            trx,
            companyId,
            date,
            "current"
          );
          periodByDate.set(date, period.id);
        }

        const linesByPeriod = new Map<string, TimesheetJournalLine[]>();
        for (const line of plan.lines) {
          const periodId = periodByDate.get(line.postingDate)!;
          const group = linesByPeriod.get(periodId) ?? [];
          group.push(line);
          linesByPeriod.set(periodId, group);
        }

        const dimensions = await trx
          .selectFrom("dimension")
          .innerJoin(
            "company",
            "company.companyGroupId",
            "dimension.companyGroupId"
          )
          .select(["dimension.id", "dimension.entityType"])
          .where("company.id", "=", companyId)
          .where("dimension.active", "=", true)
          .where("dimension.entityType", "in", [
            "Project",
            "ProjectElement",
            "Employee"
          ])
          .execute();
        const dimensionIdByType = new Map(
          dimensions
            .filter((d) => d.entityType)
            .map((d) => [d.entityType as string, d.id])
        );

        for (const [accountingPeriodId, lines] of linesByPeriod) {
          const postingDate = lines.reduce(
            (latest, line) =>
              line.postingDate > latest ? line.postingDate : latest,
            lines[0]!.postingDate
          );
          const journalId = await createAdjustmentJournal(trx, {
            companyId,
            accountingPeriodId,
            description: "Project Timesheet",
            postingDate,
            userId,
            sourceType: "Timesheet"
          });
          journalIds.push(journalId);

          const lineIds = await allocateJournalLineIds(trx, lines.length);
          const journalLineReference = nanoid();
          await trx
            .insertInto("journalLine")
            .values(
              lines.map((line, index) => ({
                id: lineIds[index]!,
                journalId,
                accountId: line.accountId,
                description: line.description,
                amount: line.amount,
                quantity: 1,
                documentType: "Timesheet" as const,
                documentId: line.entryId,
                documentLineReference: journalReference.to.timesheet(
                  line.entryId
                ),
                journalLineReference,
                companyId
              }))
            )
            .execute();

          const dimensionRows = lines.flatMap((line, index) =>
            (
              [
                ["Project", line.projectId],
                ["ProjectElement", line.projectElementId],
                ["Employee", line.employeeId]
              ] as const
            ).flatMap(([entityType, valueId]) => {
              const dimensionId = dimensionIdByType.get(entityType);
              return dimensionId && valueId
                ? [
                    {
                      journalLineId: lineIds[index]!,
                      dimensionId,
                      valueId,
                      companyId
                    }
                  ]
                : [];
            })
          );
          if (dimensionRows.length > 0) {
            await trx
              .insertInto("journalLineDimension")
              .values(dimensionRows)
              .execute();
          }

          lines.forEach((line, index) => {
            journalIdByEntry.set(line.entryId, journalId);
            if (line.isProjectDebit) {
              debitLineIdByEntry.set(line.entryId, lineIds[index]!);
            }
          });
        }
      }

      if (plan.ledgerRows.length > 0) {
        await trx
          .insertInto("projectLedger")
          .values(
            plan.ledgerRows.map((row) =>
              buildProjectLedgerRow({
                companyId,
                projectId: row.projectId,
                projectElementId: row.projectElementId,
                postingDate: row.postingDate,
                costType: "Labor",
                documentType: "Timesheet",
                documentId: row.entryId,
                employeeId: row.employeeId,
                laborCategoryId: row.laborCategoryId,
                quantity: row.quantity,
                unitOfMeasureCode: "HR",
                amount: row.amount,
                journalLineId: debitLineIdByEntry.get(row.entryId) ?? null,
                reversalOfId: row.reversalOfId,
                createdBy: userId
              })
            )
          )
          .execute();

        // A Capitalize entry also builds its asset.
        await writeProjectCipRows(trx, {
          companyId,
          userId,
          rows: plan.ledgerRows.map((row) =>
            buildProjectCipRow({
              resolved: row,
              companyId,
              userId,
              projectId: row.projectId,
              projectElementId: row.projectElementId,
              sourceType: "Timesheet",
              sourceDocumentId: row.entryId,
              amount: row.amount,
              costDate: row.postingDate,
              journalId: journalIdByEntry.get(row.entryId) ?? null
            })
          )
        });
      }

      // One statement for every entry: each carries its own rate and journal.
      const postedAt = datetime.timestamp();
      await sql`
        UPDATE "timesheetEntry" t
        SET "status" = 'Posted',
            "costRate" = v."costRate",
            "journalId" = v."journalId",
            "postedAt" = ${postedAt}::timestamptz,
            "updatedBy" = ${userId},
            "updatedAt" = ${postedAt}::timestamptz
        FROM (VALUES ${sql.join(
          plan.stamps.map(
            (stamp) =>
              sql`(${stamp.entryId}, ${stamp.costRate}::numeric, ${
                journalIdByEntry.get(stamp.entryId) ?? null
              }::text)`
          )
        )}) AS v("id", "costRate", "journalId")
        WHERE t."id" = v."id" AND t."companyId" = ${companyId}
      `.execute(trx);

      await startElementsOnFirstCharge(
        trx,
        companyId,
        entries.filter((e) => !e.reversalOfId).map((e) => e.projectElementId)
      );

      return {
        success: true,
        postedEntryIds: plan.stamps.map((stamp) => stamp.entryId),
        journalIds
      };
    });
  }
});

export default postTimesheet;
