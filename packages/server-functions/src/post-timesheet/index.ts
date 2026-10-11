// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { journalReference } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { inOrder, single } from "@carbon/database/rows";
import { datetime, type ServiceCoverage } from "@carbon/utils";
import {
  type Insertable,
  type Selectable,
  sql,
  type Transaction
} from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import { buildProjectCipRow, writeProjectCipRows } from "../lib/project-cip";
import {
  buildBillableItem,
  buildProjectLedgerRow,
  insertProjectLedgerRows,
  loadProjectPostingContexts,
  loadServicePostingContexts,
  ProjectChargeError,
  projectPostingKey,
  reverseBillableItem,
  type ServicePostingContext,
  serviceChargeCoverage,
  startElementsOnFirstCharge
} from "../lib/project-posting";
import { allocateJournalLineIds } from "../post-charge/journal-line-ids";
import {
  planTimesheetPosting,
  type TimesheetJournalLine,
  type TimesheetLedgerRow,
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
 *
 * A Service project's entry also posts from Draft (service time posts at Stop
 * work, with no submit or approval). Its coverage decides the account: a
 * stored coverage with a reason is the user's override, a reversal takes its
 * original's, and any other entry gets `resolveCoverage`, stored on the entry.
 * It writes a billable item; a reversal reverses its original's.
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
          "reversalOfId",
          "note",
          "coverage",
          "coverageReason",
          (eb) =>
            eb
              .selectFrom("project")
              .select("project.projectType")
              .whereRef("project.id", "=", "timesheetEntry.projectId")
              .whereRef("project.companyId", "=", "timesheetEntry.companyId")
              .as("projectType")
        ])
        .where("id", "in", entryIds)
        .where("companyId", "=", companyId)
        .orderBy("id")
        .forUpdate()
        .execute();

      const entries = locked
        .filter(
          (entry) =>
            (entry.status === "Submitted" ||
              entry.status === "Approved" ||
              (entry.status === "Draft" && entry.projectType === "Service")) &&
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
          reversalOfId: entry.reversalOfId,
          isService: entry.projectType === "Service",
          note: entry.note,
          coverage: entry.coverage as ServiceCoverage | null,
          coverageReason: entry.coverageReason,
          customerId: null as string | null
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

      const serviceEntries = entries.filter((e) => e.isService);
      const [
        contexts,
        rates,
        originals,
        originalLedger,
        accountDefaults,
        services
      ] = await inOrder([
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
                "id" | "costRate" | "coverage" | "coverageReason"
              >[])
            : trx
                .selectFrom("timesheetEntry")
                .select(["id", "costRate", "coverage", "coverageReason"])
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
                // Not reversed by a later row: a coverage reclass reverses
                // a service row and writes its replacement.
                .where(({ not, exists, selectFrom }) =>
                  not(
                    exists(
                      selectFrom("projectLedger as reversal")
                        .select("reversal.id")
                        .whereRef(
                          "reversal.reversalOfId",
                          "=",
                          "projectLedger.id"
                        )
                        .whereRef(
                          "reversal.companyId",
                          "=",
                          "projectLedger.companyId"
                        )
                    )
                  )
                )
                .where("companyId", "=", companyId)
                .execute(),
        () =>
          trx
            .selectFrom("accountDefault")
            .select(["laborAbsorptionAccount"])
            .where("companyId", "=", companyId)
            .executeTakeFirst(),
        () =>
          loadServicePostingContexts(
            trx,
            companyId,
            serviceEntries.map((e) => ({
              projectId: e.projectId,
              projectElementId: e.projectElementId
            }))
          )
      ]);

      // A Service entry's coverage: a reversal posts to its original's
      // account, a stored coverage with a reason is the user's override, and
      // any other entry gets the coverage its date and the asset decide.
      const originalCoverage = new Map(
        originals.map((original) => [original.id, original])
      );
      for (const entry of serviceEntries) {
        const service = services.get(
          projectPostingKey(entry.projectId, entry.projectElementId)
        );
        if (!service) {
          throw new ProjectChargeError(
            "No service order owns the project of this timesheet entry"
          );
        }
        entry.customerId = service.customerId;
        const original = entry.reversalOfId
          ? originalCoverage.get(entry.reversalOfId)
          : undefined;
        if (original) {
          entry.coverage = original.coverage as ServiceCoverage | null;
          entry.coverageReason = original.coverageReason;
        } else if (!(entry.coverage && entry.coverageReason)) {
          entry.coverage = serviceChargeCoverage(
            service,
            "Time",
            entry.entryDate
          );
          entry.coverageReason = null;
        }
      }

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
            "Employee",
            "Customer"
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
                ["Employee", line.employeeId],
                ["Customer", line.customerId]
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
        const insertedLedger = await insertProjectLedgerRows(trx, {
          companyId,
          userId,
          rows: plan.ledgerRows.map((row) =>
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
              coverage: row.coverage,
              coverageReason: row.coverageReason,
              createdBy: userId
            })
          )
        });

        await writeServiceBillableItems(trx, {
          companyId,
          userId,
          entries: serviceEntries,
          ledgerRows: plan.ledgerRows,
          ledgerIdByEntry: new Map(
            insertedLedger.map((row) => [row.documentId, row.id])
          ),
          services
        });

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

      // One statement for every entry: each carries its own rate and journal,
      // and a Service entry its coverage.
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));
      const postedAt = datetime.timestamp();
      await sql`
        UPDATE "timesheetEntry" t
        SET "status" = 'Posted',
            "costRate" = v."costRate",
            "journalId" = v."journalId",
            "coverage" = COALESCE(v."coverage"::"serviceCoverage", t."coverage"),
            "coverageReason" = CASE WHEN v."coverage" IS NULL
              THEN t."coverageReason" ELSE v."coverageReason" END,
            "postedAt" = ${postedAt}::timestamptz,
            "updatedBy" = ${userId},
            "updatedAt" = ${postedAt}::timestamptz
        FROM (VALUES ${sql.join(
          plan.stamps.map((stamp) => {
            const entry = entryById.get(stamp.entryId);
            const coverage = entry?.isService ? entry.coverage : null;
            return sql`(${stamp.entryId}, ${stamp.costRate}::numeric, ${
              journalIdByEntry.get(stamp.entryId) ?? null
            }::text, ${coverage}::text, ${
              coverage ? (entry?.coverageReason ?? null) : null
            }::text)`;
          })
        )}) AS v("id", "costRate", "journalId", "coverage", "coverageReason")
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

/**
 * The billable items of the Service entries just posted: a new item per
 * entry, priced by the service labor item, and for a reversal the reversal of
 * its original's item (written off while unbilled, else a negative copy).
 */
async function writeServiceBillableItems(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    entries: {
      id: string;
      note: string | null;
      coverage: ServiceCoverage | null;
      reversalOfId: string | null;
      projectId: string;
      projectElementId: string | null;
    }[];
    ledgerRows: TimesheetLedgerRow[];
    ledgerIdByEntry: Map<string, string>;
    services: Map<string, ServicePostingContext>;
  }
): Promise<void> {
  const { companyId, userId } = args;
  const entryById = new Map(args.entries.map((entry) => [entry.id, entry]));
  const rows = args.ledgerRows.filter((row) => entryById.has(row.entryId));
  if (rows.length === 0) return;

  // The originals' items, for the reversals: one query.
  const originalLedgerIds = rows
    .map((row) => row.reversalOfId)
    .filter((id): id is string => Boolean(id));
  const originalItems =
    originalLedgerIds.length === 0
      ? []
      : await trx
          .selectFrom("projectBillableItem")
          .selectAll()
          .where("projectLedgerId", "in", originalLedgerIds)
          .where("reversalOfId", "is", null)
          .where("companyId", "=", companyId)
          .execute();
  const itemByLedger = new Map(
    originalItems.map((item) => [item.projectLedgerId, item])
  );

  const inserts: Insertable<DB["projectBillableItem"]>[] = [];
  const writeOffIds: string[] = [];
  for (const row of rows) {
    const entry = entryById.get(row.entryId)!;
    const ledgerId = args.ledgerIdByEntry.get(row.entryId);
    if (!ledgerId) continue;

    if (row.reversalOfId) {
      const original = itemByLedger.get(row.reversalOfId);
      if (!original) continue;
      const reversal = reverseBillableItem(
        {
          ...original,
          quantity: Number(original.quantity),
          unitPrice: Number(original.unitPrice),
          amount: Number(original.amount)
        },
        { projectLedgerId: ledgerId, createdBy: userId }
      );
      if (reversal.update) writeOffIds.push(original.id);
      if (reversal.insert) inserts.push(reversal.insert);
      continue;
    }

    if (!entry.coverage) continue;
    const service = args.services.get(
      projectPostingKey(entry.projectId, entry.projectElementId)
    );
    const item = buildBillableItem({
      ledgerRow: {
        id: ledgerId,
        companyId,
        projectId: row.projectId,
        projectElementId: row.projectElementId,
        costType: "Labor",
        quantity: row.quantity,
        amount: row.amount,
        itemId: service?.laborItemId ?? null,
        createdBy: userId
      },
      coverage: entry.coverage,
      laborPrice: service?.laborPrice ?? null,
      partPrice: null,
      description: entry.note?.trim() || "Labor"
    });
    if (item) inserts.push(item);
  }

  if (writeOffIds.length > 0) {
    await trx
      .updateTable("projectBillableItem")
      .set({
        status: "Written Off",
        statusReason: "Reversed",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "in", writeOffIds)
      .where("companyId", "=", companyId)
      .execute();
  }
  if (inserts.length > 0) {
    await trx.insertInto("projectBillableItem").values(inserts).execute();
  }
}

export default postTimesheet;
