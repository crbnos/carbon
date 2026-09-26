import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^4.5.4";
import { sql, Transaction } from "kysely";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database, Json } from "../lib/types.ts";
import {
  buildCapitalizationLines,
  buildReturnToInventoryLines,
  PostingLine,
} from "../shared/asset-transfer.ts";
import { getAccountingPeriodForDate } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import {
  getDefaultPostingGroup,
  resolveInventoryAccount,
} from "../shared/get-posting-group.ts";
import {
  bookAdjustment,
  createAdjustmentJournal,
} from "../shared/post-adjustment.ts";
import { round } from "../shared/precision.ts";
import {
  AssetTransferPayload,
  CLOSED_JOB_STATUSES,
  payloadValidator,
  resolveCapitalizationStock,
  RETURNABLE_ASSET_STATUSES,
} from "./validators.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-asset-transfer");

// The single write path for moving value between inventory and the fixed
// asset register (spec §2, "Fleet bridge"). Four actions, each creating and
// posting one `fixedAssetTransfer` document in ONE transaction:
//
//   capitalize     stock → asset at the unit's carrying cost (the serial is
//                  consumed INTO the asset; Dr class asset / Cr inventory)
//   return         asset → stock at net book value (Dr inventory N / Dr
//                  accumulated depreciation / Cr class asset at cost)
//   attachJob      point a job at a Construction in Progress asset and sweep
//                  its WIP balance there (Dr CIP / Cr WIP), SAP AuC style
//   capitalizeCip  CIP asset → its in-service class (Dr class / Cr CIP)
//
// With companySettings.accountingEnabled = false every ledger, entity and
// asset write is identical and no journal is created.

type Client = Awaited<ReturnType<typeof requirePermissions>>;
type Trx = Transaction<DB>;

// Business-validation failures are 400s with the exact message the app shows;
// a referenced record the caller's company does not own is a 404; everything
// else is a 500 so real outages surface in monitoring.
class ValidationError extends Error {}
class NotFoundError extends Error {}

type AccountingContext = {
  accountingPeriodId: string;
  accountDefaults: {
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
    workInProgressAccount: string;
  };
  // active dimensions for the company group, entityType → dimension id
  dimensions: Record<string, string>;
};

type TransferResult = {
  // fixedAssetTransfer row id / readable number; null when nothing was swept
  id: string | null;
  transferId: string | null;
  // fixedAsset row id / readable number
  fixedAssetId: string;
  fixedAssetReadableId: string;
};

// Everything a journal needs that is known before the transaction opens.
// Resolving the period here (not inside the Kysely transaction) matters: the
// pool is size one, and the period resolver opens its own transaction.
async function loadAccounting(
  client: Client,
  companyId: string,
  postingDate: string,
): Promise<AccountingContext | null> {
  const settings = await client
    .from("companySettings")
    .select("accountingEnabled")
    .eq("id", companyId)
    .single();
  // Fail closed: a failed settings read must not silently post without GL.
  if (settings.error) throw new Error("Failed to fetch company settings");
  if (!settings.data.accountingEnabled) return null;

  const accountDefaults = await getDefaultPostingGroup(client, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }

  const company = await client
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error) throw new Error("Failed to fetch company");
  const dimensionRows = await client
    .from("dimension")
    .select("id, entityType")
    .eq("companyGroupId", company.data.companyGroupId)
    .eq("active", true)
    .in("entityType", ["Item", "Location", "FixedAssetClass"]);
  // Fail closed: journal lines must not silently lose dimension tags.
  if (dimensionRows.error) throw new Error("Failed to fetch dimensions");
  const dimensions: Record<string, string> = {};
  for (const dimension of dimensionRows.data ?? []) {
    dimensions[dimension.entityType] = dimension.id;
  }

  const accountingPeriodId = await getAccountingPeriodForDate(
    client,
    companyId,
    db,
    postingDate,
  );

  return {
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
      workInProgressAccount: accountDefaults.data.workInProgressAccount,
    },
    dimensions,
  };
}

// One posted 'Asset Transfer' journal from already-balanced lines, tagged with
// the Location / FixedAssetClass / Item dimensions the company group has
// active (post-receipt precedent for fixed-asset lines).
async function postAssetJournal(
  trx: Trx,
  args: {
    accounting: AccountingContext;
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    lines: PostingLine[];
    documentId: string;
    documentLineReference?: string | null;
    tags: {
      locationId: string | null;
      fixedAssetClassId: string | null;
      itemId: string | null;
    };
  },
): Promise<string> {
  const { accounting, companyId, userId } = args;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId: accounting.accountingPeriodId,
    description: args.description,
    postingDate: args.postingDate,
    userId,
    sourceType: "Asset Transfer",
  });

  const journalLineReference = nanoid();
  const journalLines = await trx
    .insertInto("journalLine")
    .values(
      args.lines.map((line) => ({
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: round(line.amount),
        quantity: 1,
        documentType: "Asset Transfer" as const,
        documentId: args.documentId,
        documentLineReference: args.documentLineReference ?? null,
        journalLineReference,
        companyId,
      })),
    )
    .returning(["id"])
    .execute();

  const tagValues: Array<[string, string | null]> = [
    ["Location", args.tags.locationId],
    ["FixedAssetClass", args.tags.fixedAssetClassId],
    ["Item", args.tags.itemId],
  ];
  const dimensionInserts = journalLines.flatMap((line) =>
    tagValues
      .filter(([entityType, valueId]) =>
        accounting.dimensions[entityType] && valueId
      )
      .map(([entityType, valueId]) => ({
        journalLineId: line.id,
        dimensionId: accounting.dimensions[entityType],
        valueId: valueId as string,
        companyId,
      }))
  );
  if (dimensionInserts.length > 0) {
    await trx.insertInto("journalLineDimension").values(dimensionInserts)
      .execute();
  }

  return journalId;
}

type AssetRow = {
  id: string;
  fixedAssetId: string;
  fixedAssetClassId: string;
  name: string;
  status: Database["public"]["Enums"]["fixedAssetStatus"];
  itemId: string | null;
  trackedEntityId: string | null;
  locationId: string | null;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  outOfServiceSince: string | null;
};

async function getAsset(
  client: Client,
  companyId: string,
  id: string,
): Promise<AssetRow> {
  const asset = await client
    .from("fixedAsset")
    .select(
      "id, fixedAssetId, fixedAssetClassId, name, status, itemId, trackedEntityId, locationId, acquisitionCost, accumulatedDepreciation, outOfServiceSince",
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (asset.error) throw new Error("Failed to fetch fixed asset");
  if (!asset.data) throw new NotFoundError("Fixed asset not found");
  return {
    ...asset.data,
    acquisitionCost: Number(asset.data.acquisitionCost ?? 0),
    accumulatedDepreciation: Number(asset.data.accumulatedDepreciation ?? 0),
  };
}

type AssetClassRow = {
  id: string;
  name: string;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  isConstructionInProgress: boolean;
  depreciationMethod: Database["public"]["Enums"]["depreciationMethod"];
  usefulLifeMonths: number;
  residualValuePercent: number;
};

async function getAssetClass(
  client: Client,
  companyId: string,
  id: string,
): Promise<AssetClassRow> {
  const assetClass = await client
    .from("fixedAssetClass")
    .select(
      "id, name, assetAccountId, accumulatedDepreciationAccountId, isConstructionInProgress, depreciationMethod, usefulLifeMonths, residualValuePercent",
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (assetClass.error) throw new Error("Failed to fetch fixed asset class");
  if (!assetClass.data) throw new NotFoundError("Fixed asset class not found");
  return assetClass.data;
}

async function assertLocation(
  client: Client,
  companyId: string,
  id: string,
): Promise<void> {
  const location = await client
    .from("location")
    .select("id")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (location.error) throw new Error("Failed to fetch location");
  if (!location.data) throw new NotFoundError("Location not found");
}

type InventoryItem = {
  id: string;
  name: string;
  readableId: string;
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"] | null;
  replenishmentSystem:
    | Database["public"]["Enums"]["itemReplenishmentSystem"]
    | null;
  itemPostingGroupId: string | null;
  itemCost: {
    costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
    unitCost: number | null;
    standardCost: number | null;
  };
};

async function getInventoryItem(
  client: Client,
  companyId: string,
  itemId: string,
): Promise<InventoryItem> {
  const [item, itemCost] = await Promise.all([
    client
      .from("item")
      .select("id, name, readableId, itemTrackingType, replenishmentSystem")
      .eq("id", itemId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("itemCost")
      .select("costingMethod, unitCost, standardCost, itemPostingGroupId")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle(),
  ]);
  if (item.error) throw new Error("Failed to fetch item");
  if (!item.data) throw new NotFoundError("Item not found");
  if (itemCost.error) throw new Error("Failed to fetch item cost");
  if (!itemCost.data) throw new NotFoundError("Item cost not found");
  return {
    ...item.data,
    itemPostingGroupId: itemCost.data.itemPostingGroupId,
    itemCost: {
      costingMethod: itemCost.data.costingMethod,
      unitCost: itemCost.data.unitCost,
      standardCost: itemCost.data.standardCost,
    },
  };
}

type TrackedEntityRow = {
  id: string;
  itemId: string | null;
  readableId: string | null;
  status: Database["public"]["Enums"]["trackedEntityStatus"];
};

async function getTrackedEntity(
  client: Client,
  companyId: string,
  id: string,
): Promise<TrackedEntityRow> {
  const entity = await client
    .from("trackedEntity")
    .select("id, itemId, readableId, status")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (entity.error) throw new Error("Failed to fetch tracked entity");
  if (!entity.data) throw new NotFoundError("Tracked entity not found");
  return entity.data;
}

// The traceability graph records the asset as the consumer (capitalize) or
// the producer (return) of the unit, mirroring complete_job_to_inventory's
// 'Capitalize' activity.
async function insertAssetActivity(
  trx: Trx,
  args: {
    type: "Capitalize" | "Return to Inventory";
    direction: "input" | "output";
    asset: { id: string; fixedAssetId: string };
    trackedEntityId: string;
    companyId: string;
    userId: string;
  },
): Promise<void> {
  const activityId = nanoid();
  await trx
    .insertInto("trackedActivity")
    .values({
      id: activityId,
      type: args.type,
      sourceDocument: "Fixed Asset",
      sourceDocumentId: args.asset.id,
      sourceDocumentReadableId: args.asset.fixedAssetId,
      attributes: { "Fixed Asset": args.asset.id },
      companyId: args.companyId,
      createdBy: args.userId,
    })
    .execute();
  await trx
    .insertInto(
      args.direction === "input"
        ? "trackedActivityInput"
        : "trackedActivityOutput",
    )
    .values({
      trackedActivityId: activityId,
      trackedEntityId: args.trackedEntityId,
      quantity: 1,
      companyId: args.companyId,
      createdBy: args.userId,
    })
    .execute();
}

async function postTransfer(
  trx: Trx,
  args: {
    id: string;
    amount: number;
    journalId: string | null;
    companyId: string;
    userId: string;
  },
): Promise<void> {
  await trx
    .updateTable("fixedAssetTransfer")
    .set({
      amount: round(args.amount),
      journalId: args.journalId,
      status: "Posted",
      postedAt: datetime.timestamp(),
      postedBy: args.userId,
      updatedAt: datetime.timestamp(),
      updatedBy: args.userId,
    })
    .where("id", "=", args.id)
    .where("companyId", "=", args.companyId)
    .execute();
}

async function capitalize(
  client: Client,
  payload: Extract<AssetTransferPayload, { type: "capitalize" }>,
): Promise<TransferResult> {
  const { companyId, userId, itemId, trackedEntityId, locationId } = payload;

  const [assetClass, item, entity] = await Promise.all([
    getAssetClass(client, companyId, payload.fixedAssetClassId),
    getInventoryItem(client, companyId, itemId),
    getTrackedEntity(client, companyId, trackedEntityId),
    assertLocation(client, companyId, locationId),
  ]);
  const draftAsset = payload.fixedAssetId
    ? await getAsset(client, companyId, payload.fixedAssetId)
    : null;

  if (entity.itemId !== itemId) {
    throw new ValidationError("The unit does not belong to this item");
  }
  if (entity.status !== "Available") {
    throw new ValidationError(
      `Only an Available unit can be capitalized; ${
        entity.readableId ?? entity.id
      } is ${entity.status}`,
    );
  }
  if (draftAsset && draftAsset.status !== "Draft") {
    throw new ValidationError(
      `Asset ${draftAsset.fixedAssetId} is ${draftAsset.status}; only a Draft asset can be filled`,
    );
  }

  // The partial unique index refuses two live assets on one unit as well; the
  // read gives the caller a reason instead of a constraint name.
  const liveAsset = await client
    .from("fixedAsset")
    .select("fixedAssetId")
    .eq("trackedEntityId", trackedEntityId)
    .eq("companyId", companyId)
    .neq("status", "Disposed")
    .limit(1)
    .maybeSingle();
  if (liveAsset.error) throw new Error("Failed to fetch fixed assets");
  if (liveAsset.data) {
    throw new ValidationError(
      `${
        entity.readableId ?? entity.id
      } is already on asset ${liveAsset.data.fixedAssetId}`,
    );
  }

  const accounting = await loadAccounting(
    client,
    companyId,
    payload.transferDate,
  );
  const serial = entity.readableId ?? entity.id;
  const status = assetClass.isConstructionInProgress
    ? ("Under Construction" as const)
    : ("Active" as const);

  return db.transaction().execute(async (trx): Promise<TransferResult> => {
    // Net on-hand per bin at the location, read inside the transaction so the
    // consumption below books against the same snapshot.
    const stockRows = await trx
      .selectFrom("itemLedger")
      .select([
        "storageUnitId",
        (eb) => eb.fn.sum<number>("quantity").as("onHand"),
      ])
      .where("trackedEntityId", "=", trackedEntityId)
      .where("itemId", "=", itemId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .groupBy("storageUnitId")
      .execute();
    const stock = resolveCapitalizationStock(
      stockRows,
      payload.storageUnitId ?? null,
    );
    if (round(stock.onHand) !== 1) {
      throw new ValidationError(
        `${serial} must have exactly one unit on hand at this location (found ${
          round(stock.onHand)
        })`,
      );
    }

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId,
    );

    // The asset first: the transfer references it. Its cost is filled in once
    // the ledger has relieved the unit's carrying value below.
    let asset: { id: string; fixedAssetId: string };
    const assetFields = {
      fixedAssetClassId: assetClass.id,
      itemId,
      trackedEntityId,
      serialNumber: entity.readableId,
      locationId,
      acquisitionDate: payload.transferDate,
      // A CIP asset does not depreciate until it is capitalized.
      depreciationStartDate: assetClass.isConstructionInProgress
        ? null
        : payload.transferDate,
      depreciationMethod: assetClass.depreciationMethod,
      usefulLifeMonths: assetClass.usefulLifeMonths,
      residualValuePercent: assetClass.residualValuePercent,
      status,
    };
    if (draftAsset) {
      // Same Draft race guard as registration: a concurrent fill or disposal
      // wins and this transaction rolls back.
      const filled = await trx
        .updateTable("fixedAsset")
        .set({
          ...assetFields,
          ...(payload.name ? { name: payload.name } : {}),
          updatedAt: datetime.timestamp(),
          updatedBy: userId,
        })
        .where("id", "=", draftAsset.id)
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .executeTakeFirst();
      if (!filled.numUpdatedRows) {
        throw new ValidationError("Asset is no longer in Draft status");
      }
      asset = { id: draftAsset.id, fixedAssetId: draftAsset.fixedAssetId };
    } else {
      const fixedAssetId = await getNextSequence(trx, "fixedAsset", companyId);
      const inserted = await trx
        .insertInto("fixedAsset")
        .values({
          ...assetFields,
          fixedAssetId,
          name: payload.name?.trim() || `${item.name} ${serial}`,
          quantity: 1,
          acquisitionCost: 0,
          companyId,
          createdBy: userId,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      asset = { id: inserted.id, fixedAssetId };
    }

    const transfer = await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Capitalization",
        sourceType: "Inventory",
        fixedAssetId: asset.id,
        itemId,
        trackedEntityId,
        locationId,
        storageUnitId: stock.storageUnitId,
        quantity: 1,
        transferDate: payload.transferDate,
        amount: 0,
        status: "Draft",
        companyId,
        createdBy: userId,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    // Relieve the unit from stock at its carrying cost — the same layer
    // consumer shipments use, for any costing method. accounting: null keeps
    // the core from posting a variance journal; the asset journal is below.
    const booked = await bookAdjustment(trx, {
      ledger: {
        postingDate: payload.transferDate,
        itemId,
        quantity: -1,
        locationId,
        storageUnitId: stock.storageUnitId,
        trackedEntityId,
        entryType: "Negative Adjmt.",
        documentType: "Asset Transfer",
        documentId: transfer.id,
        companyId,
        createdBy: userId,
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: item.itemPostingGroupId,
      },
      itemCost: item.itemCost,
      accounting: null,
    });
    const cost = round(booked.cost);

    // A unit with no carrying value has nothing to post (bookAdjustment's own
    // zero-value rule); the asset is still created at cost 0.
    let journalId: string | null = null;
    if (accounting && cost > 0) {
      const inventoryAccount = resolveInventoryAccount(
        item.replenishmentSystem,
        accounting.accountDefaults,
      );
      journalId = await postAssetJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: payload.transferDate,
        description:
          `Capitalize ${item.readableId} ${serial} → ${asset.fixedAssetId}`,
        lines: buildCapitalizationLines({
          cost,
          assetAccountId: assetClass.assetAccountId,
          creditAccountId: inventoryAccount.account,
          creditDescription: inventoryAccount.description,
        }),
        documentId: transfer.id,
        tags: { locationId, fixedAssetClassId: assetClass.id, itemId },
      });
    }

    await trx
      .updateTable("fixedAsset")
      .set({
        acquisitionCost: cost,
        updatedAt: datetime.timestamp(),
        updatedBy: userId,
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .execute();

    // A CIP-class asset is later capitalized for Σ fixedAssetCipCost, so the
    // value that arrived from stock has to be on that ledger too.
    if (assetClass.isConstructionInProgress && cost > 0) {
      await trx
        .insertInto("fixedAssetCipCost")
        .values({
          fixedAssetId: asset.id,
          sourceType: "Manual",
          sourceDocumentId: transfer.id,
          amount: cost,
          costDate: payload.transferDate,
          journalId,
          companyId,
          createdBy: userId,
        })
        .execute();
    }

    // The unit is consumed into the asset: no longer stock, and the asset id
    // on its attributes is how the fleet finds it again.
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Consumed",
        attributes: sql<
          Json
        >`COALESCE("attributes", '{}'::jsonb) || jsonb_build_object('Fixed Asset', ${asset.id}::text)`,
      })
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .execute();
    await insertAssetActivity(trx, {
      type: "Capitalize",
      direction: "input",
      asset,
      trackedEntityId,
      companyId,
      userId,
    });

    await postTransfer(trx, {
      id: transfer.id,
      amount: cost,
      journalId,
      companyId,
      userId,
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId,
    };
  });
}

async function returnToInventory(
  client: Client,
  payload: Extract<AssetTransferPayload, { type: "return" }>,
): Promise<TransferResult> {
  const { companyId, userId, locationId } = payload;

  const asset = await getAsset(client, companyId, payload.fixedAssetId);
  if (!RETURNABLE_ASSET_STATUSES.has(asset.status)) {
    throw new ValidationError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; only an Active or Fully Depreciated asset can be returned to inventory`,
    );
  }
  if (asset.outOfServiceSince) {
    throw new ValidationError(
      `Asset ${asset.fixedAssetId} is out of service; return it to service first`,
    );
  }
  if (!asset.itemId || !asset.trackedEntityId) {
    throw new ValidationError(
      `Asset ${asset.fixedAssetId} is not linked to a serialized inventory unit`,
    );
  }
  const netBookValue = round(
    asset.acquisitionCost - asset.accumulatedDepreciation,
  );
  if (netBookValue < 0) {
    throw new ValidationError(
      `Asset ${asset.fixedAssetId} has a negative net book value`,
    );
  }

  const [assetClass, item, entity] = await Promise.all([
    getAssetClass(client, companyId, asset.fixedAssetClassId),
    getInventoryItem(client, companyId, asset.itemId),
    getTrackedEntity(client, companyId, asset.trackedEntityId),
    assertLocation(client, companyId, locationId),
  ]);
  if (entity.status !== "Consumed") {
    throw new ValidationError(
      `Unit ${
        entity.readableId ?? entity.id
      } is ${entity.status}, not consumed into the asset`,
    );
  }

  const accounting = await loadAccounting(
    client,
    companyId,
    payload.transferDate,
  );
  const serial = entity.readableId ?? entity.id;
  const trackedEntityId = entity.id;
  const itemId = item.id;

  return db.transaction().execute(async (trx): Promise<TransferResult> => {
    // A unit reserved or on rent belongs to that agreement until it comes
    // back: the live-line statuses are the ones the fleetAssets view and the
    // rentalAgreementLine_asset_live_idx unique index key on.
    const liveLine = await trx
      .selectFrom("rentalAgreementLine as ral")
      .innerJoin("rentalAgreement as ra", (join) =>
        join
          .onRef("ra.id", "=", "ral.rentalAgreementId")
          .onRef("ra.companyId", "=", "ral.companyId"))
      .select(["ral.status", "ra.rentalAgreementId"])
      .where("ral.fixedAssetId", "=", asset.id)
      .where("ral.companyId", "=", companyId)
      .where("ral.status", "in", ["Pending", "On Rent"])
      .executeTakeFirst();
    if (liveLine) {
      throw new ValidationError(
        `Asset ${asset.fixedAssetId} is ${
          liveLine.status === "On Rent" ? "on rent" : "reserved"
        } on rental agreement ${liveLine.rentalAgreementId}; return it from the agreement first`,
      );
    }

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId,
    );
    const transfer = await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Return to Inventory",
        sourceType: "Inventory",
        fixedAssetId: asset.id,
        itemId,
        trackedEntityId,
        locationId,
        storageUnitId: payload.storageUnitId ?? null,
        quantity: 1,
        transferDate: payload.transferDate,
        amount: netBookValue,
        accumulatedDepreciation: round(asset.accumulatedDepreciation),
        status: "Draft",
        companyId,
        createdBy: userId,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    // Back into stock at net book value: a cost layer at N stamped with the
    // serial, so under FIFO / LIFO that unit is later relieved at N (gross
    // revenue + COGS at N), not at the oldest layer (cost-layer-order.ts).
    await bookAdjustment(trx, {
      ledger: {
        postingDate: payload.transferDate,
        itemId,
        quantity: 1,
        locationId,
        storageUnitId: payload.storageUnitId ?? null,
        trackedEntityId,
        entryType: "Positive Adjmt.",
        documentType: "Asset Transfer",
        documentId: transfer.id,
        companyId,
        createdBy: userId,
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: item.itemPostingGroupId,
      },
      itemCost: item.itemCost,
      accounting: null,
      fixedUnitCost: netBookValue,
    });

    // An asset carried at zero cost has nothing on the books to move.
    let journalId: string | null = null;
    if (accounting && round(asset.acquisitionCost) > 0) {
      const inventoryAccount = resolveInventoryAccount(
        item.replenishmentSystem,
        accounting.accountDefaults,
      );
      journalId = await postAssetJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: payload.transferDate,
        description:
          `Return to inventory ${asset.fixedAssetId} → ${item.readableId} ${serial}`,
        lines: buildReturnToInventoryLines({
          cost: asset.acquisitionCost,
          accumulatedDepreciation: asset.accumulatedDepreciation,
          inventoryAccountId: inventoryAccount.account,
          inventoryDescription: inventoryAccount.description,
          accounts: {
            assetAccountId: assetClass.assetAccountId,
            accumulatedDepreciationAccountId:
              assetClass.accumulatedDepreciationAccountId,
          },
        }),
        documentId: transfer.id,
        tags: { locationId, fixedAssetClassId: assetClass.id, itemId },
      });
    }

    const disposed = await trx
      .updateTable("fixedAsset")
      .set({
        status: "Disposed",
        disposalMethod: "Transfer to Inventory",
        disposalDate: payload.transferDate,
        saleProceeds: 0,
        updatedAt: datetime.timestamp(),
        updatedBy: userId,
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", [...RETURNABLE_ASSET_STATUSES])
      .executeTakeFirst();
    if (!disposed.numUpdatedRows) {
      throw new ValidationError(
        `Asset ${asset.fixedAssetId} changed status while it was being returned`,
      );
    }
    await trx
      .insertInto("fixedAssetDisposal")
      .values({
        fixedAssetId: asset.id,
        disposalMethod: "Transfer to Inventory",
        disposalDate: payload.transferDate,
        saleProceeds: 0,
        netBookValueAtDisposal: netBookValue,
        gainLoss: 0,
        journalId,
        companyId,
        createdBy: userId,
      })
      .execute();

    // The return inspection already happened on the agreement, so the unit
    // comes back Available (an RMA reactivates to On Hold because none has).
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Available",
        attributes: sql<
          Json
        >`COALESCE("attributes", '{}'::jsonb) - 'Fixed Asset'`,
      })
      .where("id", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .execute();
    await insertAssetActivity(trx, {
      type: "Return to Inventory",
      direction: "output",
      asset,
      trackedEntityId,
      companyId,
      userId,
    });

    await postTransfer(trx, {
      id: transfer.id,
      amount: netBookValue,
      journalId,
      companyId,
      userId,
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId,
    };
  });
}

async function attachJob(
  client: Client,
  payload: Extract<AssetTransferPayload, { type: "attachJob" }>,
): Promise<TransferResult> {
  const { companyId, userId, jobId } = payload;

  const asset = await getAsset(client, companyId, payload.fixedAssetId);
  const [assetClass, jobResult] = await Promise.all([
    getAssetClass(client, companyId, asset.fixedAssetClassId),
    client
      .from("job")
      .select(
        "id, jobId, itemId, status, locationId, salesOrderLineId, fixedAssetClassId, fixedAssetId",
      )
      .eq("id", jobId)
      .eq("companyId", companyId)
      .maybeSingle(),
  ]);
  if (jobResult.error) throw new Error("Failed to fetch job");
  if (!jobResult.data) throw new NotFoundError("Job not found");
  const job = jobResult.data;

  if (!assetClass.isConstructionInProgress) {
    throw new ValidationError(
      `Asset ${asset.fixedAssetId} is not in a Construction in Progress class`,
    );
  }
  if (asset.status !== "Draft" && asset.status !== "Under Construction") {
    throw new ValidationError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; a job can only be attached while it is Draft or Under Construction`,
    );
  }
  if (CLOSED_JOB_STATUSES.has(job.status)) {
    throw new ValidationError(
      `Job ${job.jobId} is ${job.status} and can no longer be attached to an asset`,
    );
  }
  if (job.salesOrderLineId) {
    throw new ValidationError(
      `Job ${job.jobId} is linked to a sales order line and cannot build an asset`,
    );
  }
  if (job.fixedAssetClassId || job.fixedAssetId) {
    throw new ValidationError(
      `Job ${job.jobId} already completes to a fixed asset`,
    );
  }

  const today = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const accounting = await loadAccounting(client, companyId, today);

  return db.transaction().execute(async (trx): Promise<TransferResult> => {
    // The job's WIP balance so far: cost leaves WIP at attachment (SAP AuC).
    // Without accounting there are no journals and nothing to sweep.
    let balance = 0;
    if (accounting) {
      const wip = await trx
        .selectFrom("journalLine as jl")
        .innerJoin("journal as j", (join) =>
          join
            .onRef("j.id", "=", "jl.journalId")
            .onRef("j.companyId", "=", "jl.companyId"))
        .select((eb) =>
          eb.fn.coalesce(eb.fn.sum<number>("jl.amount"), sql<number>`0`).as(
            "balance",
          )
        )
        .where(
          "jl.accountId",
          "=",
          accounting.accountDefaults.workInProgressAccount,
        )
        .where("jl.documentId", "=", jobId)
        .where("jl.companyId", "=", companyId)
        .where("j.status", "<>", "Draft")
        .executeTakeFirst();
      balance = round(Number(wip?.balance ?? 0));
    }

    let result: Pick<TransferResult, "id" | "transferId"> = {
      id: null,
      transferId: null,
    };
    // balance is 0 without accounting; the narrowing is for the journal below.
    if (accounting && balance > 0) {
      const transferId = await getNextSequence(
        trx,
        "fixedAssetTransfer",
        companyId,
      );
      const transfer = await trx
        .insertInto("fixedAssetTransfer")
        .values({
          transferId,
          type: "Capitalization",
          sourceType: "Job",
          fixedAssetId: asset.id,
          itemId: job.itemId,
          jobId,
          locationId: job.locationId,
          quantity: 1,
          transferDate: today,
          amount: balance,
          status: "Draft",
          companyId,
          createdBy: userId,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      // Both lines carry the job as documentId so the per-job WIP balance
      // still nets to zero; the transfer rides in documentLineReference.
      const journalId = await postAssetJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: today,
        description: `Attach job ${job.jobId} → ${asset.fixedAssetId}`,
        lines: buildCapitalizationLines({
          cost: balance,
          assetAccountId: assetClass.assetAccountId,
          creditAccountId: accounting.accountDefaults.workInProgressAccount,
          creditDescription: "WIP Account",
        }),
        documentId: jobId,
        documentLineReference: transferId,
        tags: {
          locationId: job.locationId,
          fixedAssetClassId: assetClass.id,
          itemId: job.itemId,
        },
      });

      await trx
        .insertInto("fixedAssetCipCost")
        .values({
          fixedAssetId: asset.id,
          sourceType: "Job",
          jobId,
          amount: balance,
          costDate: today,
          journalId,
          companyId,
          createdBy: userId,
        })
        .execute();

      await postTransfer(trx, {
        id: transfer.id,
        amount: balance,
        journalId,
        companyId,
        userId,
      });
      result = { id: transfer.id, transferId };
    }

    // The link itself: guarded on the job still having no target, so two
    // concurrent attachments cannot both win.
    const linked = await trx
      .updateTable("job")
      .set({
        fixedAssetId: asset.id,
        updatedAt: datetime.timestamp(),
        updatedBy: userId,
      })
      .where("id", "=", jobId)
      .where("companyId", "=", companyId)
      .where("fixedAssetId", "is", null)
      .where("fixedAssetClassId", "is", null)
      .executeTakeFirst();
    if (!linked.numUpdatedRows) {
      throw new ValidationError(
        `Job ${job.jobId} already completes to a fixed asset`,
      );
    }
    await trx
      .updateTable("fixedAsset")
      .set({
        status: "Under Construction",
        acquisitionCost: round(asset.acquisitionCost + balance),
        // A self-built asset lives where it is built (post-receipt precedent:
        // the receiving location fills an unset asset location).
        locationId: asset.locationId ?? job.locationId,
        updatedAt: datetime.timestamp(),
        updatedBy: userId,
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .execute();

    return {
      ...result,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId,
    };
  });
}

async function capitalizeCip(
  client: Client,
  payload: Extract<AssetTransferPayload, { type: "capitalizeCip" }>,
): Promise<TransferResult> {
  const { companyId, userId, inServiceDate } = payload;

  const asset = await getAsset(client, companyId, payload.fixedAssetId);
  const [cipClass, targetClass] = await Promise.all([
    getAssetClass(client, companyId, asset.fixedAssetClassId),
    getAssetClass(client, companyId, payload.toClassId),
  ]);

  if (asset.status !== "Under Construction") {
    throw new ValidationError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; only an Under Construction asset can be capitalized`,
    );
  }
  if (!cipClass.isConstructionInProgress) {
    throw new ValidationError(
      `Asset ${asset.fixedAssetId} is not in a Construction in Progress class`,
    );
  }
  if (targetClass.isConstructionInProgress) {
    throw new ValidationError(
      `${targetClass.name} is a Construction in Progress class; choose the in-service class`,
    );
  }

  // The transfer document needs a location: the asset's own, else the site
  // of the job that built it.
  let locationId = asset.locationId;
  if (!locationId) {
    const builder = await client
      .from("job")
      .select("locationId")
      .eq("fixedAssetId", asset.id)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (builder.error) throw new Error("Failed to fetch jobs");
    locationId = builder.data?.locationId ?? null;
  }
  if (!locationId) {
    throw new ValidationError(
      `Set a location on asset ${asset.fixedAssetId} before capitalizing it`,
    );
  }

  const accounting = await loadAccounting(client, companyId, inServiceDate);

  return db.transaction().execute(async (trx): Promise<TransferResult> => {
    const cipCost = await trx
      .selectFrom("fixedAssetCipCost")
      .select((eb) =>
        eb.fn.coalesce(eb.fn.sum<number>("amount"), sql<number>`0`).as("total")
      )
      .where("fixedAssetId", "=", asset.id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    const total = round(Number(cipCost?.total ?? 0));
    if (total <= 0) {
      throw new ValidationError(
        `Asset ${asset.fixedAssetId} has no Construction in Progress cost to capitalize`,
      );
    }

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId,
    );
    const transfer = await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Capitalization",
        sourceType: "Construction in Progress",
        fixedAssetId: asset.id,
        itemId: asset.itemId,
        trackedEntityId: asset.trackedEntityId,
        fromClassId: cipClass.id,
        locationId,
        quantity: 1,
        transferDate: inServiceDate,
        inServiceDate,
        amount: total,
        status: "Draft",
        companyId,
        createdBy: userId,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    let journalId: string | null = null;
    if (accounting) {
      journalId = await postAssetJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: inServiceDate,
        description:
          `Capitalize ${asset.fixedAssetId} — ${cipClass.name} → ${targetClass.name}`,
        lines: buildCapitalizationLines({
          cost: total,
          assetAccountId: targetClass.assetAccountId,
          creditAccountId: cipClass.assetAccountId,
          creditDescription: "Construction in Progress",
        }),
        documentId: transfer.id,
        tags: {
          locationId,
          fixedAssetClassId: targetClass.id,
          itemId: asset.itemId,
        },
      });
    }

    // Depreciation starts at the in-service date under the in-service class's
    // policy; the CIP class's method / life / residual were placeholders that
    // never ran.
    const capitalized = await trx
      .updateTable("fixedAsset")
      .set({
        fixedAssetClassId: targetClass.id,
        acquisitionCost: total,
        acquisitionDate: inServiceDate,
        depreciationStartDate: inServiceDate,
        depreciationMethod: targetClass.depreciationMethod,
        usefulLifeMonths: targetClass.usefulLifeMonths,
        residualValuePercent: targetClass.residualValuePercent,
        locationId,
        status: "Active",
        updatedAt: datetime.timestamp(),
        updatedBy: userId,
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Under Construction")
      .executeTakeFirst();
    if (!capitalized.numUpdatedRows) {
      throw new ValidationError(
        `Asset ${asset.fixedAssetId} is no longer Under Construction`,
      );
    }

    await postTransfer(trx, {
      id: transfer.id,
      amount: total,
      journalId,
      companyId,
      userId,
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId,
    };
  });
}

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = payloadValidator.parse(await req.json());
    const { companyId, userId } = payload;

    const client = await requirePermissions(req, companyId, userId, {
      create: "accounting",
    });

    let result: TransferResult;
    switch (payload.type) {
      case "capitalize":
        result = await capitalize(client, payload);
        break;
      case "return":
        result = await returnToInventory(client, payload);
        break;
      case "attachJob":
        result = await attachJob(client, payload);
        break;
      case "capitalizeCip":
        result = await capitalizeCip(client, payload);
        break;
    }

    return jsonResponse(result, 201);
  } catch (err) {
    logger.error("post-asset-transfer failed", {
      error: String((err as Error).stack ?? err),
    });
    // A payload ZodError is the caller's input contract failing, same as our
    // own ValidationError — a 400, not an outage.
    const status = err instanceof NotFoundError
      ? 404
      : err instanceof ValidationError || err instanceof z.ZodError
      ? 400
      : 500;
    return errorResponse(err, status);
  }
});
