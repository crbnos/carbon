import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { getLocalTimeZone, parseDate, today } from "npm:@internationalized/date";
import { Transaction } from "kysely";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/nanoid.ts";
import { corsHeaders } from "../lib/headers.ts";
import {
  getStorageUnitWithHighestQuantity,
  updatePickMethodDefaultStorageUnitIfNeeded,
} from "../lib/storage-units.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { TrackedEntityAttributes, credit, debit, journalReference } from "../lib/utils.ts";

import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import { calculateCOGS } from "../shared/calculate-cogs.ts";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

type InventoryShelfLifeSettings = {
  expiredEntityPolicy?: ExpiredEntityPolicy;
};

/**
 * Resolve the company's expired-entity policy from companySettings JSONB.
 * Defaults to 'Block' when the row or key is absent so the safe behavior
 * is the default.
 */
async function getExpiredEntityPolicy(
  trx: Transaction<DB>,
  companyId: string
): Promise<ExpiredEntityPolicy> {
  const row = await trx
    .selectFrom("companySettings")
    .select("inventoryShelfLife")
    .where("id", "=", companyId)
    .executeTakeFirst();
  const blob = (row?.inventoryShelfLife ??
    null) as InventoryShelfLifeSettings | null;
  return blob?.expiredEntityPolicy ?? "Block";
}

/**
 * Apply the policy to a list of trackedEntity rows about to be consumed.
 * Returns:
 *   { ok: true }                 - no expiries, or warn-only with no expired
 *   { ok: true, warning }        - warn-only, with expired ids in the message
 *   { ok: false, reason }        - block (or block-without-override), caller
 *                                  should raise an error and refuse the op
 *
 * Caller is responsible for the override flow:
 *   - In 'BlockWithOverride' mode, if the request payload supplies
 *     overrideExpired=true + overrideReason, treat the result as ok and
 *     emit an audit-log row.
 */
function checkExpiredEntities(
  entities: { id: string; expirationDate: string | null }[],
  policy: ExpiredEntityPolicy,
  override: { allowed: boolean; reason: string | null }
): { ok: true; warning?: string } | { ok: false; reason: string } {
  const todayLocal = today(getLocalTimeZone());
  const expired = entities.filter((e) => {
    if (!e.expirationDate) return false;
    try {
      return parseDate(e.expirationDate).compare(todayLocal) < 0;
    } catch {
      return false;
    }
  });
  if (expired.length === 0) return { ok: true };

  const ids = expired.map((e) => e.id).join(", ");

  if (policy === "Warn") {
    return {
      ok: true,
      warning: `Consumed ${expired.length} expired tracked entit${
        expired.length === 1 ? "y" : "ies"
      }: ${ids}`,
    };
  }

  if (
    policy === "BlockWithOverride" &&
    override.allowed &&
    override.reason &&
    override.reason.trim().length > 0
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `Cannot consume expired tracked entit${
      expired.length === 1 ? "y" : "ies"
    }: ${ids}`,
  };
}

async function issueJobOperationMaterials(
  trx: Transaction<DB>,
  {
    jobOperationId,
    quantity,
    companyId,
    userId,
    accountingEnabled,
    accountDefaults,
    dimensionMap,
    client,
    db,
  }: {
    jobOperationId: string;
    quantity: number;
    companyId: string;
    userId: string;
    accountingEnabled: boolean;
    accountDefaults: any;
    dimensionMap: Map<string, string>;
    client: any;
    db: any;
  }
) {
  const materialsToIssue = await trx
    .selectFrom("jobMaterial")
    .where("jobOperationId", "=", jobOperationId)
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

  if (materialsToIssue.length === 0) return;

  const jobId = materialsToIssue[0].jobId;

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
      .execute(),
  ]);

  if (!job?.locationId) {
    throw new Error("Job location is required");
  }

  const itemIdIsTracked = new Map(
    items.map((item) => [item.id, item.itemTrackingType === "Inventory"])
  );

  const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
    [];

  for await (const material of materialsToIssue) {

    const quantityToIssue = Number(material.quantity) * quantity;

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

        proposedStorageUnitId = pickMethod?.defaultStorageUnitId;

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
      .select([
        "storageUnitId",
        (eb) => eb.fn.sum("quantity").as("quantity"),
      ])
      .where("itemId", "=", material.itemId)
      .where("locationId", "=", job.locationId!)
      .groupBy("storageUnitId")
      .having((eb) => eb.fn.sum("quantity"), ">", 0)
      .execute();

    let finalStorageUnitId = proposedStorageUnitId;
    const currentQuantity = Number(currentStorageUnitQuantity?.quantity ?? 0);

    if (
      currentQuantity < quantityToIssue &&
      allStorageUnitQuantities.length > 0
    ) {
      const bestStorageUnit = allStorageUnitQuantities.reduce((best, current) =>
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
        quantity: -quantityToIssue,
        locationId: job.locationId,
        storageUnitId: finalStorageUnitId,
        createdBy: userId,
      });
    }

    await trx
      .updateTable("jobMaterial")
      .set({
        quantityIssued:
          (Number(material.quantityIssued) ?? 0) + quantityToIssue,
      })
      .where("id", "=", material.id)
      .execute();
  }

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

  if (accountingEnabled && accountDefaults?.data && itemLedgerInserts.length > 0) {
    const journalLineInserts: {
      accountId: string;
      description: string;
      amount: number;
      quantity: number;
      documentType: string;
      documentId: string;
      documentLineReference: string;
      journalLineReference: string;
      companyId: string;
    }[] = [];

    const journalLineDimensionsMeta: {
      itemPostingGroupId: string | null;
      locationId: string | null;
    }[] = [];

    const jobForLocation = await trx
      .selectFrom("job")
      .where("id", "=", jobId)
      .select(["locationId"])
      .executeTakeFirst();

    const consumedItemIds = [...new Set(itemLedgerInserts.map((l) => l.itemId))];
    const consumedItemCosts = consumedItemIds.length > 0
      ? await trx
          .selectFrom("itemCost")
          .where("itemId", "in", consumedItemIds)
          .where("companyId", "=", companyId)
          .select(["itemId", "itemPostingGroupId"])
          .execute()
      : [];
    const consumedPostingGroupMap = new Map(
      consumedItemCosts.map((ic) => [ic.itemId, ic.itemPostingGroupId])
    );

    for (const ledger of itemLedgerInserts) {
      const materialQuantity = Math.abs(Number(ledger.quantity));
      if (materialQuantity === 0) continue;

      const cogsResult = await calculateCOGS(trx, {
        itemId: ledger.itemId,
        quantity: materialQuantity,
        companyId,
      });

      const journalLineReference = nanoid();

      journalLineInserts.push({
        accountId: accountDefaults.data.workInProgressAccount,
        description: "WIP Account",
        amount: debit("asset", cogsResult.totalCost),
        quantity: materialQuantity,
        documentType: "Job Consumption",
        documentId: jobId,
        documentLineReference: journalReference.to.materialIssue(jobOperationId),
        journalLineReference,
        companyId,
      });

      journalLineInserts.push({
        accountId: accountDefaults.data.inventoryAccount,
        description: "Inventory Account",
        amount: credit("asset", cogsResult.totalCost),
        quantity: materialQuantity,
        documentType: "Job Consumption",
        documentId: jobId,
        documentLineReference: journalReference.to.materialIssue(jobOperationId),
        journalLineReference,
        companyId,
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
          companyId,
        })
        .execute();

      for (let i = 0; i < 2; i++) {
        journalLineDimensionsMeta.push({
          itemPostingGroupId: consumedPostingGroupMap.get(ledger.itemId) ?? null,
          locationId: jobForLocation?.locationId ?? null,
        });
      }
    }

    if (journalLineInserts.length > 0) {
      const accountingPeriodId = await getCurrentAccountingPeriod(client, companyId, db);
      const journalEntryId = await getNextSequence(trx, "journalEntry", companyId);

      const journalResult = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          accountingPeriodId,
          description: `Material Issue to Job ${job?.jobId ?? jobId}`,
          postingDate: new Date().toISOString().slice(0, 10),
          companyId,
          sourceType: "Job Consumption",
          status: "Posted",
          postedAt: new Date().toISOString(),
          postedBy: userId,
          createdBy: userId,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const journalLineResults = await trx
        .insertInto("journalLine")
        .values(
          journalLineInserts.map((line) => ({
            ...line,
            journalId: journalResult.id,
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
              companyId,
            });
          }
          if (meta.locationId && dimensionMap.has("Location")) {
            dimensionInserts.push({
              journalLineId: jl.id,
              dimensionId: dimensionMap.get("Location")!,
              valueId: meta.locationId,
              companyId,
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
}

async function createMaterialWipEntries(
  trx: Transaction<DB>,
  args: {
    consumptionLedgers: Array<{ itemId: string; quantity: number }>;
    jobId: string;
    operationId: string;
    description: string;
    wipAccount: string;
    inventoryAccount: string;
    dimensionMap: Map<string, string>;
    jobLocationId: string | null;
    client: any;
    db: any;
    companyId: string;
    userId: string;
  }
) {
  const {
    consumptionLedgers, jobId, operationId, description,
    wipAccount, inventoryAccount,
    dimensionMap, jobLocationId,
    client, db, companyId, userId,
  } = args;

  const journalLineInserts: {
    accountId: string;
    description: string;
    amount: number;
    quantity: number;
    documentType: string;
    documentId: string;
    documentLineReference: string;
    journalLineReference: string;
    companyId: string;
  }[] = [];

  const journalLineDimensionsMeta: {
    itemPostingGroupId: string | null;
    locationId: string | null;
  }[] = [];

  const uniqueItemIds = [...new Set(consumptionLedgers.map((l) => l.itemId))];
  const consumedItemCosts = uniqueItemIds.length > 0
    ? await trx
        .selectFrom("itemCost")
        .where("itemId", "in", uniqueItemIds)
        .where("companyId", "=", companyId)
        .select(["itemId", "itemPostingGroupId"])
        .execute()
    : [];
  const consumedPostingGroupMap = new Map(
    consumedItemCosts.map((ic) => [ic.itemId, ic.itemPostingGroupId])
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
          companyId,
        },
        {
          accountId: inventoryAccount,
          description: "Inventory Account",
          amount: credit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId,
        }
      );
    } else {
      journalLineInserts.push(
        {
          accountId: inventoryAccount,
          description: "Inventory Account",
          amount: debit("asset", cost),
          quantity: absQty,
          documentType: "Job Consumption",
          documentId: jobId,
          documentLineReference: journalReference.to.materialIssue(operationId),
          journalLineReference: jlRef,
          companyId,
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
          companyId,
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
        companyId,
      })
      .execute();

    for (let i = 0; i < 2; i++) {
      journalLineDimensionsMeta.push({
        itemPostingGroupId: consumedPostingGroupMap.get(ledger.itemId) ?? null,
        locationId: jobLocationId,
      });
    }
  }

  if (journalLineInserts.length === 0) return;

  const accountingPeriodId = await getCurrentAccountingPeriod(client, companyId, db);
  const journalEntryId = await getNextSequence(trx, "journalEntry", companyId);

  const journalResult = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      accountingPeriodId,
      description,
      postingDate: new Date().toISOString().slice(0, 10),
      companyId,
      sourceType: "Job Consumption",
      status: "Posted",
      postedAt: new Date().toISOString(),
      postedBy: userId,
      createdBy: userId,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  const journalLineResults = await trx
    .insertInto("journalLine")
    .values(
      journalLineInserts.map((line) => ({
        ...line,
        journalId: journalResult.id,
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
          companyId,
        });
      }
      if (meta.locationId && dimensionMap.has("Location")) {
        dimensionInserts.push({
          journalLineId: jl.id,
          dimensionId: dimensionMap.get("Location")!,
          valueId: meta.locationId,
          companyId,
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

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("convertEntity"),
    trackedEntityId: z.string(),
    newRevision: z.string(),
    quantity: z.number().positive().default(1),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("jobCompleteMakeToOrder"),
    jobId: z.string(),
    quantityComplete: z.number(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("jobOperation"),
    quantity: z.number(),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("jobOperationBatchComplete"),
    trackedEntityId: z.string(),
    companyId: z.string(),
    userId: z.string(),
    quantity: z.number(),
    jobOperationId: z.string(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional(),
  }),
  z.object({
    type: z.literal("jobOperationSerialComplete"),
    trackedEntityId: z.string(),
    companyId: z.string(),
    userId: z.string(),
    quantity: z.number(),
    jobOperationId: z.string(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional(),
  }),
  z.object({
    type: z.literal("partToOperation"),
    id: z.string(),
    itemId: z.string(),
    quantity: z.number(),
    adjustmentType: z.enum([
      "Set Quantity",
      "Positive Adjmt.",
      "Negative Adjmt.",
    ]),
    materialId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("scrapTrackedEntity"),
    trackedEntityId: z.string(),
    materialId: z.string(),
    parentTrackedEntityId: z.string(),
    companyId: z.string(),
    userId: z.string(),
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
        quantity: z.number(),
      })
    ),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("unconsumeTrackedEntities"),
    materialId: z.string(),
    parentTrackedEntityId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number(),
      })
    ),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("maintenanceDispatchInventory"),
    maintenanceDispatchId: z.string(),
    itemId: z.string(),
    unitOfMeasureCode: z.string(),
    quantity: z.number(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("maintenanceDispatchTrackedEntities"),
    maintenanceDispatchId: z.string(),
    itemId: z.string(),
    unitOfMeasureCode: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number(),
      })
    ),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("maintenanceDispatchUnconsume"),
    maintenanceDispatchItemId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number(),
      })
    ),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("maintenanceDispatchUnissue"),
    maintenanceDispatchItemId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();
  console.log({ payload });

  try {
    const validatedPayload = payloadValidator.parse(payload);

    console.log({
      function: "issue",
      ...validatedPayload,
    });

    const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
      [];

    switch (validatedPayload.type) {
      case "jobOperation": {
        const { id, companyId, quantity, userId } = validatedPayload;

        const client = await requirePermissions(req, companyId, userId, { update: "production" });

        const [accountingSettings, companyRecord] = await Promise.all([
          client
            .from("companySettings")
            .select("accountingEnabled")
            .eq("id", companyId)
            .single(),
          client.from("company").select("companyGroupId").eq("id", companyId).single(),
        ]);
        if (companyRecord.error) throw new Error("Failed to fetch company");
        const accountingEnabled = accountingSettings.data?.accountingEnabled ?? false;

        const accountDefaults = accountingEnabled
          ? await getDefaultPostingGroup(client, companyId)
          : null;
        if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
          throw new Error("Error getting account defaults");
        }

        const dimensions = accountingEnabled
          ? await client
              .from("dimension")
              .select("id, entityType")
              .eq("companyGroupId", companyRecord.data.companyGroupId)
              .eq("active", true)
              .in("entityType", ["ItemPostingGroup", "Location"])
          : null;

        const dimensionMap = new Map<string, string>();
        if (dimensions?.data) {
          for (const dim of dimensions.data) {
            if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
          }
        }

        await db.transaction().execute(async (trx) => {
          await issueJobOperationMaterials(trx, {
            jobOperationId: id,
            quantity,
            companyId,
            userId,
            accountingEnabled,
            accountDefaults: accountDefaults?.data ? accountDefaults : null,
            dimensionMap,
            client,
            db,
          });
        });

        break;
      }
      case "jobOperationBatchComplete": {
        const { trackedEntityId, companyId, userId, ...row } = validatedPayload;
        const client = await requirePermissions(req, companyId, userId, { update: "production" });

        const [jobOperation, productionQuantities] = await Promise.all([
          client
            .from("jobOperation")
            .select("*")
            .eq("id", row.jobOperationId)
            .single(),
          client
            .from("productionQuantity")
            .select("*")
            .eq("jobOperationId", row.jobOperationId)
            .eq("type", "Production"),
        ]);

        if (!jobOperation.data || !jobOperation.data.jobMakeMethodId) {
          throw new Error("Job operation not found");
        }

        const [accountingSettingsBatch, companyRecordBatch] = await Promise.all([
          client
            .from("companySettings")
            .select("accountingEnabled")
            .eq("id", companyId)
            .single(),
          client.from("company").select("companyGroupId").eq("id", companyId).single(),
        ]);
        if (companyRecordBatch.error) throw new Error("Failed to fetch company");
        const accountingEnabledBatch = accountingSettingsBatch.data?.accountingEnabled ?? false;

        const accountDefaultsBatch = accountingEnabledBatch
          ? await getDefaultPostingGroup(client, companyId)
          : null;
        if (accountingEnabledBatch && (accountDefaultsBatch?.error || !accountDefaultsBatch?.data)) {
          throw new Error("Error getting account defaults");
        }

        const dimensionsBatch = accountingEnabledBatch
          ? await client
              .from("dimension")
              .select("id, entityType")
              .eq("companyGroupId", companyRecordBatch.data.companyGroupId)
              .eq("active", true)
              .in("entityType", ["ItemPostingGroup", "Location"])
          : null;

        const dimensionMapBatch = new Map<string, string>();
        if (dimensionsBatch?.data) {
          for (const dim of dimensionsBatch.data) {
            if (dim.entityType) dimensionMapBatch.set(dim.entityType, dim.id);
          }
        }

        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto("productionQuantity")
            .values({
              ...row,
              type: "Production",
              companyId,
              createdBy: userId,
            })
            .executeTakeFirst();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .selectAll()
            .executeTakeFirst();

          if (!trackedEntity) {
            throw new Error("Tracked entity not found");
          }

          if (trackedEntity.status !== "Consumed") {
            const activityId = nanoid();
            await trx
              .insertInto("trackedActivity")
              .values({
                id: activityId,
                type: "Produce",
                sourceDocument: "Job Operation",
                sourceDocumentId: row.jobOperationId,
                attributes: {
                  "Job Operation": row.jobOperationId,
                  Employee: userId,
                  Quantity: row.quantity,
                },
                companyId,
                createdBy: userId,
              })
              .execute();

            await trx
              .insertInto("trackedActivityOutput")
              .values({
                trackedActivityId: activityId,
                trackedEntityId: trackedEntityId,
                quantity: row.quantity,
                companyId,
                createdBy: userId,
              })
              .execute();

            const previousProductionQuantities =
              productionQuantities?.data?.reduce((acc, curr) => {
                const quantity = Number(curr.quantity);
                return acc + quantity;
              }, 0) ?? 0;

            // Update the current trackedEntity to Complete
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
                quantity: previousProductionQuantities + row.quantity,
              })
              .where("id", "=", trackedEntityId)
              .execute();
          }

          await issueJobOperationMaterials(trx, {
            jobOperationId: row.jobOperationId,
            quantity: row.quantity,
            companyId,
            userId,
            accountingEnabled: accountingEnabledBatch,
            accountDefaults: accountDefaultsBatch?.data ? accountDefaultsBatch : null,
            dimensionMap: dimensionMapBatch,
            client,
            db,
          });
        });

        return new Response(
          JSON.stringify({
            success: true,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      case "jobOperationSerialComplete": {
        const { trackedEntityId, companyId, userId, ...row } = validatedPayload;
        const client = await requirePermissions(req, companyId, userId, { update: "production" });

        const jobOperation = await client
          .from("jobOperation")
          .select("*")
          .eq("id", row.jobOperationId)
          .single();
        if (!jobOperation.data || !jobOperation.data.jobMakeMethodId) {
          throw new Error("Job operation not found");
        }

        const trackedEntities = await client
          .from("trackedEntity")
          .select("*")
          .eq("attributes->>Job Make Method", jobOperation.data.jobMakeMethodId)
          .order("createdAt", { ascending: true });

        if (!trackedEntities.data || trackedEntities.data.length === 0) {
          throw new Error("Tracked entities not found");
        }

        const relatedTrackedEntities = trackedEntities.data.filter(
          (trackedEntity) =>
            `Operation ${row.jobOperationId}` in
            (trackedEntity.attributes as TrackedEntityAttributes)
        );

        const [accountingSettingsSerial, companyRecordSerial] = await Promise.all([
          client
            .from("companySettings")
            .select("accountingEnabled")
            .eq("id", companyId)
            .single(),
          client.from("company").select("companyGroupId").eq("id", companyId).single(),
        ]);
        if (companyRecordSerial.error) throw new Error("Failed to fetch company");
        const accountingEnabledSerial = accountingSettingsSerial.data?.accountingEnabled ?? false;

        const accountDefaultsSerial = accountingEnabledSerial
          ? await getDefaultPostingGroup(client, companyId)
          : null;
        if (accountingEnabledSerial && (accountDefaultsSerial?.error || !accountDefaultsSerial?.data)) {
          throw new Error("Error getting account defaults");
        }

        const dimensionsSerial = accountingEnabledSerial
          ? await client
              .from("dimension")
              .select("id, entityType")
              .eq("companyGroupId", companyRecordSerial.data.companyGroupId)
              .eq("active", true)
              .in("entityType", ["ItemPostingGroup", "Location"])
          : null;

        const dimensionMapSerial = new Map<string, string>();
        if (dimensionsSerial?.data) {
          for (const dim of dimensionsSerial.data) {
            if (dim.entityType) dimensionMapSerial.set(dim.entityType, dim.id);
          }
        }

        let newEntityId: string | undefined;
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto("productionQuantity")
            .values({
              ...row,
              type: "Production",
              companyId,
              createdBy: userId,
            })
            .executeTakeFirst();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .selectAll()
            .executeTakeFirst();

          if (!trackedEntity) {
            throw new Error("Tracked entity not found");
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
                attributes: {
                  "Job Operation": row.jobOperationId,
                  Employee: userId,
                },
                companyId,
                createdBy: userId,
              })
              .execute();

            await trx
              .insertInto("trackedActivityOutput")
              .values({
                trackedActivityId: activityId,
                trackedEntityId: trackedEntityId,
                quantity: 1,
                companyId,
                createdBy: userId,
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
                    relatedTrackedEntities.length + 1,
                },
              })
              .where("id", "=", trackedEntityId)
              .execute();
          }

          if (
            trackedEntities.data.length <
            (jobOperation.data.operationQuantity ?? 0)
          ) {
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
                companyId,
                createdBy: userId,
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
            accountingEnabled: accountingEnabledSerial,
            accountDefaults: accountDefaultsSerial?.data ? accountDefaultsSerial : null,
            dimensionMap: dimensionMapSerial,
            client,
            db,
          });
        });

        return new Response(
          JSON.stringify({
            success: true,
            newTrackedEntityId: newEntityId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      case "partToOperation": {
        const {
          id,
          companyId,
          userId,
          itemId,
          quantity,
          materialId,
          adjustmentType,
        } = validatedPayload;

        const client = await requirePermissions(req, companyId, userId, { update: "production" });

        const [accountingSettings, companyRecord] = await Promise.all([
          client
            .from("companySettings")
            .select("accountingEnabled")
            .eq("id", companyId)
            .single(),
          client.from("company").select("companyGroupId").eq("id", companyId).single(),
        ]);
        if (companyRecord.error) throw new Error("Failed to fetch company");
        const accountingEnabled = accountingSettings.data?.accountingEnabled ?? false;

        const accountDefaults = accountingEnabled
          ? await getDefaultPostingGroup(client, companyId)
          : null;
        if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
          throw new Error("Error getting account defaults");
        }

        const dimensions = accountingEnabled
          ? await client
              .from("dimension")
              .select("id, entityType")
              .eq("companyGroupId", companyRecord.data.companyGroupId)
              .eq("active", true)
              .in("entityType", ["ItemPostingGroup", "Location"])
          : null;

        const dimensionMap = new Map<string, string>();
        if (dimensions?.data) {
          for (const dim of dimensions.data) {
            if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
          }
        }

        await db.transaction().execute(async (trx) => {
          const jobOperation = await trx
            .selectFrom("jobOperation")
            .where("id", "=", id)
            .select(["jobId", "jobMakeMethodId"])
            .executeTakeFirst();

          const [job, item] = await Promise.all([
            trx
              .selectFrom("job")
              .where("id", "=", jobOperation?.jobId!)
              .select("locationId")
              .executeTakeFirst(),
            trx
              .selectFrom("item")
              .where("id", "=", itemId)
              .select([
                "id",
                "itemTrackingType",
                "name",
                "readableIdWithRevision",
                "type",
              ])
              .executeTakeFirst(),
          ]);

          if (materialId) {
            const material = await trx
              .selectFrom("jobMaterial")
              .where("id", "=", materialId)
              .selectAll()
              .executeTakeFirst();

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

            const quantityToIssue =
              adjustmentType === "Positive Adjmt."
                ? Number(quantity)
                : adjustmentType === "Negative Adjmt."
                ? Number(quantity)
                : Number(quantity) - Number(material?.quantityIssued); // set quantity

            if (
              material?.methodType !== "Make to Order" &&
              item?.itemTrackingType === "Inventory"
            ) {
              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: material?.jobId,
                documentLineId: id,
                companyId,
                itemId: material?.itemId!,
                locationId: job?.locationId,
                storageUnitId,
                quantity:
                  adjustmentType === "Positive Adjmt."
                    ? Number(quantityToIssue)
                    : -Number(quantityToIssue),
                createdBy: userId,
              });
            }

            await trx
              .updateTable("jobMaterial")
              .set({
                quantityIssued:
                  (Number(material?.quantityIssued) ?? 0) +
                  Number(quantityToIssue),
              })
              .where("id", "=", materialId)
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
                createdBy: userId,
              });
            }

            const itemCost = await trx
              .selectFrom("itemCost")
              .where("itemId", "=", itemId!)
              .select("unitCost")
              .executeTakeFirst();

            await trx
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
                quantityIssued: Number(quantity ?? 0),
                unitCost: itemCost?.unitCost ?? 0,
              })
              .executeTakeFirst();

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

          if (accountingEnabled && accountDefaults?.data && itemLedgerInserts.length > 0) {
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
              })),
              jobId: jobOperation?.jobId!,
              operationId: id,
              description: "Manual Material Issue",
              wipAccount: accountDefaults.data.workInProgressAccount,
              inventoryAccount: accountDefaults.data.inventoryAccount,
              dimensionMap,

              jobLocationId: jobRecord?.locationId ?? null,
              client,
              db,
              companyId,
              userId,
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
          companyId,
          userId,
        } = validatedPayload;
        const client = await requirePermissions(req, companyId, userId, { update: "production" });

        const [trackedEntity, jobMaterial] = await Promise.all([
          client
            .from("trackedEntity")
            .select("*")
            .eq("id", trackedEntityId)
            .single(),
          client.from("jobMaterial").select("*").eq("id", materialId).single(),
        ]);

        if (!trackedEntity.data) {
          throw new Error("Tracked entity not found");
        }

        if (!jobMaterial.data) {
          throw new Error("Job material not found");
        }

        const [accountingSettingsScrap, companyRecordScrap] = await Promise.all([
          client
            .from("companySettings")
            .select("accountingEnabled")
            .eq("id", companyId)
            .single(),
          client.from("company").select("companyGroupId").eq("id", companyId).single(),
        ]);
        if (companyRecordScrap.error) throw new Error("Failed to fetch company");
        const accountingEnabledScrap = accountingSettingsScrap.data?.accountingEnabled ?? false;

        const accountDefaultsScrap = accountingEnabledScrap
          ? await getDefaultPostingGroup(client, companyId)
          : null;
        if (accountingEnabledScrap && (accountDefaultsScrap?.error || !accountDefaultsScrap?.data)) {
          throw new Error("Error getting account defaults");
        }

        const dimensionsScrap = accountingEnabledScrap
          ? await client
              .from("dimension")
              .select("id, entityType")
              .eq("companyGroupId", companyRecordScrap.data.companyGroupId)
              .eq("active", true)
              .in("entityType", ["ItemPostingGroup", "Location"])
          : null;

        const dimensionMapScrap = new Map<string, string>();
        if (dimensionsScrap?.data) {
          for (const dim of dimensionsScrap.data) {
            if (dim.entityType) dimensionMapScrap.set(dim.entityType, dim.id);
          }
        }

        await db.transaction().execute(async (trx) => {
          const entity = trackedEntity.data!;
          const material = jobMaterial.data!;
          const quantity = Number(entity.quantity);

          const itemLedger = await trx
            .selectFrom("itemLedger")
            .where("trackedEntityId", "=", trackedEntityId)
            .orderBy("createdAt", "desc")
            .selectAll()
            .executeTakeFirst();

          const job = await trx
            .selectFrom("job")
            .select(["id", "locationId", "itemId"])
            .where("id", "=", material.jobId!)
            .executeTakeFirst();

          const item = await trx
            .selectFrom("item")
            .where("id", "=", material.itemId!)
            .select(["readableIdWithRevision"])
            .executeTakeFirst();

          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Consume",
              sourceDocument: "Job Material",
              sourceDocumentId: materialId,
              sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
              attributes: {
                Job: job?.id!,
                "Job Make Method": material.jobMakeMethodId!,
                "Job Material": material.id!,
                Employee: userId,
                Scrapped: true,
              },
              companyId,
              createdBy: userId,
            })
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId,
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
                createdBy: userId,
              })
              .execute();
          }

          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Consumed",
            })
            .where("id", "=", trackedEntityId)
            .execute();

          if (material.methodType !== "Make to Order") {
            await trx
              .insertInto("itemLedger")
              .values({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: job?.id!,
                companyId,
                itemId: entity.sourceDocumentId!,
                quantity: -quantity,
                locationId: job?.locationId ?? itemLedger?.locationId,
                storageUnitId: itemLedger?.storageUnitId,
                trackedEntityId,
                createdBy: userId,
              })
              .execute();

            if (accountingEnabledScrap && accountDefaultsScrap?.data) {
              await createMaterialWipEntries(trx, {
                consumptionLedgers: [{ itemId: entity.sourceDocumentId!, quantity: -quantity }],
                jobId: job?.id!,
                operationId: material.jobOperationId!,
                description: `Scrap — ${item?.readableIdWithRevision ?? ""}`,
                wipAccount: accountDefaultsScrap.data.workInProgressAccount,
                inventoryAccount: accountDefaultsScrap.data.inventoryAccount,
                dimensionMap: dimensionMapScrap,
  
                jobLocationId: job?.locationId ?? null,
                client,
                db,
                companyId,
                userId,
              });
            }
          }

          const currentQuantityIssued = Number(material.quantityIssued) || 0;
          const newQuantityIssued = currentQuantityIssued + quantity;

          await trx
            .updateTable("jobMaterial")
            .set({
              quantityIssued: newQuantityIssued,
            })
            .where("id", "=", materialId)
            .execute();
        });

        return new Response(
          JSON.stringify({
            success: true,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      case "trackedEntitiesToOperation": {
        const {
          materialId,
          jobOperationId,
          itemId,
          parentTrackedEntityId,
          children,
          overrideExpired,
          overrideReason,
          companyId,
          userId,
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

        const client = await requirePermissions(req, companyId, userId, { update: "production" });

        const [accountingSettingsTracked, companyRecordTracked] = await Promise.all([
          client
            .from("companySettings")
            .select("accountingEnabled")
            .eq("id", companyId)
            .single(),
          client.from("company").select("companyGroupId").eq("id", companyId).single(),
        ]);
        if (companyRecordTracked.error) throw new Error("Failed to fetch company");
        const accountingEnabledTracked = accountingSettingsTracked.data?.accountingEnabled ?? false;

        const accountDefaultsTracked = accountingEnabledTracked
          ? await getDefaultPostingGroup(client, companyId)
          : null;
        if (accountingEnabledTracked && (accountDefaultsTracked?.error || !accountDefaultsTracked?.data)) {
          throw new Error("Error getting account defaults");
        }

        const dimensionsTracked = accountingEnabledTracked
          ? await client
              .from("dimension")
              .select("id, entityType")
              .eq("companyGroupId", companyRecordTracked.data.companyGroupId)
              .eq("active", true)
              .in("entityType", ["ItemPostingGroup", "Location"])
          : null;

        const dimensionMapTracked = new Map<string, string>();
        if (dimensionsTracked?.data) {
          for (const dim of dimensionsTracked.data) {
            if (dim.entityType) dimensionMapTracked.set(dim.entityType, dim.id);
          }
        }

        let expiredWarning: string | undefined;

        const splitEntities = await db.transaction().execute(async (trx) => {
          const trackedEntities = await trx
            .selectFrom("trackedEntity")
            .where(
              "id",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .selectAll()
            .execute();

          const itemLedgers = await trx
            .selectFrom("itemLedger")
            .where("trackedEntityId", "in", [
              ...children.map((child) => child.trackedEntityId),
            ])
            .orderBy("createdBy", "desc")
            .selectAll()
            .execute();

          if (trackedEntities.length !== children.length) {
            throw new Error("Tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Available")) {
            throw new Error("Tracked entities are not available");
          }

          // Expiry policy gate. Reads companySettings.inventoryShelfLife.
          const expiredPolicy = await getExpiredEntityPolicy(trx, companyId);
          const expiredCheck = checkExpiredEntities(
            trackedEntities.map((e) => ({
              id: e.id,
              expirationDate: e.expirationDate,
            })),
            expiredPolicy,
            { allowed: !!overrideExpired, reason: overrideReason ?? null }
          );
          if (!expiredCheck.ok) {
            throw new Error(expiredCheck.reason);
          }
          if (expiredCheck.warning) {
            expiredWarning = expiredCheck.warning;
          }

          let jobMaterial: Awaited<
            ReturnType<
              ReturnType<typeof trx.selectFrom<"jobMaterial">>["selectAll"]
            >
          >[0] | undefined;
          let actualMaterialId: string | undefined = materialId;
          const firstTrackedEntity = trackedEntities[0];

          if (materialId) {
            // Existing behavior: fetch the jobMaterial
            jobMaterial = await trx
              .selectFrom("jobMaterial")
              .where("id", "=", materialId)
              .selectAll()
              .executeTakeFirst();

            // Check if any tracked entity has a different sourceDocumentId than the material's itemId
            if (
              firstTrackedEntity &&
              jobMaterial &&
              firstTrackedEntity.sourceDocumentId !== jobMaterial.itemId
            ) {
              // Create a new jobMaterial for the tracked entity's item
              const totalChildQuantity = children.reduce((sum, child) => {
                return sum + Number(child.quantity);
              }, 0);

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
                  unitCost: itemCost?.unitCost ?? 0,
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
              .select(["jobId", "jobMakeMethodId"])
              .executeTakeFirst();

            if (!jobOperation) {
              throw new Error("Job operation not found");
            }

            const item = await trx
              .selectFrom("item")
              .where("id", "=", itemId)
              .select(["name", "type", "itemTrackingType", "defaultMethodType"])
              .executeTakeFirst();

            if (!item) {
              throw new Error("Item not found");
            }

            const totalChildQuantity = children.reduce((sum, child) => {
              return sum + Number(child.quantity);
            }, 0);

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
                jobMakeMethodId: jobOperation.jobMakeMethodId,
                jobOperationId: jobOperationId,
                itemType: item.type ?? "Part",
                methodType: item.defaultMethodType ?? "Pull from Inventory",
                quantity: 0,
                quantityIssued: totalChildQuantity,
                requiresBatchTracking: item.itemTrackingType === "Batch",
                requiresSerialTracking: item.itemTrackingType === "Serial",
                unitCost: itemCost?.unitCost ?? 0,
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

          if (!jobMaterial) {
            throw new Error("Job material not found");
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
            .select([
              "id",
              "sourceDocumentId",
              "quantity",
              "attributes",
              "status",
            ])
            .executeTakeFirst();

          if (!parentTrackedEntity) {
            throw new Error("Parent tracked entity not found");
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
              },
              companyId,
              createdBy: userId,
            })
            .execute();

          await trx
            .insertInto("trackedActivityOutput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId: parentTrackedEntityId,
              quantity: parentTrackedEntity.quantity,
              companyId,
              createdBy: userId,
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
          }> = [];

          // Process each child tracked entity
          for (const child of children) {
            const trackedEntity = trackedEntities.find(
              (entity) => entity.id === child.trackedEntityId
            );
            if (!trackedEntity) {
              throw new Error("Tracked entity not found");
            }
            const { trackedEntityId, quantity } = child;

            // If quantities don't match, split the batch
            if (Number(trackedEntity.quantity) !== quantity) {
              const remainingQuantity =
                Number(trackedEntity.quantity) - quantity;
              const newTrackedEntityId = nanoid();

              console.log("Split quantities:", {
                childQuantity: Number(trackedEntity.quantity),
                availableQuantity: quantity,
                remainingQuantity,
              });

              // Track split entity for return
              splitEntities.push({
                originalId: trackedEntityId,
                newId: newTrackedEntityId,
                readableId: trackedEntity.sourceDocumentReadableId ?? "",
                quantity: remainingQuantity,
              });

              // Create split activity
              const splitActivityId = nanoid();
              await trx
                .insertInto("trackedActivity")
                .values({
                  id: splitActivityId,
                  type: "Split",
                  sourceDocument: "Job Material",
                  sourceDocumentId: actualMaterialId,
                  attributes: {
                    "Original Quantity": Number(trackedEntity.quantity),
                    "Consumed Quantity": quantity,
                    "Remaining Quantity": remainingQuantity,
                    "Split Entity ID": newTrackedEntityId,
                  },
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Record original entity as input
              await trx
                .insertInto("trackedActivityInput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: trackedEntity.id!,
                  quantity: Number(trackedEntity.quantity),
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Create new tracked entity for remaining quantity
              await trx
                .insertInto("trackedEntity")
                .values({
                  id: newTrackedEntityId,
                  readableId: trackedEntity.readableId,
                  sourceDocumentId: trackedEntity.sourceDocumentId,
                  sourceDocument: "Item",
                  sourceDocumentReadableId:
                    trackedEntity.sourceDocumentReadableId,
                  quantity: remainingQuantity,
                  status: trackedEntity.status ?? "Available",
                  attributes: trackedEntity.attributes,
                  itemId: trackedEntity.itemId ?? trackedEntity.sourceDocumentId,
                  expirationDate: trackedEntity.expirationDate ?? null,
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Update original entity attributes with split reference
              await trx
                .updateTable("trackedEntity")
                .set({
                  quantity: quantity,
                  attributes: {
                    ...((trackedEntity.attributes as Record<string, unknown>) ??
                      {}),
                    "Split Entity ID": newTrackedEntityId,
                  },
                })
                .where("id", "=", trackedEntityId)
                .execute();

              // Record outputs from split
              await trx
                .insertInto("trackedActivityOutput")
                .values([
                  {
                    trackedActivityId: splitActivityId!,
                    trackedEntityId: newTrackedEntityId!,
                    quantity: remainingQuantity,
                    companyId,
                    createdBy: userId,
                  },
                  {
                    trackedActivityId: splitActivityId!,
                    trackedEntityId: trackedEntity.id!,
                    quantity: quantity,
                    companyId,
                    createdBy: userId,
                  },
                ])
                .execute();

              // Create item ledger entries for split
              console.log("Item ledger split entries:", {
                parentQuantity: -Number(trackedEntity.quantity),
                quantity,
                remainingQuantity,
              });

              if (jobMaterial?.methodType !== "Make to Order") {
                itemLedgerInserts.push(
                  {
                    entryType: "Negative Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    companyId,
                    itemId: trackedEntity.sourceDocumentId,
                    quantity: -Number(trackedEntity.quantity),
                    locationId: job?.locationId,
                    storageUnitId: itemLedgers.find(
                      (itemLedger) =>
                        itemLedger.trackedEntityId === trackedEntityId
                    )?.storageUnitId,
                    trackedEntityId: trackedEntity.id!,
                    createdBy: userId,
                  },
                  {
                    entryType: "Positive Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    companyId,
                    itemId: trackedEntity.sourceDocumentId,
                    quantity: quantity,
                    locationId: job?.locationId,
                    storageUnitId: itemLedgers.find(
                      (itemLedger) =>
                        itemLedger.trackedEntityId === trackedEntityId
                    )?.storageUnitId,
                    trackedEntityId: trackedEntity.id!,
                    createdBy: userId,
                  },
                  {
                    entryType: "Positive Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    companyId,
                    itemId: trackedEntity.sourceDocumentId,
                    quantity: remainingQuantity,
                    locationId: job?.locationId,
                    storageUnitId: itemLedgers.find(
                      (itemLedger) =>
                        itemLedger.trackedEntityId === trackedEntityId
                    )?.storageUnitId,
                    trackedEntityId: newTrackedEntityId,
                    createdBy: userId,
                  }
                );
              }
            }

            // Update tracked entity status to consumed
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Consumed",
              })
              .where("id", "=", trackedEntityId)
              .execute();

            trackedActivityInputs.push({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId,
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
                storageUnitId: itemLedgers.find(
                  (itemLedger) => itemLedger.trackedEntityId === trackedEntityId
                )?.storageUnitId,
                trackedEntityId,
                createdBy: userId,
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

          if (accountingEnabledTracked && accountDefaultsTracked?.data && itemLedgerInserts.length > 0) {
            const consumptionEntries = itemLedgerInserts
              .filter((l) => l.entryType === "Consumption")
              .map((l) => ({ itemId: l.itemId as string, quantity: Number(l.quantity) }));

            if (consumptionEntries.length > 0) {
              await createMaterialWipEntries(trx, {
                consumptionLedgers: consumptionEntries,
                jobId: job?.id!,
                operationId: jobMaterial?.jobOperationId ?? actualMaterialId!,
                description: "Tracked Entity Material Issue",
                wipAccount: accountDefaultsTracked.data.workInProgressAccount,
                inventoryAccount: accountDefaultsTracked.data.inventoryAccount,
                dimensionMap: dimensionMapTracked,
  
                jobLocationId: job?.locationId ?? null,
                client,
                db,
                companyId,
                userId,
              });
            }
          }

          const totalChildQuantity = children.reduce((sum, child) => {
            return sum + Number(child.quantity);
          }, 0);

          // Only update if we didn't create a new jobMaterial (in which case it's already set)
          if (actualMaterialId === materialId) {
            const currentQuantityIssued =
              Number(jobMaterial?.quantityIssued) || 0;
            const newQuantityIssued =
              currentQuantityIssued + totalChildQuantity;

            await trx
              .updateTable("jobMaterial")
              .set({
                quantityIssued: newQuantityIssued,
              })
              .where("id", "=", actualMaterialId)
              .execute();

            console.log("Job material quantity updated:", {
              materialId: actualMaterialId,
              newQuantityIssued,
            });
          }

          return splitEntities;
        });

        return new Response(
          JSON.stringify({
            success: true,
            splitEntities,
            warning: expiredWarning,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      case "unconsumeTrackedEntities": {
        const {
          materialId,
          parentTrackedEntityId,
          children,
          companyId,
          userId,
        } = validatedPayload;

        if (!parentTrackedEntityId) {
          throw new Error("Parent ID is required");
        }

        if (children.length === 0) {
          throw new Error("Children are required");
        }

        const clientUnconsume = await requirePermissions(req, companyId, userId, { update: "production" });

        const [accountingSettingsUnconsume, companyRecordUnconsume] = await Promise.all([
          clientUnconsume
            .from("companySettings")
            .select("accountingEnabled")
            .eq("id", companyId)
            .single(),
          clientUnconsume.from("company").select("companyGroupId").eq("id", companyId).single(),
        ]);
        if (companyRecordUnconsume.error) throw new Error("Failed to fetch company");
        const accountingEnabledUnconsume = accountingSettingsUnconsume.data?.accountingEnabled ?? false;

        const accountDefaultsUnconsume = accountingEnabledUnconsume
          ? await getDefaultPostingGroup(clientUnconsume, companyId)
          : null;
        if (accountingEnabledUnconsume && (accountDefaultsUnconsume?.error || !accountDefaultsUnconsume?.data)) {
          throw new Error("Error getting account defaults");
        }

        const dimensionsUnconsume = accountingEnabledUnconsume
          ? await clientUnconsume
              .from("dimension")
              .select("id, entityType")
              .eq("companyGroupId", companyRecordUnconsume.data.companyGroupId)
              .eq("active", true)
              .in("entityType", ["ItemPostingGroup", "Location"])
          : null;

        const dimensionMapUnconsume = new Map<string, string>();
        if (dimensionsUnconsume?.data) {
          for (const dim of dimensionsUnconsume.data) {
            if (dim.entityType) dimensionMapUnconsume.set(dim.entityType, dim.id);
          }
        }

        await db.transaction().execute(async (trx) => {
          const trackedEntities = await trx
            .selectFrom("trackedEntity")
            .where(
              "id",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .selectAll()
            .execute();

          const itemLedgers = await trx
            .selectFrom("itemLedger")
            .where("trackedEntityId", "in", [
              ...children.map((child) => child.trackedEntityId),
            ])
            .orderBy("createdBy", "desc")
            .selectAll()
            .execute();

          if (trackedEntities.length !== children.length) {
            throw new Error("Tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Consumed")) {
            throw new Error(
              "Tracked entities must be in Consumed status to unconsume"
            );
          }

          const jobMaterial = await trx
            .selectFrom("jobMaterial")
            .where("id", "=", materialId)
            .selectAll()
            .executeTakeFirst();

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
            .select([
              "id",
              "sourceDocumentId",
              "quantity",
              "attributes",
              "status",
            ])
            .executeTakeFirst();

          if (!parentTrackedEntity) {
            throw new Error("Parent tracked entity not found");
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
                Employee: userId,
              },
              companyId,
              createdBy: userId,
            })
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId: parentTrackedEntityId,
              quantity: parentTrackedEntity.quantity,
              companyId,
              createdBy: userId,
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
              throw new Error("Tracked entity not found");
            }
            const { trackedEntityId, quantity } = child;
            // Update tracked entity status back to Available
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
              })
              .where("id", "=", trackedEntityId)
              .execute();

            trackedActivityOutputs.push({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId,
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
                storageUnitId: itemLedgers.find(
                  (itemLedger) => itemLedger.trackedEntityId === trackedEntityId
                )?.storageUnitId,
                trackedEntityId,
                createdBy: userId,
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

            if (accountingEnabledUnconsume && accountDefaultsUnconsume?.data) {
              const returnEntries = itemLedgerInserts.map((l) => ({
                itemId: l.itemId as string,
                quantity: Number(l.quantity),
              }));

              await createMaterialWipEntries(trx, {
                consumptionLedgers: returnEntries,
                jobId: job?.id!,
                operationId: jobMaterial?.jobOperationId ?? materialId,
                description: "Unconsume Material Return",
                wipAccount: accountDefaultsUnconsume.data.workInProgressAccount,
                inventoryAccount: accountDefaultsUnconsume.data.inventoryAccount,
                dimensionMap: dimensionMapUnconsume,
  
                jobLocationId: job?.locationId ?? null,
                client: clientUnconsume,
                db,
                companyId,
                userId,
              });
            }
          }

          const totalChildQuantity = children.reduce((sum, child) => {
            return sum + Number(child.quantity);
          }, 0);

          const currentQuantityIssued =
            Number(jobMaterial?.quantityIssued) || 0;
          const newQuantityIssued = currentQuantityIssued - totalChildQuantity;

          await trx
            .updateTable("jobMaterial")
            .set({
              quantityIssued: newQuantityIssued,
            })
            .where("id", "=", materialId)
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
                createdBy: userId,
              })
              .returning([
                "id",
                "readableId",
                "revision",
                "readableIdWithRevision",
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
                  createdBy: userId,
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
                  costIsAdjusted: true,
                })
                .where("itemId", "=", newItem.id)
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
                "New Item ID": newItem.id,
              },
              companyId,
              createdBy: userId,
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
                createdBy: userId,
              })
              .execute();
          }

          // Update tracked entity to new revision
          await trx
            .updateTable("trackedEntity")
            .set({
              sourceDocumentId: newItem.id,
              sourceDocumentReadableId: newItem.readableIdWithRevision,
              quantity: quantity,
            })
            .where("id", "=", trackedEntityId)
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
                createdBy: userId,
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
                  createdBy: userId,
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
                  createdBy: userId,
                },
              ];

            await trx.insertInto("itemLedger").values(ledgerEntries).execute();
          }

          console.log("Entity converted:", {
            trackedEntityId,
            oldRevision: oldItem.revision,
            newRevision,
            oldItemId: oldItem.id,
            newItemId: newItem.id,
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
            quantity: quantity,
          };
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Entity converted successfully",
            convertedEntity,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      case "maintenanceDispatchInventory": {
        const {
          maintenanceDispatchId,
          itemId,
          unitOfMeasureCode,
          quantity,
          companyId,
          userId,
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          // Get the maintenance dispatch to find the location
          const dispatch = await trx
            .selectFrom("maintenanceDispatch")
            .where("id", "=", maintenanceDispatchId)
            .select(["id", "maintenanceDispatchId", "workCenterId", "locationId"])
            .executeTakeFirstOrThrow();

          const locationId = dispatch.locationId;

          // Get item details
          const item = await trx
            .selectFrom("item")
            .where("id", "=", itemId)
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
              createdBy: userId,
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          // Only create item ledger entry for non-tracked items (not Serial or Batch)
          if (item.itemTrackingType !== "Serial" && item.itemTrackingType !== "Batch") {
            // Get storage unit with highest quantity for this item at this location
            const storageUnitId = locationId
              ? await getStorageUnitWithHighestQuantity(
                  trx,
                  itemId,
                  locationId
                )
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
                createdBy: userId,
              })
              .execute();

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

        return new Response(
          JSON.stringify({
            success: true,
            message: "Material issued successfully",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
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
          userId,
        } = validatedPayload;

        if (children.length === 0) {
          throw new Error("At least one tracked entity is required");
        }

        let expiredWarning: string | undefined;

        const splitEntities = await db.transaction().execute(async (trx) => {
          // Get the maintenance dispatch to find the location
          const dispatch = await trx
            .selectFrom("maintenanceDispatch")
            .where("id", "=", maintenanceDispatchId)
            .select(["id", "maintenanceDispatchId", "workCenterId", "locationId"])
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
              createdBy: userId,
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
            throw new Error("Some tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Available")) {
            throw new Error("Some tracked entities are not available");
          }

          // Expiry policy gate.
          const expiredPolicy = await getExpiredEntityPolicy(trx, companyId);
          const expiredCheck = checkExpiredEntities(
            trackedEntities.map((e) => ({
              id: e.id,
              expirationDate: e.expirationDate,
            })),
            expiredPolicy,
            { allowed: !!overrideExpired, reason: overrideReason ?? null }
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
                Employee: userId,
              },
              companyId,
              createdBy: userId,
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
          }> = [];

          // Process each child tracked entity
          for (const child of children) {
            const trackedEntity = trackedEntities.find(
              (entity) => entity.id === child.trackedEntityId
            );
            if (!trackedEntity) {
              throw new Error("Tracked entity not found");
            }
            const { trackedEntityId, quantity } = child;

            // If quantities don't match, split the batch
            if (Number(trackedEntity.quantity) !== quantity) {
              const remainingQuantity =
                Number(trackedEntity.quantity) - quantity;
              const newTrackedEntityId = nanoid();

              // Track split entity for return
              splitEntities.push({
                originalId: trackedEntityId,
                newId: newTrackedEntityId,
                readableId: trackedEntity.sourceDocumentReadableId ?? "",
                quantity: remainingQuantity,
              });

              // Create split activity
              const splitActivityId = nanoid();
              await trx
                .insertInto("trackedActivity")
                .values({
                  id: splitActivityId,
                  type: "Split",
                  sourceDocument: "Maintenance Dispatch Item",
                  sourceDocumentId: maintenanceDispatchItemId,
                  attributes: {
                    "Original Quantity": Number(trackedEntity.quantity),
                    "Consumed Quantity": quantity,
                    "Remaining Quantity": remainingQuantity,
                    "Split Entity ID": newTrackedEntityId,
                  },
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Record original entity as input
              await trx
                .insertInto("trackedActivityInput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: trackedEntity.id!,
                  quantity: Number(trackedEntity.quantity),
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Create new tracked entity for remaining quantity
              await trx
                .insertInto("trackedEntity")
                .values({
                  id: newTrackedEntityId,
                  readableId: trackedEntity.readableId,
                  sourceDocumentId: trackedEntity.sourceDocumentId,
                  sourceDocument: "Item",
                  sourceDocumentReadableId:
                    trackedEntity.sourceDocumentReadableId,
                  quantity: remainingQuantity,
                  status: trackedEntity.status ?? "Available",
                  attributes: trackedEntity.attributes,
                  itemId: trackedEntity.itemId ?? trackedEntity.sourceDocumentId,
                  expirationDate: trackedEntity.expirationDate ?? null,
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Update original entity quantity
              await trx
                .updateTable("trackedEntity")
                .set({
                  quantity: quantity,
                  attributes: {
                    ...((trackedEntity.attributes as Record<string, unknown>) ??
                      {}),
                    "Split Entity ID": newTrackedEntityId,
                  },
                })
                .where("id", "=", trackedEntityId)
                .execute();

              // Record outputs from split
              await trx
                .insertInto("trackedActivityOutput")
                .values([
                  {
                    trackedActivityId: splitActivityId,
                    trackedEntityId: newTrackedEntityId,
                    quantity: remainingQuantity,
                    companyId,
                    createdBy: userId,
                  },
                  {
                    trackedActivityId: splitActivityId,
                    trackedEntityId: trackedEntity.id!,
                    quantity: quantity,
                    companyId,
                    createdBy: userId,
                  },
                ])
                .execute();

              // Create item ledger entries for split
              const existingLedger = itemLedgers.find(
                (l) => l.trackedEntityId === trackedEntityId
              );

              itemLedgerInserts.push(
                {
                  entryType: "Negative Adjmt.",
                  documentType: "Batch Split",
                  documentId: splitActivityId,
                  companyId,
                  itemId: trackedEntity.sourceDocumentId,
                  quantity: -Number(trackedEntity.quantity),
                  locationId,
                  storageUnitId: existingLedger?.storageUnitId,
                  trackedEntityId: trackedEntity.id!,
                  createdBy: userId,
                },
                {
                  entryType: "Positive Adjmt.",
                  documentType: "Batch Split",
                  documentId: splitActivityId,
                  companyId,
                  itemId: trackedEntity.sourceDocumentId,
                  quantity: quantity,
                  locationId,
                  storageUnitId: existingLedger?.storageUnitId,
                  trackedEntityId: trackedEntity.id!,
                  createdBy: userId,
                },
                {
                  entryType: "Positive Adjmt.",
                  documentType: "Batch Split",
                  documentId: splitActivityId,
                  companyId,
                  itemId: trackedEntity.sourceDocumentId,
                  quantity: remainingQuantity,
                  locationId,
                  storageUnitId: existingLedger?.storageUnitId,
                  trackedEntityId: newTrackedEntityId,
                  createdBy: userId,
                }
              );
            }

            // Update tracked entity status to consumed
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Consumed",
              })
              .where("id", "=", trackedEntityId)
              .execute();

            trackedActivityInputs.push({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId,
            });

            // Add junction table entry
            junctionInserts.push({
              maintenanceDispatchItemId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId,
            });

            // Create consumption item ledger entry
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
              quantity: -quantity,
              locationId,
              storageUnitId: existingLedger?.storageUnitId,
              trackedEntityId,
              createdBy: userId,
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

        return new Response(
          JSON.stringify({
            success: true,
            message: "Material issued successfully",
            splitEntities,
            warning: expiredWarning,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      case "maintenanceDispatchUnconsume": {
        const { maintenanceDispatchItemId, children, companyId, userId } =
          validatedPayload;

        if (children.length === 0) {
          throw new Error("At least one tracked entity is required");
        }

        await db.transaction().execute(async (trx) => {
          // Get the maintenance dispatch item with related data
          const dispatchItem = await trx
            .selectFrom("maintenanceDispatchItem")
            .where("id", "=", maintenanceDispatchItemId)
            .selectAll()
            .executeTakeFirstOrThrow();

          // Get the maintenance dispatch to find the location
          const dispatch = await trx
            .selectFrom("maintenanceDispatch")
            .where("id", "=", dispatchItem.maintenanceDispatchId)
            .select(["id", "maintenanceDispatchId", "workCenterId", "locationId"])
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
            throw new Error("Some tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Consumed")) {
            throw new Error(
              "Some tracked entities are not in consumed status"
            );
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
                Employee: userId,
              },
              companyId,
              createdBy: userId,
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
              throw new Error("Tracked entity not found");
            }
            const { trackedEntityId, quantity } = child;

            // Update tracked entity status back to Available
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
              })
              .where("id", "=", trackedEntityId)
              .execute();

            trackedActivityOutputs.push({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId,
            });

            // Remove from junction table
            await trx
              .deleteFrom("maintenanceDispatchItemTrackedEntity")
              .where("maintenanceDispatchItemId", "=", maintenanceDispatchItemId)
              .where("trackedEntityId", "=", trackedEntityId)
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
              createdBy: userId,
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
          const totalChildQuantity = children.reduce((sum, child) => {
            return sum + Number(child.quantity);
          }, 0);

          const currentQuantity = Number(dispatchItem.quantity) || 0;
          const newQuantity = Math.max(0, currentQuantity - totalChildQuantity);

          await trx
            .updateTable("maintenanceDispatchItem")
            .set({
              quantity: newQuantity,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .where("id", "=", maintenanceDispatchItemId)
            .execute();
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Material unconsumed successfully",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      case "maintenanceDispatchUnissue": {
        const { maintenanceDispatchItemId, companyId, userId } =
          validatedPayload;

        await db.transaction().execute(async (trx) => {
          // Get the maintenance dispatch item
          const dispatchItem = await trx
            .selectFrom("maintenanceDispatchItem")
            .where("id", "=", maintenanceDispatchItemId)
            .selectAll()
            .executeTakeFirstOrThrow();

          // Get the maintenance dispatch to find the location
          const dispatch = await trx
            .selectFrom("maintenanceDispatch")
            .where("id", "=", dispatchItem.maintenanceDispatchId)
            .select(["id", "maintenanceDispatchId", "workCenterId", "locationId"])
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
                  Employee: userId,
                },
                companyId,
                createdBy: userId,
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
                .execute();

              trackedActivityOutputs.push({
                trackedActivityId: activityId,
                trackedEntityId: junction.trackedEntityId,
                quantity,
                companyId,
                createdBy: userId,
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
                createdBy: userId,
              });
            }

            // Delete junction entries
            await trx
              .deleteFrom("maintenanceDispatchItemTrackedEntity")
              .where("maintenanceDispatchItemId", "=", maintenanceDispatchItemId)
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
                  createdBy: userId,
                })
                .execute();
            }
          }

          // Delete the dispatch item
          await trx
            .deleteFrom("maintenanceDispatchItem")
            .where("id", "=", maintenanceDispatchItemId)
            .execute();
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Item unissued and removed successfully",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "x",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    // Error.prototype properties (message, name, stack) aren't enumerable,
    // so a plain JSON.stringify(err) produces "{}" and clients lose the
    // actual reason (e.g. "Cannot consume expired tracked entity ...").
    // Pull the message out explicitly.
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unexpected error";
    return new Response(
      JSON.stringify({ success: false, message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
