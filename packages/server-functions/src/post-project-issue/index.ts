// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Constants, getCompanyTimeZone } from "@carbon/database";
import { inOrder, rpcRows, single } from "@carbon/database/rows";
import {
  datetime,
  round,
  type ServiceCoverage,
  settleQuantity
} from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { assertCompanyRecords } from "../company-records";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import {
  bookAdjustment,
  createAdjustmentJournal
} from "../lib/post-adjustment";
import { buildProjectCipRow, writeProjectCipRows } from "../lib/project-cip";
import {
  assertChargeable,
  buildProjectLedgerRow,
  insertProjectLedgerRows,
  isUnallowableCharge,
  loadProjectPostingContexts,
  loadServicePostingContext,
  ProjectChargeError,
  projectPostingKey,
  resolveProjectPostingAccount,
  serviceChargeCoverage,
  startElementsOnFirstCharge
} from "../lib/project-posting";
import {
  assertEntitiesInStripes,
  loadDemandStripes,
  type StripeQuantity,
  splitAcrossStripes,
  trackedEntityStripe
} from "../lib/stock-stripes";
import {
  findServiceIssueToReturn,
  installServicePart,
  type ServiceIssue,
  uninstallServicePart
} from "./service";

export const postProjectIssueInput = z.object({
  projectId: z.string(),
  projectElementId: z.string().optional().nullable(),
  itemId: z.string(),
  locationId: z.string(),
  storageUnitId: z.string().optional().nullable(),
  trackedEntityId: z.string().optional().nullable(),
  quantity: z.number().gt(0),
  direction: z.enum(["Issue", "Return"]),
  /** A Service project's issue: the user's coverage, with its reason. */
  coverage: z
    .enum(Constants.public.Enums.serviceCoverage)
    .optional()
    .nullable(),
  coverageReason: z.string().optional().nullable(),
  /** A Service project's return: the issue it reverses (else the latest
   *  open issue of the same part to the node). */
  returnOfProjectLedgerId: z.string().optional().nullable()
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
 *
 * On a Service project (By Coverage) the charge's coverage decides the
 * account: the user's override with a reason, else `resolveCoverage` for a
 * part. The issue writes a billable item and installs the part in the
 * customer asset (`installServicePart`). A return reverses one whole issue at
 * its coverage (`reversalOfId` on the ledger row) and undoes the install.
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
          { columns: ["name", "itemTrackingType", "replenishmentSystem"] }
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
            "ProjectElement",
            "Customer"
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
      projectId: string | null;
    };
    const trackingRows = (quantities.data ?? []) as TrackingQuantityRow[];

    // The stripes the project's demand may draw (Projects Phase 2a): its own
    // stock first when it has project stock, then common stock. A Return goes
    // back to the first: the project's stock, else common stock.
    const stripes = await loadDemandStripes(db, companyId, projectId);
    let draws: StripeQuantity[];
    if (!isIssue) {
      draws = [{ stripe: stripes[0] ?? null, quantity }];
    } else if (trackedEntityId) {
      // A tracked entity is drawn from its own stripe, which the project's
      // demand must be allowed to draw.
      const stripe = trackedEntityStripe(
        trackingRows.map((row) => ({
          trackedEntityId: row.trackedEntityId,
          projectId: row.projectId,
          quantity: row.quantity
        })),
        trackedEntityId
      );
      const source = trackingRows.find(
        (row) =>
          row.trackedEntityId === trackedEntityId &&
          (row.projectId ?? null) === stripe
      );
      if (round(quantity) > round(source?.quantity ?? 0)) {
        throw new InvalidInputError("Insufficient quantity to issue");
      }
      if (!stripes.includes(stripe)) {
        const entity = await single(
          db,
          "trackedEntity",
          { id: trackedEntityId, companyId },
          { columns: ["readableId"] }
        );
        await assertEntitiesInStripes(
          db,
          companyId,
          [{ readableId: entity.data?.readableId ?? null, stripe }],
          stripes
        );
      }
      draws = [{ stripe, quantity }];
    } else {
      // Untracked stock at the bin, stripe by stripe in draw order.
      // null == undefined — loose equality, as the adjustment path matches.
      const available = stripes.map((stripe) => ({
        stripe,
        quantity: trackingRows
          .filter(
            (row) =>
              row.trackedEntityId == null &&
              row.storageUnitId == storageUnitId &&
              (row.projectId ?? null) === stripe
          )
          .reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)
      }));
      const split = splitAcrossStripes(quantity, available);
      if (round(split.remaining) > 0) {
        throw new InvalidInputError("Insufficient quantity to issue");
      }
      // One stripe (no project stock) books the quantity as given.
      draws =
        stripes.length === 1
          ? [{ stripe: stripes[0] ?? null, quantity }]
          : split.draws;
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

      // A Service project: the coverage decides the account.
      const service =
        context.project.costTreatment === "By Coverage"
          ? await loadServicePostingContext(trx, {
              companyId,
              projectId,
              elementId: projectElementId
            })
          : null;
      if (context.project.costTreatment === "By Coverage" && !service) {
        throw new ProjectChargeError(
          "No service order owns the project of this issue"
        );
      }
      let coverage: ServiceCoverage | null = null;
      let coverageReason: string | null = null;
      let returnedIssue: ServiceIssue | null = null;
      if (service && isIssue) {
        const override = input.coverage && input.coverageReason?.trim();
        coverage = override
          ? input.coverage!
          : serviceChargeCoverage(service, "Part", postingDate);
        coverageReason = override ? input.coverageReason!.trim() : null;
      } else if (service) {
        returnedIssue = await findServiceIssueToReturn(trx, {
          companyId,
          projectId,
          projectElementId,
          itemId,
          trackedEntityId,
          quantity,
          returnOfProjectLedgerId: input.returnOfProjectLedgerId ?? null
        });
        coverage = returnedIssue.coverage;
        coverageReason = returnedIssue.coverageReason;
      }

      const resolved = resolveProjectPostingAccount(
        context,
        postingDate,
        coverage
      );
      const { treatment, accountId } = resolved;
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

      // One journal for every stripe drawn, created on the first movement
      // that carries value.
      let sharedJournalId: string | null = null;
      const getJournalId = async () => {
        if (!sharedJournalId) {
          sharedJournalId = await createAdjustmentJournal(trx, {
            companyId,
            accountingPeriodId: accountingPeriodId!,
            // accountingEnabled still gates this path, so it posts Posted.
            status: "Posted",
            description: journalDescription,
            postingDate,
            userId,
            sourceType: "Project Issue"
          });
        }
        return sharedJournalId;
      };
      const journalDescription = `${isIssue ? "Issue to" : "Return from"} Project ${
        context.project.identifier || context.project.name || projectId
      }`;

      // One adjustment per stripe drawn; the project is charged their sum.
      const bookedRows: { itemLedgerId: string; cost: number }[] = [];
      for (const draw of draws) {
        const bookedRow = await bookAdjustment(trx, {
          ledger: {
            postingDate,
            itemId,
            quantity: isIssue ? -draw.quantity : draw.quantity,
            locationId,
            storageUnitId,
            trackedEntityId,
            projectId: draw.stripe,
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
                postingStatus: "Posted",
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
                  : service
                    ? "Service Material"
                    : "Project Material",
                sourceType: "Project Issue",
                description: journalDescription,
                getJournalId,
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
                    : []),
                  ...(service?.customerId
                    ? [{ entityType: "Customer", valueId: service.customerId }]
                    : [])
                ]
              }
            : null
        });
        bookedRows.push(bookedRow);
      }
      const booked = {
        itemLedgerId: bookedRows[0]!.itemLedgerId,
        journalId: sharedJournalId as string | null,
        cost: round(bookedRows.reduce((sum, row) => sum + row.cost, 0))
      };

      let projectLedgerId: string | null = null;
      if (!isStatistical) {
        const row = (
          await insertProjectLedgerRows(trx, {
            companyId,
            userId,
            rows: [
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
                reversalOfId: returnedIssue?.id ?? null,
                coverage,
                coverageReason,
                unallowable: isUnallowableCharge(context, accountId),
                createdBy: userId
              })
            ]
          })
        )[0]!;
        projectLedgerId = row.id;

        if (service && isIssue && coverage) {
          await installServicePart(trx, {
            companyId,
            userId,
            service,
            projectId,
            projectElementId,
            projectLedgerId: row.id,
            itemLedgerId: booked.itemLedgerId,
            itemId,
            itemName: itemResult.data.name,
            trackedEntityId,
            quantity,
            postingDate,
            coverage
          });
        } else if (service && returnedIssue) {
          await uninstallServicePart(trx, {
            companyId,
            userId,
            service,
            projectElementId,
            issueLedgerId: returnedIssue.id,
            issueItemLedgerId: returnedIssue.documentId,
            returnLedgerId: row.id
          });
        }

        // An issue to a Capitalize project builds its asset.
        await writeProjectCipRows(trx, {
          companyId,
          userId,
          rows: [
            buildProjectCipRow({
              resolved,
              companyId,
              userId,
              projectId,
              projectElementId,
              sourceType: "Project Issue",
              sourceDocumentId: booked.itemLedgerId,
              amount: isIssue ? booked.cost : -booked.cost,
              costDate: postingDate,
              journalId: booked.journalId
            })
          ]
        });
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
