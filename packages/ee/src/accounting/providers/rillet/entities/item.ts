import { JournalEntrySyncError } from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type { Rillet, RilletProductWrite, RilletWriteOmit } from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  loadCompanyBaseCurrency,
  loadRilletAccountCodesById,
  RilletEntitySyncer,
  toRilletMoney,
  writeDroppingUnregisteredReferences
} from "./shared";

/**
 * RilletItemSyncer — push-only: Carbon items become Rillet Products.
 * This syncer exists chiefly as the invoice-line dependency: Rillet
 * AR_ONLY invoice items REQUIRE a product_id, so the invoice syncer calls
 * ensureDependencySynced("item", ...) before mapping.
 *
 * Rillet products are revenue objects, not inventory: the required
 * `account_code` is the REVENUE account, resolved from the company's
 * accountDefault.salesAccount through the account-mapping externalCode
 * map (items carry no per-item posting accounts). An unmapped/missing
 * sales account → structured UNMAPPED_ACCOUNTS Warning, same errorCode
 * contract as the journal pre-flight.
 *
 * Rillet Product name is the unique-ish item key and maps from Carbon's
 * unique item code (readableIdWithRevision) — the same role QBO's
 * Item.Name plays. The 250-char cap → structured NAME_TOO_LONG Warning
 * (no silent truncation).
 */

/** Rillet caps product names at 250 characters. */
export const RILLET_PRODUCT_NAME_MAX_LENGTH = 250;

/**
 * Map a Carbon item to the Rillet Product write payload. Pure — exported
 * for tests.
 *
 * ASSUMPTIONS (the create-product docs give no ERP-integration guidance;
 * chosen as the safest minimal valid payload):
 * - `price` is ONE_TIME at the item's unit sale price in the company base
 *   currency — nominal only, since AR_ONLY invoice items carry their own
 *   `total_amount` (the price never books revenue by itself).
 * - `include_in_arr_mrr: false` — Carbon-invoiced products must not skew
 *   Rillet's recurring-revenue metrics.
 * - `revenue_pattern: "EVEN_PERIOD"` — immediate/even recognition for the
 *   invoice period; Carbon does not model service periods in v1.
 */
export function mapItemToRilletProduct(args: {
  item: Accounting.Item;
  accountCodesById: ReadonlyMap<string, string>;
  revenueAccountId: string | null;
  currency: string;
}): RilletProductWrite {
  const { item } = args;

  if (item.code.length > RILLET_PRODUCT_NAME_MAX_LENGTH) {
    throw new JournalEntrySyncError({
      errorCode: "NAME_TOO_LONG",
      message: `The item code is ${item.code.length} characters; Rillet caps product names at ${RILLET_PRODUCT_NAME_MAX_LENGTH}. Shorten the item code in Carbon, then retry.`,
      warning: true,
      metadata: {
        entityLabel: "item",
        name: item.code,
        maxLength: RILLET_PRODUCT_NAME_MAX_LENGTH
      }
    });
  }

  const accountCode = args.revenueAccountId
    ? args.accountCodesById.get(args.revenueAccountId)
    : undefined;

  if (!accountCode) {
    const missingDefault = !args.revenueAccountId;
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync item ${item.code}: ${
        missingDefault
          ? "the company account defaults are missing salesAccount"
          : "the default sales account has no Rillet account mapping"
      } — Rillet products require a revenue account code. Map the account on the integration settings page, then retry.`,
      warning: true,
      metadata: {
        itemId: item.id,
        unmappedAccountIds: args.revenueAccountId
          ? [args.revenueAccountId]
          : [],
        ...(missingDefault ? { missingDefaults: ["salesAccount"] } : {})
      }
    });
  }

  return {
    name: item.code,
    description: item.description ?? item.name,
    price: {
      type: "ONE_TIME",
      amount: toRilletMoney(item.unitSalePrice, args.currency)
    },
    include_in_arr_mrr: false,
    revenue_pattern: "EVEN_PERIOD",
    account_code: accountCode,
    status: "ACTIVE",
    external_references: [
      carbonExternalReference(item.id),
      carbonCompanyExternalReference(item.companyId)
    ]
  };
}

// Row shape for item queries with cost/price joins (mirrors the QBO/Xero
// item syncers')
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

export class RilletItemSyncer extends RilletEntitySyncer<
  Accounting.Item,
  Rillet.Product,
  RilletWriteOmit
> {
  // Cached per instance — a drain reuses one syncer across its claimed
  // operations, so mappings, the sales-account default and the base
  // currency are each fetched at most once
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private revenueAccountIdPromise?: Promise<string | null>;
  private baseCurrencyPromise?: Promise<string>;

  protected get pushOnlyEntityLabel(): string {
    return "Items";
  }

  // =================================================================
  // 1. ACCOUNT + CURRENCY RESOLUTION (cached per instance)
  // =================================================================

  private getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadRilletAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
  }

  /**
   * The revenue account products post to: accountDefault.salesAccount
   * (items carry no per-item posting accounts).
   */
  private getRevenueAccountId(): Promise<string | null> {
    if (!this.revenueAccountIdPromise) {
      this.revenueAccountIdPromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select("salesAccount")
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return defaults?.salesAccount ?? null;
      })();
    }
    return this.revenueAccountIdPromise;
  }

  private getBaseCurrency(): Promise<string> {
    if (!this.baseCurrencyPromise) {
      this.baseCurrencyPromise = loadCompanyBaseCurrency(
        this.database,
        this.companyId
      );
    }
    return this.baseCurrencyPromise;
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
        isSold: true, // Assume all items can be sold (Xero/QBO parity)
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

  async fetchRemote(id: string): Promise<Rillet.Product | null> {
    return this.rilletProvider.getProduct(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Product>> {
    const result = new Map<string, Rillet.Product>();
    for (const id of ids) {
      const product = await this.rilletProvider.getProduct(id);
      if (product) result.set(product.id, product);
    }
    return result;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> Rillet) with account resolution
  // =================================================================

  protected async mapToRemote(
    local: Accounting.Item
  ): Promise<RilletProductWrite> {
    const accountCodesById = await this.getAccountCodesById();
    const revenueAccountId = await this.getRevenueAccountId();
    const currency = await this.getBaseCurrency();

    return mapItemToRilletProduct({
      item: local,
      accountCodesById,
      revenueAccountId,
      currency
    });
  }

  // =================================================================
  // 5. UPSERT REMOTE (create with idempotency key, or PUT update)
  // =================================================================

  protected async upsertRemote(
    data: RilletProductWrite,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);

    if (existingRemoteId) {
      const updated = await writeDroppingUnregisteredReferences(
        data,
        (payload) =>
          this.rilletProvider.updateProduct(existingRemoteId, payload)
      );
      return updated.id ?? existingRemoteId;
    }

    const created = await writeDroppingUnregisteredReferences(data, (payload) =>
      this.rilletProvider.createProduct(
        payload,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "product",
          localId
        })
      )
    );
    return created.id;
  }
}
