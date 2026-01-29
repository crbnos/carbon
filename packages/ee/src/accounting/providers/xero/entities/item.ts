import type { KyselyTx } from "@carbon/database/client";
import { type Accounting, BaseEntitySyncer } from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";

// Type for rows returned from item queries with cost/price joins
type ItemRow = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  description: string | null;
  companyId: string | null;
  type: "Part" | "Material" | "Tool" | "Consumable" | "Fixture";
  unitOfMeasureCode: string | null;
  replenishmentSystem: "Buy" | "Make" | "Buy and Make";
  itemTrackingType: string;
  updatedAt: string | null;
  unitCost: number | null;
  unitSalePrice: number | null;
};

export class ItemSyncer extends BaseEntitySyncer<
  Accounting.Item,
  Xero.Item,
  "UpdatedDateUTC"
> {
  // =================================================================
  // 1. ID MAPPING - Uses default implementation from BaseEntitySyncer
  // =================================================================

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.Item): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.Item | null> {
    const items = await this.fetchItemsByIds([id]);
    return items.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.Item>> {
    return this.fetchItemsByIds(ids);
  }

  private async fetchItemsByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.Item>> {
    if (ids.length === 0) return new Map();

    const rows = await this.database
      .selectFrom("item")
      .leftJoin("itemCost", "itemCost.itemId", "item.id")
      .leftJoin("itemUnitSalePrice", "itemUnitSalePrice.itemId", "item.id")
      .select([
        "item.id",
        "item.readableId",
        "item.readableIdWithRevision",
        "item.name",
        "item.description",
        "item.companyId",
        "item.type",
        "item.unitOfMeasureCode",
        "item.replenishmentSystem",
        "item.itemTrackingType",
        "item.updatedAt",
        "itemCost.unitCost",
        "itemUnitSalePrice.unitSalePrice"
      ])
      .where("item.id", "in", ids)
      .where("item.companyId", "=", this.companyId)
      .execute();

    return this.transformRows(rows as ItemRow[]);
  }

  private transformRows(rows: ItemRow[]): Map<string, Accounting.Item> {
    const result = new Map<string, Accounting.Item>();

    for (const row of rows) {
      const isPurchased =
        row.replenishmentSystem === "Buy" ||
        row.replenishmentSystem === "Buy and Make";
      const isSold = true; // Assume all items can be sold
      const isTrackedAsInventory = row.itemTrackingType !== "None";

      result.set(row.id, {
        id: row.id,
        code: row.readableIdWithRevision ?? row.readableId,
        name: row.name,
        description: row.description,
        companyId: row.companyId!,
        type: row.type,
        unitOfMeasureCode: row.unitOfMeasureCode,
        unitCost: row.unitCost ?? 0,
        unitSalePrice: row.unitSalePrice ?? 0,
        isPurchased,
        isSold,
        isTrackedAsInventory,
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // 4. REMOTE FETCH (Single + Batch) - API calls within syncer
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.Item | null> {
    const result = await this.provider.request<{ Items: Xero.Item[] }>(
      "GET",
      `/Items/${id}`
    );
    return result.error ? null : (result.data?.Items?.[0] ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.Item>> {
    const result = new Map<string, Xero.Item>();
    if (ids.length === 0) return result;

    const response = await this.provider.request<{ Items: Xero.Item[] }>(
      "GET",
      `/Items?IDs=${ids.join(",")}`
    );

    if (response.error) {
      throwXeroApiError("fetch items batch", response);
    }

    if (response.data?.Items) {
      for (const item of response.data.Items) {
        result.set(item.ItemID, item);
      }
    }

    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Item
  ): Promise<Omit<Xero.Item, "UpdatedDateUTC">> {
    const existingRemoteId = await this.getRemoteId(local.id);

    return {
      ItemID: existingRemoteId!,
      Code: local.code.slice(0, 30),
      Name: local.name.slice(0, 50),
      Description: local.description?.slice(0, 4000) ?? undefined,
      IsPurchased: local.isPurchased,
      IsSold: local.isSold,
      IsTrackedAsInventory: local.isTrackedAsInventory,
      PurchaseDetails: local.isPurchased
        ? { UnitPrice: local.unitCost }
        : undefined,
      SalesDetails: local.isSold
        ? { UnitPrice: local.unitSalePrice }
        : undefined
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon) - Update only
  // =================================================================

  protected async mapToLocal(
    remote: Xero.Item
  ): Promise<Partial<Accounting.Item>> {
    return {
      code: remote.Code,
      name: remote.Name ?? "",
      description: remote.Description ?? null,
      unitCost: remote.PurchaseDetails?.UnitPrice ?? 0,
      unitSalePrice: remote.SalesDetails?.UnitPrice ?? 0,
      isPurchased: remote.IsPurchased ?? false,
      isSold: remote.IsSold ?? false,
      isTrackedAsInventory: remote.IsTrackedAsInventory ?? false
    };
  }

  // =================================================================
  // 7. UPSERT LOCAL (Update existing only - Carbon is source of truth)
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Item>,
    remoteId: string
  ): Promise<string> {
    let existingLocalId = await this.getLocalId(remoteId);

    // Smart match: if no mapping exists, try to find by item code.
    // Xero Item.Code maps to Carbon item.readableIdWithRevision (or readableId).
    // This prevents errors during backfill when items exist in both systems.
    if (!existingLocalId && data.code) {
      existingLocalId = await this.findLocalItemByCode(tx, data.code);
    }

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new items from Xero. Item with remote ID ${remoteId} (code: ${
          data.code ?? "unknown"
        }) not found locally.`
      );
    }

    // Update item table (mapping is handled by linkEntities in base class)
    await tx
      .updateTable("item")
      .set({
        name: data.name,
        description: data.description,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", existingLocalId)
      .execute();

    // Update itemCost if unitCost changed
    if (data.unitCost !== undefined) {
      await tx
        .updateTable("itemCost")
        .set({ unitCost: data.unitCost })
        .where("itemId", "=", existingLocalId)
        .execute();
    }

    // Update itemUnitSalePrice if unitSalePrice changed
    if (data.unitSalePrice !== undefined) {
      await tx
        .updateTable("itemUnitSalePrice")
        .set({ unitSalePrice: data.unitSalePrice })
        .where("itemId", "=", existingLocalId)
        .execute();
    }

    return existingLocalId;
  }

  /**
   * Try to find an existing Carbon item by its code (readableIdWithRevision or readableId).
   * Used for smart matching during backfill when no ID mapping exists yet.
   */
  private async findLocalItemByCode(
    tx: KyselyTx,
    code: string
  ): Promise<string | null> {
    // Try readableIdWithRevision first (exact match for the Code sent to Xero)
    const match = await tx
      .selectFrom("item")
      .select("id")
      .where("companyId", "=", this.companyId)
      .where((eb) =>
        eb.or([
          eb("readableIdWithRevision" as any, "=", code),
          eb("readableId", "=", code)
        ])
      )
      .executeTakeFirst();

    return match?.id ?? null;
  }

  /**
   * Search Xero for an existing item by exact Code match.
   * Used for smart matching during push when no ID mapping exists yet.
   */
  private async findRemoteItemByCode(code: string): Promise<string | null> {
    const escapedCode = code.replace(/"/g, '\\"');
    const result = await this.provider.request<{ Items: Xero.Item[] }>(
      "GET",
      `/Items?where=Code=="${escapedCode}"`
    );

    if (!result.error && result.data?.Items?.[0]?.ItemID) {
      return result.data.Items[0].ItemID;
    }

    return null;
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch) - API calls within syncer
  // =================================================================

  protected async upsertRemote(
    data: Omit<Xero.Item, "UpdatedDateUTC">,
    localId: string
  ): Promise<string> {
    let existingRemoteId = await this.getRemoteId(localId);

    // Smart match: if no mapping exists, search Xero by Code before creating.
    // Xero enforces unique item codes.
    if (!existingRemoteId && data.Code) {
      existingRemoteId = await this.findRemoteItemByCode(data.Code);
    }

    const items = existingRemoteId
      ? [{ ...data, ItemID: existingRemoteId }]
      : [data];

    const result = await this.provider.request<{ Items: Xero.Item[] }>(
      "POST",
      "/Items",
      { body: JSON.stringify({ Items: items }) }
    );

    if (result.error) {
      throwXeroApiError(
        existingRemoteId ? "update item" : "create item",
        result
      );
    }

    if (!result.data?.Items?.[0]?.ItemID) {
      throw new Error("Xero API returned success but no ItemID was returned");
    }

    return result.data.Items[0].ItemID;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.Item, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (data.length === 0) return result;

    const items: Xero.Item[] = [];
    const localIdOrder: string[] = [];

    for (const { localId, payload } of data) {
      const existingRemoteId = await this.getRemoteId(localId);
      items.push(
        existingRemoteId
          ? ({ ...payload, ItemID: existingRemoteId } as Xero.Item)
          : (payload as Xero.Item)
      );
      localIdOrder.push(localId);
    }

    const response = await this.provider.request<{ Items: Xero.Item[] }>(
      "POST",
      "/Items",
      { body: JSON.stringify({ Items: items }) }
    );

    if (response.error) {
      throwXeroApiError("batch upsert items", response);
    }

    if (!response.data?.Items) {
      throw new Error(
        "Xero API returned success but no Items array was returned"
      );
    }

    for (let i = 0; i < response.data.Items.length; i++) {
      const returnedItem = response.data.Items[i];
      const localId = localIdOrder[i];
      if (returnedItem?.ItemID && localId) {
        result.set(localId, returnedItem.ItemID);
      }
    }

    return result;
  }
}
