// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Constants,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import { credit, datetime, debit, round } from "@carbon/utils";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
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
  reverseBillableItem
} from "../lib/project-posting";

export const reclassProjectCoverageInput = z.object({
  projectLedgerId: z.string(),
  coverage: z.enum(Constants.public.Enums.serviceCoverage),
  reason: z.string().trim().min(1)
});

export type ReclassProjectCoverageResult = {
  success: true;
  journalId: string | null;
  /** The new projectLedger row, at the new coverage. */
  projectLedgerId: string;
};

/** The source documents that carry a coverage, and their journal types. */
const SOURCE_TYPES = {
  Timesheet: "Timesheet",
  "Project Issue": "Project Issue",
  "Project Expense": "Project Expense"
} as const;

/** "Labor (Covered by warranty)" → "Labor". */
function baseDescription(description: string): string {
  return description.replace(/ \(Covered by (warranty|contract)\)$/, "");
}

/**
 * Changes the coverage of a posted service charge without moving stock or
 * time. In one transaction it:
 * 1. refuses a charge whose billable item is Billed, or no change;
 * 2. posts Dr the new coverage's account / Cr the account the charge debited;
 * 3. writes a reversal projectLedger row and a new row at the new coverage
 *    (the ledger stays append-only);
 * 4. writes off (or credits) the old billable item and writes the new one;
 * 5. stores the coverage and reason on the source timesheet or expense entry.
 * An installed component follows its issue to the new ledger row.
 */
const reclassProjectCoverage = defineServerFn({
  name: "reclass-project-coverage",
  input: reclassProjectCoverageInput,
  permissions: { update: "projects" },
  async run(
    ctx,
    { projectLedgerId, coverage, reason }
  ): Promise<ReclassProjectCoverageResult> {
    const { db, companyId, userId } = ctx;

    const postingDate = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    return db.transaction().execute(async (trx) => {
      // Row lock: two reclasses of one charge must not both reverse it.
      const source = await trx
        .selectFrom("projectLedger")
        .selectAll()
        .where("id", "=", projectLedgerId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!source) throw new NotFoundError("Charge not found");

      const sourceType =
        SOURCE_TYPES[source.documentType as keyof typeof SOURCE_TYPES];
      if (!source.coverage || !sourceType) {
        throw new InvalidInputError("Only a service charge has a coverage");
      }
      if (source.reversalOfId) {
        throw new InvalidInputError("A reversal cannot be reclassed");
      }
      const reversed = await trx
        .selectFrom("projectLedger")
        .select("id")
        .where("reversalOfId", "=", source.id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (reversed) {
        throw new ProjectChargeError(
          "This charge is already reversed or reclassed"
        );
      }
      if (source.coverage === coverage) {
        throw new ProjectChargeError(`The charge is already ${coverage}`);
      }
      if (source.coverage === "Capitalized" || coverage === "Capitalized") {
        throw new ProjectChargeError(
          "Only a refurbishment charge is Capitalized, and it stays Capitalized"
        );
      }

      const billable = await trx
        .selectFrom("projectBillableItem")
        .selectAll()
        .where("projectLedgerId", "=", source.id)
        .where("reversalOfId", "is", null)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (billable?.status === "Billed") {
        throw new ProjectChargeError(
          "The charge is already invoiced. Credit the invoice first."
        );
      }

      const contexts = await loadProjectPostingContexts(trx, companyId, [
        {
          projectId: source.projectId,
          projectElementId: source.projectElementId
        }
      ]);
      const context = contexts.get(
        projectPostingKey(source.projectId, source.projectElementId)
      );
      if (!context) throw new NotFoundError("Project element not found");
      assertChargeable(context, "commitment");
      const service = await loadServicePostingContext(trx, {
        companyId,
        projectId: source.projectId,
        elementId: source.projectElementId
      });
      if (!service) {
        throw new ProjectChargeError(
          "No service order owns the project of this charge"
        );
      }

      const amount = round(Number(source.amount));
      let journalId: string | null = null;
      let debitLineId: string | null = null;
      let creditLineId: string | null = null;
      // The account the replacement posts to; null for a zero charge. The
      // journal is written for every company: Provisional before the
      // accounting cutover, Posted after it (postProjectJournal).
      let newAccount: string | null = null;
      if (amount !== 0) {
        newAccount = resolveProjectPostingAccount(
          context,
          postingDate,
          coverage
        ).accountId;
        // Credit the account the charge debited.
        const debited = source.journalLineId
          ? await trx
              .selectFrom("journalLine")
              .select("accountId")
              .where("id", "=", source.journalLineId)
              .where("companyId", "=", companyId)
              .executeTakeFirst()
          : undefined;
        const oldAccount =
          debited?.accountId ??
          resolveProjectPostingAccount(
            context,
            source.postingDate,
            source.coverage
          ).accountId;
        if (!newAccount || !oldAccount) {
          throw new ProjectChargeError(
            "The charge's coverage has no posting account"
          );
        }
        if (newAccount !== oldAccount) {
          const posted = await postProjectJournal(trx, {
            companyId,
            userId,
            postingDate,
            description: `Coverage ${source.coverage} to ${coverage}: ${reason}`,
            sourceType,
            documentType: sourceType,
            documentId: source.documentId,
            documentLineReference: journalReference.to.coverageReclass(
              source.id
            ),
            lines: [
              {
                accountId: newAccount,
                description: `${coverage} Coverage`,
                amount: debit("expense", amount)
              },
              {
                accountId: oldAccount,
                description: `${source.coverage} Coverage`,
                amount: credit("expense", amount)
              }
            ],
            dimensions: [
              ["Project", source.projectId],
              ["ProjectElement", source.projectElementId],
              ["Employee", source.employeeId],
              ["Customer", service.customerId]
            ]
          });
          journalId = posted.journalId;
          debitLineId = posted.lineIds[0] ?? null;
          creditLineId = posted.lineIds[1] ?? null;
        }
      }

      const shared = {
        companyId,
        projectId: source.projectId,
        projectElementId: source.projectElementId,
        postingDate,
        costType: source.costType,
        documentType: source.documentType,
        documentId: source.documentId,
        documentLineId: source.documentLineId,
        jobId: source.jobId,
        itemId: source.itemId,
        employeeId: source.employeeId,
        laborCategoryId: source.laborCategoryId,
        supplierId: source.supplierId,
        unitOfMeasureCode: source.unitOfMeasureCode,
        createdBy: userId
      };
      const quantity =
        source.quantity === null ? null : Number(source.quantity);
      const reversal = (
        await insertProjectLedgerRows(trx, {
          companyId,
          userId,
          rows: [
            buildProjectLedgerRow({
              ...shared,
              quantity: quantity === null ? null : -quantity,
              amount: -amount,
              journalLineId: creditLineId,
              reversalOfId: source.id,
              coverage: source.coverage,
              coverageReason: source.coverageReason,
              unallowable: source.unallowable
            })
          ]
        })
      )[0]!;
      const replacement = (
        await insertProjectLedgerRows(trx, {
          companyId,
          userId,
          rows: [
            buildProjectLedgerRow({
              ...shared,
              quantity,
              amount,
              journalLineId: debitLineId,
              coverage,
              coverageReason: reason,
              unallowable: isUnallowableCharge(context, newAccount)
            })
          ]
        })
      )[0]!;

      const now = datetime.timestamp();
      if (billable) {
        const undo = reverseBillableItem(billable, {
          projectLedgerId: reversal.id,
          createdBy: userId
        });
        if (undo.update) {
          await trx
            .updateTable("projectBillableItem")
            .set({ ...undo.update, updatedBy: userId, updatedAt: now })
            .where("id", "=", billable.id)
            .where("companyId", "=", companyId)
            .execute();
        }
        if (undo.insert) {
          await trx
            .insertInto("projectBillableItem")
            .values(undo.insert)
            .execute();
        }
      }

      const partPrice =
        source.costType === "Material" && source.itemId
          ? await trx
              .selectFrom("itemUnitSalePrice")
              .select("unitSalePrice")
              .where("itemId", "=", source.itemId)
              .where("companyId", "=", companyId)
              .executeTakeFirst()
              .then((row) => (row ? Number(row.unitSalePrice) : null))
          : null;
      const item = buildBillableItem({
        ledgerRow: {
          id: replacement.id,
          companyId,
          projectId: source.projectId,
          projectElementId: source.projectElementId,
          costType: source.costType,
          quantity,
          amount,
          itemId:
            billable?.itemId ??
            (source.costType === "Labor" ? service.laborItemId : source.itemId),
          createdBy: userId
        },
        coverage,
        laborPrice: service.laborPrice,
        partPrice,
        description: billable
          ? baseDescription(billable.description)
          : source.costType === "Labor"
            ? "Labor"
            : "Charge"
      });
      if (item) {
        await trx.insertInto("projectBillableItem").values(item).execute();
      }

      // The source entry keeps the coverage its charge now posts at.
      if (source.documentType === "Timesheet") {
        await trx
          .updateTable("timesheetEntry")
          .set({
            coverage,
            coverageReason: reason,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", source.documentId)
          .where("companyId", "=", companyId)
          .execute();
      } else if (source.documentType === "Project Expense") {
        await trx
          .updateTable("projectExpenseEntry")
          .set({
            coverage,
            coverageReason: reason,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", source.documentId)
          .where("companyId", "=", companyId)
          .execute();
      } else {
        // An installed part follows its issue, so a return still finds it.
        await trx
          .updateTable("customerAssetComponent")
          .set({
            projectLedgerId: replacement.id,
            updatedBy: userId,
            updatedAt: now
          })
          .where("projectLedgerId", "=", source.id)
          .where("companyId", "=", companyId)
          .execute();
      }

      return { success: true, journalId, projectLedgerId: replacement.id };
    });
  }
});

export default reclassProjectCoverage;
