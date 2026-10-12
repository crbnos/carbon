// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Database,
  getCompanyTimeZone,
  type Json,
  journalReference
} from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  assertPostingStatusUnchanged,
  journalPostingStatus,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import {
  allocateAcrossBudgets,
  getOperationLinesideBin,
  getPickedBudgets,
  orderOldFirst,
  recordSharedTakes,
  type SharedTakes,
  splitTakeByBin
} from "@carbon/database/picked-consumption";
import { contains, inOrder, many, single } from "@carbon/database/rows";
import {
  getNextSequence,
  getNextSerialNumbers
} from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import {
  buildBatchMergeRecords,
  buildBatchSplitRecords,
  credit,
  datetime,
  debit,
  isFullDraw,
  resolveTrackedEntityBin,
  round,
  splitPickAcrossMembers,
  type TrackedEntityAttributes
} from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import {
  type Insertable,
  type Kysely,
  type Selectable,
  sql,
  type Transaction
} from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { assertCompanyRecords } from "../company-records";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import { calculateCOGS } from "../lib/calculate-cogs";
import {
  getCurrentAccountingPeriod,
  resolveAccountingPeriod
} from "../lib/get-accounting-period";
import {
  getDefaultPostingGroup,
  resolveInventoryAccount
} from "../lib/get-posting-group";
import {
  bookAdjustment,
  createAdjustmentJournal,
  valueMovement
} from "../lib/post-adjustment";
import {
  getStorageUnitWithHighestQuantity,
  updatePickMethodDefaultStorageUnitIfNeeded
} from "../lib/storage-units";
import reschedule from "../reschedule";
import { ServerFnContext } from "../server-fn-context";
import {
  type ExpiredEntityPolicy,
  type ExpiryOverride,
  expiredEntities,
  expiryVerdict,
  getExpiredEntityPolicy
} from "../shelf-life";
import { resolveMaintenanceReturnCost } from "./maintenance-return-cost";
import { applyScrapReplacement } from "./scrap-replacement";

/**
 * Applies the company's expired-entity policy to entities about to be
 * consumed: `ok` with a warning under `Warn`, `ok: false` with the reason when
 * blocked. An override with a reason passes under `BlockWithOverride`; the
 * caller records it.
 */
function checkExpiredEntities(
  entities: { id: string; expirationDate: string | null }[],
  policy: ExpiredEntityPolicy,
  override: ExpiryOverride,
  today: CalendarDate
): { ok: true; warning?: string } | { ok: false; reason: string } {
  const expired = expiredEntities(entities, today);
  if (expired.length === 0) return { ok: true };

  const ids = expired.map((e) => e.id).join(", ");
  const noun = `entit${expired.length === 1 ? "y" : "ies"}`;
  switch (expiryVerdict(policy, override)) {
    case "warn":
      return {
        ok: true,
        warning: `Consumed ${expired.length} expired tracked ${noun}: ${ids}`
      };
    case "allow":
      return { ok: true };
    case "block":
      return {
        ok: false,
        reason: `Cannot consume expired tracked ${noun}: ${ids}`
      };
  }
}

async function issueJobOperationMaterials(
  trx: Transaction<KyselyDatabase>,
  {
    jobOperationId,
    quantity,
    companyId,
    userId,
    postingStatus,
    accountDefaults,
    dimensionMap,
    db
  }: {
    jobOperationId: string;
    quantity: number;
    companyId: string;
    userId: string;
    // Provisional before the company's accounting cutover, Posted after it.
    postingStatus: AutomaticJournalStatus;
    accountDefaults: ConsumeAccountDefaults;
    dimensionMap: Map<string, string>;
    db: Kysely<KyselyDatabase>;
  }
) {
  const materialsToIssue = await trx
    .selectFrom("jobMaterial")
    .where("jobOperationId", "=", jobOperationId)
    .where("companyId", "=", companyId)
    .where("itemType", "in", ["Material", "Part", "Consumable"])
    .where("methodType", "!=", "Make to Order")
    .where("estimatedQuantity", ">", 0)
    .where("requiresBatchTracking", "=", false)
    .where("requiresSerialTracking", "=", false)
    .selectAll()
    .execute();

  const kittedChildren = await trx
    .selectFrom("jobMaterialWithMakeMethodId")
    .where("jobOperationId", "=", jobOperationId)
    .where("companyId", "=", companyId)
    .where("itemType", "in", ["Material", "Part", "Consumable"])
    .where("methodType", "=", "Make to Order")
    .where("kit", "=", true)
    .selectAll()
    .execute();

  const jobMakeMethodIdsOfKittedChildren = kittedChildren.map(
    (kittedChild) => kittedChild.jobMaterialMakeMethodId
  );

  if (jobMakeMethodIdsOfKittedChildren.length > 0) {
    const materialsToIssueFromKittedChildren = await trx
      .selectFrom("jobMaterial")
      .where("jobMakeMethodId", "in", jobMakeMethodIdsOfKittedChildren)
      .where("itemType", "in", ["Material", "Part", "Consumable"])
      .where("methodType", "!=", "Make to Order")
      .where("estimatedQuantity", ">", 0)
      .where("requiresBatchTracking", "=", false)
      .where("requiresSerialTracking", "=", false)
      .selectAll()
      .execute();

    materialsToIssue.push(...materialsToIssueFromKittedChildren);
  }

  if (materialsToIssue.length === 0) return { totalMaterialCost: 0 };

  const jobId = materialsToIssue[0]!.jobId;

  const [job, items] = await Promise.all([
    trx
      .selectFrom("job")
      .where("id", "=", jobId)
      .select(["locationId", "jobId"])
      .executeTakeFirst(),
    trx
      .selectFrom("item")
      .where(
        "id",
        "in",
        materialsToIssue.map((material) => material.itemId)
      )
      .select(["id", "item.itemTrackingType"])
      .execute()
  ]);

  if (!job?.locationId) {
    throw new Error("Job location is required");
  }

  const itemIdIsTracked = new Map(
    items.map((item) => [item.id, item.itemTrackingType === "Inventory"])
  );

  // Company business day — item/cost ledgers and this function's journals must
  // all post on the same day (they previously relied on the CURRENT_DATE default,
  // which is UTC and diverged from the company-TZ journals here).
  const today = datetime
    .today(await getCompanyTimeZone(trx, companyId))
    .toString();

  const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
    [];

  const opStorageUnitId = await getOperationLinesideBin(trx, {
    jobOperationId,
    companyId
  });
  const takenShared: SharedTakes = new Map();
  for await (const material of materialsToIssue) {
    // Cap the backflush at the material's remaining unissued requirement,
    // mirroring backflush_job_materials. Without this, materials already
    // issued manually (e.g. from MES after skipping the operation) get
    // consumed a second time on operation completion — duplicate item/cost
    // ledger entries and duplicate DR WIP / CR Inventory journal lines.
    const demandQuantity = Number(material.quantity) * quantity;
    const remainingQuantity = Math.max(
      Number(material.estimatedQuantity ?? 0) -
        Number(material.quantityIssued ?? 0),
      0
    );
    const quantityToIssue = Math.min(demandQuantity, remainingQuantity);

    if (quantityToIssue <= 0) continue;

    const budgets = orderOldFirst(
      await getPickedBudgets(trx, {
        material,
        locationId: job.locationId,
        companyId,
        opStorageUnitId,
        takenShared
      }),
      material.itemId
    );
    const { takes, remaining } = allocateAcrossBudgets(
      quantityToIssue,
      budgets,
      Number(material.quantity ?? 0)
    );
    recordSharedTakes(takenShared, takes);
    for (const take of takes) {
      if (!take.budget.isInventory) continue;
      for (const row of splitTakeByBin(take)) {
        itemLedgerInserts.push({
          entryType: "Consumption",
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineId: jobOperationId,
          companyId,
          itemId: take.budget.itemId,
          quantity: -row.quantity,
          locationId: job.locationId,
          storageUnitId: row.storageUnitId,
          postingDate: today,
          createdBy: userId
        });
      }
    }

    if (remaining > 0) {
      let proposedStorageUnitId = material.storageUnitId;

      if (!proposedStorageUnitId) {
        if (material.defaultStorageUnit) {
          const pickMethod = await trx
            .selectFrom("pickMethod")
            .where("itemId", "=", material.itemId)
            .where("locationId", "=", job.locationId!)
            .where("companyId", "=", companyId)
            .select("defaultStorageUnitId")
            .executeTakeFirst();

          proposedStorageUnitId = pickMethod?.defaultStorageUnitId ?? null;

          if (!proposedStorageUnitId) {
            proposedStorageUnitId = await getStorageUnitWithHighestQuantity(
              trx,
              material.itemId,
              job.locationId!
            );
          }
        } else {
          proposedStorageUnitId = await getStorageUnitWithHighestQuantity(
            trx,
            material.itemId,
            job.locationId!
          );
        }
      }

      const currentStorageUnitQuantity = await trx
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum("quantity").as("quantity"))
        .where("itemId", "=", material.itemId)
        .where("locationId", "=", job.locationId!)
        .where("storageUnitId", "=", proposedStorageUnitId ?? "")
        .executeTakeFirst();

      const allStorageUnitQuantities = await trx
        .selectFrom("itemLedger")
        .select(["storageUnitId", (eb) => eb.fn.sum("quantity").as("quantity")])
        .where("itemId", "=", material.itemId)
        .where("locationId", "=", job.locationId!)
        .groupBy("storageUnitId")
        .having((eb) => eb.fn.sum("quantity"), ">", 0)
        .execute();

      let finalStorageUnitId = proposedStorageUnitId;
      const currentQuantity = Number(currentStorageUnitQuantity?.quantity ?? 0);

      if (currentQuantity < remaining && allStorageUnitQuantities.length > 0) {
        const bestStorageUnit = allStorageUnitQuantities.reduce(
          (best, current) =>
            Number(current.quantity) > Number(best.quantity) ? current : best
        );
        finalStorageUnitId = bestStorageUnit.storageUnitId ?? null;
      }

      const isTracked = itemIdIsTracked.get(material.itemId);

      if (isTracked) {
        itemLedgerInserts.push({
          entryType: "Consumption",
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineId: jobOperationId,
          companyId,
          itemId: material.itemId,
          quantity: -remaining,
          locationId: job.locationId,
          storageUnitId: finalStorageUnitId,
          postingDate: today,
          createdBy: userId
        });
      }
    }

    await trx
      .updateTable("jobMaterial")
      .set({
        quantityIssued: round(
          round(Number(material.quantityIssued) ?? 0) + round(quantityToIssue)
        )
      })
      .where("id", "=", material.id)
      .where("companyId", "=", companyId)
      .execute();
  }

  // Total material cost this call relieved from inventory into WIP — the
  // jobOperationScrap case posts its WIP→scrap journal from this figure so a
  // second calculateCOGS pass never double-relieves cost layers.
  let totalMaterialCost = 0;

  if (itemLedgerInserts.length > 0) {
    await trx.insertInto("itemLedger").values(itemLedgerInserts).execute();

    for (const ledger of itemLedgerInserts) {
      await updatePickMethodDefaultStorageUnitIfNeeded(
        trx,
        ledger.itemId,
        ledger.locationId,
        ledger.storageUnitId,
        companyId,
        userId
      );
    }
  }

  if (itemLedgerInserts.length > 0) {
    const journalLineInserts: {
      accountId: string;
      description: string;
      amount: number;
      quantity: number;
      documentType: "Job Consumption";
      documentId: string;
      documentLineReference: string;
      journalLineReference: string;
      companyId: string;
    }[] = [];

    const journalLineDimensionsMeta: {
      itemPostingGroupId: string | null;
      itemId: string | null;
      locationId: string | null;
    }[] = [];

    const jobForLocation = await trx
      .selectFrom("job")
      .where("id", "=", jobId)
      .select(["locationId"])
      .executeTakeFirst();

    const consumedItemIds = [
      ...new Set(itemLedgerInserts.map((l) => l.itemId))
    ];
    const [consumedItemCosts, consumedItems] =
      consumedItemIds.length > 0
        ? await Promise.all([
            trx
              .selectFrom("itemCost")
              .where("itemId", "in", consumedItemIds)
              .where("companyId", "=", companyId)
              .select(["itemId", "itemPostingGroupId"])
              .execute(),
            trx
              .selectFrom("item")
              .where("id", "in", consumedItemIds)
              .where("companyId", "=", companyId)
              .select(["id", "replenishmentSystem"])
              .execute()
          ])
        : [[], []];
    const consumedPostingGroupMap = new Map(
      consumedItemCosts.map((ic) => [ic.itemId, ic.itemPostingGroupId])
    );
    const consumedReplenishmentMap = new Map(
      consumedItems.map((i) => [i.id, i.replenishmentSystem])
    );

    for (const ledger of itemLedgerInserts) {
      const materialQuantity = Math.abs(Number(ledger.quantity));
      if (materialQuantity === 0) continue;

      const cogsResult = await calculateCOGS(trx, {
        itemId: ledger.itemId,
        quantity: materialQuantity,
        companyId
      });
      totalMaterialCost += cogsResult.totalCost;

      const journalLineReference = nanoid();

      journalLineInserts.push({
        accountId: accountDefaults.workInProgressAccount,
        description: "WIP Account",
        amount: debit("asset", cogsResult.totalCost),
        quantity: materialQuantity,
        documentType: "Job Consumption",
        documentId: jobId,
        documentLineReference:
          journalReference.to.materialIssue(jobOperationId),
        journalLineReference,
        companyId
      });

      const inventoryAccount = resolveInventoryAccount(
        consumedReplenishmentMap.get(ledger.itemId) ?? null,
        accountDefaults
      );
      journalLineInserts.push({
        accountId: inventoryAccount.account,
        description: inventoryAccount.description,
        amount: credit("asset", cogsResult.totalCost),
        quantity: materialQuantity,
        documentType: "Job Consumption",
        documentId: jobId,
        documentLineReference:
          journalReference.to.materialIssue(jobOperationId),
        journalLineReference,
        companyId
      });

      await trx
        .insertInto("costLedger")
        .values({
          itemLedgerType: "Consumption",
          costLedgerType: "Direct Cost",
          adjustment: false,
          documentType: "Job Consumption",
          documentId: jobId,
          itemId: ledger.itemId,
          quantity: -materialQuantity,
          cost: -cogsResult.totalCost,
          remainingQuantity: 0,
          postingDate: today,
          companyId
        })
        .execute();

      for (let i = 0; i < 2; i++) {
        journalLineDimensionsMeta.push({
          itemPostingGroupId:
            consumedPostingGroupMap.get(ledger.itemId) ?? null,
          itemId: ledger.itemId ?? null,
          locationId: jobForLocation?.locationId ?? null
        });
      }
    }

    if (journalLineInserts.length > 0) {
      // Resolve the period from the SAME hoisted `today` the ledger rows used —
      // a midnight rollover mid-transaction must not split journal and ledger.
      // A Provisional journal has no accounting period.
      const accountingPeriodId =
        postingStatus === "Posted"
          ? await getCurrentAccountingPeriod(companyId, trx, today)
          : null;
      const journalEntryId = await getNextSequence(
        trx,
        "journalEntry",
        companyId
      );

      const journalResult = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          accountingPeriodId,
          description: `Material Issue to Job ${job?.jobId ?? jobId}`,
          postingDate: today,
          companyId,
          sourceType: "Job Consumption",
          status: postingStatus,
          postedAt: datetime.timestamp(),
          postedBy: userId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const journalLineResults = await trx
        .insertInto("journalLine")
        .values(
          journalLineInserts.map((line) => ({
            ...line,
            journalId: journalResult.id
          }))
        )
        .returning(["id"])
        .execute();

      if (dimensionMap.size > 0) {
        const dimensionInserts: {
          journalLineId: string;
          dimensionId: string;
          valueId: string;
          companyId: string;
        }[] = [];

        journalLineResults.forEach((jl, index) => {
          const meta = journalLineDimensionsMeta[index];
          if (!meta) return;

          if (meta.itemPostingGroupId && dimensionMap.has("ItemPostingGroup")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("ItemPostingGroup")!,
              valueId: meta.itemPostingGroupId,
              companyId
            });
          }
          if (meta.itemId && dimensionMap.has("Item")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Item")!,
              valueId: meta.itemId,
              companyId
            });
          }
          if (meta.locationId && dimensionMap.has("Location")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Location")!,
              valueId: meta.locationId,
              companyId
            });
          }
        });

        if (dimensionInserts.length > 0) {
          await trx
            .insertInto("journalLineDimension")
            .values(dimensionInserts)
            .execute();
        }
      }
    }
  }

  return { totalMaterialCost };
}

async function createMaterialWipEntries(
  trx: Transaction<KyselyDatabase>,
  args: {
    // trackedEntityId: the serial consumed, relieved from its own cost layer
    // first (specific identification, lib/cost-layer-order.ts).
    consumptionLedgers: Array<{
      itemId: string;
      quantity: number;
      trackedEntityId?: string | null;
    }>;
    jobId: string;
    operationId: string;
    description: string;
    wipAccount: string;
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
    dimensionMap: Map<string, string>;
    jobLocationId: string | null;
    db: Kysely<KyselyDatabase>;
    companyId: string;
    userId: string;
    // Provisional before the company's accounting cutover, Posted after it.
    postingStatus: AutomaticJournalStatus;
  }
) {
  const {
    consumptionLedgers,
    jobId,
    operationId,
    description,
    wipAccount,
    rawMaterialsAccount,
    finishedGoodsAccount,
    dimensionMap,
    jobLocationId,
    companyId,
    userId,
    postingStatus
  } = args;

  // Cost layer posts on the company business day, matching the caller's
  // itemLedger movement (was defaulting to CURRENT_DATE = UTC).
  const today = datetime
    .today(await getCompanyTimeZone(trx, companyId))
    .toString();

  const journalLineInserts: {
    accountId: string;
    description: string;
    amount: number;
    quantity: number;
    documentType: "Job Consumption";
    documentId: string;
    documentLineReference: string;
    journalLineReference: string;
    companyId: string;
  }[] = [];

  const journalLineDimensionsMeta: {
    itemPostingGroupId: string | null;
    itemId: string | null;
    locationId: string | null;
  }[] = [];

  const uniqueItemIds = [...new Set(consumptionLedgers.map((l) => l.itemId))];
  const [consumedItemCosts, consumedItems] =
    uniqueItemIds.length > 0
      ? await Promise.all([
          trx
            .selectFrom("itemCost")
            .where("itemId", "in", uniqueItemIds)
            .where("companyId", "=", companyId)
            .select(["itemId", "itemPostingGroupId"])
            .execute(),
          trx
            .selectFrom("item")
            .where("id", "in", uniqueItemIds)
            .where("companyId", "=", companyId)
            .select(["id", "replenishmentSystem"])
            .execute()
        ])
      : [[], []];
  const consumedPostingGroupMap = new Map(
    consumedItemCosts.map((ic) => [ic.itemId, ic.itemPostingGroupId])
  );
  const consumedReplenishmentMap = new Map(
    consumedItems.map((i) => [i.id, i.replenishmentSystem])
  );

  for (const ledger of consumptionLedgers) {
    const ledgerQty = Number(ledger.quantity);
    if (ledgerQty === 0) continue;

    const absQty = Math.abs(ledgerQty);
    const isConsumption = ledgerQty < 0;

    let cost: number;
    if (isConsumption) {
      const cogsResult = await calculateCOGS(trx, {
        itemId: ledger.itemId,
        quantity: absQty,
        companyId,
        trackedEntityIds: ledger.trackedEntityId ? [ledger.trackedEntityId] : []
      });
      cost = cogsResult.totalCost;
    } else {
      const itemCost = await trx
        .selectFrom("itemCost")
        .where("itemId", "=", ledger.itemId)
        .where("companyId", "=", companyId)
        .select("unitCost")
        .executeTakeFirst();
      cost = absQty * Number(itemCost?.unitCost ?? 0);
    }

    if (cost <= 0) continue;

    const jlRef = nanoid();
    const inventoryAccount = resolveInventoryAccount(
      consumedReplenishmentMap.get(ledger.itemId) ?? null,
      { rawMaterialsAccount, finishedGoodsAccount }
    );

    if (isConsumption) {
      journalLineInserts.push(
        {
          accountId: wipAccount,
          description: "WIP Account",
          amount: debit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId
        },
        {
          accountId: inventoryAccount.account,
          description: inventoryAccount.description,
          amount: credit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId
        }
      );
    } else {
      journalLineInserts.push(
        {
          accountId: inventoryAccount.account,
          description: inventoryAccount.description,
          amount: debit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId
        },
        {
          accountId: wipAccount,
          description: "WIP Account",
          amount: credit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId
        }
      );
    }

    await trx
      .insertInto("costLedger")
      .values({
        itemLedgerType: "Consumption",
        costLedgerType: "Direct Cost",
        adjustment: false,
        documentType: "Job Consumption",
        documentId: jobId,
        itemId: ledger.itemId,
        quantity: isConsumption ? -absQty : absQty,
        cost: isConsumption ? -cost : cost,
        remainingQuantity: 0,
        postingDate: today,
        companyId
      })
      .execute();

    for (let i = 0; i < 2; i++) {
      journalLineDimensionsMeta.push({
        itemPostingGroupId: consumedPostingGroupMap.get(ledger.itemId) ?? null,
        itemId: ledger.itemId ?? null,
        locationId: jobLocationId
      });
    }
  }

  if (journalLineInserts.length === 0) return;

  // Same hoisted `today` as this function's ledger rows (see above). A
  // Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getCurrentAccountingPeriod(companyId, trx, today)
      : null;
  const journalEntryId = await getNextSequence(trx, "journalEntry", companyId);

  const journalResult = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId,
      description,
      postingDate: today,
      companyId,
      sourceType: "Job Consumption",
      status: postingStatus,
      postedAt: datetime.timestamp(),
      postedBy: userId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  const journalLineResults = await trx
    .insertInto("journalLine")
    .values(
      journalLineInserts.map((line) => ({
        ...line,
        journalId: journalResult.id
      }))
    )
    .returning(["id"])
    .execute();

  if (dimensionMap.size > 0) {
    const dimensionInserts: {
      journalLineId: string;
      dimensionId: string;
      valueId: string;
      companyId: string;
    }[] = [];

    journalLineResults.forEach((jl, index) => {
      const meta = journalLineDimensionsMeta[index];
      if (!meta) return;
      if (meta.itemPostingGroupId && dimensionMap.has("ItemPostingGroup")) {
        dimensionInserts.push({
          journalLineId: jl.id,
          dimensionId: dimensionMap.get("ItemPostingGroup")!,
          valueId: meta.itemPostingGroupId,
          companyId
        });
      }
      if (meta.itemId && dimensionMap.has("Item")) {
        dimensionInserts.push({
          journalLineId: jl.id,
          dimensionId: dimensionMap.get("Item")!,
          valueId: meta.itemId,
          companyId
        });
      }
      if (meta.locationId && dimensionMap.has("Location")) {
        dimensionInserts.push({
          journalLineId: jl.id,
          dimensionId: dimensionMap.get("Location")!,
          valueId: meta.locationId,
          companyId
        });
      }
    });

    if (dimensionInserts.length > 0) {
      await trx
        .insertInto("journalLineDimension")
        .values(dimensionInserts)
        .execute();
    }
  }
}

// Each child's quantity is its own persist boundary — it becomes one
// Consumption ledger row — so round PER CHILD and then round the sum. That is
// what makes jobMaterial.quantityIssued net exactly against those rows; a
// single round of the raw sum can differ from them by a minor unit.
function roundedChildTotal(children: { quantity: number | string }[]): number {
  return round(
    children.reduce((sum, child) => sum + round(Number(child.quantity)), 0)
  );
}

const logger = getLogger("server-functions", "issue");

type ItemLedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];

/** Each `type` adds its own fields (`newTrackedEntityId`, `readableId`, …). */
export type IssueResult = { success: boolean; message?: string } & Record<
  string,
  unknown
>;

export const issueInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("convertEntity"),
    trackedEntityId: z.string(),
    newRevision: z.string(),
    quantity: z.number().positive().default(1)
  }),
  z.object({
    type: z.literal("jobCompleteMakeToOrder"),
    jobId: z.string(),
    quantityComplete: z.number()
  }),
  z.object({
    type: z.literal("jobOperation"),
    quantity: z.number(),
    id: z.string()
  }),
  z.object({
    type: z.literal("jobOperationBatchComplete"),
    trackedEntityId: z.string(),
    quantity: z.number(),
    jobOperationId: z.string(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional(),
    // Provenance links for inspection-driven completions. The partial UNIQUE
    // index on productionQuantity.inspectionSampleId makes a re-post of the
    // same verdict fail instead of double-counting.
    inspectionId: z.string().optional(),
    inspectionSampleId: z.string().optional()
  }),
  z.object({
    type: z.literal("jobOperationBatchOutput"),
    jobOperationId: z.string(),
    trackedEntityId: z.string(),
    quantity: z.number(),
    readableId: z.string().optional().nullable()
  }),
  z.object({
    type: z.literal("jobOperationSerialComplete"),
    trackedEntityId: z.string(),
    quantity: z.number(),
    jobOperationId: z.string(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional(),
    inspectionId: z.string().optional(),
    inspectionSampleId: z.string().optional()
  }),
  z.object({
    type: z.literal("jobOperationScrap"),
    jobOperationId: z.string(),
    quantity: z.number().positive(),
    scrapReasonId: z.string(),
    trackedEntityId: z.string().optional(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional()
  }),
  z.object({
    type: z.literal("partToOperation"),
    id: z.string(),
    itemId: z.string(),
    quantity: z.number(),
    adjustmentType: z.enum([
      "Set Quantity",
      "Positive Adjmt.",
      "Negative Adjmt."
    ]),
    materialId: z.string().optional(),
    // Assembly view: when issuing an unplanned part (no materialId), scope the new
    // jobMaterial to this step so it surfaces on that step in the operator view.
    jobOperationStepId: z.string().optional()
  }),
  z.object({
    type: z.literal("scrapTrackedEntity"),
    trackedEntityId: z.string(),
    materialId: z.string(),
    parentTrackedEntityId: z.string(),
    scrapReasonId: z.string(),
    makeReplacement: z.boolean().optional()
  }),
  z.object({
    type: z.literal("mergeTrackedEntities"),
    trackedEntityIds: z.array(z.string()).min(2),
    readableId: z.string().optional().nullable()
  }),
  z.object({
    type: z.literal("trackedEntitiesToBatch"),
    batchId: z.string(),
    itemId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    ),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional()
  }),
  z.object({
    type: z.literal("trackedEntitiesToOperation"),
    materialId: z.string().optional(),
    jobOperationId: z.string().optional(),
    itemId: z.string().optional(),
    parentTrackedEntityId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    ),
    // Assembly view: the step + 1-based unit the operator was on, stamped onto the
    // Consume activity so issued quantities can be attributed per-unit/per-step even
    // for a batch parent (all units share one lot entity).
    jobOperationStepId: z.string().optional(),
    unitNumber: z.number().int().positive().optional(),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional()
  }),
  z.object({
    type: z.literal("unconsumeTrackedEntities"),
    materialId: z.string(),
    parentTrackedEntityId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    )
  }),
  z.object({
    type: z.literal("maintenanceDispatchInventory"),
    maintenanceDispatchId: z.string(),
    itemId: z.string(),
    unitOfMeasureCode: z.string(),
    quantity: z.number()
  }),
  z.object({
    type: z.literal("maintenanceDispatchTrackedEntities"),
    maintenanceDispatchId: z.string(),
    itemId: z.string(),
    unitOfMeasureCode: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    ),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional()
  }),
  z.object({
    type: z.literal("maintenanceDispatchUnconsume"),
    maintenanceDispatchItemId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    )
  }),
  z.object({
    type: z.literal("maintenanceDispatchUnissue"),
    maintenanceDispatchItemId: z.string()
  })
]);

// The production-event and inspection links a completion/scrap payload carries
// are written verbatim into productionQuantity, whose single-column FKs accept
// any company's row — re-read them under companyId first (one query per table).
async function assertProductionQuantityLinks(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  links: {
    laborProductionEventId?: string;
    machineProductionEventId?: string;
    setupProductionEventId?: string;
    inspectionId?: string;
    inspectionSampleId?: string;
  }
) {
  await assertCompanyRecords(
    db,
    "productionEvent",
    [
      links.laborProductionEventId,
      links.machineProductionEventId,
      links.setupProductionEventId
    ],
    companyId,
    "Production event"
  );
  await assertCompanyRecords(
    db,
    "inspection",
    [links.inspectionId],
    companyId,
    "Inspection"
  );
  await assertCompanyRecords(
    db,
    "inspectionSample",
    [links.inspectionSampleId],
    companyId,
    "Inspection sample"
  );
}

// Shared accounting context for the job consumption paths: the posting-group
// defaults and the active dimension map. Every company posts these journals
// (Provisional before its accounting cutover), so both always load.
async function loadConsumeAccountingContext(
  db: Kysely<KyselyDatabase>,
  companyId: string
) {
  const companyRecord = await single(
    db,
    "company",
    { id: companyId },
    { columns: ["companyGroupId"] }
  );
  if (companyRecord.error) throw new Error("Failed to fetch company");

  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }

  const dimensions = await many(
    db,
    "dimension",
    {
      companyGroupId: companyRecord.data.companyGroupId!,
      active: true,
      entityType: ["ItemPostingGroup", "Item", "Location"]
    },
    { columns: ["id", "entityType"] }
  );

  const dimensionMap = new Map<string, string>();
  if (dimensions.data) {
    for (const dim of dimensions.data) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }
  }

  return { accountDefaults: accountDefaults.data, dimensionMap };
}

type ConsumeAccountDefaults = Awaited<
  ReturnType<typeof loadConsumeAccountingContext>
>["accountDefaults"];

// Spare parts issued to a maintenance dispatch are an expense the moment they
// leave stock. The caller writes the item ledger rows; this values them: each
// movement relieves (or, on a return, restores) the item's cost layers and
// posts Dr maintenanceAccount / Cr inventory through
// the shared adjustment core — one journal per call, tagged with the dispatch's
// work center. A return reverses at what the dispatch actually booked
// (`resolveMaintenanceReturnCost`), so a part issued before maintenance
// consumption carried value comes back with no value either.
async function valueMaintenanceMovements(
  trx: Transaction<KyselyDatabase>,
  args: {
    dispatch: {
      id: string;
      maintenanceDispatchId: string;
      workCenterId: string | null;
      locationId: string | null;
    };
    // SIGNED: < 0 issued to the dispatch, > 0 returned from it
    movements: Array<{ itemId: string; quantity: number }>;
    postingDate: string;
    companyId: string;
    userId: string;
  }
) {
  const { dispatch, postingDate, companyId, userId } = args;
  const movements = args.movements.filter((m) => Number(m.quantity) !== 0);
  if (movements.length === 0) return;

  const itemIds = [...new Set(movements.map((m) => m.itemId))];
  const hasReturns = movements.some((m) => Number(m.quantity) > 0);

  // Provisional before the company's accounting cutover, Posted after it.
  const postingStatus = await journalPostingStatus(trx, companyId);
  const [items, itemCosts, bookedRows] = await Promise.all([
    trx
      .selectFrom("item")
      .select(["id", "itemTrackingType", "replenishmentSystem"])
      .where("id", "in", itemIds)
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("itemCost")
      .select([
        "itemId",
        "costingMethod",
        "unitCost",
        "standardCost",
        "itemPostingGroupId"
      ])
      .where("itemId", "in", itemIds)
      .where("companyId", "=", companyId)
      .execute(),
    hasReturns
      ? trx
          .selectFrom("costLedger")
          .select(["itemId", "quantity", "cost"])
          .where("documentId", "=", dispatch.id)
          .where("documentType", "=", "Maintenance Consumption")
          .where("itemId", "in", itemIds)
          .where("companyId", "=", companyId)
          .execute()
      : Promise.resolve([])
  ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemCostById = new Map(itemCosts.map((cost) => [cost.itemId, cost]));
  const bookedByItem = new Map<
    string,
    Array<{ quantity: number; cost: number }>
  >();
  for (const row of bookedRows) {
    const list = bookedByItem.get(row.itemId as string) ?? [];
    list.push({ quantity: Number(row.quantity), cost: Number(row.cost) });
    bookedByItem.set(row.itemId as string, list);
  }

  const accountDefaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!accountDefaults) throw new Error("Error getting account defaults");

  const dimensions = await trx
    .selectFrom("dimension")
    .innerJoin("company", "company.companyGroupId", "dimension.companyGroupId")
    .select(["dimension.id", "dimension.entityType"])
    .where("company.id", "=", companyId)
    .where("dimension.active", "=", true)
    .where("dimension.entityType", "in", [
      "Item",
      "ItemPostingGroup",
      "Location",
      "WorkCenter"
    ])
    .execute();

  // A Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? (await resolveAccountingPeriod(trx, companyId, postingDate, "current"))
          .id
      : null;
  const description = `Maintenance Consumption ${dispatch.maintenanceDispatchId}`;
  let journalId: string | null = null;

  const accounting: Parameters<typeof valueMovement>[1]["accounting"] = {
    postingStatus,
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.finishedGoodsAccount,
      inventoryAdjustmentVarianceAccount:
        accountDefaults.inventoryAdjustmentVarianceAccount
    },
    offsetAccount: accountDefaults.maintenanceAccount,
    offsetDescription: "Maintenance Expense",
    description,
    userId,
    dimensions: Object.fromEntries(
      dimensions
        .filter((dim) => dim.entityType)
        .map((dim) => [dim.entityType as string, dim.id])
    ),
    extraDimensions: dispatch.workCenterId
      ? [{ entityType: "WorkCenter", valueId: dispatch.workCenterId }]
      : [],
    getJournalId: async () => {
      journalId ??= await createAdjustmentJournal(trx, {
        companyId,
        accountingPeriodId,
        status: postingStatus,
        description,
        postingDate,
        userId
      });
      return journalId;
    }
  };

  for (const movement of movements) {
    let quantity = Number(movement.quantity);
    let fixedUnitCost: number | undefined;

    if (quantity > 0) {
      const booked = bookedByItem.get(movement.itemId) ?? [];
      const reversal = resolveMaintenanceReturnCost(booked, quantity);
      if (!reversal) continue;
      quantity = reversal.quantity;
      fixedUnitCost = reversal.unitCost;
      // A later return of the same item in this call sees this one.
      booked.push({ quantity, cost: quantity * fixedUnitCost });
      bookedByItem.set(movement.itemId, booked);
    }

    const item = itemById.get(movement.itemId);
    const itemCost = itemCostById.get(movement.itemId);
    await valueMovement(trx, {
      movement: {
        postingDate,
        itemId: movement.itemId,
        quantity,
        locationId: dispatch.locationId,
        entryType: "Consumption",
        documentType: "Maintenance Consumption",
        documentId: dispatch.id,
        companyId
      },
      item: {
        itemTrackingType: item?.itemTrackingType ?? null,
        replenishmentSystem: item?.replenishmentSystem ?? null,
        itemPostingGroupId: itemCost?.itemPostingGroupId ?? null
      },
      itemCost: {
        costingMethod: itemCost?.costingMethod ?? "Average",
        unitCost: Number(itemCost?.unitCost ?? 0),
        standardCost: Number(itemCost?.standardCost ?? 0)
      },
      accounting,
      fixedUnitCost
    });
  }
}

// The per-operation tracked-consumption write sequence, extracted verbatim from
// the trackedEntitiesToOperation case so trackedEntitiesToBatch can run it once
// per member inside ONE transaction. Reads run against `trx`, so sequential
// member calls drawing from the same lot see each other's decrements.
async function consumeTrackedEntitiesIntoOperation(
  trx: Transaction<KyselyDatabase>,
  {
    materialId,
    jobOperationId,
    itemId,
    parentTrackedEntityId,
    children,
    jobOperationStepId,
    unitNumber,
    overrideExpired,
    overrideReason,
    companyId,
    userId,
    companyToday,
    db,
    postingStatus,
    accountDefaults: accountDefaultsTracked,
    dimensionMap: dimensionMapTracked
  }: {
    materialId?: string;
    jobOperationId?: string;
    itemId?: string;
    parentTrackedEntityId: string;
    children: { trackedEntityId: string; quantity: number }[];
    jobOperationStepId?: string;
    unitNumber?: number;
    overrideExpired?: boolean;
    overrideReason?: string | null;
    companyId: string;
    userId: string;
    companyToday: CalendarDate;
    db: Kysely<KyselyDatabase>;
    // Provisional before the company's accounting cutover, Posted after it.
    postingStatus: AutomaticJournalStatus;
    accountDefaults: ConsumeAccountDefaults;
    dimensionMap: Map<string, string>;
  }
): Promise<{
  splitEntities: Array<{
    originalId: string;
    newId: string;
    readableId: string;
    quantity: number;
    remainingQuantity: number;
  }>;
  warning: string | undefined;
}> {
  let expiredWarning: string | undefined;

  const trackedEntities = await trx
    .selectFrom("trackedEntity")
    .where(
      "id",
      "in",
      children.map((child) => child.trackedEntityId)
    )
    .where("companyId", "=", companyId)
    .selectAll()
    .execute();

  const itemLedgers = await trx
    .selectFrom("itemLedger")
    .where("trackedEntityId", "in", [
      ...children.map((child) => child.trackedEntityId)
    ])
    .orderBy("createdBy", "desc")
    .selectAll()
    .execute();

  if (trackedEntities.length !== children.length) {
    throw new NotFoundError("Tracked entities not found");
  }

  if (trackedEntities.some((entity) => entity.status !== "Available")) {
    throw new Error("Tracked entities are not available");
  }

  // Expiry policy gate. Reads companySettings.inventoryShelfLife.
  const expiredPolicy = await getExpiredEntityPolicy(trx, companyId);
  const expiredCheck = checkExpiredEntities(
    trackedEntities.map((e) => ({
      id: e.id,
      expirationDate: e.expirationDate
    })),
    expiredPolicy,
    { allowed: !!overrideExpired, reason: overrideReason ?? null },
    companyToday
  );
  if (!expiredCheck.ok) {
    throw new Error(expiredCheck.reason);
  }
  if (expiredCheck.warning) {
    expiredWarning = expiredCheck.warning;
  }

  let jobMaterial: Selectable<KyselyDatabase["jobMaterial"]> | undefined;
  let actualMaterialId: string | undefined = materialId;
  const firstTrackedEntity = trackedEntities[0];

  if (materialId) {
    // Existing behavior: fetch the jobMaterial
    jobMaterial = await trx
      .selectFrom("jobMaterial")
      .where("id", "=", materialId)
      .where("companyId", "=", companyId)
      .selectAll()
      .executeTakeFirst();

    // Check if any tracked entity has a different sourceDocumentId than the material's itemId
    if (
      firstTrackedEntity &&
      jobMaterial &&
      firstTrackedEntity.sourceDocumentId !== jobMaterial.itemId
    ) {
      // Create a new jobMaterial for the tracked entity's item
      const totalChildQuantity = roundedChildTotal(children);

      const itemCost = await trx
        .selectFrom("itemCost")
        .where("itemId", "=", firstTrackedEntity.sourceDocumentId!)
        .select("unitCost")
        .executeTakeFirst();

      const newJobMaterial = await trx
        .insertInto("jobMaterial")
        .values({
          companyId,
          createdBy: userId,
          description: firstTrackedEntity.sourceDocumentReadableId ?? "",
          estimatedQuantity: 0,
          itemId: firstTrackedEntity.sourceDocumentId!,
          jobId: jobMaterial.jobId!,
          jobMakeMethodId: jobMaterial.jobMakeMethodId,
          jobOperationId: jobMaterial.jobOperationId,
          itemType: jobMaterial.itemType,
          methodType: jobMaterial.methodType,
          quantity: 0,
          quantityIssued: totalChildQuantity,
          requiresBatchTracking: jobMaterial.requiresBatchTracking,
          requiresSerialTracking: jobMaterial.requiresSerialTracking,
          unitCost: itemCost?.unitCost ?? 0
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      actualMaterialId = newJobMaterial.id!;

      // Fetch the newly created jobMaterial
      jobMaterial = await trx
        .selectFrom("jobMaterial")
        .where("id", "=", actualMaterialId)
        .selectAll()
        .executeTakeFirstOrThrow();
    }
  } else if (jobOperationId && itemId) {
    // New behavior: create a jobMaterial on the fly
    const jobOperation = await trx
      .selectFrom("jobOperation")
      .where("id", "=", jobOperationId)
      .where("companyId", "=", companyId)
      .select(["jobId", "jobMakeMethodId"])
      .executeTakeFirst();

    if (!jobOperation) {
      throw new NotFoundError("Job operation not found");
    }

    const item = await trx
      .selectFrom("item")
      .where("id", "=", itemId)
      .where("companyId", "=", companyId)
      .select(["name", "type", "itemTrackingType", "defaultMethodType"])
      .executeTakeFirst();

    if (!item) {
      throw new NotFoundError("Item not found");
    }

    const totalChildQuantity = roundedChildTotal(children);

    const itemCost = await trx
      .selectFrom("itemCost")
      .where("itemId", "=", itemId)
      .select("unitCost")
      .executeTakeFirst();

    const newJobMaterial = await trx
      .insertInto("jobMaterial")
      .values({
        companyId,
        createdBy: userId,
        description: item.name ?? "",
        estimatedQuantity: 0,
        itemId: itemId,
        jobId: jobOperation.jobId!,
        jobMakeMethodId: jobOperation.jobMakeMethodId!,
        jobOperationId: jobOperationId,
        itemType: item.type ?? "Part",
        methodType: item.defaultMethodType ?? "Pull from Inventory",
        quantity: 0,
        quantityIssued: totalChildQuantity,
        requiresBatchTracking: item.itemTrackingType === "Batch",
        requiresSerialTracking: item.itemTrackingType === "Serial",
        unitCost: itemCost?.unitCost ?? 0
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    actualMaterialId = newJobMaterial.id!;

    // Scope this unplanned tracked part to the step it was issued on
    // (assembly view), so it shows on that step rather than as General.
    if (jobOperationStepId) {
      await trx
        .insertInto("jobMaterialStep")
        .values({
          jobMaterialId: actualMaterialId,
          jobOperationStepId
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    // Fetch the newly created jobMaterial
    jobMaterial = await trx
      .selectFrom("jobMaterial")
      .where("id", "=", actualMaterialId)
      .selectAll()
      .executeTakeFirstOrThrow();
  }

  if (!jobMaterial) {
    throw new NotFoundError("Job material not found");
  }

  // Get item details
  const item = await trx
    .selectFrom("item")
    .where("id", "=", jobMaterial?.itemId!)
    .select(["readableIdWithRevision"])
    .executeTakeFirst();

  // Get job location
  const job = await trx
    .selectFrom("job")
    .select(["id", "locationId"])
    .where("id", "=", jobMaterial?.jobId!)
    .executeTakeFirst();

  // Get parent tracked entity details
  const parentTrackedEntity = await trx
    .selectFrom("trackedEntity")
    .where("id", "=", parentTrackedEntityId)
    .where("companyId", "=", companyId)
    .select(["id", "sourceDocumentId", "quantity", "attributes", "status"])
    .executeTakeFirst();

  if (!parentTrackedEntity) {
    throw new NotFoundError("Parent tracked entity not found");
  }

  // Create tracked activity
  const activityId = nanoid();
  await trx
    .insertInto("trackedActivity")
    .values({
      id: activityId,
      type: "Consume",
      sourceDocument: "Job Material",
      sourceDocumentId: actualMaterialId,
      sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
      attributes: {
        Job: job?.id!,
        "Job Make Method": jobMaterial?.jobMakeMethodId!,
        "Job Material": jobMaterial?.id!,
        Employee: userId,
        // Assembly view: which step + 1-based unit this consume was for, so
        // the MES can attribute issued quantities per-unit even for a batch
        // parent (where all units share one lot entity).
        ...(jobOperationStepId
          ? { "Job Operation Step": jobOperationStepId }
          : {}),
        ...(unitNumber !== undefined ? { Unit: unitNumber } : {})
      },
      companyId,
      createdBy: userId
    })
    .execute();

  await trx
    .insertInto("trackedActivityOutput")
    .values({
      trackedActivityId: activityId,
      trackedEntityId: parentTrackedEntityId,
      quantity: parentTrackedEntity.quantity,
      companyId,
      createdBy: userId
    })
    .execute();

  const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
    [];
  const trackedActivityInputs: Database["public"]["Tables"]["trackedActivityInput"]["Insert"][] =
    [];

  const splitEntities: Array<{
    originalId: string;
    newId: string;
    readableId: string;
    quantity: number;
    remainingQuantity: number;
  }> = [];

  // Process each child tracked entity
  for (const child of children) {
    const trackedEntity = trackedEntities.find(
      (entity) => entity.id === child.trackedEntityId
    );
    if (!trackedEntity) {
      throw new NotFoundError("Tracked entity not found");
    }
    const { trackedEntityId } = child;

    // ONE canonical quantity for this child, rounded at the persist
    // boundary. On a FULL draw it is the lot's own on-hand: the entity
    // is flipped Consumed without its quantity being rewritten, so
    // booking the requested figure instead would leave the Consumption
    // ledger row disagreeing with the lot it just emptied.
    const entityQuantity = round(Number(trackedEntity.quantity));
    const fullDraw = isFullDraw(entityQuantity, child.quantity);
    const quantity = fullDraw ? entityQuantity : round(child.quantity);

    // Partial consume → split: the lineside entity keeps its id and
    // is decremented; a NEW child entity carries the consumed
    // quantity. EVERYTHING below (Consumed status, Consume input,
    // Consumption ledger) books against the child — flipping the
    // entity half without the ledger half would double-count on-hand.
    let consumedEntityId = trackedEntityId;
    if (!fullDraw) {
      const consumedChildId = nanoid();
      consumedEntityId = consumedChildId;

      const split = buildBatchSplitRecords({
        parent: {
          id: trackedEntity.id!,
          readableId: trackedEntity.readableId,
          quantity: entityQuantity,
          sourceDocument: trackedEntity.sourceDocument,
          sourceDocumentId: trackedEntity.sourceDocumentId,
          sourceDocumentReadableId: trackedEntity.sourceDocumentReadableId,
          itemId: trackedEntity.itemId ?? trackedEntity.sourceDocumentId,
          expirationDate: trackedEntity.expirationDate ?? null,
          attributes: trackedEntity.attributes as Record<string, unknown> | null
        },
        drawQuantity: quantity,
        childId: consumedChildId,
        splitActivityId: nanoid(),
        activitySourceDocument: "Job Material",
        activitySourceDocumentId: actualMaterialId!,
        bin: {
          storageUnitId: resolveTrackedEntityBin(itemLedgers, trackedEntityId),
          locationId: job?.locationId ?? null
        },
        itemLedgerItemId: trackedEntity.sourceDocumentId,
        companyId,
        userId,
        postingDate: companyToday.toString(),
        // Created Available; the shared status update below flips the
        // child to Consumed in the same transaction.
        childStatus: "Available",
        extraChildAttributes: {
          ...(jobOperationStepId
            ? { "Job Operation Step": jobOperationStepId }
            : {}),
          ...(unitNumber !== undefined ? { Unit: unitNumber } : {})
        }
      });

      // Track split entity for the MES confirmation: quantity = what
      // was consumed (the child), remainingQuantity = what the
      // surviving lineside entity still holds.
      splitEntities.push({
        originalId: trackedEntityId,
        newId: consumedChildId,
        readableId: trackedEntity.sourceDocumentReadableId ?? "",
        quantity,
        remainingQuantity: split.parentUpdate.quantity
      });

      await trx
        .insertInto("trackedActivity")
        .values(
          split.activityInsert as Insertable<KyselyDatabase["trackedActivity"]>
        )
        .execute();

      await trx
        .insertInto("trackedEntity")
        .values(
          split.childEntityInsert as Insertable<KyselyDatabase["trackedEntity"]>
        )
        .execute();

      await trx
        .insertInto("trackedActivityInput")
        .values(split.activityInputInsert)
        .execute();

      await trx
        .insertInto("trackedActivityOutput")
        .values(split.activityOutputInsert)
        .execute();

      await trx
        .updateTable("trackedEntity")
        .set(split.parentUpdate)
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();

      // MTO skips ONLY the ledger inserts; entity/activity writes
      // above still happen.
      if (jobMaterial?.methodType !== "Make to Order") {
        itemLedgerInserts.push(...(split.ledgerInserts as ItemLedgerInsert[]));
      }
    }

    // Consume the drawn entity — the split child, or the whole
    // entity on a full draw.
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Consumed"
      })
      .where("id", "=", consumedEntityId)
      .where("companyId", "=", companyId)
      .execute();

    trackedActivityInputs.push({
      trackedActivityId: activityId,
      trackedEntityId: consumedEntityId,
      quantity,
      companyId,
      createdBy: userId
    });

    if (jobMaterial?.methodType !== "Make to Order") {
      itemLedgerInserts.push({
        entryType: "Consumption",
        documentType: "Job Consumption",
        documentId: job?.id!,
        companyId,
        itemId: trackedEntity.sourceDocumentId,
        quantity: -quantity,
        locationId: job?.locationId,
        // The split child has no rows in the pre-transaction ledger
        // snapshot — it sits at the parent's resolved bin.
        storageUnitId: resolveTrackedEntityBin(itemLedgers, trackedEntityId),
        trackedEntityId: consumedEntityId,
        createdBy: userId
      });
    }
  }

  if (trackedActivityInputs.length > 0) {
    await trx
      .insertInto("trackedActivityInput")
      .values(trackedActivityInputs)
      .execute();
  }

  if (itemLedgerInserts.length > 0) {
    await trx.insertInto("itemLedger").values(itemLedgerInserts).execute();

    // Update pickMethod defaultStorageUnitId if needed for each inserted ledger
    for (const ledger of itemLedgerInserts) {
      await updatePickMethodDefaultStorageUnitIfNeeded(
        trx,
        ledger.itemId,
        ledger.locationId,
        ledger.storageUnitId,
        companyId,
        userId
      );
    }
  }

  if (itemLedgerInserts.length > 0) {
    const consumptionEntries = itemLedgerInserts
      .filter((l) => l.entryType === "Consumption")
      .map((l) => ({
        itemId: l.itemId as string,
        quantity: Number(l.quantity),
        trackedEntityId: l.trackedEntityId
      }));

    if (consumptionEntries.length > 0) {
      await createMaterialWipEntries(trx, {
        consumptionLedgers: consumptionEntries,
        jobId: job?.id!,
        operationId: jobMaterial?.jobOperationId ?? actualMaterialId!,
        description: "Tracked Entity Material Issue",
        wipAccount: accountDefaultsTracked.workInProgressAccount,
        rawMaterialsAccount: accountDefaultsTracked.rawMaterialsAccount,
        finishedGoodsAccount: accountDefaultsTracked.finishedGoodsAccount,
        dimensionMap: dimensionMapTracked,

        jobLocationId: job?.locationId ?? null,
        db,
        companyId,
        userId,
        postingStatus
      });
    }
  }

  const totalChildQuantity = roundedChildTotal(children);

  // Only update if we didn't create a new jobMaterial (in which case it's already set)
  if (actualMaterialId === materialId) {
    const currentQuantityIssued = round(
      Number(jobMaterial?.quantityIssued) || 0
    );
    const newQuantityIssued = round(currentQuantityIssued + totalChildQuantity);

    await trx
      .updateTable("jobMaterial")
      .set({
        quantityIssued: newQuantityIssued
      })
      .where("id", "=", actualMaterialId!)
      .where("companyId", "=", companyId)
      .execute();

    logger.info("Job material quantity updated", {
      materialId: actualMaterialId,
      newQuantityIssued
    });
  }

  return { splitEntities, warning: expiredWarning };
}

// The Produce half of a batch-tracked operation completion — the activity +
// entity flip EXTRACTED from jobOperationBatchComplete, so the batch-operations
// Phase 2 (jobOperationBatchOutput) can finalize a member's output WITHOUT that
// case's productionQuantity insert (batch Phase 1 already recorded it) and
// WITHOUT its backflush (the batch's own issue step already ran).
async function produceBatchOutput(
  trx: Transaction<KyselyDatabase>,
  {
    jobOperationId,
    trackedEntityId,
    producedQuantity,
    totalQuantity,
    companyId,
    userId
  }: {
    jobOperationId: string;
    trackedEntityId: string;
    producedQuantity: number;
    totalQuantity: number;
    companyId: string;
    userId: string;
  }
) {
  const trackedEntity = await trx
    .selectFrom("trackedEntity")
    .where("id", "=", trackedEntityId)
    .where("companyId", "=", companyId)
    .selectAll()
    .executeTakeFirst();

  if (!trackedEntity) {
    throw new NotFoundError("Tracked entity not found");
  }

  if (trackedEntity.status !== "Consumed") {
    const activityId = nanoid();
    await trx
      .insertInto("trackedActivity")
      .values({
        id: activityId,
        type: "Produce",
        sourceDocument: "Job Operation",
        sourceDocumentId: jobOperationId,
        attributes: {
          "Job Operation": jobOperationId,
          Employee: userId,
          Quantity: producedQuantity
        },
        companyId,
        createdBy: userId
      })
      .execute();

    await trx
      .insertInto("trackedActivityOutput")
      .values({
        trackedActivityId: activityId,
        trackedEntityId: trackedEntityId,
        quantity: producedQuantity,
        companyId,
        createdBy: userId
      })
      .execute();

    // Update the current trackedEntity to Complete
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Available",
        quantity: totalQuantity
      })
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

/**
 * Issues material and records production against jobs, operations, tracked
 * entities and maintenance dispatches, per `type`.
 */
const issue = defineServerFn({
  name: "issue",
  input: issueInput,
  // Kysely bypasses RLS, so the caller must hold the type's permission in the
  // company it names. `jobCompleteMakeToOrder` has no handler (it returns the
  // fallthrough result) and never had a permission check.
  permissions: {
    by: "type",
    rules: {
      convertEntity: { update: "inventory" },
      jobCompleteMakeToOrder: {},
      jobOperation: { update: "production" },
      jobOperationBatchComplete: { update: "production" },
      jobOperationBatchOutput: { update: "production" },
      jobOperationSerialComplete: { update: "production" },
      jobOperationScrap: { update: "production" },
      partToOperation: { update: "production" },
      scrapTrackedEntity: { update: "production" },
      mergeTrackedEntities: { update: "inventory" },
      trackedEntitiesToBatch: { update: "production" },
      trackedEntitiesToOperation: { update: "production" },
      unconsumeTrackedEntities: { update: "production" },
      maintenanceDispatchInventory: { update: "resources" },
      maintenanceDispatchTrackedEntities: { update: "resources" },
      maintenanceDispatchUnconsume: { update: "resources" },
      maintenanceDispatchUnissue: { update: "resources" }
    }
  },
  defaultStatus: 400,
  async run(ctx, input): Promise<IssueResult> {
    const { db } = ctx;
    const validatedPayload = {
      ...input,
      companyId: ctx.companyId,
      userId: ctx.userId
    };

    logger.info(validatedPayload);

    const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
      [];

    switch (validatedPayload.type) {
      case "jobOperation": {
        const { id, companyId, quantity, userId } = validatedPayload;

        const { accountDefaults, dimensionMap } =
          await loadConsumeAccountingContext(db, companyId);

        await db.transaction().execute(async (trx) => {
          // Provisional before the company's accounting cutover, Posted after it.
          const postingStatus = await journalPostingStatus(trx, companyId);
          await issueJobOperationMaterials(trx, {
            jobOperationId: id,
            quantity,
            companyId,
            userId,
            postingStatus,
            accountDefaults,
            dimensionMap,
            db
          });
        });

        break;
      }
      case "jobOperationBatchComplete": {
        const { trackedEntityId, companyId, userId, ...row } = validatedPayload;
        await assertProductionQuantityLinks(db, companyId, row);

        const [jobOperation, productionQuantities] = await inOrder([
          () =>
            single(db, "jobOperation", { id: row.jobOperationId, companyId }),
          () =>
            many(db, "productionQuantity", {
              jobOperationId: row.jobOperationId,
              companyId,
              type: "Production"
            })
        ]);

        if (!jobOperation.data || !jobOperation.data.jobMakeMethodId) {
          throw new NotFoundError("Job operation not found");
        }

        const accountingBatch = await loadConsumeAccountingContext(
          db,
          companyId
        );

        await db.transaction().execute(async (trx) => {
          // Provisional before the company's accounting cutover, Posted after it.
          const postingStatus = await journalPostingStatus(trx, companyId);
          await trx
            .insertInto("productionQuantity")
            .values({
              ...row,
              type: "Production",
              companyId,
              createdBy: userId
            })
            .executeTakeFirst();

          const previousProductionQuantities =
            productionQuantities?.data?.reduce((acc, curr) => {
              const quantity = Number(curr.quantity);
              return acc + quantity;
            }, 0) ?? 0;

          await produceBatchOutput(trx, {
            jobOperationId: row.jobOperationId,
            trackedEntityId,
            producedQuantity: row.quantity,
            totalQuantity: previousProductionQuantities + row.quantity,
            companyId,
            userId
          });

          await issueJobOperationMaterials(trx, {
            jobOperationId: row.jobOperationId,
            quantity: row.quantity,
            companyId,
            userId,
            postingStatus,
            accountDefaults: accountingBatch.accountDefaults,
            dimensionMap: accountingBatch.dimensionMap,
            db
          });
        });

        return {
          success: true
        };
      }
      case "jobOperationBatchOutput": {
        const {
          jobOperationId,
          trackedEntityId,
          quantity,
          readableId,
          companyId,
          userId
        } = validatedPayload;

        const [entity, productionQuantities] = await inOrder([
          () =>
            single(
              db,
              "trackedEntity",
              { id: trackedEntityId, companyId },
              { columns: ["id", "status", "readableId"] }
            ),
          () =>
            many(
              db,
              "productionQuantity",
              { jobOperationId, companyId, type: "Production" },
              { columns: ["quantity"] }
            )
        ]);
        if (entity.error || !entity.data) {
          throw new NotFoundError("Tracked entity not found");
        }

        // Resume no-op: a prior attempt already produced this member's output.
        if (entity.data.status === "Available") {
          return { success: true, created: false };
        }

        // An Available lot must carry a number. Batch creation plans it (the
        // entity's readableId, or the merged lot passed as readableId); this is
        // the backstop for direct calls and for batches planned before that.
        if (!readableId && !entity.data.readableId) {
          throw new Error(
            `Operation ${jobOperationId} produces a batch-tracked item — its batch number is required`
          );
        }

        const totalQuantity =
          productionQuantities.data?.reduce(
            (acc: number, curr: { quantity: number | string | null }) =>
              acc + Number(curr.quantity),
            0
          ) ?? 0;
        if (totalQuantity <= 0) {
          throw new Error(
            "No recorded production quantity for this operation — complete the batch first"
          );
        }

        await db.transaction().execute(async (trx) => {
          if (readableId) {
            await trx
              .updateTable("trackedEntity")
              .set({ readableId })
              .where("id", "=", trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();
          }
          await produceBatchOutput(trx, {
            jobOperationId,
            trackedEntityId,
            producedQuantity: quantity,
            totalQuantity,
            companyId,
            userId
          });
        });

        return { success: true, created: true };
      }
      case "jobOperationSerialComplete": {
        const { trackedEntityId, companyId, userId, ...row } = validatedPayload;
        await assertProductionQuantityLinks(db, companyId, row);

        const jobOperation = await single(db, "jobOperation", {
          id: row.jobOperationId,
          companyId
        });
        if (!jobOperation.data || !jobOperation.data.jobMakeMethodId) {
          throw new NotFoundError("Job operation not found");
        }

        // UNIT-AXIS order, identical to the apps' getTrackedEntitiesByMakeMethodId:
        // position here is the `index` step records are stored under, so the
        // tiebreakers are not optional — `createdAt` ties for bulk-minted serials
        // and Postgres breaks a tie by physical row order, which any UPDATE moves.
        const trackedEntities = await many(
          db,
          "trackedEntity",
          {
            attributes: contains({
              "Job Make Method": jobOperation.data.jobMakeMethodId
            }),
            companyId
          },
          { orderBy: ["createdAt", "readableId", "id"] }
        );

        if (!trackedEntities.data || trackedEntities.data.length === 0) {
          throw new NotFoundError("Tracked entities not found");
        }

        // The unit this completion is for, as the 0-based axis index its step
        // records are keyed by. Derived HERE rather than taken from the caller:
        // three routes post this payload and none of them should be trusted, or
        // required, to know the axis.
        const completedUnitIndex = trackedEntities.data.findIndex(
          (entity: { id: string }) => entity.id === trackedEntityId
        );

        const relatedTrackedEntities = trackedEntities.data.filter(
          (trackedEntity) =>
            `Operation ${row.jobOperationId}` in
            (trackedEntity.attributes as TrackedEntityAttributes)
        );

        const {
          accountDefaults: accountDefaultsSerial,
          dimensionMap: dimensionMapSerial
        } = await loadConsumeAccountingContext(db, companyId);

        let newEntityId: string | undefined;
        await db.transaction().execute(async (trx) => {
          // Provisional before the company's accounting cutover, Posted after it.
          const postingStatus = await journalPostingStatus(trx, companyId);
          await trx
            .insertInto("productionQuantity")
            .values({
              ...row,
              type: "Production",
              companyId,
              createdBy: userId
            })
            .executeTakeFirst();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirst();

          if (!trackedEntity) {
            throw new NotFoundError("Tracked entity not found");
          }

          if (trackedEntity.status !== "Consumed") {
            const activityId = nanoid();
            await trx
              .insertInto("trackedActivity")
              .values({
                id: activityId,
                type: "Complete",
                sourceDocument: "Job Operation",
                sourceDocumentId: row.jobOperationId,
                // `Job` is what the traceability sidebar loads step records by,
                // and `Unit` is what scopes them to THIS serial. Without `Job`
                // the sidebar showed none; without `Unit` it would show every
                // unit's values under one serial. Same two keys the production
                // event activity already writes (MES startProductionEvent).
                attributes: {
                  Job: jobOperation.data.jobId,
                  "Job Operation": row.jobOperationId,
                  Employee: userId,
                  ...(completedUnitIndex >= 0
                    ? { Unit: completedUnitIndex }
                    : {})
                },
                companyId,
                createdBy: userId
              })
              .execute();

            await trx
              .insertInto("trackedActivityOutput")
              .values({
                trackedActivityId: activityId,
                trackedEntityId: trackedEntityId,
                quantity: 1,
                companyId,
                createdBy: userId
              })
              .execute();
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
                quantity: 1,
                attributes: {
                  ...(trackedEntity.attributes as TrackedEntityAttributes),
                  [`Operation ${row.jobOperationId}`]:
                    relatedTrackedEntities.length + 1
                }
              })
              .where("id", "=", trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();
          }

          if (
            trackedEntities.data.length <
            (jobOperation.data.operationQuantity ?? 0)
          ) {
            // Number this lazily-spawned unit from the item's serial sequence, if
            // one is configured. This unit wasn't part of the initial pre-split at
            // job creation (e.g. the job quantity was increased afterwards, or the
            // sequence was configured later), so it would otherwise be created with
            // a null readableId. Resolve the job's location for the %{location}
            // token; the reservation runs in this transaction, atomic with the spawn.
            let spawnReadableId: string | null = null;
            if (trackedEntity.itemId) {
              let locationCode: string | null = null;
              let locationName: string | null = null;
              const jobIdForLocation = (
                trackedEntity.attributes as Record<string, unknown>
              ).Job;
              if (typeof jobIdForLocation === "string") {
                const jobRow = await single(
                  trx,
                  "job",
                  { id: jobIdForLocation, companyId },
                  { columns: ["locationId"] }
                );
                if (jobRow.data?.locationId) {
                  const loc = await single(
                    trx,
                    "location",
                    { id: jobRow.data.locationId, companyId },
                    { columns: ["code", "name"] }
                  );
                  locationCode = loc.data?.code ?? null;
                  locationName = loc.data?.name ?? null;
                }
              }
              const spawnSerials = await getNextSerialNumbers(trx, {
                itemId: trackedEntity.itemId,
                companyId,
                count: 1,
                locationCode,
                locationName
              });
              spawnReadableId = spawnSerials[0] ?? null;
            }

            // Create a new trackedEntity with the same attributes but status = Reserved
            const newTrackedEntityResult = await trx
              .insertInto("trackedEntity")
              .values({
                sourceDocument: trackedEntity.sourceDocument,
                sourceDocumentId: trackedEntity.sourceDocumentId,
                sourceDocumentReadableId:
                  trackedEntity.sourceDocumentReadableId,
                quantity: 1,
                status: "Reserved",
                attributes: trackedEntity.attributes,
                itemId: trackedEntity.itemId ?? null,
                expirationDate: trackedEntity.expirationDate ?? null,
                readableId: spawnReadableId,
                companyId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirst();

            newEntityId = newTrackedEntityResult?.id;
          }

          await issueJobOperationMaterials(trx, {
            jobOperationId: row.jobOperationId,
            quantity: row.quantity,
            companyId,
            userId,
            postingStatus,
            accountDefaults: accountDefaultsSerial,
            dimensionMap: dimensionMapSerial,
            db
          });
        });

        return {
          success: true,
          newTrackedEntityId: newEntityId
        };
      }
      case "jobOperationScrap": {
        const {
          jobOperationId,
          quantity,
          scrapReasonId,
          trackedEntityId: scrapEntityId,
          notes,
          laborProductionEventId,
          machineProductionEventId,
          setupProductionEventId,
          companyId,
          userId
        } = validatedPayload;
        // Lands on productionQuantity, the Scrap activity and the journal's
        // ScrapReason dimension — all this company's rows.
        await assertCompanyRecords(
          db,
          "scrapReason",
          [scrapReasonId],
          companyId,
          "Scrap reason"
        );
        await assertProductionQuantityLinks(db, companyId, {
          laborProductionEventId,
          machineProductionEventId,
          setupProductionEventId
        });

        const operationRes = await single(db, "jobOperation", {
          id: jobOperationId,
          companyId
        });
        const operation = operationRes.data;
        if (!operation || !operation.jobMakeMethodId) {
          throw new NotFoundError("Job operation not found");
        }

        const [
          makeMethodRes,
          jobRes,
          trackedEntitiesRes,
          companyRecordScrapOp
        ] = await inOrder([
          () =>
            single(
              db,
              "jobMakeMethod",
              { id: operation.jobMakeMethodId, companyId },
              {
                columns: [
                  "id",
                  "itemId",
                  "requiresSerialTracking",
                  "requiresBatchTracking",
                  "parentMaterialId"
                ]
              }
            ),
          () =>
            single(
              db,
              "job",
              { id: operation.jobId, companyId },
              { columns: ["id", "jobId", "locationId"] }
            ),
          () =>
            many(
              db,
              "trackedEntity",
              {
                attributes: contains({
                  "Job Make Method": operation.jobMakeMethodId
                }),
                companyId
              },
              { columns: ["id"] }
            ),
          () =>
            single(
              db,
              "company",
              { id: companyId },
              { columns: ["companyGroupId"] }
            )
        ]);
        if (makeMethodRes.error || !makeMethodRes.data) {
          throw new NotFoundError("Job make method not found");
        }
        if (jobRes.error || !jobRes.data)
          throw new NotFoundError("Job not found");
        if (companyRecordScrapOp.error) {
          throw new Error("Failed to fetch company");
        }
        const makeMethod = makeMethodRes.data;
        const job = jobRes.data;
        const existingEntityCount = trackedEntitiesRes.data?.length ?? 0;

        const accountDefaultsScrapOp = await getDefaultPostingGroup(
          db,
          companyId
        );
        if (accountDefaultsScrapOp.error || !accountDefaultsScrapOp.data) {
          throw new Error("Error getting account defaults");
        }

        const dimensionsScrapOp = await many(
          db,
          "dimension",
          {
            companyGroupId: companyRecordScrapOp.data.companyGroupId!,
            active: true,
            entityType: [
              "ItemPostingGroup",
              "Item",
              "Location",
              "ScrapReason",
              "WorkCenter",
              "Employee"
            ]
          },
          { columns: ["id", "entityType"] }
        );
        const dimensionMapScrapOp = new Map<string, string>();
        if (dimensionsScrapOp.data) {
          for (const dim of dimensionsScrapOp.data) {
            if (dim.entityType) dimensionMapScrapOp.set(dim.entityType, dim.id);
          }
        }

        const isSerial = makeMethod.requiresSerialTracking === true;
        if (isSerial && !scrapEntityId) {
          throw new Error("trackedEntityId is required to scrap a serial unit");
        }
        if (isSerial && quantity !== 1) {
          throw new Error("Serial units are scrapped one at a time");
        }

        const todayScrapOp = datetime
          .today(await getCompanyTimeZone(db, companyId))
          .toString();

        let newEntityId: string | undefined;
        await db.transaction().execute(async (trx) => {
          // Provisional before the company's accounting cutover, Posted after it.
          const postingStatus = await journalPostingStatus(trx, companyId);

          // 1. Scrap quantity record. The quantity-sync interceptor aggregates
          //    quantityScrapped; scrap no longer counts toward the auto-Done
          //    target (20260807090629), so the operation stays open until the
          //    good quantity is actually made.
          await trx
            .insertInto("productionQuantity")
            .values({
              jobOperationId,
              quantity,
              type: "Scrap",
              scrapReasonId,
              notes,
              laborProductionEventId,
              machineProductionEventId,
              setupProductionEventId,
              companyId,
              createdBy: userId
            })
            .executeTakeFirst();

          // 2. Backflush the scrapped units\' BOM for this operation — material
          //    cost enters WIP exactly as a completion would (NetSuite "Issue
          //    for Scrap"); the WIP→scrap journal below relieves it.
          const backflush = await issueJobOperationMaterials(trx, {
            jobOperationId,
            quantity,
            companyId,
            userId,
            postingStatus,
            accountDefaults: accountDefaultsScrapOp.data,
            dimensionMap: dimensionMapScrapOp,
            db
          });

          // 3. Serial: terminal status + Scrap genealogy on the selected unit.
          //    The entity keeps its consumed-material input tree.
          let scrappedEntityAttributes: TrackedEntityAttributes | null = null;
          if (isSerial && scrapEntityId) {
            const entity = await trx
              .selectFrom("trackedEntity")
              .selectAll()
              .where("id", "=", scrapEntityId)
              .where("companyId", "=", companyId)
              .executeTakeFirst();
            if (!entity) throw new NotFoundError("Tracked entity not found");
            if (entity.status === "Consumed" || entity.status === "Scrapped") {
              throw new Error("Tracked entity is not in progress");
            }
            scrappedEntityAttributes =
              entity.attributes as TrackedEntityAttributes;

            const scrapActivityId = nanoid();
            await trx
              .insertInto("trackedActivity")
              .values({
                id: scrapActivityId,
                type: "Scrap",
                sourceDocument: "Job Operation",
                sourceDocumentId: jobOperationId,
                attributes: {
                  "Job Operation": jobOperationId,
                  "Scrap Reason": scrapReasonId,
                  Employee: userId,
                  ...(notes?.trim() ? { Notes: notes.trim() } : {})
                },
                companyId,
                createdBy: userId
              })
              .execute();
            await trx
              .insertInto("trackedActivityInput")
              .values({
                trackedActivityId: scrapActivityId,
                trackedEntityId: scrapEntityId,
                quantity: 1,
                companyId,
                createdBy: userId
              })
              .execute();
            // No `Operation ...` completion stamp — the unit did NOT complete
            // this operation; status is the terminal marker.
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Scrapped",
                attributes: {
                  ...(entity.attributes as TrackedEntityAttributes),
                  "Scrap Reason": scrapReasonId
                }
              })
              .where("id", "=", scrapEntityId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // 4. Reopen Done ops + capacity top-up beyond the planned allowance
          //    so replacement units can run the FULL routing.
          await applyScrapReplacement(trx, {
            jobMakeMethodId: operation.jobMakeMethodId!,
            jobId: job.id,
            companyId,
            userId
          });

          // 5. Serial: spawn the replacement Reserved unit. Same convention as
          //    jobOperationSerialComplete — spawn while total entities <
          //    operationQuantity; the top-up above grew operationQuantity by
          //    the beyond-allowance scrap, and pre-created allowance units
          //    (job.scrapQuantity at release) already cover in-allowance scrap.
          if (isSerial && scrapEntityId && scrappedEntityAttributes) {
            const updatedOperation = await trx
              .selectFrom("jobOperation")
              .select(["operationQuantity"])
              .where("id", "=", jobOperationId)
              .executeTakeFirst();
            const capacity = Number(updatedOperation?.operationQuantity ?? 0);
            if (existingEntityCount < capacity) {
              let spawnReadableId: string | null = null;
              if (makeMethod.itemId) {
                let locationCode: string | null = null;
                let locationName: string | null = null;
                if (job.locationId) {
                  const loc = await single(
                    trx,
                    "location",
                    { id: job.locationId, companyId },
                    { columns: ["code", "name"] }
                  );
                  locationCode = loc.data?.code ?? null;
                  locationName = loc.data?.name ?? null;
                }
                const spawnSerials = await getNextSerialNumbers(trx, {
                  itemId: makeMethod.itemId,
                  companyId,
                  count: 1,
                  locationCode,
                  locationName
                });
                spawnReadableId = spawnSerials[0] ?? null;
              }

              const scrappedEntity = await trx
                .selectFrom("trackedEntity")
                .selectAll()
                .where("id", "=", scrapEntityId)
                .executeTakeFirst();
              const newTrackedEntityResult = await trx
                .insertInto("trackedEntity")
                .values({
                  sourceDocument: scrappedEntity?.sourceDocument ?? "Item",
                  sourceDocumentId:
                    scrappedEntity?.sourceDocumentId ?? makeMethod.itemId ?? "",
                  sourceDocumentReadableId:
                    scrappedEntity?.sourceDocumentReadableId,
                  quantity: 1,
                  status: "Reserved",
                  attributes: scrappedEntityAttributes as unknown as Json,
                  itemId: makeMethod.itemId ?? null,
                  expirationDate: scrappedEntity?.expirationDate ?? null,
                  readableId: spawnReadableId,
                  companyId,
                  createdBy: userId
                })
                .returning(["id"])
                .executeTakeFirst();
              newEntityId = newTrackedEntityResult?.id;
            }
          }

          // 6. GL: relieve the scrapped units\' accumulated material cost from
          //    WIP into the scrap account. Valuation = this operation\'s actual
          //    backflush cost + prior operations\' estimated material cost
          //    (jobMaterial per-unit quantity × itemCost.unitCost). Labor and
          //    overhead already absorbed stay in WIP and settle via close-job
          //    variance (spec decision 6).
          let priorUnitMaterialCost = 0;
          const priorOperations = await trx
            .selectFrom("jobOperation")
            .select(["id"])
            .where("jobMakeMethodId", "=", operation.jobMakeMethodId!)
            .where("order", "<", operation.order)
            .execute();
          if (priorOperations.length > 0) {
            const priorMaterials = await trx
              .selectFrom("jobMaterial")
              .select(["itemId", "quantity"])
              .where(
                "jobOperationId",
                "in",
                priorOperations.map((op) => op.id)
              )
              .where("methodType", "!=", "Make to Order")
              .execute();
            if (priorMaterials.length > 0) {
              const priorCosts = await trx
                .selectFrom("itemCost")
                .select(["itemId", "unitCost"])
                .where(
                  "itemId",
                  "in",
                  priorMaterials.map((m) => m.itemId)
                )
                .where("companyId", "=", companyId)
                .execute();
              const unitCostByItem = new Map(
                priorCosts.map((c) => [c.itemId, Number(c.unitCost) || 0])
              );
              for (const material of priorMaterials) {
                priorUnitMaterialCost +=
                  (Number(material.quantity) || 0) *
                  (unitCostByItem.get(material.itemId) ?? 0);
              }
            }
          }

          const scrapCost =
            backflush.totalMaterialCost + priorUnitMaterialCost * quantity;
          if (scrapCost > 0) {
            // A Provisional journal has no accounting period.
            const accountingPeriodId =
              postingStatus === "Posted"
                ? await getCurrentAccountingPeriod(companyId, trx, todayScrapOp)
                : null;
            const journalEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );
            const journalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId,
                accountingPeriodId,
                description: `Scrap — Job ${job.jobId ?? job.id}`,
                postingDate: todayScrapOp,
                companyId,
                sourceType: "Job Consumption",
                status: postingStatus,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            // An empty scrapAccount falls back to the variance account.
            const scrapAccountId = resolveDefaultAccount(
              accountDefaultsScrapOp.data,
              "scrapAccount",
              postingStatus
            ).accountId;
            const journalLineReference = nanoid();
            const journalLineResults = await trx
              .insertInto("journalLine")
              .values([
                {
                  journalId: journalResult.id,
                  accountId: scrapAccountId,
                  description: "Scrap Account",
                  amount: debit("expense", scrapCost),
                  quantity,
                  documentType: "Scrap",
                  documentId: job.id,
                  documentLineReference: `jobOperationScrap:${jobOperationId}`,
                  journalLineReference,
                  companyId
                },
                {
                  journalId: journalResult.id,
                  accountId: accountDefaultsScrapOp.data.workInProgressAccount,
                  description: "WIP Account",
                  amount: credit("asset", scrapCost),
                  quantity,
                  documentType: "Scrap",
                  documentId: job.id,
                  documentLineReference: `jobOperationScrap:${jobOperationId}`,
                  journalLineReference,
                  companyId
                }
              ])
              .returning(["id"])
              .execute();

            const itemCostRow = makeMethod.itemId
              ? await trx
                  .selectFrom("itemCost")
                  .select(["itemPostingGroupId"])
                  .where("itemId", "=", makeMethod.itemId)
                  .where("companyId", "=", companyId)
                  .executeTakeFirst()
              : null;
            const scrapDimensionValues: Array<[string, string | null]> = [
              ["Item", makeMethod.itemId ?? null],
              ["ItemPostingGroup", itemCostRow?.itemPostingGroupId ?? null],
              ["Location", job.locationId ?? null],
              ["ScrapReason", scrapReasonId],
              ["WorkCenter", operation.workCenterId ?? null],
              ["Employee", userId]
            ];
            const dimensionInserts = journalLineResults.flatMap((line) =>
              scrapDimensionValues
                .filter(
                  ([entityType, valueId]) =>
                    dimensionMapScrapOp.has(entityType) && valueId
                )
                .map(([entityType, valueId]) => ({
                  journalLineId: line.id,
                  dimensionId: dimensionMapScrapOp.get(entityType)!,
                  valueId: valueId as string,
                  companyId
                }))
            );
            if (dimensionInserts.length > 0) {
              await trx
                .insertInto("journalLineDimension")
                .values(dimensionInserts)
                .execute();
            }
          }
        });

        // Reschedule outside the transaction (trigger-rework precedent):
        // reopened/topped-up operations need fresh dates and priorities.
        // The scrap transaction already committed; a failed reschedule is logged, not raised.
        const rescheduled = await reschedule(
          ServerFnContext.system({ db, companyId, userId }),
          { jobId: job.id }
        );
        if (rescheduled.error) {
          logger.error("Failed to trigger reschedule after scrap", {
            error: rescheduled.error
          });
        }

        return {
          success: true,
          newTrackedEntityId: newEntityId
        };
      }
      case "partToOperation": {
        const {
          id,
          companyId,
          userId,
          itemId,
          quantity,
          materialId,
          jobOperationStepId,
          adjustmentType
        } = validatedPayload;

        // Written into jobMaterialStep for an unplanned part (no companyId there).
        await assertCompanyRecords(
          db,
          "jobOperationStep",
          [jobOperationStepId],
          companyId,
          "Job operation step"
        );

        const { accountDefaults, dimensionMap } =
          await loadConsumeAccountingContext(db, companyId);

        await db.transaction().execute(async (trx) => {
          // Provisional before the company's accounting cutover, Posted after it.
          const postingStatus = await journalPostingStatus(trx, companyId);
          const jobOperation = await trx
            .selectFrom("jobOperation")
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .select(["jobId", "jobMakeMethodId"])
            .executeTakeFirst();
          if (!jobOperation) throw new NotFoundError("Job operation not found");

          const [job, item] = await Promise.all([
            trx
              .selectFrom("job")
              .where("id", "=", jobOperation?.jobId!)
              .select("locationId")
              .executeTakeFirst(),
            trx
              .selectFrom("item")
              .where("id", "=", itemId)
              .where("companyId", "=", companyId)
              .select([
                "id",
                "itemTrackingType",
                "name",
                "readableIdWithRevision",
                "type"
              ])
              .executeTakeFirst()
          ]);

          if (materialId) {
            const material = await trx
              .selectFrom("jobMaterial")
              .where("id", "=", materialId)
              .where("companyId", "=", companyId)
              .selectAll()
              .executeTakeFirst();
            if (!material) throw new NotFoundError("Job material not found");

            let storageUnitId: string | null | undefined;
            // Prioritize material.storageUnitId if available
            if (material?.storageUnitId) {
              storageUnitId = material.storageUnitId;
            } else if (material?.defaultStorageUnit) {
              const pickMethod = await trx
                .selectFrom("pickMethod")
                .where("itemId", "=", itemId)
                .where("locationId", "=", job?.locationId!)
                .select("defaultStorageUnitId")
                .executeTakeFirst();
              storageUnitId = pickMethod?.defaultStorageUnitId;
            } else {
              storageUnitId = await getStorageUnitWithHighestQuantity(
                trx,
                itemId,
                job?.locationId!
              );
            }

            // Rounded once here: it drives the ledger rows, the budget
            // allocation and the quantityIssued write below.
            const quantityToIssue = round(
              adjustmentType === "Positive Adjmt."
                ? Number(quantity)
                : adjustmentType === "Negative Adjmt."
                  ? Number(quantity)
                  : round(Number(quantity)) -
                    round(Number(material?.quantityIssued)) // set quantity
            );

            if (material && material.methodType !== "Make to Order") {
              let remaining = Number(quantityToIssue);
              if (adjustmentType !== "Positive Adjmt." && remaining > 0) {
                const budgets = orderOldFirst(
                  await getPickedBudgets(trx, {
                    material,
                    locationId: job?.locationId!,
                    companyId,
                    opStorageUnitId: await getOperationLinesideBin(trx, {
                      jobOperationId: material.jobOperationId,
                      companyId
                    })
                  }),
                  material.itemId
                );
                const allocation = allocateAcrossBudgets(
                  remaining,
                  budgets,
                  Number(material.quantity ?? 0)
                );
                remaining = allocation.remaining;
                for (const take of allocation.takes) {
                  if (!take.budget.isInventory) continue;
                  for (const row of splitTakeByBin(take)) {
                    itemLedgerInserts.push({
                      entryType: "Consumption",
                      documentType: "Job Consumption",
                      documentId: material.jobId,
                      documentLineId: id,
                      companyId,
                      itemId: take.budget.itemId,
                      locationId: job?.locationId,
                      storageUnitId: row.storageUnitId,
                      quantity: -row.quantity,
                      createdBy: userId
                    });
                  }
                }
              }
              if (item?.itemTrackingType === "Inventory" && remaining !== 0) {
                itemLedgerInserts.push({
                  entryType: "Consumption",
                  documentType: "Job Consumption",
                  documentId: material.jobId,
                  documentLineId: id,
                  companyId,
                  itemId: material.itemId,
                  locationId: job?.locationId,
                  storageUnitId,
                  quantity:
                    adjustmentType === "Positive Adjmt."
                      ? Number(remaining)
                      : -Number(remaining),
                  createdBy: userId
                });
              }
            }

            await trx
              .updateTable("jobMaterial")
              .set({
                // A positive adjustment returns material to inventory, so it
                // reduces quantityIssued — otherwise the backflush cap sees
                // returned material as still issued.
                quantityIssued: round(
                  round(Number(material?.quantityIssued) ?? 0) +
                    (adjustmentType === "Positive Adjmt."
                      ? -quantityToIssue
                      : quantityToIssue)
                )
              })
              .where("id", "=", materialId)
              .where("companyId", "=", companyId)
              .execute();

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .execute();

              // Update pickMethod defaultStorageUnitId if needed for each inserted ledger
              for (const ledger of itemLedgerInserts) {
                await updatePickMethodDefaultStorageUnitIfNeeded(
                  trx,
                  ledger.itemId,
                  ledger.locationId,
                  ledger.storageUnitId,
                  companyId,
                  userId
                );
              }
            }
          } else {
            let storageUnitId: string | null | undefined;
            if (item?.itemTrackingType === "Inventory") {
              const pickMethod = await trx
                .selectFrom("pickMethod")
                .where("itemId", "=", itemId)
                .where("locationId", "=", job?.locationId!)
                .select("defaultStorageUnitId")
                .executeTakeFirst();

              storageUnitId =
                pickMethod?.defaultStorageUnitId ??
                (await getStorageUnitWithHighestQuantity(
                  trx,
                  itemId,
                  job?.locationId!
                ));

              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: jobOperation?.jobId,
                documentLineId: id,
                companyId,
                itemId: itemId!,
                quantity:
                  adjustmentType === "Positive Adjmt."
                    ? Number(quantity)
                    : -Number(quantity),
                locationId: job?.locationId,
                storageUnitId,
                createdBy: userId
              });
            }

            const itemCost = await trx
              .selectFrom("itemCost")
              .where("itemId", "=", itemId!)
              .select("unitCost")
              .executeTakeFirst();

            const newJobMaterial = await trx
              .insertInto("jobMaterial")
              .values({
                companyId,
                createdBy: userId,
                description: item?.name ?? "",
                estimatedQuantity: 0,
                itemId: itemId!,
                itemType: item?.type ?? "Part",
                jobId: jobOperation?.jobId!,
                jobMakeMethodId: jobOperation?.jobMakeMethodId!,
                jobOperationId: id,
                storageUnitId: storageUnitId ?? undefined,
                methodType: "Pull from Inventory",
                quantity: 0,
                quantityIssued: round(Number(quantity ?? 0)),
                unitCost: itemCost?.unitCost ?? 0
              })
              .returning("id")
              .executeTakeFirst();

            // Scope this unplanned part to the step it was issued on (assembly
            // view), so it shows on that step rather than as a General material.
            if (jobOperationStepId && newJobMaterial?.id) {
              await trx
                .insertInto("jobMaterialStep")
                .values({
                  jobMaterialId: newJobMaterial.id,
                  jobOperationStepId
                })
                .onConflict((oc) => oc.doNothing())
                .execute();
            }

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .execute();

              // Update pickMethod defaultStorageUnitId if needed for each inserted ledger
              for (const ledger of itemLedgerInserts) {
                await updatePickMethodDefaultStorageUnitIfNeeded(
                  trx,
                  ledger.itemId,
                  ledger.locationId,
                  ledger.storageUnitId,
                  companyId,
                  userId
                );
              }
            }
          }

          if (itemLedgerInserts.length > 0) {
            const jobOperation = await trx
              .selectFrom("jobOperation")
              .where("id", "=", id)
              .select(["jobId"])
              .executeTakeFirst();

            const jobRecord = jobOperation?.jobId
              ? await trx
                  .selectFrom("job")
                  .where("id", "=", jobOperation.jobId)
                  .select(["itemId", "locationId"])
                  .executeTakeFirst()
              : null;

            await createMaterialWipEntries(trx, {
              consumptionLedgers: itemLedgerInserts.map((l) => ({
                itemId: l.itemId as string,
                quantity: Number(l.quantity),
                trackedEntityId: l.trackedEntityId
              })),
              jobId: jobOperation?.jobId!,
              operationId: id,
              description: "Manual Material Issue",
              wipAccount: accountDefaults.workInProgressAccount,
              rawMaterialsAccount: accountDefaults.rawMaterialsAccount,
              finishedGoodsAccount: accountDefaults.finishedGoodsAccount,
              dimensionMap,

              jobLocationId: jobRecord?.locationId ?? null,
              db,
              companyId,
              userId,
              postingStatus
            });
          }
        });
        break;
      }
      case "scrapTrackedEntity": {
        const {
          trackedEntityId,
          materialId,
          parentTrackedEntityId,
          scrapReasonId,
          makeReplacement,
          companyId,
          userId
        } = validatedPayload;
        // The parent lands in trackedActivityOutput and the reason on the ledger,
        // the activity and the journal dimension — both must be this company's.
        await assertCompanyRecords(
          db,
          "trackedEntity",
          [parentTrackedEntityId],
          companyId,
          "Parent tracked entity"
        );
        await assertCompanyRecords(
          db,
          "scrapReason",
          [scrapReasonId],
          companyId,
          "Scrap reason"
        );

        const [trackedEntity, jobMaterial] = await inOrder([
          () => single(db, "trackedEntity", { id: trackedEntityId, companyId }),
          () => single(db, "jobMaterial", { id: materialId, companyId })
        ]);

        if (!trackedEntity.data) {
          throw new NotFoundError("Tracked entity not found");
        }

        if (!jobMaterial.data) {
          throw new NotFoundError("Job material not found");
        }
        if (trackedEntity.data.status === "Scrapped") {
          throw new Error("Tracked entity has already been scrapped");
        }

        const companyRecordScrap = await single(
          db,
          "company",
          { id: companyId },
          { columns: ["companyGroupId"] }
        );
        if (companyRecordScrap.error)
          throw new Error("Failed to fetch company");
        // Provisional before the company's accounting cutover, Posted after it.
        const postingStatusScrap = await journalPostingStatus(db, companyId);

        const accountDefaultsScrap = await getDefaultPostingGroup(
          db,
          companyId
        );
        if (accountDefaultsScrap.error || !accountDefaultsScrap.data) {
          throw new Error("Error getting account defaults");
        }

        const dimensionsScrap = await many(
          db,
          "dimension",
          {
            companyGroupId: companyRecordScrap.data.companyGroupId!,
            active: true,
            entityType: [
              "ItemPostingGroup",
              "Item",
              "Location",
              "ScrapReason",
              "WorkCenter",
              "Employee"
            ]
          },
          { columns: ["id", "entityType"] }
        );

        const dimensionMapScrap = new Map<string, string>();
        if (dimensionsScrap.data) {
          for (const dim of dimensionsScrap.data) {
            if (dim.entityType) dimensionMapScrap.set(dim.entityType, dim.id);
          }
        }

        const todayScrap = datetime
          .today(await getCompanyTimeZone(db, companyId))
          .toString();
        // Resolve the period BEFORE the transaction parks the (size 1) pool.
        // A Provisional journal has no accounting period.
        const accountingPeriodIdScrap =
          postingStatusScrap === "Posted"
            ? await getCurrentAccountingPeriod(companyId, db, todayScrap)
            : null;
        // An empty scrapAccount falls back to the variance account.
        const scrapAccountIdScrap = resolveDefaultAccount(
          accountDefaultsScrap.data,
          "scrapAccount",
          postingStatusScrap
        ).accountId;

        let didReplace = false;
        await db.transaction().execute(async (trx) => {
          // Re-read inside the transaction: its FOR SHARE lock holds the
          // status until commit, and the period above was resolved for it.
          await assertPostingStatusUnchanged(
            trx,
            companyId,
            postingStatusScrap
          );
          const entity = trackedEntity.data!;
          const material = jobMaterial.data!;
          const quantity = Number(entity.quantity);

          const job = await trx
            .selectFrom("job")
            .select(["id", "jobId", "locationId", "itemId"])
            .where("id", "=", material.jobId!)
            .executeTakeFirst();

          const item = await trx
            .selectFrom("item")
            .where("id", "=", material.itemId!)
            .select(["readableIdWithRevision"])
            .executeTakeFirst();

          // Scrap genealogy (was: Consume + attributes.Scrapped). The entity
          // keeps its full input tree; status is the terminal marker.
          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Scrap",
              sourceDocument: "Job Material",
              sourceDocumentId: materialId,
              sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
              attributes: {
                Job: job?.id!,
                "Job Make Method": material.jobMakeMethodId!,
                "Job Material": material.id!,
                "Scrap Reason": scrapReasonId,
                Employee: userId
              },
              companyId,
              createdBy: userId
            })
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId
            })
            .execute();

          if (parentTrackedEntityId) {
            await trx
              .insertInto("trackedActivityOutput")
              .values({
                trackedActivityId: activityId,
                trackedEntityId: parentTrackedEntityId,
                quantity,
                companyId,
                createdBy: userId
              })
              .execute();
          }

          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Scrapped"
            })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          const consumedItemId = entity.sourceDocumentId ?? material.itemId!;
          const [itemRow, itemCostRow] = await Promise.all([
            trx
              .selectFrom("item")
              .select(["itemTrackingType", "replenishmentSystem"])
              .where("id", "=", consumedItemId)
              .executeTakeFirst(),
            trx
              .selectFrom("itemCost")
              .select([
                "costingMethod",
                "unitCost",
                "standardCost",
                "itemPostingGroupId"
              ])
              .where("itemId", "=", consumedItemId)
              .where("companyId", "=", companyId)
              .executeTakeFirst()
          ]);
          // A missing itemCost must not fail the scrap — fall back to zero
          // cost (no journal value) so the physical/traceability scrap still
          // records; accounting can be reconciled later.
          const resolvedItemCost = {
            costingMethod: itemCostRow?.costingMethod ?? "Average",
            unitCost: Number(itemCostRow?.unitCost ?? 0),
            standardCost: Number(itemCostRow?.standardCost ?? 0),
            itemPostingGroupId: itemCostRow?.itemPostingGroupId ?? null
          };

          // Entity STATE drives the accounting side, not methodType:
          //  - Available (picked / in stock) → scrap FROM STOCK (Cr inventory)
          //  - Consumed (already issued into the parent) → relieve WIP (Cr WIP)
          const isConsumed = entity.status === "Consumed";

          const scrapWorkCenterId = material.jobOperationId
            ? ((
                await trx
                  .selectFrom("jobOperation")
                  .select(["workCenterId"])
                  .where("id", "=", material.jobOperationId)
                  .executeTakeFirst()
              )?.workCenterId ?? null)
            : null;
          const scrapExtraDimensions = [
            { entityType: "ScrapReason", valueId: scrapReasonId },
            ...(scrapWorkCenterId
              ? [{ entityType: "WorkCenter", valueId: scrapWorkCenterId }]
              : []),
            { entityType: "Employee", valueId: userId }
          ];

          if (!isConsumed) {
            // AVAILABLE → scrap from stock (Dr scrapAccount / Cr inventory via
            // the shared adjustment core) at the entity's actual on-hand bin.
            // quantityIssued is untouched — it was never consumed.
            const ledgerRows = await trx
              .selectFrom("itemLedger")
              .select(["trackedEntityId", "storageUnitId", "quantity"])
              .where("trackedEntityId", "=", trackedEntityId)
              .execute();
            const bin = resolveTrackedEntityBin(ledgerRows, trackedEntityId);

            await bookAdjustment(trx, {
              ledger: {
                postingDate: todayScrap,
                itemId: consumedItemId,
                quantity: -Math.abs(quantity),
                locationId: job?.locationId ?? null,
                storageUnitId: bin,
                trackedEntityId,
                entryType: "Negative Adjmt.",
                documentType: "Scrap",
                documentId: job?.id ?? null,
                scrapReasonId,
                companyId,
                createdBy: userId
              },
              item: {
                itemTrackingType: itemRow?.itemTrackingType ?? null,
                replenishmentSystem: itemRow?.replenishmentSystem ?? null,
                itemPostingGroupId: resolvedItemCost.itemPostingGroupId
              },
              itemCost: {
                costingMethod: resolvedItemCost.costingMethod,
                unitCost: resolvedItemCost.unitCost,
                standardCost: resolvedItemCost.standardCost
              },
              accounting: {
                postingStatus: postingStatusScrap,
                accountingPeriodId: accountingPeriodIdScrap,
                accountDefaults: {
                  rawMaterialsAccount:
                    accountDefaultsScrap.data.rawMaterialsAccount,
                  finishedGoodsAccount:
                    accountDefaultsScrap.data.finishedGoodsAccount,
                  inventoryAdjustmentVarianceAccount:
                    accountDefaultsScrap.data.inventoryAdjustmentVarianceAccount
                },
                offsetAccount: scrapAccountIdScrap,
                offsetDescription: "Scrap Account",
                description: `Scrap — ${item?.readableIdWithRevision ?? ""}`,
                userId,
                dimensions: Object.fromEntries(dimensionMapScrap),
                extraDimensions: scrapExtraDimensions
              }
            });
          } else {
            // CONSUMED → the material cost was moved into WIP at consumption.
            // Relieve it to scrap (Dr scrapAccount / Cr WIP at the item's unit
            // cost — materials-only, spec decision 6) and reopen the material
            // requirement so a replacement can be issued.
            const scrapCost = resolvedItemCost.unitCost * quantity;
            if (scrapCost > 0) {
              const journalEntryId = await getNextSequence(
                trx,
                "journalEntry",
                companyId
              );
              const journalResult = await trx
                .insertInto("journal")
                .values({
                  journalEntryId,
                  accountingPeriodId: accountingPeriodIdScrap,
                  description: `Scrap — ${item?.readableIdWithRevision ?? ""}`,
                  postingDate: todayScrap,
                  companyId,
                  sourceType: "Job Consumption",
                  status: postingStatusScrap,
                  postedAt: datetime.timestamp(),
                  postedBy: userId,
                  createdBy: userId
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

              const journalLineReference = nanoid();
              const journalLineResults = await trx
                .insertInto("journalLine")
                .values([
                  {
                    journalId: journalResult.id,
                    accountId: scrapAccountIdScrap,
                    description: "Scrap Account",
                    amount: debit("expense", scrapCost),
                    quantity,
                    documentType: "Scrap",
                    documentId: job?.id ?? null,
                    documentLineReference: `scrapTrackedEntity:${materialId}`,
                    journalLineReference,
                    companyId
                  },
                  {
                    journalId: journalResult.id,
                    accountId: accountDefaultsScrap.data.workInProgressAccount,
                    description: "WIP Account",
                    amount: credit("asset", scrapCost),
                    quantity,
                    documentType: "Scrap",
                    documentId: job?.id ?? null,
                    documentLineReference: `scrapTrackedEntity:${materialId}`,
                    journalLineReference,
                    companyId
                  }
                ])
                .returning(["id"])
                .execute();

              const scrapDimensionValues: Array<[string, string | null]> = [
                ["Item", consumedItemId],
                ["ItemPostingGroup", resolvedItemCost.itemPostingGroupId],
                ["Location", job?.locationId ?? null],
                ["ScrapReason", scrapReasonId],
                ["WorkCenter", scrapWorkCenterId],
                ["Employee", userId]
              ];
              const dimensionInserts = journalLineResults.flatMap((line) =>
                scrapDimensionValues
                  .filter(
                    ([entityType, valueId]) =>
                      dimensionMapScrap.has(entityType) && valueId
                  )
                  .map(([entityType, valueId]) => ({
                    journalLineId: line.id,
                    dimensionId: dimensionMapScrap.get(entityType)!,
                    valueId: valueId as string,
                    companyId
                  }))
              );
              if (dimensionInserts.length > 0) {
                await trx
                  .insertInto("journalLineDimension")
                  .values(dimensionInserts)
                  .execute();
              }
            }

            // Reopen the requirement — the consumed part is gone, so the
            // assembly needs a replacement issued.
            const currentQuantityIssued = round(
              Number(material.quantityIssued) || 0
            );
            await trx
              .updateTable("jobMaterial")
              .set({
                quantityIssued: Math.max(
                  0,
                  round(currentQuantityIssued - round(quantity))
                )
              })
              .where("id", "=", materialId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Replacement flow ("made 3, scrapped 1 → make 1 more"): only a
          // Make-to-Order subassembly can be re-made in place. Reopen its
          // routing, spawn the replacement serial, and record a rework row.
          if (makeReplacement && job) {
            const subMakeMethod = await trx
              .selectFrom("jobMakeMethod")
              .select(["id", "itemId", "requiresSerialTracking"])
              .where("parentMaterialId", "=", material.id!)
              .where("companyId", "=", companyId)
              .executeTakeFirst();

            if (subMakeMethod) {
              didReplace = true;
              await applyScrapReplacement(trx, {
                jobMakeMethodId: subMakeMethod.id,
                jobId: job.id,
                companyId,
                userId
              });

              if (
                subMakeMethod.requiresSerialTracking &&
                subMakeMethod.itemId
              ) {
                let locationCode: string | null = null;
                let locationName: string | null = null;
                if (job.locationId) {
                  const loc = await single(
                    trx,
                    "location",
                    { id: job.locationId, companyId },
                    { columns: ["code", "name"] }
                  );
                  locationCode = loc.data?.code ?? null;
                  locationName = loc.data?.name ?? null;
                }
                const spawnSerials = await getNextSerialNumbers(trx, {
                  itemId: subMakeMethod.itemId,
                  companyId,
                  count: 1,
                  locationCode,
                  locationName
                });
                await trx
                  .insertInto("trackedEntity")
                  .values({
                    sourceDocument: entity.sourceDocument,
                    sourceDocumentId: entity.sourceDocumentId,
                    sourceDocumentReadableId: entity.sourceDocumentReadableId,
                    quantity: 1,
                    status: "Reserved",
                    attributes: entity.attributes,
                    itemId: subMakeMethod.itemId,
                    expirationDate: entity.expirationDate ?? null,
                    readableId: spawnSerials[0] ?? null,
                    companyId,
                    createdBy: userId
                  })
                  .execute();
              }

              const firstSubOperation = await trx
                .selectFrom("jobOperation")
                .select(["id"])
                .where("jobMakeMethodId", "=", subMakeMethod.id)
                .orderBy("order", "asc")
                .executeTakeFirst();
              const scrapReason = await trx
                .selectFrom("scrapReason")
                .select(["name"])
                .where("id", "=", scrapReasonId)
                .where("companyId", "=", companyId)
                .executeTakeFirst();
              if (firstSubOperation && material.jobOperationId) {
                await trx
                  .insertInto("rework")
                  .values({
                    jobId: job.id,
                    triggeredAtJobOperationId: material.jobOperationId,
                    targetJobOperationId: firstSubOperation.id,
                    reason: scrapReason?.name ?? "Scrap",
                    quantity,
                    requestedById: userId,
                    companyId
                  })
                  .execute();
              }
            }
          }
        });

        // Reschedule outside the transaction when the routing was reopened.
        if (didReplace) {
          // The scrap transaction already committed; a failed reschedule is logged, not raised.
          const rescheduled = await reschedule(
            ServerFnContext.system({ db, companyId, userId }),
            { jobId: jobMaterial.data.jobId }
          );
          if (rescheduled.error) {
            logger.error("Failed to trigger reschedule after scrap", {
              error: rescheduled.error
            });
          }
        }

        return {
          success: true
        };
      }
      case "trackedEntitiesToOperation": {
        const {
          materialId,
          jobOperationId,
          itemId,
          parentTrackedEntityId,
          children,
          jobOperationStepId,
          unitNumber,
          overrideExpired,
          overrideReason,
          companyId,
          userId
        } = validatedPayload;

        if (!parentTrackedEntityId) {
          throw new Error("Parent ID is required");
        }

        if (children.length === 0) {
          throw new Error("Children are required");
        }

        // Either materialId or (jobOperationId + itemId) must be provided
        if (!materialId && (!jobOperationId || !itemId)) {
          throw new Error(
            "Either materialId or both jobOperationId and itemId must be provided"
          );
        }

        // Stamped on the Consume activity and written into jobMaterialStep.
        await assertCompanyRecords(
          db,
          "jobOperationStep",
          [jobOperationStepId],
          companyId,
          "Job operation step"
        );
        const companyToday = datetime.today(
          await getCompanyTimeZone(db, companyId)
        );
        const accounting = await loadConsumeAccountingContext(db, companyId);

        const result = await db.transaction().execute(async (trx) =>
          consumeTrackedEntitiesIntoOperation(trx, {
            db,
            materialId,
            jobOperationId,
            itemId,
            parentTrackedEntityId,
            children,
            jobOperationStepId,
            unitNumber,
            overrideExpired,
            overrideReason,
            companyId,
            userId,
            companyToday,
            // Provisional before the company's accounting cutover, Posted after it.
            postingStatus: await journalPostingStatus(trx, companyId),
            ...accounting
          })
        );

        return {
          success: true,
          splitEntities: result.splitEntities,
          warning: result.warning
        };
      }
      case "trackedEntitiesToBatch": {
        const {
          batchId,
          itemId,
          children,
          overrideExpired,
          overrideReason,
          companyId,
          userId
        } = validatedPayload;

        if (children.length === 0) {
          throw new Error("Children are required");
        }

        const companyToday = datetime.today(
          await getCompanyTimeZone(db, companyId)
        );
        const accounting = await loadConsumeAccountingContext(db, companyId);

        // Resolve (and lazily create) the accounting period BEFORE the member
        // transaction opens. getCurrentAccountingPeriod reads over HTTP but
        // writes in-transaction, so two members inside ONE transaction would
        // each try to create a missing period — the second cannot see the
        // first's uncommitted insert and the unique index rolls the whole pick
        // back. Committed here, every member's read finds it. A Provisional
        // journal has no accounting period, so none is created before the
        // company's accounting cutover.
        const postingStatus = await journalPostingStatus(db, companyId);
        if (postingStatus === "Posted") {
          await getCurrentAccountingPeriod(
            companyId,
            db,
            companyToday.toString()
          );
        }

        const batchResult = await db.transaction().execute(async (trx) => {
          // Re-read inside the transaction: its FOR SHARE lock holds the
          // status until commit, and the period above was resolved for it.
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          const batch = await trx
            .selectFrom("jobOperationBatch")
            .select(["id", "status"])
            .where("id", "=", batchId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
          if (!batch) {
            throw new NotFoundError("Batch not found");
          }
          if (batch.status === "Completed") {
            throw new Error("Batch is already completed");
          }

          const members = await trx
            .selectFrom("jobOperation")
            .select(["id", "jobId", "jobMakeMethodId"])
            .where("jobOperationBatchId", "=", batchId)
            .where("companyId", "=", companyId)
            .execute();
          if (members.length === 0) {
            throw new Error("Batch has no member operations");
          }
          const memberIds = members.map((m) => m.id);
          const memberIdSet = new Set(memberIds);
          // A member's materials are what its operation view lists: the
          // operation's make method BOM. A row linked straight to a member
          // operation stays with it; the rest belong to the member on its make
          // method (BOMs are usually not assigned per operation, and jobs built
          // from an item never carry the link).
          const memberByMakeMethod = new Map(
            members
              .filter((m) => m.jobMakeMethodId)
              .map((m) => [m.jobMakeMethodId as string, m.id])
          );

          // Lock the member material rows so a concurrent batch pick (or a
          // member-level manual issue) cannot double-allocate the remaining
          // requirement.
          const materialRows = await trx
            .selectFrom("jobMaterial")
            .select([
              "id",
              "jobOperationId",
              "jobMakeMethodId",
              "estimatedQuantity",
              "quantityIssued"
            ])
            .where("companyId", "=", companyId)
            .where("itemId", "=", itemId)
            .where((eb) =>
              eb.or([
                eb("jobOperationId", "in", memberIds),
                ...(memberByMakeMethod.size
                  ? [
                      eb("jobMakeMethodId", "in", [
                        ...memberByMakeMethod.keys()
                      ])
                    ]
                  : [])
              ])
            )
            .forUpdate()
            .execute();

          const rowByOp = new Map<string, string>();
          const remainingByOp = new Map<string, number>();
          for (const row of materialRows) {
            const opId =
              row.jobOperationId && memberIdSet.has(row.jobOperationId)
                ? row.jobOperationId
                : memberByMakeMethod.get(row.jobMakeMethodId as string);
            if (!opId) continue;
            const remaining = Math.max(
              0,
              Number(row.estimatedQuantity ?? 0) -
                Number(row.quantityIssued ?? 0)
            );
            remainingByOp.set(opId, (remainingByOp.get(opId) ?? 0) + remaining);
            // The write target: an OPEN row for this member/item when one
            // exists, else any row (which one is arbitrary either way).
            if (!rowByOp.has(opId) || remaining > 0) {
              rowByOp.set(opId, row.id as string);
            }
          }

          // Per picked lot, split pro-rata by each member's CURRENT remaining —
          // every member links to every lot it physically drew from, and a
          // multi-lot pick converges on exact per-member BOM totals.
          const drawsByOp = new Map<
            string,
            { trackedEntityId: string; quantity: number }[]
          >();
          for (const child of children) {
            const open = members
              .map((m) => ({
                jobOperationId: m.id,
                remaining: remainingByOp.get(m.id) ?? 0
              }))
              .filter((m) => m.remaining > 0);
            const shares = splitPickAcrossMembers(open, Number(child.quantity));
            for (const share of shares) {
              if (share.quantity <= 0) continue;
              remainingByOp.set(
                share.jobOperationId,
                (remainingByOp.get(share.jobOperationId) ?? 0) - share.quantity
              );
              const draws = drawsByOp.get(share.jobOperationId) ?? [];
              draws.push({
                trackedEntityId: child.trackedEntityId,
                quantity: share.quantity
              });
              drawsByOp.set(share.jobOperationId, draws);
            }
          }

          const splitEntities: Array<{
            originalId: string;
            newId: string;
            readableId: string;
            quantity: number;
            remainingQuantity: number;
          }> = [];
          let warning: string | undefined;

          for (const member of members) {
            const draws = drawsByOp.get(member.id);
            if (!draws || draws.length === 0) continue;
            if (!member.jobMakeMethodId) {
              throw new Error(`Job operation ${member.id} has no make method`);
            }
            // The member's WIP entity — what its consumption books into (the
            // same entity the single-operation page passes as the parent).
            const parent = await trx
              .selectFrom("trackedEntity")
              .select(["id"])
              .where(
                sql`"attributes"->>'Job Make Method'`,
                "=",
                member.jobMakeMethodId
              )
              .where("companyId", "=", companyId)
              // Scrap and split children inherit the attribute, so an earlier
              // run's dead entity can be the oldest match — it must not absorb
              // this member's consumption.
              .where("status", "not in", ["Consumed", "Scrapped", "Rejected"])
              // Deterministic among tied `createdAt` (bulk-minted serials).
              .orderBy("createdAt", "asc")
              .orderBy("readableId", "asc")
              .orderBy("id", "asc")
              .executeTakeFirst();
            if (!parent) {
              throw new Error(
                `No tracked entity found for job operation ${member.id} — release the member job before picking to the batch`
              );
            }

            const memberResult = await consumeTrackedEntitiesIntoOperation(
              trx,
              {
                db,
                materialId: rowByOp.get(member.id),
                jobOperationId: member.id,
                itemId,
                parentTrackedEntityId: parent.id as string,
                children: draws,
                overrideExpired,
                overrideReason,
                companyId,
                userId,
                companyToday,
                postingStatus,
                ...accounting
              }
            );
            splitEntities.push(...memberResult.splitEntities);
            warning = warning ?? memberResult.warning;
          }

          return { splitEntities, warning };
        });

        return {
          success: true,
          ...batchResult
        };
      }
      case "mergeTrackedEntities": {
        const { trackedEntityIds, readableId, companyId, userId } =
          validatedPayload;

        const companyToday = datetime.today(
          await getCompanyTimeZone(db, companyId)
        );

        const mergeResult = await db.transaction().execute(async (trx) => {
          const parents = await trx
            .selectFrom("trackedEntity")
            .selectAll()
            .where("id", "in", trackedEntityIds)
            .where("companyId", "=", companyId)
            .forUpdate()
            .execute();

          if (parents.length !== trackedEntityIds.length) {
            throw new NotFoundError("Tracked entities not found");
          }

          // Order by the caller's list, not the DB's row order: the builder
          // reads the FIRST parent for the merged lot's number, bin, and
          // attribute base, so an unordered read makes those non-deterministic.
          const parentById = new Map(parents.map((p) => [p.id, p]));
          const orderedParents = trackedEntityIds.map((id) => {
            const row = parentById.get(id);
            if (!row) throw new NotFoundError("Tracked entities not found");
            return row;
          });

          const parentLedgers = await trx
            .selectFrom("itemLedger")
            .select([
              "trackedEntityId",
              "storageUnitId",
              "locationId",
              "quantity",
              "createdAt"
            ])
            .where("trackedEntityId", "in", trackedEntityIds)
            .where("companyId", "=", companyId)
            .orderBy("createdAt", "desc")
            .execute();

          // The parent's on-ledger balance: what its job receipt has put into
          // stock so far. The merge only moves this — unreceived quantity
          // reaches inventory later, through the member job's own receipt.
          const receivedOf = (entityId: string) =>
            (parentLedgers as any[])
              .filter((l) => l.trackedEntityId === entityId)
              .reduce((acc, l) => acc + Number(l.quantity), 0);

          const locationOf = (entityId: string) =>
            (parentLedgers as any[]).find(
              (l) => l.trackedEntityId === entityId && l.locationId
            )?.locationId ?? null;

          const mergedId = nanoid();
          const mergeActivityId = nanoid();

          const records = buildBatchMergeRecords({
            parents: orderedParents.map((p) => ({
              id: p.id,
              readableId: p.readableId,
              quantity: Number(p.quantity),
              receivedQuantity: receivedOf(p.id),
              status: p.status as string,
              sourceDocument: p.sourceDocument,
              sourceDocumentId: p.sourceDocumentId,
              sourceDocumentReadableId: p.sourceDocumentReadableId,
              itemId: p.itemId ?? null,
              expirationDate: (p.expirationDate as string | null) ?? null,
              attributes: p.attributes as Record<string, unknown> | null,
              bin: {
                storageUnitId: resolveTrackedEntityBin(
                  parentLedgers as any[],
                  p.id
                ),
                locationId: locationOf(p.id)
              }
            })),
            mergedId,
            mergeActivityId,
            readableId: readableId ?? null,
            activitySourceDocument: "Tracked Entity",
            activitySourceDocumentId: mergedId,
            companyId,
            userId,
            postingDate: companyToday.toString()
          });

          await trx
            .insertInto("trackedEntity")
            .values({
              ...records.mergedEntityInsert,
              // TEXT NOT NULL columns; the builder sources them from the first
              // parent, which the schema guarantees is non-null.
              sourceDocument: records.mergedEntityInsert
                .sourceDocument as string,
              sourceDocumentId: records.mergedEntityInsert
                .sourceDocumentId as string,
              attributes: records.mergedEntityInsert.attributes as Json
            })
            .execute();

          await trx
            .insertInto("trackedActivity")
            .values({
              ...records.activityInsert,
              attributes: records.activityInsert.attributes as Json
            })
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values(records.activityInputInserts)
            .execute();

          await trx
            .insertInto("trackedActivityOutput")
            .values(records.activityOutputInsert)
            .execute();

          await trx
            .insertInto("itemLedger")
            .values(
              records.ledgerInserts.map((l) => ({
                ...l,
                itemId: l.itemId as string
              }))
            )
            .execute();

          for (const update of records.parentUpdates) {
            await trx
              .updateTable("trackedEntity")
              .set({ status: update.status })
              .where("id", "=", update.id)
              .where("companyId", "=", companyId)
              .execute();
          }

          return {
            trackedEntityId: mergedId,
            readableId: records.mergedEntityInsert.readableId,
            quantity: records.mergedEntityInsert.quantity
          };
        });

        return {
          success: true,
          ...mergeResult
        };
      }
      case "unconsumeTrackedEntities": {
        const {
          materialId,
          parentTrackedEntityId,
          children,
          companyId,
          userId
        } = validatedPayload;

        if (!parentTrackedEntityId) {
          throw new Error("Parent ID is required");
        }

        if (children.length === 0) {
          throw new Error("Children are required");
        }

        const {
          accountDefaults: accountDefaultsUnconsume,
          dimensionMap: dimensionMapUnconsume
        } = await loadConsumeAccountingContext(db, companyId);

        await db.transaction().execute(async (trx) => {
          // Provisional before the company's accounting cutover, Posted after it.
          const postingStatus = await journalPostingStatus(trx, companyId);
          const trackedEntities = await trx
            .selectFrom("trackedEntity")
            .where(
              "id",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .where("companyId", "=", companyId)
            .selectAll()
            .execute();

          const itemLedgers = await trx
            .selectFrom("itemLedger")
            .where("trackedEntityId", "in", [
              ...children.map((child) => child.trackedEntityId)
            ])
            .orderBy("createdBy", "desc")
            .selectAll()
            .execute();

          if (trackedEntities.length !== children.length) {
            throw new NotFoundError("Tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Consumed")) {
            throw new Error(
              "Tracked entities must be in Consumed status to unconsume"
            );
          }

          const jobMaterial = await trx
            .selectFrom("jobMaterial")
            .where("id", "=", materialId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirst();
          if (!jobMaterial) throw new NotFoundError("Job material not found");

          // Get item details
          const item = await trx
            .selectFrom("item")
            .where("id", "=", jobMaterial?.itemId!)
            .select(["readableIdWithRevision"])
            .executeTakeFirst();

          // Get job location
          const job = await trx
            .selectFrom("job")
            .select(["id", "locationId"])
            .where("id", "=", jobMaterial?.jobId!)
            .executeTakeFirst();

          // Get parent tracked entity details
          const parentTrackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", parentTrackedEntityId)
            .where("companyId", "=", companyId)
            .select([
              "id",
              "sourceDocumentId",
              "quantity",
              "attributes",
              "status"
            ])
            .executeTakeFirst();

          if (!parentTrackedEntity) {
            throw new NotFoundError("Parent tracked entity not found");
          }

          // Create tracked activity for unconsume
          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Unconsume",
              sourceDocument: "Job Material",
              sourceDocumentId: materialId,
              sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
              attributes: {
                Job: job?.id!,
                "Job Make Method": jobMaterial?.jobMakeMethodId!,
                "Job Material": jobMaterial?.id!,
                Employee: userId
              },
              companyId,
              createdBy: userId
            })
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId: parentTrackedEntityId,
              quantity: parentTrackedEntity.quantity,
              companyId,
              createdBy: userId
            })
            .execute();

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          const trackedActivityOutputs: Database["public"]["Tables"]["trackedActivityOutput"]["Insert"][] =
            [];

          // Process each child tracked entity
          for (const child of children) {
            const trackedEntity = trackedEntities.find(
              (entity) => entity.id === child.trackedEntityId
            );
            if (!trackedEntity) {
              throw new NotFoundError("Tracked entity not found");
            }
            const { trackedEntityId, quantity } = child;
            // Update tracked entity status back to Available
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available"
              })
              .where("id", "=", trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();

            trackedActivityOutputs.push({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId
            });

            if (jobMaterial?.methodType !== "Make to Order") {
              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: job?.id!,
                companyId,
                itemId: trackedEntity.sourceDocumentId,
                quantity: quantity,
                locationId: job?.locationId,
                // NOTE: unconsume path left on its original bin-selection until
                // it can be verified; the resolveTrackedEntityBin fix is scoped
                // to the consumption path (trackedEntitiesToOperation).
                storageUnitId: itemLedgers.find(
                  (itemLedger) => itemLedger.trackedEntityId === trackedEntityId
                )?.storageUnitId,
                trackedEntityId,
                createdBy: userId
              });
            }
          }

          if (trackedActivityOutputs.length > 0) {
            await trx
              .insertInto("trackedActivityOutput")
              .values(trackedActivityOutputs)
              .execute();
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();

            for (const ledger of itemLedgerInserts) {
              await updatePickMethodDefaultStorageUnitIfNeeded(
                trx,
                ledger.itemId,
                ledger.locationId,
                ledger.storageUnitId,
                companyId,
                userId
              );
            }

            const returnEntries = itemLedgerInserts.map((l) => ({
              itemId: l.itemId as string,
              quantity: Number(l.quantity)
            }));

            await createMaterialWipEntries(trx, {
              consumptionLedgers: returnEntries,
              jobId: job?.id!,
              operationId: jobMaterial?.jobOperationId ?? materialId,
              description: "Unconsume Material Return",
              wipAccount: accountDefaultsUnconsume.workInProgressAccount,
              rawMaterialsAccount: accountDefaultsUnconsume.rawMaterialsAccount,
              finishedGoodsAccount:
                accountDefaultsUnconsume.finishedGoodsAccount,
              dimensionMap: dimensionMapUnconsume,

              jobLocationId: job?.locationId ?? null,
              db,
              companyId,
              userId,
              postingStatus
            });
          }

          const totalChildQuantity = roundedChildTotal(children);

          const currentQuantityIssued = round(
            Number(jobMaterial?.quantityIssued) || 0
          );
          const newQuantityIssued = round(
            currentQuantityIssued - totalChildQuantity
          );

          await trx
            .updateTable("jobMaterial")
            .set({
              quantityIssued: newQuantityIssued
            })
            .where("id", "=", materialId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }
      case "convertEntity": {
        const { trackedEntityId, newRevision, quantity, companyId, userId } =
          validatedPayload;

        const convertedEntity = await db.transaction().execute(async (trx) => {
          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          if (!trackedEntity.sourceDocumentId) {
            throw new Error("Tracked entity has no source document");
          }

          // Get the old item revision
          const oldItem = await trx
            .selectFrom("item")
            .where("id", "=", trackedEntity.sourceDocumentId)
            .select(["id", "readableId", "revision"])
            .executeTakeFirstOrThrow();

          // Check if new revision exists, create if not
          let newItem = await trx
            .selectFrom("item")
            .where("readableId", "=", oldItem.readableId)
            .where("revision", "=", newRevision)
            .where("companyId", "=", companyId)
            .select(["id", "readableId", "revision", "readableIdWithRevision"])
            .executeTakeFirst();

          if (!newItem) {
            // Get the part/material/tool/consumable record
            const baseItem = await trx
              .selectFrom("item")
              .where("id", "=", oldItem.id)
              .selectAll()
              .executeTakeFirstOrThrow();

            // Create new item revision
            const insertedItem = await trx
              .insertInto("item")
              .values({
                readableId: oldItem.readableId,
                revision: newRevision,
                type: baseItem.type,
                active: baseItem.active,
                name: baseItem.name,
                description: baseItem.description,
                itemTrackingType: baseItem.itemTrackingType,
                replenishmentSystem: baseItem.replenishmentSystem,
                defaultMethodType: baseItem.defaultMethodType,
                unitOfMeasureCode: baseItem.unitOfMeasureCode,
                modelUploadId: baseItem.modelUploadId,
                companyId,
                createdBy: userId
              })
              .returning([
                "id",
                "readableId",
                "revision",
                "readableIdWithRevision"
              ])
              .executeTakeFirstOrThrow();

            newItem = insertedItem;

            // Create the part/material/tool/consumable record if it doesn't exist
            if (baseItem.type === "Part") {
              await trx
                .insertInto("part")
                .values({
                  id: oldItem.readableId,
                  companyId,
                  createdBy: userId
                })
                .onConflict((oc) => oc.columns(["id", "companyId"]).doNothing())
                .execute();
            }
          }

          if (oldItem.id) {
            const oldItemCost = await trx
              .selectFrom("itemCost")
              .where("itemId", "=", oldItem.id)
              .select(["unitCost"])
              .executeTakeFirst();

            // Calculate new unit cost based on quantity conversion
            // Total value = oldQuantity * oldUnitCost
            // New unit cost = Total value / newQuantity
            const oldQuantity = Number(trackedEntity.quantity);
            const oldUnitCost = Number(oldItemCost?.unitCost ?? 0);

            const totalValue = oldQuantity * oldUnitCost;
            const newUnitCost = totalValue / quantity;

            // Update new revision's cost
            if (newItem?.id) {
              await trx
                .updateTable("itemCost")
                .set({
                  unitCost: newUnitCost,
                  costIsAdjusted: true
                })
                .where("itemId", "=", newItem.id)
                .where("companyId", "=", companyId)
                .execute();
            }
          }

          // Create conversion activity
          const conversionActivityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: conversionActivityId,
              type: "Convert",
              sourceDocument: "Revision Conversion",
              attributes: {
                "Old Revision": oldItem.revision,
                "New Revision": newRevision,
                "Old Item ID": oldItem.id,
                "New Item ID": newItem.id
              },
              companyId,
              createdBy: userId
            })
            .execute();

          // Record input (old revision entity)
          if (trackedEntity.id) {
            await trx
              .insertInto("trackedActivityInput")
              .values({
                trackedActivityId: conversionActivityId,
                trackedEntityId: trackedEntity.id,
                quantity: trackedEntity.quantity,
                companyId,
                createdBy: userId
              })
              .execute();
          }

          // Update tracked entity to new revision
          await trx
            .updateTable("trackedEntity")
            .set({
              sourceDocumentId: newItem.id,
              sourceDocumentReadableId: newItem.readableIdWithRevision,
              quantity: quantity
            })
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();

          // Record output (new revision entity)
          if (trackedEntity.id) {
            await trx
              .insertInto("trackedActivityOutput")
              .values({
                trackedActivityId: conversionActivityId,
                trackedEntityId: trackedEntity.id,
                quantity: quantity,
                companyId,
                createdBy: userId
              })
              .execute();
          }

          // Get the location from existing ledger entries
          const existingLedger = await trx
            .selectFrom("itemLedger")
            .where("trackedEntityId", "=", trackedEntityId)
            .select(["locationId", "storageUnitId"])
            .orderBy("createdAt", "desc")
            .executeTakeFirst();

          // Create item ledger entries
          if (oldItem.id && newItem?.id) {
            const oldQuantity = Number(trackedEntity.quantity);
            const ledgerEntries: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [
                // Remove old revision quantity
                {
                  entryType: "Negative Adjmt.",
                  documentType: "Batch Split",
                  documentId: conversionActivityId,
                  companyId,
                  itemId: oldItem.id,
                  quantity: -oldQuantity,
                  locationId: existingLedger?.locationId,
                  storageUnitId: existingLedger?.storageUnitId,
                  trackedEntityId,
                  createdBy: userId
                },
                // Add new revision quantity
                {
                  entryType: "Positive Adjmt.",
                  documentType: "Batch Split",
                  documentId: conversionActivityId,
                  companyId,
                  itemId: newItem.id,
                  quantity: quantity,
                  locationId: existingLedger?.locationId,
                  storageUnitId: existingLedger?.storageUnitId,
                  trackedEntityId,
                  createdBy: userId
                }
              ];

            await trx.insertInto("itemLedger").values(ledgerEntries).execute();
          }

          logger.info("Entity converted", {
            trackedEntityId,
            oldRevision: oldItem.revision,
            newRevision,
            oldItemId: oldItem.id,
            newItemId: newItem.id
          });

          // Get the updated readable ID with revision
          const updatedItem = await trx
            .selectFrom("item")
            .where("id", "=", newItem.id)
            .select(["readableIdWithRevision"])
            .executeTakeFirst();

          return {
            trackedEntityId,
            readableId:
              updatedItem?.readableIdWithRevision ?? oldItem.readableId,
            quantity: quantity
          };
        });

        return {
          success: true,
          message: "Entity converted successfully",
          convertedEntity
        };
      }
      case "maintenanceDispatchInventory": {
        const {
          maintenanceDispatchId,
          itemId,
          unitOfMeasureCode,
          quantity,
          companyId,
          userId
        } = validatedPayload;

        const postingDate = datetime
          .today(await getCompanyTimeZone(db, companyId))
          .toString();

        await db.transaction().execute(async (trx) => {
          // Get the maintenance dispatch to find the location
          const dispatch = await trx
            .selectFrom("maintenanceDispatch")
            .where("id", "=", maintenanceDispatchId)
            .where("companyId", "=", companyId)
            .select([
              "id",
              "maintenanceDispatchId",
              "workCenterId",
              "locationId"
            ])
            .executeTakeFirstOrThrow();

          const locationId = dispatch.locationId;

          // Get item details
          const item = await trx
            .selectFrom("item")
            .where("id", "=", itemId)
            .where("companyId", "=", companyId)
            .select(["id", "itemTrackingType"])
            .executeTakeFirstOrThrow();

          // Create the dispatch item
          const dispatchItem = await trx
            .insertInto("maintenanceDispatchItem")
            .values({
              maintenanceDispatchId,
              itemId,
              unitOfMeasureCode,
              quantity,
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          // Only create item ledger entry for non-tracked items (not Serial or Batch)
          if (
            item.itemTrackingType !== "Serial" &&
            item.itemTrackingType !== "Batch"
          ) {
            // Get storage unit with highest quantity for this item at this location
            const storageUnitId = locationId
              ? await getStorageUnitWithHighestQuantity(trx, itemId, locationId)
              : null;

            await trx
              .insertInto("itemLedger")
              .values({
                entryType: "Consumption",
                documentType: "Maintenance Consumption",
                documentId: dispatch.id,
                documentLineId: dispatchItem.id,
                companyId,
                itemId,
                quantity: -quantity,
                locationId,
                storageUnitId,
                createdBy: userId
              })
              .execute();

            await valueMaintenanceMovements(trx, {
              dispatch,
              movements: [{ itemId, quantity: -quantity }],
              postingDate,
              companyId,
              userId
            });

            // Update pickMethod defaultStorageUnitId if needed
            if (locationId) {
              await updatePickMethodDefaultStorageUnitIfNeeded(
                trx,
                itemId,
                locationId,
                storageUnitId,
                companyId,
                userId
              );
            }
          }
        });

        return {
          success: true,
          message: "Material issued successfully"
        };
      }
      case "maintenanceDispatchTrackedEntities": {
        const {
          maintenanceDispatchId,
          itemId,
          unitOfMeasureCode,
          children,
          overrideExpired,
          overrideReason,
          companyId,
          userId
        } = validatedPayload;

        if (children.length === 0) {
          throw new Error("At least one tracked entity is required");
        }

        let expiredWarning: string | undefined;
        const companyToday = datetime.today(
          await getCompanyTimeZone(db, companyId)
        );

        const splitEntities = await db.transaction().execute(async (trx) => {
          // Get the maintenance dispatch to find the location
          const dispatch = await trx
            .selectFrom("maintenanceDispatch")
            .where("id", "=", maintenanceDispatchId)
            .where("companyId", "=", companyId)
            .select([
              "id",
              "maintenanceDispatchId",
              "workCenterId",
              "locationId"
            ])
            .executeTakeFirstOrThrow();

          const locationId = dispatch.locationId;

          // Calculate total quantity from children
          const totalQuantity = children.reduce(
            (sum, child) => sum + Number(child.quantity),
            0
          );

          // Create the dispatch item
          const dispatchItem = await trx
            .insertInto("maintenanceDispatchItem")
            .values({
              maintenanceDispatchId,
              itemId,
              unitOfMeasureCode,
              quantity: totalQuantity,
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          // Get tracked entities
          const trackedEntities = await trx
            .selectFrom("trackedEntity")
            .where(
              "id",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .where("companyId", "=", companyId)
            .selectAll()
            .execute();

          // Get item ledgers for these tracked entities
          const itemLedgers = await trx
            .selectFrom("itemLedger")
            .where(
              "trackedEntityId",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .orderBy("createdAt", "desc")
            .selectAll()
            .execute();

          if (trackedEntities.length !== children.length) {
            throw new NotFoundError("Some tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Available")) {
            throw new Error("Some tracked entities are not available");
          }

          // Expiry policy gate.
          const expiredPolicy = await getExpiredEntityPolicy(trx, companyId);
          const expiredCheck = checkExpiredEntities(
            trackedEntities.map((e) => ({
              id: e.id,
              expirationDate: e.expirationDate
            })),
            expiredPolicy,
            { allowed: !!overrideExpired, reason: overrideReason ?? null },
            companyToday
          );
          if (!expiredCheck.ok) {
            throw new Error(expiredCheck.reason);
          }
          if (expiredCheck.warning) {
            expiredWarning = expiredCheck.warning;
          }

          // Get item details
          const item = await trx
            .selectFrom("item")
            .where("id", "=", itemId)
            .where("companyId", "=", companyId)
            .select(["id", "readableIdWithRevision"])
            .executeTakeFirstOrThrow();

          const maintenanceDispatchItemId = dispatchItem.id;

          // Create tracked activity
          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Consume",
              sourceDocument: "Maintenance Dispatch Item",
              sourceDocumentId: maintenanceDispatchItemId,
              sourceDocumentReadableId: item.readableIdWithRevision ?? "",
              attributes: {
                "Maintenance Dispatch": dispatch.maintenanceDispatchId,
                "Maintenance Dispatch Item": dispatchItem.id,
                Employee: userId
              },
              companyId,
              createdBy: userId
            })
            .execute();

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          const trackedActivityInputs: Database["public"]["Tables"]["trackedActivityInput"]["Insert"][] =
            [];
          const junctionInserts: {
            maintenanceDispatchItemId: string;
            trackedEntityId: string;
            quantity: number;
            companyId: string;
            createdBy: string;
          }[] = [];

          const splitEntities: Array<{
            originalId: string;
            newId: string;
            readableId: string;
            quantity: number;
            remainingQuantity: number;
          }> = [];

          // Process each child tracked entity
          for (const child of children) {
            const trackedEntity = trackedEntities.find(
              (entity) => entity.id === child.trackedEntityId
            );
            if (!trackedEntity) {
              throw new NotFoundError("Tracked entity not found");
            }
            const { trackedEntityId } = child;

            // Same canonical quantity as the job-consumption loop above: a
            // full draw books the lot's own rounded on-hand.
            const entityQuantity = round(Number(trackedEntity.quantity));
            const fullDraw = isFullDraw(entityQuantity, child.quantity);
            const quantity = fullDraw ? entityQuantity : round(child.quantity);

            // Book against the entity's ACTUAL bin (net on-hand), not an
            // arbitrary first ledger row — aligns with the job-consumption
            // path above.
            const entityBin = resolveTrackedEntityBin(
              itemLedgers,
              trackedEntityId
            );

            // Partial consume → split: the lineside entity keeps its id and
            // is decremented; a NEW child entity carries the consumed
            // quantity. EVERYTHING below (Consumed status, Consume input,
            // Maintenance Consumption ledger, junction row) books against
            // the child.
            let consumedEntityId = trackedEntityId;
            if (!fullDraw) {
              const consumedChildId = nanoid();
              consumedEntityId = consumedChildId;

              const split = buildBatchSplitRecords({
                parent: {
                  id: trackedEntity.id!,
                  readableId: trackedEntity.readableId,
                  quantity: entityQuantity,
                  sourceDocument: trackedEntity.sourceDocument,
                  sourceDocumentId: trackedEntity.sourceDocumentId,
                  sourceDocumentReadableId:
                    trackedEntity.sourceDocumentReadableId,
                  itemId:
                    trackedEntity.itemId ?? trackedEntity.sourceDocumentId,
                  expirationDate: trackedEntity.expirationDate ?? null,
                  attributes: trackedEntity.attributes as Record<
                    string,
                    unknown
                  > | null
                },
                drawQuantity: quantity,
                childId: consumedChildId,
                splitActivityId: nanoid(),
                activitySourceDocument: "Maintenance Dispatch Item",
                activitySourceDocumentId: maintenanceDispatchItemId,
                bin: {
                  storageUnitId: entityBin,
                  locationId
                },
                itemLedgerItemId: trackedEntity.sourceDocumentId,
                companyId,
                userId,
                postingDate: companyToday.toString(),
                // Created Available; the shared status update below flips the
                // child to Consumed in the same transaction.
                childStatus: "Available"
              });

              splitEntities.push({
                originalId: trackedEntityId,
                newId: consumedChildId,
                readableId: trackedEntity.sourceDocumentReadableId ?? "",
                quantity,
                remainingQuantity: split.parentUpdate.quantity
              });

              await trx
                .insertInto("trackedActivity")
                .values(
                  split.activityInsert as Insertable<
                    KyselyDatabase["trackedActivity"]
                  >
                )
                .execute();

              await trx
                .insertInto("trackedEntity")
                .values(
                  split.childEntityInsert as Insertable<
                    KyselyDatabase["trackedEntity"]
                  >
                )
                .execute();

              await trx
                .insertInto("trackedActivityInput")
                .values(split.activityInputInsert)
                .execute();

              await trx
                .insertInto("trackedActivityOutput")
                .values(split.activityOutputInsert)
                .execute();

              await trx
                .updateTable("trackedEntity")
                .set(split.parentUpdate)
                .where("id", "=", trackedEntityId)
                .where("companyId", "=", companyId)
                .execute();

              itemLedgerInserts.push(
                ...(split.ledgerInserts as ItemLedgerInsert[])
              );
            }

            // Consume the drawn entity — the split child, or the whole
            // entity on a full draw.
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Consumed"
              })
              .where("id", "=", consumedEntityId)
              .where("companyId", "=", companyId)
              .execute();

            trackedActivityInputs.push({
              trackedActivityId: activityId,
              trackedEntityId: consumedEntityId,
              quantity,
              companyId,
              createdBy: userId
            });

            // Add junction table entry
            junctionInserts.push({
              maintenanceDispatchItemId,
              trackedEntityId: consumedEntityId,
              quantity,
              companyId,
              createdBy: userId
            });

            itemLedgerInserts.push({
              entryType: "Consumption",
              documentType: "Maintenance Consumption",
              documentId: dispatch.id,
              documentLineId: maintenanceDispatchItemId,
              companyId,
              itemId: trackedEntity.sourceDocumentId,
              quantity: -quantity,
              locationId,
              // The split child has no rows in the pre-transaction ledger
              // snapshot — it sits at the parent's resolved bin.
              storageUnitId: entityBin,
              trackedEntityId: consumedEntityId,
              createdBy: userId
            });
          }

          if (trackedActivityInputs.length > 0) {
            await trx
              .insertInto("trackedActivityInput")
              .values(trackedActivityInputs)
              .execute();
          }

          if (junctionInserts.length > 0) {
            await trx
              .insertInto("maintenanceDispatchItemTrackedEntity")
              .values(junctionInserts)
              .execute();
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();

            // Only the consumption rows carry value; batch-split legs move
            // stock between entities at the same bin.
            await valueMaintenanceMovements(trx, {
              dispatch,
              movements: itemLedgerInserts
                .filter((l) => l.documentType === "Maintenance Consumption")
                .map((l) => ({
                  itemId: l.itemId,
                  quantity: Number(l.quantity)
                })),
              postingDate: companyToday.toString(),
              companyId,
              userId
            });

            // Update pickMethod defaultStorageUnitId if needed
            for (const ledger of itemLedgerInserts) {
              await updatePickMethodDefaultStorageUnitIfNeeded(
                trx,
                ledger.itemId,
                ledger.locationId,
                ledger.storageUnitId,
                companyId,
                userId
              );
            }
          }

          return splitEntities;
        });

        return {
          success: true,
          message: "Material issued successfully",
          splitEntities,
          warning: expiredWarning
        };
      }
      case "maintenanceDispatchUnconsume": {
        const { maintenanceDispatchItemId, children, companyId, userId } =
          validatedPayload;

        if (children.length === 0) {
          throw new Error("At least one tracked entity is required");
        }

        const postingDate = datetime
          .today(await getCompanyTimeZone(db, companyId))
          .toString();

        await db.transaction().execute(async (trx) => {
          // Get the maintenance dispatch item with related data
          const dispatchItem = await trx
            .selectFrom("maintenanceDispatchItem")
            .where("id", "=", maintenanceDispatchItemId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          // Get the maintenance dispatch to find the location
          const dispatch = await trx
            .selectFrom("maintenanceDispatch")
            .where("id", "=", dispatchItem.maintenanceDispatchId)
            .select([
              "id",
              "maintenanceDispatchId",
              "workCenterId",
              "locationId"
            ])
            .executeTakeFirstOrThrow();

          const locationId = dispatch.locationId;

          // Get tracked entities
          const trackedEntities = await trx
            .selectFrom("trackedEntity")
            .where(
              "id",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .where("companyId", "=", companyId)
            .selectAll()
            .execute();

          // Get item ledgers for these tracked entities
          const itemLedgers = await trx
            .selectFrom("itemLedger")
            .where(
              "trackedEntityId",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .orderBy("createdAt", "desc")
            .selectAll()
            .execute();

          if (trackedEntities.length !== children.length) {
            throw new NotFoundError("Some tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Consumed")) {
            throw new Error("Some tracked entities are not in consumed status");
          }

          // Get item details
          const item = await trx
            .selectFrom("item")
            .where("id", "=", dispatchItem.itemId)
            .select(["id", "readableIdWithRevision"])
            .executeTakeFirstOrThrow();

          // Create tracked activity for unconsume
          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Unconsume",
              sourceDocument: "Maintenance Dispatch Item",
              sourceDocumentId: maintenanceDispatchItemId,
              sourceDocumentReadableId: item.readableIdWithRevision ?? "",
              attributes: {
                "Maintenance Dispatch": dispatch.maintenanceDispatchId,
                "Maintenance Dispatch Item": dispatchItem.id,
                Employee: userId
              },
              companyId,
              createdBy: userId
            })
            .execute();

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          const trackedActivityOutputs: Database["public"]["Tables"]["trackedActivityOutput"]["Insert"][] =
            [];

          // Process each child tracked entity
          for (const child of children) {
            const trackedEntity = trackedEntities.find(
              (entity) => entity.id === child.trackedEntityId
            );
            if (!trackedEntity) {
              throw new NotFoundError("Tracked entity not found");
            }
            const { trackedEntityId, quantity } = child;

            // Update tracked entity status back to Available
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available"
              })
              .where("id", "=", trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();

            trackedActivityOutputs.push({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId
            });

            // Remove from junction table
            await trx
              .deleteFrom("maintenanceDispatchItemTrackedEntity")
              .where(
                "maintenanceDispatchItemId",
                "=",
                maintenanceDispatchItemId
              )
              .where("trackedEntityId", "=", trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();

            // Create reverse item ledger entry (positive to return to inventory)
            const existingLedger = itemLedgers.find(
              (l) => l.trackedEntityId === trackedEntityId
            );

            itemLedgerInserts.push({
              entryType: "Consumption",
              documentType: "Maintenance Consumption",
              documentId: dispatch.id,
              documentLineId: maintenanceDispatchItemId,
              companyId,
              itemId: trackedEntity.sourceDocumentId,
              quantity: quantity, // Positive to return to inventory
              locationId,
              storageUnitId: existingLedger?.storageUnitId,
              trackedEntityId,
              createdBy: userId
            });
          }

          if (trackedActivityOutputs.length > 0) {
            await trx
              .insertInto("trackedActivityOutput")
              .values(trackedActivityOutputs)
              .execute();
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();

            await valueMaintenanceMovements(trx, {
              dispatch,
              movements: itemLedgerInserts.map((l) => ({
                itemId: l.itemId,
                quantity: Number(l.quantity)
              })),
              postingDate,
              companyId,
              userId
            });

            // Update pickMethod defaultStorageUnitId if needed
            for (const ledger of itemLedgerInserts) {
              await updatePickMethodDefaultStorageUnitIfNeeded(
                trx,
                ledger.itemId,
                ledger.locationId,
                ledger.storageUnitId,
                companyId,
                userId
              );
            }
          }

          // Update the dispatch item quantity
          const totalChildQuantity = roundedChildTotal(children);

          const currentQuantity = round(Number(dispatchItem.quantity) || 0);
          const newQuantity = Math.max(
            0,
            round(currentQuantity - totalChildQuantity)
          );

          await trx
            .updateTable("maintenanceDispatchItem")
            .set({
              quantity: newQuantity,
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
            .where("id", "=", maintenanceDispatchItemId)
            .where("companyId", "=", companyId)
            .execute();
        });

        return {
          success: true,
          message: "Material unconsumed successfully"
        };
      }
      case "maintenanceDispatchUnissue": {
        const { maintenanceDispatchItemId, companyId, userId } =
          validatedPayload;

        const postingDate = datetime
          .today(await getCompanyTimeZone(db, companyId))
          .toString();

        await db.transaction().execute(async (trx) => {
          // Get the maintenance dispatch item
          const dispatchItem = await trx
            .selectFrom("maintenanceDispatchItem")
            .where("id", "=", maintenanceDispatchItemId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          // Get the maintenance dispatch to find the location
          const dispatch = await trx
            .selectFrom("maintenanceDispatch")
            .where("id", "=", dispatchItem.maintenanceDispatchId)
            .select([
              "id",
              "maintenanceDispatchId",
              "workCenterId",
              "locationId"
            ])
            .executeTakeFirstOrThrow();

          const locationId = dispatch.locationId;

          // Get item details
          const item = await trx
            .selectFrom("item")
            .where("id", "=", dispatchItem.itemId)
            .select(["id", "itemTrackingType", "readableIdWithRevision"])
            .executeTakeFirstOrThrow();

          // Check if this has tracked entities
          const trackedEntityJunctions = await trx
            .selectFrom("maintenanceDispatchItemTrackedEntity")
            .where("maintenanceDispatchItemId", "=", maintenanceDispatchItemId)
            .selectAll()
            .execute();

          if (trackedEntityJunctions.length > 0) {
            // Handle tracked entities - unconsume them
            const trackedEntityIds = trackedEntityJunctions.map(
              (j) => j.trackedEntityId
            );

            // Get tracked entities
            const trackedEntities = await trx
              .selectFrom("trackedEntity")
              .where("id", "in", trackedEntityIds)
              .selectAll()
              .execute();

            // Get item ledgers for these tracked entities
            const itemLedgers = await trx
              .selectFrom("itemLedger")
              .where("trackedEntityId", "in", trackedEntityIds)
              .orderBy("createdAt", "desc")
              .selectAll()
              .execute();

            // Create tracked activity for unconsume
            const activityId = nanoid();
            await trx
              .insertInto("trackedActivity")
              .values({
                id: activityId,
                type: "Unconsume",
                sourceDocument: "Maintenance Dispatch Item",
                sourceDocumentId: maintenanceDispatchItemId,
                sourceDocumentReadableId: item.readableIdWithRevision ?? "",
                attributes: {
                  "Maintenance Dispatch": dispatch.maintenanceDispatchId,
                  "Maintenance Dispatch Item": dispatchItem.id,
                  Employee: userId
                },
                companyId,
                createdBy: userId
              })
              .execute();

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const trackedActivityOutputs: Database["public"]["Tables"]["trackedActivityOutput"]["Insert"][] =
              [];

            // Process each tracked entity
            for (const junction of trackedEntityJunctions) {
              const trackedEntity = trackedEntities.find(
                (e) => e.id === junction.trackedEntityId
              );
              if (!trackedEntity) continue;

              const quantity = Number(junction.quantity);

              // Update tracked entity status back to Available
              await trx
                .updateTable("trackedEntity")
                .set({ status: "Available" })
                .where("id", "=", junction.trackedEntityId)
                .where("companyId", "=", companyId)
                .execute();

              trackedActivityOutputs.push({
                trackedActivityId: activityId,
                trackedEntityId: junction.trackedEntityId,
                quantity,
                companyId,
                createdBy: userId
              });

              // Create reverse item ledger entry (positive to return to inventory)
              const existingLedger = itemLedgers.find(
                (l) => l.trackedEntityId === junction.trackedEntityId
              );

              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Maintenance Consumption",
                documentId: dispatch.id,
                documentLineId: maintenanceDispatchItemId,
                companyId,
                itemId: trackedEntity.sourceDocumentId,
                quantity: quantity, // Positive to return to inventory
                locationId,
                storageUnitId: existingLedger?.storageUnitId,
                trackedEntityId: junction.trackedEntityId,
                createdBy: userId
              });
            }

            // Delete junction entries
            await trx
              .deleteFrom("maintenanceDispatchItemTrackedEntity")
              .where(
                "maintenanceDispatchItemId",
                "=",
                maintenanceDispatchItemId
              )
              .where("companyId", "=", companyId)
              .execute();

            if (trackedActivityOutputs.length > 0) {
              await trx
                .insertInto("trackedActivityOutput")
                .values(trackedActivityOutputs)
                .execute();
            }

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .execute();

              await valueMaintenanceMovements(trx, {
                dispatch,
                movements: itemLedgerInserts.map((l) => ({
                  itemId: l.itemId,
                  quantity: Number(l.quantity)
                })),
                postingDate,
                companyId,
                userId
              });
            }
          } else if (
            item.itemTrackingType !== "Serial" &&
            item.itemTrackingType !== "Batch"
          ) {
            // Handle inventory items - create positive ledger entry to return to inventory
            const quantity = Number(dispatchItem.quantity);

            if (quantity > 0) {
              // Find the storage unit from the original consumption ledger entry
              const originalLedger = await trx
                .selectFrom("itemLedger")
                .where("documentLineId", "=", maintenanceDispatchItemId)
                .where("documentType", "=", "Maintenance Consumption")
                .orderBy("createdAt", "desc")
                .selectAll()
                .executeTakeFirst();

              await trx
                .insertInto("itemLedger")
                .values({
                  entryType: "Consumption",
                  documentType: "Maintenance Consumption",
                  documentId: dispatch.id,
                  documentLineId: maintenanceDispatchItemId,
                  companyId,
                  itemId: dispatchItem.itemId,
                  quantity: quantity, // Positive to return to inventory
                  locationId,
                  storageUnitId: originalLedger?.storageUnitId,
                  createdBy: userId
                })
                .execute();

              await valueMaintenanceMovements(trx, {
                dispatch,
                movements: [{ itemId: dispatchItem.itemId, quantity }],
                postingDate,
                companyId,
                userId
              });
            }
          }

          // Delete the dispatch item
          await trx
            .deleteFrom("maintenanceDispatchItem")
            .where("id", "=", maintenanceDispatchItemId)
            .where("companyId", "=", companyId)
            .execute();
        });

        return {
          success: true,
          message: "Item unissued and removed successfully"
        };
      }
    }

    return {
      success: true,
      message: "x"
    };
  }
});

export default issue;
