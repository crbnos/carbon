// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { journalReference } from "@carbon/database";
import { single } from "@carbon/database/rows";
import {
  credit,
  datetime,
  debit,
  round,
  type ServiceCoverage
} from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import { postProjectJournal } from "../lib/project-journal";
import {
  assertChargeable,
  buildBillableItem,
  buildProjectLedgerRow,
  insertProjectLedgerRows,
  isUnallowableCharge,
  loadProjectPostingContexts,
  loadServicePostingContext,
  ProjectChargeError,
  projectPostingKey,
  resolveProjectPostingAccount,
  reverseBillableItem,
  serviceChargeCoverage,
  startElementsOnFirstCharge
} from "../lib/project-posting";

export const postProjectExpenseInput = z.object({
  projectExpenseEntryId: z.string()
});

export type PostProjectExpenseResult = {
  success: true;
  /** False when the entry was already posted. */
  posted: boolean;
  journalId: string | null;
  projectLedgerId: string | null;
};

/**
 * Posts a project expense entry (a cost with no invoice: mileage, a meal, a
 * part bought on a card): Dr the project account / Cr
 * goodsReceivedNotInvoicedAccount, with `sourceType 'Project Expense'` and the
 * Project, Project Element and Employee dimensions, plus one projectLedger row
 * of type Other Direct. With accounting off only the ledger row is written. A
 * Statistical project charges indirectCostAccount and writes no ledger row.
 *
 * On a Service project the coverage decides the account (the user's override
 * with a reason, else `resolveCoverage` for an expense), the journal carries
 * the Customer dimension, and the charge writes a billable item at its
 * amount. A reversal entry (`reversalOfId`) posts its own (negative) amount at
 * its original's coverage and reverses the original's billable item.
 * Posting twice is a no-op.
 */
const postProjectExpense = defineServerFn({
  name: "post-project-expense",
  input: postProjectExpenseInput,
  permissions: { update: "projects" },
  async run(ctx, { projectExpenseEntryId }): Promise<PostProjectExpenseResult> {
    const { db, companyId, userId } = ctx;

    const settings = await single(
      db,
      "companySettings",
      { id: companyId },
      { columns: ["accountingEnabled"] }
    );
    if (settings.error) throw new Error("Failed to fetch company settings");
    const accountingEnabled = settings.data?.accountingEnabled ?? false;

    return db.transaction().execute(async (trx) => {
      // Row lock: two posts of one entry must not both post it.
      const entry = await trx
        .selectFrom("projectExpenseEntry")
        .selectAll()
        .where("id", "=", projectExpenseEntryId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!entry) throw new NotFoundError("Expense entry not found");

      const alreadyPosted = await trx
        .selectFrom("projectLedger")
        .select("id")
        .where("documentType", "=", "Project Expense")
        .where("documentId", "=", entry.id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (entry.journalId || alreadyPosted) {
        return {
          success: true,
          posted: false,
          journalId: entry.journalId,
          projectLedgerId: alreadyPosted?.id ?? null
        };
      }

      const isReversal = Boolean(entry.reversalOfId);
      const contexts = await loadProjectPostingContexts(trx, companyId, [
        {
          projectId: entry.projectId,
          projectElementId: entry.projectElementId
        }
      ]);
      const context = contexts.get(
        projectPostingKey(entry.projectId, entry.projectElementId)
      );
      if (!context) throw new NotFoundError("Project element not found");
      assertChargeable(context, isReversal ? "commitment" : "new");

      // The original's open ledger row: not reversed by a later row (a
      // coverage reclass reverses and replaces it).
      const original = entry.reversalOfId
        ? await sql<{
            id: string;
            coverage: ServiceCoverage | null;
            coverageReason: string | null;
          }>`
            SELECT pl."id", pl."coverage", pl."coverageReason"
            FROM "projectLedger" pl
            WHERE pl."documentType" = 'Project Expense'
              AND pl."documentId" = ${entry.reversalOfId}
              AND pl."companyId" = ${companyId}
              AND pl."reversalOfId" IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM "projectLedger" r
                WHERE r."reversalOfId" = pl."id" AND r."companyId" = pl."companyId"
              )
            ORDER BY pl."createdAt" DESC, pl."id" DESC
            LIMIT 1
          `
            .execute(trx)
            .then((result) => result.rows[0] ?? null)
        : null;

      const isService = context.project.costTreatment === "By Coverage";
      const service = isService
        ? await loadServicePostingContext(trx, {
            companyId,
            projectId: entry.projectId,
            elementId: entry.projectElementId
          })
        : null;
      if (isService && !service) {
        throw new ProjectChargeError(
          "No service order owns the project of this expense"
        );
      }

      let coverage: ServiceCoverage | null = null;
      let coverageReason: string | null = null;
      if (service) {
        if (original) {
          coverage = original.coverage;
          coverageReason = original.coverageReason;
        } else if (entry.coverage && entry.coverageReason) {
          coverage = entry.coverage;
          coverageReason = entry.coverageReason;
        } else {
          coverage = serviceChargeCoverage(service, "Expense", entry.entryDate);
        }
      }

      const resolved = resolveProjectPostingAccount(
        context,
        entry.entryDate,
        coverage
      );
      if (resolved.treatment === "Capitalize") {
        throw new ProjectChargeError(
          "An expense entry cannot charge a capital project. Use a charge or a purchase invoice."
        );
      }
      const isStatistical = resolved.treatment === "Statistical";
      const amount = round(Number(entry.amount));

      let journalId: string | null = null;
      let debitLineId: string | null = null;
      if (accountingEnabled && amount !== 0) {
        const defaults = await trx
          .selectFrom("accountDefault")
          .select(["goodsReceivedNotInvoicedAccount", "indirectCostAccount"])
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        const debitAccount = isStatistical
          ? defaults?.indirectCostAccount
          : resolved.accountId;
        if (!debitAccount) {
          throw new ProjectChargeError(
            "Set Indirect Cost in Account Defaults before you charge an expense to a Statistical project"
          );
        }
        if (!defaults?.goodsReceivedNotInvoicedAccount) {
          throw new Error(
            "goodsReceivedNotInvoicedAccount not configured in account defaults"
          );
        }

        const posted = await postProjectJournal(trx, {
          companyId,
          userId,
          postingDate: entry.entryDate,
          description: `${isReversal ? "Reverse expense" : "Expense"}: ${entry.description}`,
          sourceType: "Project Expense",
          documentType: "Project Expense",
          documentId: entry.id,
          documentLineReference: journalReference.to.projectExpense(entry.id),
          lines: [
            {
              accountId: debitAccount,
              description: isStatistical
                ? "Indirect Cost"
                : service
                  ? "Service Expense"
                  : "Project Expense",
              amount: debit("expense", amount)
            },
            {
              accountId: defaults.goodsReceivedNotInvoicedAccount,
              description: "Accrued Expense",
              amount: credit("liability", amount)
            }
          ],
          dimensions: [
            ["Project", entry.projectId],
            ["ProjectElement", entry.projectElementId],
            ["Employee", entry.employeeId],
            ["Customer", service?.customerId]
          ]
        });
        journalId = posted.journalId;
        debitLineId = posted.lineIds[0] ?? null;
      }

      let projectLedgerId: string | null = null;
      if (!isStatistical) {
        const row = (
          await insertProjectLedgerRows(trx, {
            companyId,
            userId,
            rows: [
              buildProjectLedgerRow({
                companyId,
                projectId: entry.projectId,
                projectElementId: entry.projectElementId,
                postingDate: entry.entryDate,
                costType: "Other Direct",
                documentType: "Project Expense",
                documentId: entry.id,
                employeeId: entry.employeeId,
                quantity: isReversal ? -1 : 1,
                amount,
                journalLineId: debitLineId,
                reversalOfId: original?.id ?? null,
                coverage,
                coverageReason,
                unallowable: isUnallowableCharge(context, resolved.accountId),
                createdBy: userId
              })
            ]
          })
        )[0]!;
        projectLedgerId = row.id;

        if (service && original) {
          const item = await trx
            .selectFrom("projectBillableItem")
            .selectAll()
            .where("projectLedgerId", "=", original.id)
            .where("reversalOfId", "is", null)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
          if (item) {
            const reversal = reverseBillableItem(item, {
              projectLedgerId: row.id,
              createdBy: userId
            });
            if (reversal.update) {
              await trx
                .updateTable("projectBillableItem")
                .set({
                  ...reversal.update,
                  updatedBy: userId,
                  updatedAt: datetime.timestamp()
                })
                .where("id", "=", item.id)
                .where("companyId", "=", companyId)
                .execute();
            }
            if (reversal.insert) {
              await trx
                .insertInto("projectBillableItem")
                .values(reversal.insert)
                .execute();
            }
          }
        } else if (service && coverage) {
          const item = buildBillableItem({
            ledgerRow: {
              id: row.id,
              companyId,
              projectId: entry.projectId,
              projectElementId: entry.projectElementId,
              costType: "Other Direct",
              quantity: 1,
              amount,
              itemId: null,
              createdBy: userId
            },
            coverage,
            laborPrice: null,
            partPrice: null,
            description: entry.description
          });
          if (item) {
            await trx.insertInto("projectBillableItem").values(item).execute();
          }
        }
      }

      await trx
        .updateTable("projectExpenseEntry")
        .set({
          journalId,
          coverage: service ? coverage : entry.coverage,
          coverageReason: service ? coverageReason : entry.coverageReason,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", entry.id)
        .where("companyId", "=", companyId)
        .execute();

      if (!isReversal) {
        await startElementsOnFirstCharge(trx, companyId, [
          entry.projectElementId
        ]);
      }

      return { success: true, posted: true, journalId, projectLedgerId };
    });
  }
});

export default postProjectExpense;
