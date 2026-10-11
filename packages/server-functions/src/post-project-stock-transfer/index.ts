// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone } from "@carbon/database";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { inOrder } from "@carbon/database/rows";
import { datetime, round } from "@carbon/utils";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { calculateCOGS } from "../lib/calculate-cogs";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import {
  buildAdjustmentJournalLines,
  buildCostLedgerRow,
  buildItemLedgerRow,
  buildJournalLineDimensions
} from "../lib/plan-adjustment";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import {
  buildProjectLedgerRow,
  insertProjectLedgerRows
} from "../lib/project-posting";
import { paybackVariance, planBorrowMatching } from "./plan";

export const postProjectStockTransferInput = z.object({
  projectStockTransferId: z.string()
});

export type PostProjectStockTransferResult = {
  success: true;
  journalId: string | null;
};

/**
 * Posts an Approved project stock transfer (Projects Phase 2a): stock moves
 * between stock stripes at the same bin, at cost.
 *
 * - **Transfer**: the from-stripe's layers are relieved (calculateCOGS) and a
 *   layer at the drawn cost opens in the to-stripe. The drawn cost includes the
 *   relieved layers' adjustment children, so their value moves with them. No
 *   journal: both owners are inventory.
 * - **Borrow**: the same move from the lender to the borrower, whose layer
 *   points at a new open `projectBorrow` (quantity, borrowed unit cost, due
 *   date). No journal.
 * - **Payback**: the borrower's stock is relieved at its current cost and the
 *   lender gets back the borrowed cost, one layer per borrow settled (oldest
 *   open borrow of the item first, starting from the one the payback names).
 *   The difference is the borrower's Payback Variance: a projectLedger row and
 *   a journal of the variance against inventory, tagged with the borrower's
 *   project.
 *
 * Government-furnished stock never leaves for common stock or for a project
 * of another customer.
 */
const postProjectStockTransfer = defineServerFn({
  name: "post-project-stock-transfer",
  input: postProjectStockTransferInput,
  permissions: { update: "projects" },
  async run(
    ctx,
    { projectStockTransferId }
  ): Promise<PostProjectStockTransferResult> {
    const { db, companyId, userId } = ctx;
    const postingDate = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    const [accountDefaults, dimensions] = await inOrder([
      () =>
        db
          .selectFrom("accountDefault")
          .select([
            "rawMaterialsAccount",
            "finishedGoodsAccount",
            "inventoryAdjustmentVarianceAccount"
          ])
          .where("companyId", "=", companyId)
          .executeTakeFirst(),
      () =>
        db
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
            "Item",
            "ItemPostingGroup",
            "Location",
            "Project"
          ])
          .execute()
    ]);
    if (!accountDefaults) throw new Error("Error getting account defaults");
    const dimensionMap: Record<string, string> = {};
    for (const dimension of dimensions) {
      if (dimension.entityType) {
        dimensionMap[dimension.entityType] = dimension.id;
      }
    }

    return db.transaction().execute(async (trx) => {
      const header = await trx
        .selectFrom("projectStockTransfer")
        .selectAll()
        .where("id", "=", projectStockTransferId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!header) throw new NotFoundError("Project stock transfer not found");
      if (header.status !== "Approved") {
        throw new InvalidInputError(
          `Only an approved transfer can be posted; this one is ${header.status}`
        );
      }

      const lines = await trx
        .selectFrom("projectStockTransferLine")
        .selectAll()
        .where("projectStockTransferId", "=", header.id)
        .where("companyId", "=", companyId)
        .orderBy("createdAt")
        .orderBy("id")
        .execute();
      if (lines.length === 0) {
        throw new InvalidInputError("Add a line before you post the transfer");
      }

      // The owners. A Payback runs from the borrower back to the lender of
      // the borrow it settles.
      let fromProjectId = header.fromProjectId;
      let toProjectId = header.toProjectId;
      if (header.type === "Payback") {
        const borrow = await trx
          .selectFrom("projectBorrow")
          .select(["borrowerProjectId", "lenderProjectId", "status"])
          .where("id", "=", header.settlesBorrowId!)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!borrow) throw new NotFoundError("Borrow not found");
        if (borrow.status !== "Open") {
          throw new InvalidInputError("The borrow is already paid back");
        }
        if (
          (header.fromProjectId &&
            header.fromProjectId !== borrow.borrowerProjectId) ||
          (header.toProjectId && header.toProjectId !== borrow.lenderProjectId)
        ) {
          throw new InvalidInputError(
            "A payback runs from the borrower back to the lender"
          );
        }
        fromProjectId = borrow.borrowerProjectId;
        toProjectId = borrow.lenderProjectId;
      }
      if (fromProjectId === toProjectId) {
        throw new InvalidInputError("The transfer needs two different owners");
      }

      // Government-furnished stock stays with its customer.
      const ownerIds = [fromProjectId, toProjectId].filter((id): id is string =>
        Boolean(id)
      );
      const owners =
        ownerIds.length > 0
          ? await trx
              .selectFrom("project")
              .select([
                "id",
                "identifier",
                "name",
                "customerId",
                "governmentFurnished"
              ])
              .where("id", "in", ownerIds)
              .where("companyId", "=", companyId)
              .execute()
          : [];
      const fromProject = owners.find((p) => p.id === fromProjectId);
      const toProject = owners.find((p) => p.id === toProjectId);
      if (fromProject?.governmentFurnished) {
        if (
          !toProject ||
          !fromProject.customerId ||
          toProject.customerId !== fromProject.customerId
        ) {
          throw new InvalidInputError(
            `Government-furnished stock of project ${
              fromProject.identifier || fromProject.name
            } can only move to a project of the same customer`
          );
        }
      }

      const itemIds = [...new Set(lines.map((line) => line.itemId))];
      const [items, itemCosts, onHand] = await Promise.all([
        trx
          .selectFrom("item")
          .select(["id", "itemTrackingType", "replenishmentSystem"])
          .where("id", "in", itemIds)
          .where("companyId", "=", companyId)
          .execute(),
        trx
          .selectFrom("itemCost")
          .select(["itemId", "itemPostingGroupId"])
          .where("itemId", "in", itemIds)
          .where("companyId", "=", companyId)
          .execute(),
        // The from-stripe's on-hand at the transfer's location, per bin and
        // lot: what the lines may move.
        trx
          .selectFrom("itemLedger")
          .select([
            "itemId",
            "storageUnitId",
            "trackedEntityId",
            (eb) => eb.fn.sum<number>("quantity").as("quantity")
          ])
          .where("companyId", "=", companyId)
          .where("locationId", "=", header.locationId)
          .where("itemId", "in", itemIds)
          .where((eb) =>
            fromProjectId
              ? eb("projectId", "=", fromProjectId)
              : eb("projectId", "is", null)
          )
          .groupBy(["itemId", "storageUnitId", "trackedEntityId"])
          .execute()
      ]);
      const itemById = new Map(items.map((item) => [item.id, item]));
      const postingGroupByItem = new Map(
        itemCosts.map((cost) => [cost.itemId, cost.itemPostingGroupId])
      );
      const slotKey = (
        itemId: string,
        storageUnitId: string | null,
        trackedEntityId: string | null
      ) =>
        `${itemId}\u0000${storageUnitId ?? ""}\u0000${trackedEntityId ?? ""}`;
      const available = new Map<string, number>();
      for (const row of onHand) {
        available.set(
          slotKey(row.itemId, row.storageUnitId, row.trackedEntityId),
          Number(row.quantity ?? 0)
        );
      }
      const requested = new Map<string, number>();
      for (const line of lines) {
        const item = itemById.get(line.itemId);
        if (!item || item.itemTrackingType === "Non-Inventory") {
          throw new InvalidInputError("Only stocked items can be transferred");
        }
        const tracked =
          item.itemTrackingType === "Serial" ||
          item.itemTrackingType === "Batch";
        if (tracked && !line.trackedEntityId) {
          throw new InvalidInputError(
            "Select the lot or serial number of every tracked line"
          );
        }
        const key = slotKey(
          line.itemId,
          line.storageUnitId,
          line.trackedEntityId
        );
        requested.set(key, (requested.get(key) ?? 0) + Number(line.quantity));
      }
      for (const [key, quantity] of requested) {
        if (round(quantity) > round(available.get(key) ?? 0)) {
          throw new InvalidInputError(
            `Insufficient quantity in the ${
              fromProject
                ? `stock of project ${fromProject.identifier || fromProject.name}`
                : "common stock"
            } to transfer`
          );
        }
      }

      // A payback variance writes a journal: Provisional before the
      // company's accounting cutover, Posted after it. FOR SHARE holds the
      // status until commit. A Provisional journal has no accounting period.
      const postingStatus = await journalPostingStatus(trx, companyId);
      const accountingPeriodId =
        postingStatus === "Posted" && header.type === "Payback"
          ? (
              await resolveAccountingPeriod(
                trx,
                companyId,
                postingDate,
                "current"
              )
            ).id
          : null;
      // One journal for the paybacks of every line, created on the first
      // variance.
      let journalId: string | null = null;
      const getJournalId = async () => {
        if (!journalId) {
          journalId = await createAdjustmentJournal(trx, {
            companyId,
            accountingPeriodId,
            status: postingStatus,
            description: `Payback ${header.projectStockTransferId}`,
            postingDate,
            userId,
            sourceType: "Project Transfer"
          });
        }
        return journalId;
      };

      for (const line of lines) {
        const item = itemById.get(line.itemId)!;
        const quantity = Number(line.quantity);
        // A serial unit is costed by specific identification, as every
        // adjustment is (valueMovement).
        const serialId =
          item.itemTrackingType === "Serial" ? line.trackedEntityId : null;

        // 1. Draw from the from-stripe: its layers are relieved.
        const cogs = await calculateCOGS(trx, {
          itemId: line.itemId,
          quantity,
          companyId,
          projectId: fromProjectId,
          trackedEntityIds: serialId ? [serialId] : []
        });
        const unitCost = quantity > 0 ? cogs.totalCost / quantity : 0;

        // 2. The Transfer pair at the same bin, one leg per stripe.
        const ledgerBase = {
          postingDate,
          entryType: "Transfer" as const,
          documentType: "Project Transfer" as const,
          documentId: header.id,
          itemId: line.itemId,
          locationId: header.locationId,
          storageUnitId: line.storageUnitId,
          trackedEntityId: line.trackedEntityId,
          companyId,
          createdBy: userId
        };
        await trx
          .insertInto("itemLedger")
          .values([
            buildItemLedgerRow({
              ...ledgerBase,
              quantity: -quantity,
              projectId: fromProjectId
            }),
            buildItemLedgerRow({
              ...ledgerBase,
              quantity,
              projectId: toProjectId
            })
          ])
          .execute();

        const layerBase = {
          entryType: "Transfer" as const,
          documentType: "Project Transfer" as const,
          documentId: header.id,
          itemId: line.itemId,
          postingDate,
          trackedEntityId: serialId,
          companyId
        };
        // The relief row of the drawn layers (remaining 0).
        await trx
          .insertInto("costLedger")
          .values(
            buildCostLedgerRow({
              ...layerBase,
              quantity: -quantity,
              cost: -cogs.totalCost,
              projectId: fromProjectId
            })
          )
          .execute();

        if (header.type === "Transfer") {
          await trx
            .insertInto("costLedger")
            .values(
              buildCostLedgerRow({
                ...layerBase,
                quantity,
                cost: cogs.totalCost,
                projectId: toProjectId
              })
            )
            .execute();
        } else if (header.type === "Borrow") {
          const borrow = await trx
            .insertInto("projectBorrow")
            .values({
              borrowerProjectId: toProjectId!,
              lenderProjectId: fromProjectId!,
              itemId: line.itemId,
              locationId: header.locationId,
              quantity,
              borrowedUnitCost: round(unitCost),
              paybackDueDate: header.paybackDueDate!,
              status: "Open",
              projectStockTransferLineId: line.id,
              companyId,
              createdBy: userId
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("costLedger")
            .values({
              ...buildCostLedgerRow({
                ...layerBase,
                quantity,
                cost: cogs.totalCost,
                projectId: toProjectId
              }),
              projectBorrowId: borrow.id
            })
            .execute();
        } else {
          // Payback: the open borrows of this item between the two projects,
          // the one the payback names first, then the oldest.
          const openBorrows = await trx
            .selectFrom("projectBorrow")
            .select([
              "id",
              "quantity",
              "quantityPaidBack",
              "borrowedUnitCost",
              "createdAt"
            ])
            .where("companyId", "=", companyId)
            .where("borrowerProjectId", "=", fromProjectId!)
            .where("lenderProjectId", "=", toProjectId!)
            .where("itemId", "=", line.itemId)
            .where("locationId", "=", header.locationId)
            .where("status", "=", "Open")
            .orderBy("createdAt")
            .orderBy("id")
            .forUpdate()
            .execute();
          const ordered = [
            ...openBorrows.filter((b) => b.id === header.settlesBorrowId),
            ...openBorrows.filter((b) => b.id !== header.settlesBorrowId)
          ];
          const settlements = planBorrowMatching(
            ordered.map((b) => ({
              id: b.id,
              quantity: Number(b.quantity),
              quantityPaidBack: Number(b.quantityPaidBack),
              borrowedUnitCost: Number(b.borrowedUnitCost)
            })),
            quantity
          );

          let variance = 0;
          for (const settlement of settlements) {
            // The lender gets back the cost it lent.
            await trx
              .insertInto("costLedger")
              .values({
                ...buildCostLedgerRow({
                  ...layerBase,
                  quantity: settlement.quantity,
                  cost: settlement.quantity * settlement.borrowedUnitCost,
                  projectId: toProjectId
                }),
                projectBorrowId: settlement.borrowId
              })
              .execute();
            const borrowed = ordered.find((b) => b.id === settlement.borrowId)!;
            await trx
              .updateTable("projectBorrow")
              .set({
                quantityPaidBack: round(
                  Number(borrowed.quantityPaidBack) + settlement.quantity
                ),
                status: settlement.paidBack ? "Paid Back" : "Open",
                updatedBy: userId,
                updatedAt: datetime.timestamp()
              })
              .where("id", "=", settlement.borrowId)
              .where("companyId", "=", companyId)
              .execute();
            variance += paybackVariance(
              settlement.borrowedUnitCost,
              unitCost,
              settlement.quantity
            );
          }
          variance = round(variance);

          if (variance !== 0) {
            // The borrower takes the difference: Dr variance / Cr inventory
            // when it paid back dearer stock, the mirror when cheaper.
            const journalLines = await trx
              .insertInto("journalLine")
              .values(
                buildAdjustmentJournalLines({
                  journalId: await getJournalId(),
                  documentId: header.id,
                  documentType: "Project Transfer",
                  journalLineReference: nanoid(),
                  isGain: variance < 0,
                  cost: Math.abs(variance),
                  quantity,
                  replenishmentSystem: item.replenishmentSystem,
                  accountDefaults,
                  offsetDescription: "Payback Variance",
                  companyId
                })
              )
              .returning("id")
              .execute();
            const journalLineId = journalLines[1]?.id ?? null;
            const tags = buildJournalLineDimensions({
              journalLineIds: journalLines.map((jl) => jl.id),
              dimensions: dimensionMap,
              itemId: line.itemId,
              itemPostingGroupId: postingGroupByItem.get(line.itemId),
              locationId: header.locationId,
              extraDimensions: [
                { entityType: "Project", valueId: fromProjectId! }
              ],
              companyId
            });
            if (tags.length > 0) {
              await trx
                .insertInto("journalLineDimension")
                .values(tags)
                .execute();
            }
            await insertProjectLedgerRows(trx, {
              companyId,
              userId,
              rows: [
                buildProjectLedgerRow({
                  companyId,
                  projectId: fromProjectId!,
                  projectElementId: null,
                  postingDate,
                  costType: "Payback Variance",
                  documentType: "Project Transfer",
                  documentId: header.id,
                  documentLineId: line.id,
                  itemId: line.itemId,
                  quantity,
                  amount: variance,
                  journalLineId,
                  // A payback variance sits on the project root (no element)
                  // and posts to the inventory variance account, not to a
                  // project account: no allowability decides it.
                  unallowable: false,
                  createdBy: userId
                })
              ]
            });
          }
        }

        // 3. The line records the cost it moved at.
        await trx
          .updateTable("projectStockTransferLine")
          .set({
            unitCost: round(unitCost),
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", line.id)
          .where("companyId", "=", companyId)
          .execute();
      }

      await trx
        .updateTable("projectStockTransfer")
        .set({
          status: "Posted",
          // A Payback keeps the owners it posted between.
          fromProjectId,
          toProjectId,
          postedAt: datetime.timestamp(),
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", header.id)
        .where("companyId", "=", companyId)
        .execute();

      return {
        success: true,
        journalId: journalId as string | null
      };
    });
  }
});

export default postProjectStockTransfer;
