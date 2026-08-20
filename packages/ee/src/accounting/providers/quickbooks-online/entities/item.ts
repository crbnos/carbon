import type { KyselyTx } from "@carbon/database/client";
import { JournalEntrySyncError } from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type { Qbo, QboCreatePayload } from "../models";
import {
  escapeQboQueryValue,
  loadQboAccountRefsById,
  QBO_NAME_MAX_LENGTH,
  QboEntitySyncer,
  type QboWriteOmit,
  qboNameTooLongError,
  toQboNameExistsError,
  updateWithSyncTokenRetry
} from "./shared";

/**
 * QboItemSyncer — push-only (owner carbon, direction push-to-accounting per
 * DEFAULT_SYNC_CONFIG): Carbon items become QBO Items typed `Service`
 * (Carbon item type "Service") or `NonInventory` (every physical type) —
 * NEVER `Inventory`: QBO item-level quantity tracking stays off so the
 * posting sync's inventory journals are the single source of COGS
 * (double-COGS guard).
 *
 * QBO `Name` is the unique item key (100-char cap → structured
 * NAME_TOO_LONG Warning) and maps from Carbon's unique item code
 * (readableIdWithRevision) — the same role Xero's Item.Code plays.
 *
 * IncomeAccountRef/ExpenseAccountRef resolve through the account-mapping
 * service (entityType "account", integration "quickbooks" — mapping
 * externalId is the QBO account id) from the company's accountDefault
 * sales / cost-of-goods-sold accounts (items carry no per-item posting
 * accounts since the posting-group matrix was dropped). Unmapped accounts
 * → structured UNMAPPED_ACCOUNTS Warning, same errorCode as the journal
 * pre-flight.
 */

// Row shape for item queries with cost/price joins (mirrors Xero's)
type ItemRow = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  description: string | null;
  companyId: string | null;
  type: "Part" | "Material" | "Tool" | "Service" | "Consumable" | "Fixture";
  unitOfMeasureCode: string | null;
  replenishmentSystem: "Buy" | "Make" | "Buy and Make";
  itemTrackingType: string;
  updatedAt: string | null;
  unitCost: number | null;
  unitSalePrice: number | null;
};

/**
 * Map a Carbon item to the QBO Item write payload. Pure — exported for
 * tests.
 *
 * - `incomeAccountId`/`expenseAccountId` are the Carbon account.ids the
 *   refs resolve from (accountDefault salesAccount /
 *   costOfGoodsSoldAccount); `accountRefsById` maps Carbon account.id →
 *   QBO AccountRef (mapping externalId).
 * - Throws NAME_TOO_LONG (Warning) when the code exceeds QBO's 100-char
 *   Name cap — no silent truncation.
 * - Throws UNMAPPED_ACCOUNTS (Warning) when a required account is missing
 *   or has no mapping: income is always required (all items are sellable),
 *   expense only for purchased items.
 */
export function mapItemToQboItem(args: {
  item: Accounting.Item;
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
}): QboCreatePayload<Qbo.Item> {
  const { item } = args;

  if (item.code.length > QBO_NAME_MAX_LENGTH) {
    throw qboNameTooLongError({ entityLabel: "item", name: item.code });
  }

  const incomeRef = args.incomeAccountId
    ? args.accountRefsById.get(args.incomeAccountId)
    : undefined;
  const expenseRef = args.expenseAccountId
    ? args.accountRefsById.get(args.expenseAccountId)
    : undefined;

  const unmappedAccountIds: string[] = [];
  const missingDefaults: string[] = [];

  if (item.isSold) {
    if (!args.incomeAccountId) {
      missingDefaults.push("salesAccount");
    } else if (!incomeRef) {
      unmappedAccountIds.push(args.incomeAccountId);
    }
  }

  if (item.isPurchased) {
    if (!args.expenseAccountId) {
      missingDefaults.push("costOfGoodsSoldAccount");
    } else if (!expenseRef) {
      unmappedAccountIds.push(args.expenseAccountId);
    }
  }

  if (unmappedAccountIds.length > 0 || missingDefaults.length > 0) {
    const parts: string[] = [];
    if (unmappedAccountIds.length > 0) {
      parts.push(
        `${unmappedAccountIds.length} default posting account(s) have no QuickBooks Online account mapping`
      );
    }
    if (missingDefaults.length > 0) {
      parts.push(
        `company account defaults are missing: ${missingDefaults.join(", ")}`
      );
    }
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync item ${item.code}: ${parts.join(
        "; "
      )}. Map the account(s) on the integration settings page, then retry.`,
      warning: true,
      metadata: {
        itemId: item.id,
        unmappedAccountIds,
        ...(missingDefaults.length > 0 ? { missingDefaults } : {})
      }
    });
  }

  return {
    Name: item.code,
    Description: (item.description ?? item.name).slice(0, 4000),
    // NEVER "Inventory" — QBO quantity tracking stays off (double-COGS guard)
    Type: item.type === "Service" ? "Service" : "NonInventory",
    Active: true,
    UnitPrice: item.unitSalePrice,
    PurchaseCost: item.unitCost,
    IncomeAccountRef: item.isSold ? incomeRef : undefined,
    ExpenseAccountRef: item.isPurchased ? expenseRef : undefined
  };
}

export class QboItemSyncer extends QboEntitySyncer<Accounting.Item, Qbo.Item> {
  // Cached per instance — a drain reuses one syncer across its claimed
  // operations, so mappings and account defaults are fetched at most once
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;
  private defaultItemAccountsPromise?: Promise<{
    incomeAccountId: string | null;
    expenseAccountId: string | null;
  }>;

  // =================================================================
  // 1. ACCOUNT RESOLUTION (account-mapping service, journal-syncer path)
  // =================================================================

  /**
   * Carbon account.id → QBO AccountRef from the account-mapping rows
   * (entityType "account") — the journal syncer's resolution path, cached
   * per instance.
   */
  private getAccountRefsById(): Promise<Map<string, Qbo.Ref>> {
    if (!this.accountRefsByIdPromise) {
      this.accountRefsByIdPromise = loadQboAccountRefsById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountRefsByIdPromise;
  }

  /**
   * The item posting defaults: accountDefault.salesAccount (income) and
   * accountDefault.costOfGoodsSoldAccount (expense). Items carry no
   * per-item posting accounts, so these are the source the refs resolve
   * from.
   */
  private getDefaultItemAccounts(): Promise<{
    incomeAccountId: string | null;
    expenseAccountId: string | null;
  }> {
    if (!this.defaultItemAccountsPromise) {
      this.defaultItemAccountsPromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select(["salesAccount", "costOfGoodsSoldAccount"])
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return {
          incomeAccountId: defaults?.salesAccount ?? null,
          expenseAccountId: defaults?.costOfGoodsSoldAccount ?? null
        };
      })();
    }
    return this.defaultItemAccountsPromise;
  }

  // =================================================================
  // 2. LOCAL FETCH (Single + Batch)
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

    const result = new Map<string, Accounting.Item>();
    for (const row of rows as ItemRow[]) {
      const isPurchased =
        row.replenishmentSystem === "Buy" ||
        row.replenishmentSystem === "Buy and Make";

      result.set(row.id, {
        id: row.id,
        code: row.readableIdWithRevision ?? row.readableId,
        name: row.name,
        description: row.description,
        companyId: row.companyId!,
        type: row.type,
        unitOfMeasureCode: row.unitOfMeasureCode,
        unitCost: Number(row.unitCost) || 0,
        unitSalePrice: Number(row.unitSalePrice) || 0,
        isPurchased,
        isSold: true, // Assume all items can be sold (Xero parity)
        isTrackedAsInventory: row.itemTrackingType !== "None",
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // 3. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Qbo.Item | null> {
    const item = await this.qboProvider.getItem(id);
    this.rememberRemoteEntity(item);
    return item;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.Item>> {
    const result = new Map<string, Qbo.Item>();
    if (ids.length === 0) return result;

    const values = ids.map((id) => `'${escapeQboQueryValue(id)}'`).join(", ");
    const items = await this.qboProvider.query<Qbo.Item>(
      "Item",
      `Id IN (${values})`
    );

    for (const item of items) {
      this.rememberRemoteEntity(item);
      result.set(item.Id, item);
    }

    return result;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> QBO) with account resolution
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Item
  ): Promise<Omit<Qbo.Item, QboWriteOmit>> {
    const accountRefsById = await this.getAccountRefsById();
    const { incomeAccountId, expenseAccountId } =
      await this.getDefaultItemAccounts();

    return mapItemToQboItem({
      item: local,
      accountRefsById,
      incomeAccountId,
      expenseAccountId
    });
  }

  // =================================================================
  // 5. TRANSFORMATION (QBO -> Carbon) - Update only (Carbon owns items)
  // =================================================================

  protected async mapToLocal(
    remote: Qbo.Item
  ): Promise<Partial<Accounting.Item>> {
    return {
      // QBO Name carries the Carbon item code (see mapItemToQboItem)
      code: remote.Name,
      description: remote.Description ?? null,
      unitCost: remote.PurchaseCost ?? 0,
      unitSalePrice: remote.UnitPrice ?? 0
    };
  }

  // =================================================================
  // 6. UPSERT LOCAL (Update existing only - Carbon is source of truth)
  // =================================================================

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<Accounting.Item>,
    remoteId: string
  ): Promise<string> {
    let existingLocalId = await this.getLocalId(remoteId);

    // Smart match: QBO Item.Name carries the Carbon item code
    // (readableIdWithRevision or readableId).
    if (!existingLocalId && data.code) {
      const match = await tx
        .selectFrom("item")
        .select("id")
        .where("companyId", "=", this.companyId)
        .where((eb) =>
          eb.or([
            eb("readableIdWithRevision" as any, "=", data.code!),
            eb("readableId", "=", data.code!)
          ])
        )
        .executeTakeFirst();
      existingLocalId = match?.id ?? null;
    }

    if (!existingLocalId) {
      throw new Error(
        `Cannot create new items from QuickBooks Online. Item with remote ID ${remoteId} (name: ${
          data.code ?? "unknown"
        }) not found locally.`
      );
    }

    // Update the item description only — QBO Name is the Carbon code, not
    // the item's display name
    await tx
      .updateTable("item")
      .set({
        description: data.description,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", existingLocalId)
      .execute();

    if (data.unitCost !== undefined) {
      await tx
        .updateTable("itemCost")
        .set({ unitCost: data.unitCost })
        .where("itemId", "=", existingLocalId)
        .execute();
    }

    if (data.unitSalePrice !== undefined) {
      await tx
        .updateTable("itemUnitSalePrice")
        .set({ unitSalePrice: data.unitSalePrice })
        .where("itemId", "=", existingLocalId)
        .execute();
    }

    return existingLocalId;
  }

  // =================================================================
  // 7. UPSERT REMOTE (create, or sparse update with SyncToken retry)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Qbo.Item, QboWriteOmit>,
    localId: string
  ): Promise<string> {
    let existingRemoteId = await this.getRemoteId(localId);

    // Smart match: QBO item names are unique — search by Name (the Carbon
    // code) before creating.
    if (!existingRemoteId && data.Name) {
      existingRemoteId = await this.findRemoteItemByName(data.Name);
    }

    try {
      if (!existingRemoteId) {
        const created = await this.qboProvider.createItem(data);
        this.rememberRemoteEntity(created);
        return created.Id;
      }

      const remoteId = existingRemoteId;
      const updated = await updateWithSyncTokenRetry({
        entityLabel: "item",
        remoteId,
        fetchCurrent: () => this.qboProvider.getItem(remoteId),
        update: (syncToken) =>
          this.qboProvider.updateItem({
            ...data,
            Id: remoteId,
            SyncToken: syncToken
          })
      });
      this.rememberRemoteEntity(updated);
      return updated.Id;
    } catch (error) {
      const nameExists = toQboNameExistsError(error, {
        entityLabel: "item",
        name: data.Name
      });
      if (nameExists) throw nameExists;
      throw error;
    }
  }

  private async findRemoteItemByName(name: string): Promise<string | null> {
    const matches = await this.qboProvider.query<Qbo.Item>(
      "Item",
      `Name = '${escapeQboQueryValue(name)}'`
    );

    const match = matches[0];
    if (!match) return null;

    this.rememberRemoteEntity(match);
    return match.Id;
  }
}
