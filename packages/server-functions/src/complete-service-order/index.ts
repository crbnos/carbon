// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Completes a service order. A Field Visit or Depot Repair order is only
// stamped Completed. A Refurbishment moves its WIP into the serial's cost
// (`planRefurbishmentCompletion`) and releases the serial.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md (Accounting → Refurbishment
// completion); plan .ai/plans/2026-10-09-field-service-phase-c.md, Task 4.

import {
  type Database,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { credit, datetime, debit, round } from "@carbon/utils";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError, ServerFnError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { resolveInventoryAccount } from "../lib/get-posting-group";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import { allocateJournalLineIds } from "../post-charge/journal-line-ids";
import {
  loadRefurbishmentCompletion,
  type RefurbishmentCompletionContext
} from "./load";
import {
  planRefurbishmentCompletion,
  type RefurbishmentAccount,
  RefurbishmentCompletionError,
  type RefurbishmentCompletionPlan
} from "./plan";

export type {
  RefurbishmentCompletionContext,
  RefurbishmentOrder
} from "./load";
export { loadRefurbishmentCompletion } from "./load";
export type { RefurbishmentCompletionPlan } from "./plan";
export {
  NO_CAP_WARNING,
  planRefurbishmentCompletion,
  RefurbishmentCompletionError
} from "./plan";

export const completeServiceOrderInput = z.object({
  serviceOrderId: z.string()
});

export type CompleteServiceOrderResult = {
  success: true;
  serviceOrderId: string;
  /** Refurbishment only, else null. */
  capitalizedAmount: number | null;
  writeDownAmount: number | null;
  journalId: string | null;
  warnings: string[];
};

type Enums = Database["public"]["Enums"];

/** The open statuses an order completes from (`canMoveServiceOrder`). */
const COMPLETABLE = new Set(["Draft", "Scheduled", "In Progress"]);

/**
 * Completes one service order, in one transaction.
 *
 * A Field Visit or Depot Repair order is stamped `completedAt` /
 * `completedBy` and set Completed, its project Technically Complete — what
 * the ERP's Complete did before.
 *
 * A Refurbishment also:
 * 1. sums its Capitalized ledger rows (the WIP), loads the item's cost and its
 *    open layers and children under row locks, and the sale price cap;
 * 2. plans the completion (`planRefurbishmentCompletion`);
 * 3. writes the layer split, the child moves, the revaluation and the
 *    write-down child rows, and the Average unit cost;
 * 4. posts one journal (`sourceType 'Service Order'`) when accounting is on:
 *    Dr inventory / Cr WIP, the WIP lines by node with the Project and
 *    Project Element dimensions;
 * 5. sets the serial Available and writes a `Service` activity;
 * 6. saves the amounts, the journal and the costing method on the order.
 */
const completeServiceOrder = defineServerFn({
  name: "complete-service-order",
  input: completeServiceOrderInput,
  permissions: { update: "service" },
  async run(
    { db, companyId, userId },
    { serviceOrderId }
  ): Promise<CompleteServiceOrderResult> {
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();
    return db.transaction().execute(async (trx) => {
      // Row lock: two completions of one order must not both capitalize it.
      const order = await trx
        .selectFrom("serviceOrder")
        .select([
          "id",
          "serviceOrderId",
          "type",
          "status",
          "projectId",
          "trackedEntityId",
          "itemId",
          "expectedSellingPrice",
          "abnormalRework"
        ])
        .where("id", "=", serviceOrderId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new NotFoundError("Service order not found");
      if (!COMPLETABLE.has(order.status)) {
        throw new ServerFnError(
          `Service order ${order.serviceOrderId} is ${order.status}. Only an open order is completed.`,
          422
        );
      }

      const now = datetime.timestamp();
      const finish = async (
        columns: Partial<{
          capitalizedAmount: number;
          writeDownAmount: number;
          completionJournalId: string | null;
          completionCostingMethod: Enums["itemCostingMethod"];
        }> = {}
      ) => {
        await trx
          .updateTable("serviceOrder")
          .set({
            ...columns,
            status: "Completed",
            completedAt: now,
            completedBy: userId,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", order.id)
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .updateTable("project")
          .set({
            status: "Technically Complete",
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", order.projectId)
          .where("companyId", "=", companyId)
          .execute();
      };

      if (order.type !== "Refurbishment") {
        await finish();
        return {
          success: true,
          serviceOrderId: order.id,
          capitalizedAmount: null,
          writeDownAmount: null,
          journalId: null,
          warnings: []
        };
      }

      const serial = await trx
        .selectFrom("trackedEntity")
        .select(["id", "readableId", "status"])
        .where("id", "=", order.trackedEntityId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!serial) throw new NotFoundError("Serial not found");
      if (serial.status !== "On Hold" && serial.status !== "Available") {
        throw new ServerFnError(
          `Serial ${serial.readableId ?? serial.id} is ${serial.status}. Only a serial in stock completes a refurbishment.`,
          422
        );
      }

      const context = await loadRefurbishmentCompletion(trx, {
        companyId,
        order: {
          ...order,
          expectedSellingPrice:
            order.expectedSellingPrice === null
              ? null
              : Number(order.expectedSellingPrice)
        },
        lock: true
      });

      let plan: RefurbishmentCompletionPlan;
      try {
        plan = planRefurbishmentCompletion(context.input);
      } catch (err) {
        if (err instanceof RefurbishmentCompletionError) {
          throw new ServerFnError(err.message, 422);
        }
        throw err;
      }

      await writeCostLedger(trx, {
        companyId,
        orderId: order.id,
        itemId: order.itemId,
        serialId: order.trackedEntityId,
        today,
        plan,
        context
      });

      if (plan.averageUnitCost !== null) {
        await trx
          .updateTable("itemCost")
          .set({
            unitCost: plan.averageUnitCost,
            updatedBy: userId,
            updatedAt: now
          })
          .where("itemId", "=", order.itemId)
          .where("companyId", "=", companyId)
          .execute();
      }

      const journalId =
        plan.journal.length > 0
          ? await postCompletionJournal(trx, {
              companyId,
              userId,
              today,
              order,
              plan,
              context
            })
          : null;

      await trx
        .updateTable("trackedEntity")
        .set({ status: "Available", updatedBy: userId })
        .where("id", "=", order.trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      const activity = await trx
        .insertInto("trackedActivity")
        .values({
          type: "Service",
          sourceDocument: "Service Order",
          sourceDocumentId: order.id,
          sourceDocumentReadableId: order.serviceOrderId,
          attributes: {
            "Service Order": order.id,
            Refurbished: true,
            Employee: userId
          },
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("trackedActivityOutput")
        .values({
          trackedActivityId: activity.id,
          trackedEntityId: order.trackedEntityId,
          quantity: 1,
          companyId,
          createdBy: userId
        })
        .execute();

      await finish({
        capitalizedAmount: plan.capitalizedAmount,
        writeDownAmount: plan.writeDown,
        completionJournalId: journalId,
        completionCostingMethod: context.input.costingMethod
      });

      return {
        success: true,
        serviceOrderId: order.id,
        capitalizedAmount: plan.capitalizedAmount,
        writeDownAmount: plan.writeDown,
        journalId,
        warnings: [...context.warnings, ...plan.warnings]
      };
    });
  }
});

export default completeServiceOrder;

/**
 * The plan's cost ledger writes: the split (the source layer gives up one
 * unit's quantity and cost; a stamped layer of one unit copies its document),
 * the child moves onto the serial's layer, the revaluation child and the
 * write-down child.
 */
async function writeCostLedger(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    orderId: string;
    itemId: string;
    serialId: string;
    today: string;
    plan: RefurbishmentCompletionPlan;
    context: RefurbishmentCompletionContext;
  }
): Promise<void> {
  const { companyId, plan, context } = args;
  let serialLayerId = plan.serialLayerId;

  if (plan.split) {
    const source = context.layerRows.get(plan.split.sourceLayerId);
    if (!source) throw new Error("The source cost layer was not loaded");
    const unitNominal = round(
      Number(source.nominalCost) / Number(source.quantity)
    );
    await trx
      .updateTable("costLedger")
      .set({
        quantity: plan.split.sourceQuantity,
        remainingQuantity: plan.split.sourceRemainingQuantity,
        cost: plan.split.sourceCost,
        nominalCost: round(Number(source.nominalCost) - unitNominal)
      })
      .where("id", "=", source.id)
      .where("companyId", "=", companyId)
      .execute();
    const inserted = await trx
      .insertInto("costLedger")
      .values({
        itemLedgerType: source.itemLedgerType,
        costLedgerType: source.costLedgerType,
        adjustment: false,
        documentType: source.documentType,
        documentId: source.documentId,
        externalDocumentId: source.externalDocumentId,
        itemId: source.itemId,
        quantity: 1,
        remainingQuantity: 1,
        cost: plan.split.cost,
        nominalCost: unitNominal,
        supplierId: source.supplierId,
        trackedEntityId: args.serialId,
        postingDate: source.postingDate,
        companyId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    serialLayerId = inserted.id;
  }

  const children: {
    itemLedgerType: Enums["itemLedgerType"];
    costLedgerType: Enums["costLedgerType"];
    documentType: Enums["itemLedgerDocumentType"] | null;
    documentId: string | null;
    externalDocumentId: string | null;
    supplierId: string | null;
    postingDate: string;
    appliesToCostLedgerId: string | null;
    quantity: number;
    remainingQuantity: number;
    cost: number;
  }[] = [];

  for (const move of plan.childMoves) {
    const child = context.childRows.get(move.childId);
    if (!child) throw new Error("A moved cost child was not loaded");
    await trx
      .updateTable("costLedger")
      .set({
        quantity: move.quantity,
        remainingQuantity: move.remainingQuantity,
        cost: move.cost,
        nominalCost: move.cost
      })
      .where("id", "=", child.id)
      .where("companyId", "=", companyId)
      .execute();
    children.push({
      itemLedgerType: child.itemLedgerType,
      costLedgerType: child.costLedgerType,
      documentType: child.documentType,
      documentId: child.documentId,
      externalDocumentId: child.externalDocumentId,
      supplierId: child.supplierId,
      postingDate: child.postingDate,
      appliesToCostLedgerId: serialLayerId,
      quantity: move.movedQuantity,
      remainingQuantity: move.movedQuantity,
      cost: move.movedCost
    });
  }

  if (plan.revaluation) {
    const attachedTo = plan.revaluation.attached ? serialLayerId : null;
    children.push({
      itemLedgerType: "Positive Adjmt.",
      costLedgerType: "Revaluation",
      documentType: null,
      documentId: args.orderId,
      externalDocumentId: null,
      supplierId: null,
      postingDate: args.today,
      appliesToCostLedgerId: attachedTo,
      quantity: 1,
      // An unattached child (Average) is cost history only: nothing relieves it.
      remainingQuantity: attachedTo ? 1 : 0,
      cost: plan.revaluation.cost
    });
  }

  if (plan.writeDown > 0) {
    children.push({
      itemLedgerType: "Negative Adjmt.",
      costLedgerType: "Revaluation",
      documentType: null,
      documentId: args.orderId,
      externalDocumentId: null,
      supplierId: null,
      postingDate: args.today,
      appliesToCostLedgerId: serialLayerId,
      quantity: 1,
      remainingQuantity: 1,
      cost: -plan.writeDown
    });
  }

  if (children.length > 0) {
    await trx
      .insertInto("costLedger")
      .values(
        children.map((child) => ({
          ...child,
          adjustment: true,
          itemId: args.itemId,
          nominalCost: child.cost,
          trackedEntityId: args.serialId,
          companyId
        }))
      )
      .execute();
  }
}

/**
 * One posted journal for the completion, in today's period. The inventory
 * account follows the item's replenishment (`resolveInventoryAccount`); every
 * line carries the Project dimension, and the WIP lines are split by node
 * with the Project Element dimension, so each node's WIP nets to zero.
 */
async function postCompletionJournal(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    today: string;
    order: { id: string; serviceOrderId: string; projectId: string };
    plan: RefurbishmentCompletionPlan;
    context: RefurbishmentCompletionContext;
  }
): Promise<string> {
  const { companyId, order, plan, context } = args;
  const defaults = await trx
    .selectFrom("accountDefault")
    .select([
      "rawMaterialsAccount",
      "finishedGoodsAccount",
      "workInProgressAccount",
      "materialVarianceAccount",
      "inventoryAdjustmentVarianceAccount"
    ])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Account defaults are not configured");
  const required = (value: string | null, name: string): string => {
    if (!value) {
      throw new ServerFnError(
        `Set ${name} in Account Defaults before you complete a refurbishment`,
        422
      );
    }
    return value;
  };
  const inventory = resolveInventoryAccount(context.item.replenishmentSystem, {
    rawMaterialsAccount: required(
      defaults.rawMaterialsAccount,
      "Raw Materials"
    ),
    finishedGoodsAccount: required(
      defaults.finishedGoodsAccount,
      "Finished Goods"
    )
  });
  const accounts: Record<
    RefurbishmentAccount,
    { id: string; type: "asset" | "expense" }
  > = {
    inventory: { id: inventory.account, type: "asset" },
    workInProgress: {
      id: required(defaults.workInProgressAccount, "Work in Progress"),
      type: "asset"
    },
    materialVariance: {
      id: required(defaults.materialVarianceAccount, "Material Variance"),
      type: "expense"
    },
    inventoryAdjustmentVariance: {
      id: required(
        defaults.inventoryAdjustmentVarianceAccount,
        "Inventory Adjustment Variance"
      ),
      type: "expense"
    }
  };

  // The WIP credit by node: each node's Capitalized charges, the last node
  // taking any rounding residual so the lines sum to the planned amount.
  const lines: {
    accountId: string;
    description: string;
    amount: number;
    projectElementId: string | null;
  }[] = [];
  for (const line of plan.journal) {
    const account = accounts[line.account];
    const signed = (amount: number) =>
      round(
        line.side === "debit"
          ? debit(account.type, amount)
          : credit(account.type, amount)
      );
    if (line.account === "workInProgress" && context.wipByElement.length > 1) {
      let left = line.amount;
      context.wipByElement.forEach((share, index) => {
        const amount =
          index === context.wipByElement.length - 1
            ? round(left)
            : share.amount;
        left -= amount;
        lines.push({
          accountId: account.id,
          description: line.description,
          amount: signed(amount),
          projectElementId: share.projectElementId
        });
      });
    } else {
      lines.push({
        accountId: account.id,
        description: line.description,
        amount: signed(line.amount),
        projectElementId:
          line.account === "workInProgress"
            ? (context.wipByElement[0]?.projectElementId ?? null)
            : null
      });
    }
  }

  // Every completion writes its journal: Provisional before the company's
  // accounting cutover, Posted after it. FOR SHARE holds the status until
  // commit. A Provisional journal has no accounting period.
  const status = await journalPostingStatus(trx, companyId);
  const accountingPeriodId =
    status === "Posted"
      ? (await resolveAccountingPeriod(trx, companyId, args.today, "current"))
          .id
      : null;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId,
    status,
    description: `Refurbishment ${order.serviceOrderId}`,
    postingDate: args.today,
    userId: args.userId,
    sourceType: "Service Order"
  });
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
        documentType: "Service Order" as const,
        documentId: order.id,
        documentLineReference: journalReference.to.serviceOrder(order.id),
        journalLineReference,
        companyId
      }))
    )
    .execute();

  const dimensions = await trx
    .selectFrom("dimension")
    .innerJoin("company", "company.companyGroupId", "dimension.companyGroupId")
    .select(["dimension.id", "dimension.entityType"])
    .where("company.id", "=", companyId)
    .where("dimension.active", "=", true)
    .where("dimension.entityType", "in", ["Project", "ProjectElement"])
    .execute();
  const dimensionId = (entityType: string) =>
    dimensions.find((dimension) => dimension.entityType === entityType)?.id;
  const projectDimension = dimensionId("Project");
  const elementDimension = dimensionId("ProjectElement");
  const tags = lines.flatMap((line, index) => [
    ...(projectDimension
      ? [
          {
            journalLineId: lineIds[index]!,
            dimensionId: projectDimension,
            valueId: order.projectId,
            companyId
          }
        ]
      : []),
    ...(elementDimension && line.projectElementId
      ? [
          {
            journalLineId: lineIds[index]!,
            dimensionId: elementDimension,
            valueId: line.projectElementId,
            companyId
          }
        ]
      : [])
  ]);
  if (tags.length > 0) {
    await trx.insertInto("journalLineDimension").values(tags).execute();
  }

  return journalId;
}
