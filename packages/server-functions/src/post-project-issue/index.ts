// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCompanyTimeZone } from "@carbon/database";
import { inOrder, rpcRows, single } from "@carbon/database/rows";
import { datetime, round, settleQuantity } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { assertCompanyRecords } from "../company-records";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { bookAdjustment } from "../lib/post-adjustment";
import {
  assertChargeable,
  buildProjectLedgerRow,
  loadProjectPostingContexts,
  ProjectChargeError,
  projectPostingKey,
  resolveProjectPostingAccount,
  startElementsOnFirstCharge
} from "../lib/project-posting";

export const postProjectIssueInput = z.object({
  projectId: z.string(),
  projectElementId: z.string().optional().nullable(),
  itemId: z.string(),
  locationId: z.string(),
  storageUnitId: z.string().optional().nullable(),
  trackedEntityId: z.string().optional().nullable(),
  quantity: z.number().gt(0),
  direction: z.enum(["Issue", "Return"])
});

export type PostProjectIssueResult = {
  success: true;
  itemLedgerId: string;
  journalId: string | null;
  cost: number;
  projectLedgerId: string | null;
};

/**
 * Issues stock to a project (or returns it). The stock leaves (or re-enters)
 * inventory at its carrying cost through the inventory-adjustment core, and
 * the offset posts to the project account the cost treatment resolves:
 * Dr project / Cr inventory for an Issue, the mirror for a Return. One
 * projectLedger Material row records the same cost. A Statistical project
 * charges indirectCostAccount and writes no ledger row.
 *
 * A Return values the stock at the item's current cost (the increase rule of
 * `bookAdjustment`), and the ledger row uses that same cost, so the project
 * total equals the GL.
 */
const postProjectIssue = defineServerFn({
  name: "post-project-issue",
  input: postProjectIssueInput,
  permissions: { update: "inventory" },
  async run(ctx, input): Promise<PostProjectIssueResult> {
    const { db, companyId, userId } = ctx;
    const {
      projectId,
      itemId,
      locationId,
      quantity,
      direction,
      storageUnitId = null,
      trackedEntityId = null
    } = input;
    const projectElementId = input.projectElementId ?? null;
    const isIssue = direction === "Issue";

    // The ids come from the caller: re-read them under companyId.
    await inOrder([
      () =>
        assertCompanyRecords(db, "project", [projectId], companyId, "Project"),
      () => assertCompanyRecords(db, "item", [itemId], companyId, "Item"),
      () =>
        assertCompanyRecords(
          db,
          "location",
          [locationId],
          companyId,
          "Location"
        ),
      () =>
        assertCompanyRecords(
          db,
          "storageUnit",
          [storageUnitId],
          companyId,
          "Storage unit"
        ),
      () =>
        assertCompanyRecords(
          db,
          "trackedEntity",
          [trackedEntityId],
          companyId,
          "Tracked entity"
        )
    ]);

    const postingDate = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    const [
      itemResult,
      itemCostResult,
      settings,
      accountDefaults,
      dimensions,
      quantities
    ] = await inOrder([
      () =>
        single(
          db,
          "item",
          { id: itemId, companyId },
          { columns: ["itemTrackingType", "replenishmentSystem"] }
        ),
      () =>
        single(
          db,
          "itemCost",
          { itemId, companyId },
          {
            columns: [
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId"
            ]
          }
        ),
      () =>
        single(
          db,
          "companySettings",
          { id: companyId },
          { columns: ["accountingEnabled"] }
        ),
      () =>
        db
          .selectFrom("accountDefault")
          .select([
            "rawMaterialsAccount",
            "finishedGoodsAccount",
            "inventoryAdjustmentVarianceAccount",
            "indirectCostAccount"
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
            "Project",
            "ProjectElement"
          ])
          .execute(),
      () =>
        rpcRows(db, "get_item_quantities_by_tracking_id", {
          item_id: itemId,
          company_id: companyId,
          location_id: locationId
        })
    ]);

    if (itemResult.error) throw new Error("Failed to fetch item");
    if (itemCostResult.error) throw new Error("Failed to fetch item cost");
    // Fail closed: a failed settings read must not post without the GL.
    if (settings.error) throw new Error("Failed to fetch company settings");
    if (quantities.error) throw new Error("Failed to fetch current quantities");
    if (!accountDefaults) throw new Error("Error getting account defaults");

    const isTracked =
      itemResult.data.itemTrackingType === "Serial" ||
      itemResult.data.itemTrackingType === "Batch";
    if (isTracked && !trackedEntityId) {
      throw new InvalidInputError(
        `Select the ${itemResult.data.itemTrackingType === "Serial" ? "serial number" : "batch"} to ${isIssue ? "issue" : "return"}`
      );
    }

    // Only the fields this function reads.
    type TrackingQuantityRow = {
      trackedEntityId: string | null;
      storageUnitId: string | null;
      quantity: number | null;
    };
    const trackingRows = (quantities.data ?? []) as TrackingQuantityRow[];
    if (isIssue) {
      // null == undefined — loose equality, as the adjustment path matches.
      const source = trackedEntityId
        ? trackingRows.find((row) => row.trackedEntityId === trackedEntityId)
        : trackingRows.find(
            (row) =>
              row.trackedEntityId == null && row.storageUnitId == storageUnitId
          );
      if (round(quantity) > round(source?.quantity ?? 0)) {
        throw new InvalidInputError("Insufficient quantity to issue");
      }
    }

    const accountingEnabled = settings.data?.accountingEnabled ?? false;
    const dimensionMap: Record<string, string> = {};
    for (const dimension of dimensions) {
      if (dimension.entityType) {
        dimensionMap[dimension.entityType] = dimension.id;
      }
    }

    return db.transaction().execute(async (trx) => {
      const contexts = await loadProjectPostingContexts(trx, companyId, [
        { projectId, projectElementId }
      ]);
      const context = contexts.get(
        projectPostingKey(projectId, projectElementId)
      );
      if (!context) throw new NotFoundError("Project element not found");
      assertChargeable(context, isIssue ? "new" : "commitment");

      const { treatment, accountId } = resolveProjectPostingAccount(
        context,
        postingDate
      );
      const isStatistical = treatment === "Statistical";
      const offsetAccount = isStatistical
        ? accountDefaults.indirectCostAccount
        : accountId;
      if (!offsetAccount) {
        throw new ProjectChargeError(
          "Set Indirect Cost in Account Defaults before you issue to a Statistical project"
        );
      }

      if (trackedEntityId) {
        const entity = await trx
          .selectFrom("trackedEntity")
          .select(["quantity", "status"])
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        await trx
          .updateTable("trackedEntity")
          .set(
            settleQuantity({
              quantity:
                Number(entity.quantity) + (isIssue ? -quantity : quantity),
              // A returned unit is back in stock.
              status:
                !isIssue && entity.status === "Consumed"
                  ? "Available"
                  : entity.status,
              refusal: "Insufficient quantity to issue"
            })
          )
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", companyId)
          .execute();
      }

      const accountingPeriodId = accountingEnabled
        ? (
            await resolveAccountingPeriod(
              trx,
              companyId,
              postingDate,
              "current"
            )
          ).id
        : null;

      const booked = await bookAdjustment(trx, {
        ledger: {
          postingDate,
          itemId,
          quantity: isIssue ? -quantity : quantity,
          locationId,
          storageUnitId,
          trackedEntityId,
          entryType: isIssue ? "Negative Adjmt." : "Positive Adjmt.",
          documentType: "Project Issue",
          documentId: projectId,
          companyId,
          createdBy: userId
        },
        item: {
          itemTrackingType: itemResult.data.itemTrackingType,
          replenishmentSystem: itemResult.data.replenishmentSystem,
          itemPostingGroupId: itemCostResult.data.itemPostingGroupId
        },
        itemCost: itemCostResult.data,
        accounting: accountingPeriodId
          ? {
              accountingPeriodId,
              accountDefaults: {
                rawMaterialsAccount: accountDefaults.rawMaterialsAccount,
                finishedGoodsAccount: accountDefaults.finishedGoodsAccount,
                inventoryAdjustmentVarianceAccount:
                  accountDefaults.inventoryAdjustmentVarianceAccount
              },
              offsetAccount,
              offsetDescription: isStatistical
                ? "Indirect Cost"
                : "Project Material",
              sourceType: "Project Issue",
              description: `${isIssue ? "Issue to" : "Return from"} Project ${
                context.project.identifier || context.project.name || projectId
              }`,
              userId,
              dimensions: dimensionMap,
              extraDimensions: [
                { entityType: "Project", valueId: projectId },
                ...(projectElementId
                  ? [
                      {
                        entityType: "ProjectElement",
                        valueId: projectElementId
                      }
                    ]
                  : [])
              ]
            }
          : null
      });

      let projectLedgerId: string | null = null;
      if (!isStatistical) {
        const row = await trx
          .insertInto("projectLedger")
          .values(
            buildProjectLedgerRow({
              companyId,
              projectId,
              projectElementId,
              postingDate,
              costType: "Material",
              documentType: "Project Issue",
              documentId: booked.itemLedgerId,
              itemId,
              quantity: isIssue ? quantity : -quantity,
              amount: isIssue ? booked.cost : -booked.cost,
              createdBy: userId
            })
          )
          .returning("id")
          .executeTakeFirstOrThrow();
        projectLedgerId = row.id;
      }

      if (projectElementId) {
        // The element's plan line for the item, if it has one (the oldest
        // when it has several).
        await sql`
          UPDATE "projectElementMaterial"
          SET "quantityIssued" = "quantityIssued" + ${
            isIssue ? quantity : -quantity
          }::numeric,
              "updatedBy" = ${userId},
              "updatedAt" = NOW()
          WHERE "id" = (
            SELECT "id" FROM "projectElementMaterial"
            WHERE "projectElementId" = ${projectElementId}
              AND "projectId" = ${projectId}
              AND "itemId" = ${itemId}
              AND "companyId" = ${companyId}
            ORDER BY "createdAt", "id"
            LIMIT 1
          )
          AND "companyId" = ${companyId}
        `.execute(trx);

        if (isIssue) {
          await startElementsOnFirstCharge(trx, companyId, [projectElementId]);
        }
      }

      return {
        success: true,
        itemLedgerId: booked.itemLedgerId,
        journalId: booked.journalId,
        cost: booked.cost,
        projectLedgerId
      };
    });
  }
});

export default postProjectIssue;
