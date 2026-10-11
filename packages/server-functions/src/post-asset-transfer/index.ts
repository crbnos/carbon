// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone, type Json } from "@carbon/database";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import type { KyselyDatabase as DB, Kysely } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  assertPostingStatusUnchanged,
  journalPostingStatus
} from "@carbon/database/journal-posting-status";
import { inOrder } from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { datetime, round } from "@carbon/utils";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { assertCompanyRecords } from "../company-records";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  buildCapitalizationLines,
  buildReturnToInventoryLines,
  type PostingLine
} from "../lib/asset-transfer";
import { getAccountingPeriodForDate } from "../lib/get-accounting-period";
import {
  getDefaultPostingGroup,
  resolveInventoryAccount
} from "../lib/get-posting-group";
import { getOffsetAccount } from "../lib/offset-account";
import {
  bookAdjustment,
  createAdjustmentJournal
} from "../lib/post-adjustment";
import { authorize } from "../server-fn-context";
import {
  ADJUSTABLE_ASSET_STATUSES,
  type AssetTransferInput,
  CLOSED_JOB_STATUSES,
  postAssetTransferInput,
  RETURNABLE_ASSET_STATUSES,
  resolveCapitalizationCost,
  resolveCapitalizationStock,
  statusAfterCostAdjustment
} from "./validators";

export { postAssetTransferInput } from "./validators";

// The single write path for moving value between inventory and the fixed
// asset register (spec §2, "Fleet bridge"). Five actions, each creating and
// posting one `fixedAssetTransfer` document in ONE transaction:
//
//   capitalize     stock → asset at the unit's carrying cost (the serial is
//                  consumed INTO the asset; Dr class asset / Cr inventory);
//                  a unit carried at zero takes the cost the user enters
//                  instead (Dr class asset / Cr the chosen offset account),
//                  and is refused without one
//   return         asset → stock at net book value (Dr inventory N / Dr
//                  accumulated depreciation / Cr class asset at cost)
//   attachJob      point a job at a Construction in Progress asset and sweep
//                  its WIP balance there (Dr CIP / Cr WIP), SAP AuC style
//   capitalizeCip  CIP asset → its in-service class (Dr class / Cr CIP)
//   adjustCost     raise an asset's cost after it was capitalized (Dr class
//                  asset / Cr the chosen offset account), SAP
//                  post-capitalization style
//
// Every action writes its journal: Provisional before the company's
// accounting cutover, Posted after it.
//
// Business-validation failures are 400s (`InvalidInputError`) with the exact
// message the app shows; a referenced record the caller's company does not own
// is a 404 (`NotFoundError`); everything else is a 500 so real outages surface
// in monitoring.

type Db = Kysely<DB>;
type Trx = Transaction<DB>;

type Scoped<T extends AssetTransferInput["type"]> = Extract<
  AssetTransferInput,
  { type: T }
> & { companyId: string; userId: string };

type AccountingContext = {
  // Provisional before the company's accounting cutover, Posted after it
  postingStatus: AutomaticJournalStatus;
  // null for a Provisional journal: it has no accounting period
  accountingPeriodId: string | null;
  accountDefaults: {
    rawMaterialsAccount: string;
    finishedGoodsAccount: string;
    workInProgressAccount: string;
  };
  // active dimensions for the company group, entityType → dimension id
  dimensions: Record<string, string>;
};

export type AssetTransferResult = {
  // fixedAssetTransfer row id / readable number; null when nothing was swept
  id: string | null;
  transferId: string | null;
  // fixedAsset row id / readable number
  fixedAssetId: string;
  fixedAssetReadableId: string;
};

// Everything a journal needs that is known before the transaction opens. The
// period resolver opens (and commits) its own transaction when given `db`.
async function loadAccounting(
  db: Db,
  companyId: string,
  postingDate: string
): Promise<AccountingContext> {
  const postingStatus = await journalPostingStatus(db, companyId);

  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults.error || !accountDefaults.data) {
    throw new Error("Error getting account defaults");
  }

  const company = await db
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company) throw new Error("Failed to fetch company");
  // Fail closed: journal lines must not silently lose dimension tags (a
  // failed read throws).
  const dimensionRows = await db
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", company.companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", ["Item", "Location", "FixedAssetClass"])
    .execute();
  const dimensions: Record<string, string> = {};
  for (const dimension of dimensionRows) {
    dimensions[dimension.entityType] = dimension.id;
  }

  // A Provisional journal has no period, and no posting creates one before
  // the cutover.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getAccountingPeriodForDate(companyId, db, postingDate)
      : null;

  return {
    postingStatus,
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
      finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
      workInProgressAccount: accountDefaults.data.workInProgressAccount
    },
    dimensions
  };
}

// One 'Asset Transfer' journal from already-balanced lines (Provisional before
// the accounting cutover, Posted after it), tagged with
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
  }
): Promise<string> {
  const { accounting, companyId, userId } = args;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId: accounting.accountingPeriodId,
    status: accounting.postingStatus,
    description: args.description,
    postingDate: args.postingDate,
    userId,
    sourceType: "Asset Transfer"
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
        companyId
      }))
    )
    .returning(["id"])
    .execute();

  const tagValues: Array<[string, string | null]> = [
    ["Location", args.tags.locationId],
    ["FixedAssetClass", args.tags.fixedAssetClassId],
    ["Item", args.tags.itemId]
  ];
  const dimensionInserts = journalLines.flatMap((line) =>
    tagValues
      .filter(
        ([entityType, valueId]) => accounting.dimensions[entityType] && valueId
      )
      .map(([entityType, valueId]) => ({
        journalLineId: line.id,
        dimensionId: accounting.dimensions[entityType] as string,
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
  outOfServiceSince: unknown;
};

async function getAsset(
  db: Db,
  companyId: string,
  id: string
): Promise<AssetRow> {
  const asset = await db
    .selectFrom("fixedAsset")
    .select([
      "id",
      "fixedAssetId",
      "fixedAssetClassId",
      "name",
      "status",
      "itemId",
      "trackedEntityId",
      "locationId",
      "acquisitionCost",
      "accumulatedDepreciation",
      "outOfServiceSince"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!asset) throw new NotFoundError("Fixed asset not found");
  return {
    ...asset,
    acquisitionCost: Number(asset.acquisitionCost ?? 0),
    accumulatedDepreciation: Number(asset.accumulatedDepreciation ?? 0)
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
  db: Db,
  companyId: string,
  id: string
): Promise<AssetClassRow> {
  const assetClass = await db
    .selectFrom("fixedAssetClass")
    .select([
      "id",
      "name",
      "assetAccountId",
      "accumulatedDepreciationAccountId",
      "isConstructionInProgress",
      "depreciationMethod",
      "usefulLifeMonths",
      "residualValuePercent"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!assetClass) throw new NotFoundError("Fixed asset class not found");
  return assetClass;
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
  db: Db,
  companyId: string,
  itemId: string
): Promise<InventoryItem> {
  const [item, itemCost] = await inOrder([
    () =>
      db
        .selectFrom("item")
        .select([
          "id",
          "name",
          "readableId",
          "itemTrackingType",
          "replenishmentSystem"
        ])
        .where("id", "=", itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
    () =>
      db
        .selectFrom("itemCost")
        .select([
          "costingMethod",
          "unitCost",
          "standardCost",
          "itemPostingGroupId"
        ])
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
  ]);
  if (!item) throw new NotFoundError("Item not found");
  if (!itemCost) throw new NotFoundError("Item cost not found");
  return {
    ...item,
    itemPostingGroupId: itemCost.itemPostingGroupId,
    itemCost: {
      costingMethod: itemCost.costingMethod,
      unitCost: itemCost.unitCost,
      standardCost: itemCost.standardCost
    }
  };
}

type TrackedEntityRow = {
  id: string;
  itemId: string | null;
  readableId: string | null;
  status: Database["public"]["Enums"]["trackedEntityStatus"];
};

async function getTrackedEntity(
  db: Db,
  companyId: string,
  id: string
): Promise<TrackedEntityRow> {
  const entity = await db
    .selectFrom("trackedEntity")
    .select(["id", "itemId", "readableId", "status"])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!entity) throw new NotFoundError("Tracked entity not found");
  return entity;
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
  }
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
      createdBy: args.userId
    })
    .execute();
  await trx
    .insertInto(
      args.direction === "input"
        ? "trackedActivityInput"
        : "trackedActivityOutput"
    )
    .values({
      trackedActivityId: activityId,
      trackedEntityId: args.trackedEntityId,
      quantity: 1,
      companyId: args.companyId,
      createdBy: args.userId
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
  }
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
      updatedBy: args.userId
    })
    .where("id", "=", args.id)
    .where("companyId", "=", args.companyId)
    .execute();
}

async function capitalize(
  db: Db,
  payload: Scoped<"capitalize">
): Promise<AssetTransferResult> {
  const { companyId, userId, itemId, trackedEntityId, locationId } = payload;

  const [assetClass, item, entity] = await inOrder([
    () => getAssetClass(db, companyId, payload.fixedAssetClassId),
    () => getInventoryItem(db, companyId, itemId),
    () => getTrackedEntity(db, companyId, trackedEntityId),
    () =>
      assertCompanyRecords(db, "location", [locationId], companyId, "Location"),
    () =>
      assertCompanyRecords(
        db,
        "storageUnit",
        [payload.storageUnitId],
        companyId,
        "Storage unit"
      )
  ]);
  const draftAsset = payload.fixedAssetId
    ? await getAsset(db, companyId, payload.fixedAssetId)
    : null;

  if (entity.itemId !== itemId) {
    throw new InvalidInputError("The unit does not belong to this item");
  }
  if (entity.status !== "Available") {
    throw new InvalidInputError(
      `Only an Available unit can be capitalized; ${
        entity.readableId ?? entity.id
      } is ${entity.status}`
    );
  }
  if (draftAsset && draftAsset.status !== "Draft") {
    throw new InvalidInputError(
      `Asset ${draftAsset.fixedAssetId} is ${draftAsset.status}; only a Draft asset can be filled`
    );
  }

  // The partial unique index refuses two live assets on one unit as well; the
  // read gives the caller a reason instead of a constraint name.
  const liveAsset = await db
    .selectFrom("fixedAsset")
    .select("fixedAssetId")
    .where("trackedEntityId", "=", trackedEntityId)
    .where("companyId", "=", companyId)
    .where("status", "<>", "Disposed")
    .limit(1)
    .executeTakeFirst();
  if (liveAsset) {
    throw new InvalidInputError(
      `${
        entity.readableId ?? entity.id
      } is already on asset ${liveAsset.fixedAssetId}`
    );
  }

  const accounting = await loadAccounting(db, companyId, payload.transferDate);
  // Only read when a cost was entered; whether one may be is decided once the
  // unit's carrying cost is known, inside the transaction.
  const offsetAccount =
    payload.cost != null
      ? await getOffsetAccount(db, companyId, payload.offsetAccountId)
      : null;
  const serial = entity.readableId ?? entity.id;
  const status = assetClass.isConstructionInProgress
    ? ("Under Construction" as const)
    : ("Active" as const);

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // Net on-hand per bin at the location, read inside the transaction so the
    // consumption below books against the same snapshot.
    const stockRows = await trx
      .selectFrom("itemLedger")
      .select([
        "storageUnitId",
        (eb) => eb.fn.sum<number>("quantity").as("onHand")
      ])
      .where("trackedEntityId", "=", trackedEntityId)
      .where("itemId", "=", itemId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .groupBy("storageUnitId")
      .execute();
    const stock = resolveCapitalizationStock(
      stockRows,
      payload.storageUnitId ?? null
    );
    if (round(stock.onHand) !== 1) {
      throw new InvalidInputError(
        `${serial} must have exactly one unit on hand at this location (found ${round(
          stock.onHand
        )})`
      );
    }

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId
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
      status
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
          updatedBy: userId
        })
        .where("id", "=", draftAsset.id)
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .executeTakeFirst();
      if (!filled.numUpdatedRows) {
        throw new InvalidInputError("Asset is no longer in Draft status");
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
          createdBy: userId
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
        createdBy: userId
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
        createdBy: userId
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: item.itemPostingGroupId
      },
      itemCost: item.itemCost,
      accounting: null
    });
    // The transfer moves the value inventory already holds. A unit carried at
    // nothing (a job that recorded no production or material, a no-cost
    // issue) would become an asset worth nothing with no journal to say so,
    // so it takes the cost the user entered instead — booked from the offset
    // account that value was spent from — and is refused without one.
    const resolved = resolveCapitalizationCost({
      carried: round(booked.cost),
      entered: payload.cost == null ? null : round(payload.cost),
      serial,
      itemReadableId: item.readableId
    });
    if ("error" in resolved) throw new InvalidInputError(resolved.error);
    const cost = resolved.cost;

    const inventoryAccount = resolveInventoryAccount(
      item.replenishmentSystem,
      accounting.accountDefaults
    );
    const credit =
      resolved.source === "entered" && offsetAccount
        ? {
            account: offsetAccount.id,
            description: "Capitalized Cost",
            type: offsetAccount.type
          }
        : { ...inventoryAccount, type: "asset" as const };
    const journalId = await postAssetJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: payload.transferDate,
      description: `Capitalize ${item.readableId} ${serial} → ${asset.fixedAssetId}`,
      lines: buildCapitalizationLines({
        cost,
        assetAccountId: assetClass.assetAccountId,
        creditAccountId: credit.account,
        creditDescription: credit.description,
        creditAccountType: credit.type
      }),
      documentId: transfer.id,
      tags: { locationId, fixedAssetClassId: assetClass.id, itemId }
    });

    await trx
      .updateTable("fixedAsset")
      .set({
        acquisitionCost: cost,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .execute();

    // A CIP-class asset is later capitalized for Σ fixedAssetCipCost, so the
    // value that arrived from stock has to be on that ledger too.
    if (assetClass.isConstructionInProgress) {
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
          createdBy: userId
        })
        .execute();
    }

    // The unit is consumed into the asset: no longer stock, and the asset id
    // on its attributes is how the fleet finds it again.
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Consumed",
        attributes: sql<Json>`COALESCE("attributes", '{}'::jsonb) || jsonb_build_object('Fixed Asset', ${asset.id}::text)`
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
      userId
    });

    await postTransfer(trx, {
      id: transfer.id,
      amount: cost,
      journalId,
      companyId,
      userId
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

async function returnToInventory(
  db: Db,
  payload: Scoped<"return">
): Promise<AssetTransferResult> {
  const { companyId, userId, locationId } = payload;

  const asset = await getAsset(db, companyId, payload.fixedAssetId);
  if (!RETURNABLE_ASSET_STATUSES.has(asset.status)) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; only an Active or Fully Depreciated asset can be returned to inventory`
    );
  }
  if (asset.outOfServiceSince) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is out of service; return it to service first`
    );
  }
  if (!asset.itemId || !asset.trackedEntityId) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is not linked to a serialized inventory unit`
    );
  }
  const netBookValue = round(
    asset.acquisitionCost - asset.accumulatedDepreciation
  );
  if (netBookValue < 0) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} has a negative net book value`
    );
  }

  const assetItemId = asset.itemId;
  const assetTrackedEntityId = asset.trackedEntityId;
  const [assetClass, item, entity] = await inOrder([
    () => getAssetClass(db, companyId, asset.fixedAssetClassId),
    () => getInventoryItem(db, companyId, assetItemId),
    () => getTrackedEntity(db, companyId, assetTrackedEntityId),
    () =>
      assertCompanyRecords(db, "location", [locationId], companyId, "Location"),
    () =>
      assertCompanyRecords(
        db,
        "storageUnit",
        [payload.storageUnitId],
        companyId,
        "Storage unit"
      )
  ]);
  if (entity.status !== "Consumed") {
    throw new InvalidInputError(
      `Unit ${
        entity.readableId ?? entity.id
      } is ${entity.status}, not consumed into the asset`
    );
  }

  const accounting = await loadAccounting(db, companyId, payload.transferDate);
  const serial = entity.readableId ?? entity.id;
  const trackedEntityId = entity.id;
  const itemId = item.id;

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // A unit reserved or on rent belongs to that agreement until it comes
    // back: the live-line statuses are the ones the fleetAssets view and the
    // rentalAgreementLine_asset_live_idx unique index key on.
    const liveLine = await trx
      .selectFrom("rentalAgreementLine as ral")
      .innerJoin("rentalAgreement as ra", (join) =>
        join
          .onRef("ra.id", "=", "ral.rentalAgreementId")
          .onRef("ra.companyId", "=", "ral.companyId")
      )
      .select(["ral.status", "ra.rentalAgreementId"])
      .where("ral.fixedAssetId", "=", asset.id)
      .where("ral.companyId", "=", companyId)
      .where("ral.status", "in", ["Pending", "On Rent"])
      .executeTakeFirst();
    if (liveLine) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is ${
          liveLine.status === "On Rent" ? "on rent" : "reserved"
        } on rental agreement ${liveLine.rentalAgreementId}; return it from the agreement first`
      );
    }

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId
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
        createdBy: userId
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
        createdBy: userId
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: item.itemPostingGroupId
      },
      itemCost: item.itemCost,
      accounting: null,
      fixedUnitCost: netBookValue
    });

    // An asset carried at zero cost has nothing on the books to move.
    let journalId: string | null = null;
    if (round(asset.acquisitionCost) > 0) {
      const inventoryAccount = resolveInventoryAccount(
        item.replenishmentSystem,
        accounting.accountDefaults
      );
      journalId = await postAssetJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: payload.transferDate,
        description: `Return to inventory ${asset.fixedAssetId} → ${item.readableId} ${serial}`,
        lines: buildReturnToInventoryLines({
          cost: asset.acquisitionCost,
          accumulatedDepreciation: asset.accumulatedDepreciation,
          inventoryAccountId: inventoryAccount.account,
          inventoryDescription: inventoryAccount.description,
          accounts: {
            assetAccountId: assetClass.assetAccountId,
            accumulatedDepreciationAccountId:
              assetClass.accumulatedDepreciationAccountId
          }
        }),
        documentId: transfer.id,
        tags: { locationId, fixedAssetClassId: assetClass.id, itemId }
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
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", [...RETURNABLE_ASSET_STATUSES])
      .executeTakeFirst();
    if (!disposed.numUpdatedRows) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} changed status while it was being returned`
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
        createdBy: userId
      })
      .execute();

    // The return inspection already happened on the agreement, so the unit
    // comes back Available (an RMA reactivates to On Hold because none has).
    await trx
      .updateTable("trackedEntity")
      .set({
        status: "Available",
        attributes: sql<Json>`COALESCE("attributes", '{}'::jsonb) - 'Fixed Asset'`
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
      userId
    });

    await postTransfer(trx, {
      id: transfer.id,
      amount: netBookValue,
      journalId,
      companyId,
      userId
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

async function attachJob(
  db: Db,
  payload: Scoped<"attachJob">
): Promise<AssetTransferResult> {
  const { companyId, userId, jobId } = payload;

  const asset = await getAsset(db, companyId, payload.fixedAssetId);
  const [assetClass, jobRow] = await inOrder([
    () => getAssetClass(db, companyId, asset.fixedAssetClassId),
    () =>
      db
        .selectFrom("job")
        .select([
          "id",
          "jobId",
          "itemId",
          "status",
          "locationId",
          "salesOrderLineId",
          "fixedAssetClassId",
          "fixedAssetId"
        ])
        .where("id", "=", jobId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
  ]);
  if (!jobRow) throw new NotFoundError("Job not found");
  const job = jobRow;

  if (!assetClass.isConstructionInProgress) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is not in a Construction in Progress class`
    );
  }
  if (asset.status !== "Draft" && asset.status !== "Under Construction") {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; a job can only be attached while it is Draft or Under Construction`
    );
  }
  if (CLOSED_JOB_STATUSES.has(job.status)) {
    throw new InvalidInputError(
      `Job ${job.jobId} is ${job.status} and can no longer be attached to an asset`
    );
  }
  if (job.salesOrderLineId) {
    throw new InvalidInputError(
      `Job ${job.jobId} is linked to a sales order line and cannot build an asset`
    );
  }
  if (job.fixedAssetClassId || job.fixedAssetId) {
    throw new InvalidInputError(
      `Job ${job.jobId} already completes to a fixed asset`
    );
  }

  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();
  const accounting = await loadAccounting(db, companyId, today);

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // The job's WIP balance so far: cost leaves WIP at attachment (SAP AuC).
    // Before the cutover it sits in Provisional journals and is swept by one.
    const wip = await trx
      .selectFrom("journalLine as jl")
      .innerJoin("journal as j", (join) =>
        join
          .onRef("j.id", "=", "jl.journalId")
          .onRef("j.companyId", "=", "jl.companyId")
      )
      .select((eb) =>
        eb.fn
          .coalesce(eb.fn.sum<number>("jl.amount"), sql<number>`0`)
          .as("balance")
      )
      .where(
        "jl.accountId",
        "=",
        accounting.accountDefaults.workInProgressAccount
      )
      .where("jl.documentId", "=", jobId)
      .where("jl.companyId", "=", companyId)
      .where("j.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
      .executeTakeFirst();
    const balance = round(Number(wip?.balance ?? 0));

    let result: Pick<AssetTransferResult, "id" | "transferId"> = {
      id: null,
      transferId: null
    };
    if (balance > 0) {
      const transferId = await getNextSequence(
        trx,
        "fixedAssetTransfer",
        companyId
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
          createdBy: userId
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
          creditDescription: "WIP Account"
        }),
        documentId: jobId,
        documentLineReference: transferId,
        tags: {
          locationId: job.locationId,
          fixedAssetClassId: assetClass.id,
          itemId: job.itemId
        }
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
          createdBy: userId
        })
        .execute();

      await postTransfer(trx, {
        id: transfer.id,
        amount: balance,
        journalId,
        companyId,
        userId
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
        updatedBy: userId
      })
      .where("id", "=", jobId)
      .where("companyId", "=", companyId)
      .where("fixedAssetId", "is", null)
      .where("fixedAssetClassId", "is", null)
      .executeTakeFirst();
    if (!linked.numUpdatedRows) {
      throw new InvalidInputError(
        `Job ${job.jobId} already completes to a fixed asset`
      );
    }
    // Guarded on the status read above and written relative to the row as
    // it is now: a concurrent capitalization or another attachment must not
    // be overwritten with a cost read before this transaction began.
    const swept = await trx
      .updateTable("fixedAsset")
      .set({
        status: "Under Construction",
        acquisitionCost: sql<number>`COALESCE("acquisitionCost", 0) + ${balance}`,
        // A self-built asset lives where it is built (post-receipt precedent:
        // the receiving location fills an unset asset location).
        locationId: sql<
          string | null
        >`COALESCE("locationId", ${job.locationId})`,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", ["Draft", "Under Construction"])
      .executeTakeFirst();
    if (!swept.numUpdatedRows) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is no longer Draft or Under Construction`
      );
    }

    return {
      ...result,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

async function capitalizeCip(
  db: Db,
  payload: Scoped<"capitalizeCip">
): Promise<AssetTransferResult> {
  const { companyId, userId, inServiceDate } = payload;

  const asset = await getAsset(db, companyId, payload.fixedAssetId);
  const [cipClass, targetClass] = await inOrder([
    () => getAssetClass(db, companyId, asset.fixedAssetClassId),
    () => getAssetClass(db, companyId, payload.toClassId)
  ]);

  if (asset.status !== "Under Construction") {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; only an Under Construction asset can be capitalized`
    );
  }
  if (!cipClass.isConstructionInProgress) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is not in a Construction in Progress class`
    );
  }
  if (targetClass.isConstructionInProgress) {
    throw new InvalidInputError(
      `${targetClass.name} is a Construction in Progress class; choose the in-service class`
    );
  }

  // The transfer document needs a location: the asset's own, else the site
  // of the job that built it.
  let locationId = asset.locationId;
  if (!locationId) {
    const builder = await db
      .selectFrom("job")
      .select("locationId")
      .where("fixedAssetId", "=", asset.id)
      .where("companyId", "=", companyId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .executeTakeFirst();
    locationId = builder?.locationId ?? null;
  }
  if (!locationId) {
    throw new InvalidInputError(
      `Set a location on asset ${asset.fixedAssetId} before capitalizing it`
    );
  }
  const assetLocationId = locationId;

  const accounting = await loadAccounting(db, companyId, inServiceDate);

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // Lock the asset before summing its cost rows: an attachment or a
    // receipt adding a row after the sum would be left out of the
    // capitalized cost while the asset leaves Under Construction.
    const locked = await trx
      .selectFrom("fixedAsset")
      .select("status")
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (locked?.status !== "Under Construction") {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is no longer Under Construction`
      );
    }

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
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} has no Construction in Progress cost to capitalize`
      );
    }

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId
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
        locationId: assetLocationId,
        quantity: 1,
        transferDate: inServiceDate,
        inServiceDate,
        amount: total,
        status: "Draft",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalId = await postAssetJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: inServiceDate,
      description: `Capitalize ${asset.fixedAssetId} — ${cipClass.name} → ${targetClass.name}`,
      lines: buildCapitalizationLines({
        cost: total,
        assetAccountId: targetClass.assetAccountId,
        creditAccountId: cipClass.assetAccountId,
        creditDescription: "Construction in Progress"
      }),
      documentId: transfer.id,
      tags: {
        locationId: assetLocationId,
        fixedAssetClassId: targetClass.id,
        itemId: asset.itemId
      }
    });

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
        locationId: assetLocationId,
        status: "Active",
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Under Construction")
      .executeTakeFirst();
    if (!capitalized.numUpdatedRows) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is no longer Under Construction`
      );
    }

    await postTransfer(trx, {
      id: transfer.id,
      amount: total,
      journalId,
      companyId,
      userId
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

async function adjustCost(
  db: Db,
  payload: Scoped<"adjustCost">
): Promise<AssetTransferResult> {
  const { companyId, userId, locationId } = payload;

  const asset = await getAsset(db, companyId, payload.fixedAssetId);
  if (!ADJUSTABLE_ASSET_STATUSES.has(asset.status)) {
    throw new InvalidInputError(
      `Asset ${asset.fixedAssetId} is ${asset.status}; only an Active or Fully Depreciated asset's cost can be adjusted`
    );
  }
  const [assetClass] = await inOrder([
    () => getAssetClass(db, companyId, asset.fixedAssetClassId),
    () =>
      assertCompanyRecords(db, "location", [locationId], companyId, "Location")
  ]);

  const amount = round(payload.amount);
  if (amount <= 0) {
    throw new InvalidInputError("The cost adjustment must be more than zero");
  }

  const accounting = await loadAccounting(db, companyId, payload.transferDate);
  const offsetAccount = await getOffsetAccount(
    db,
    companyId,
    payload.offsetAccountId
  );

  return db.transaction().execute(async (trx): Promise<AssetTransferResult> => {
    await assertPostingStatusUnchanged(
      trx,
      companyId,
      accounting.postingStatus
    );
    // Re-read under a row lock: a concurrent run, disposal or adjustment
    // changes the values the new status is derived from.
    const current = await trx
      .selectFrom("fixedAsset")
      .select([
        "status",
        "acquisitionCost",
        "accumulatedDepreciation",
        "residualValuePercent"
      ])
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (!ADJUSTABLE_ASSET_STATUSES.has(current.status)) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} is ${current.status}; only an Active or Fully Depreciated asset's cost can be adjusted`
      );
    }
    const acquisitionCost = round(Number(current.acquisitionCost) + amount);

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId
    );
    const transfer = await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Cost Adjustment",
        sourceType: "Manual",
        fixedAssetId: asset.id,
        itemId: asset.itemId,
        trackedEntityId: asset.trackedEntityId,
        locationId,
        quantity: 1,
        transferDate: payload.transferDate,
        amount: 0,
        accumulatedDepreciation: Number(current.accumulatedDepreciation),
        status: "Draft",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalId = await postAssetJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: payload.transferDate,
      description: `Cost Adjustment ${asset.fixedAssetId}`,
      lines: buildCapitalizationLines({
        cost: amount,
        assetAccountId: assetClass.assetAccountId,
        creditAccountId: offsetAccount.id,
        creditDescription: "Capitalized Cost",
        creditAccountType: offsetAccount.type
      }),
      documentId: transfer.id,
      tags: {
        locationId,
        fixedAssetClassId: assetClass.id,
        itemId: asset.itemId
      }
    });

    // Depreciation already taken stays; the next run catches a Straight Line
    // asset up on the months it took at the old cost (buildDepreciationLines).
    const adjusted = await trx
      .updateTable("fixedAsset")
      .set({
        acquisitionCost,
        status: statusAfterCostAdjustment({
          status: current.status,
          acquisitionCost,
          accumulatedDepreciation: Number(current.accumulatedDepreciation),
          residualValuePercent: Number(current.residualValuePercent)
        }),
        locationId: asset.locationId ?? locationId,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", [...ADJUSTABLE_ASSET_STATUSES])
      .executeTakeFirst();
    if (!adjusted.numUpdatedRows) {
      throw new InvalidInputError(
        `Asset ${asset.fixedAssetId} changed status while its cost was being adjusted`
      );
    }

    await postTransfer(trx, {
      id: transfer.id,
      amount,
      journalId,
      companyId,
      userId
    });

    return {
      id: transfer.id,
      transferId,
      fixedAssetId: asset.id,
      fixedAssetReadableId: asset.fixedAssetId
    };
  });
}

/**
 * Creates and posts one `fixedAssetTransfer` document between inventory and
 * the fixed asset register, per `type`. Every record id in the input is
 * re-read under companyId before anything is written.
 */
const postAssetTransfer = defineServerFn({
  name: "post-asset-transfer",
  input: postAssetTransferInput,
  // Moving value the books already hold is `create`; putting a number of
  // your own on an asset (an entered cost, a cost adjustment) is recosting,
  // which takes `update`.
  permissions: {
    by: "type",
    rules: {
      capitalize: { create: "accounting" },
      return: { create: "accounting" },
      attachJob: { create: "accounting" },
      capitalizeCip: { create: "accounting" },
      adjustCost: { update: "accounting" }
    }
  },
  async run(ctx, input): Promise<AssetTransferResult> {
    const { db, companyId, userId } = ctx;
    switch (input.type) {
      case "capitalize":
        if (input.cost != null) {
          await authorize(ctx, { update: "accounting" });
        }
        return capitalize(db, { ...input, companyId, userId });
      case "return":
        return returnToInventory(db, { ...input, companyId, userId });
      case "attachJob":
        return attachJob(db, { ...input, companyId, userId });
      case "capitalizeCip":
        return capitalizeCip(db, { ...input, companyId, userId });
      case "adjustCost":
        return adjustCost(db, { ...input, companyId, userId });
    }
  }
});

export default postAssetTransfer;
