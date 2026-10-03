// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { datetime } from "@carbon/utils";
import { createMappingService } from "../../../core/external-mapping";
import { JournalEntrySyncError } from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import type { Rillet, RilletProductWrite, RilletWriteOmit } from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  loadCompanyBaseCurrency,
  loadCurrencyDecimalPlaces,
  loadRilletAccountCodesById,
  RilletPushOnlyEntitySyncer,
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
  /** `currency.decimalPlaces` of `currency` — the settlement scale, not a default. */
  decimalPlaces: number;
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
      amount: toRilletMoney(
        item.unitSalePrice,
        args.currency,
        args.decimalPlaces
      )
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

function mergeProductWrite(
  current: Rillet.Product,
  desired: RilletProductWrite
): RilletProductWrite {
  const {
    id: _id,
    updated_at: _updatedAt,
    ...merged
  } = { ...current, ...desired };
  const replacedTypes = new Set(
    desired.external_references?.map((ref) => ref.type) ?? []
  );
  return {
    ...merged,
    price: { ...current.price, ...desired.price },
    external_references: [
      ...(current.external_references ?? []).filter(
        (ref) => !replacedTypes.has(ref.type)
      ),
      ...(desired.external_references ?? [])
    ]
  };
}

export class RilletItemSyncer extends RilletPushOnlyEntitySyncer<
  Accounting.Item,
  Rillet.Product,
  RilletWriteOmit
> {
  private helperProducts = new Map<string, Promise<string>>();

  /**
   * A Rillet product that stands in for a REVENUE ACCOUNT rather than a Carbon
   * item.
   *
   * Rillet requires `product_id` on every invoice line (`InvoiceItemSchema`), so
   * an invoice cannot be pushed without one. Referencing the real Carbon item
   * meant mirroring the whole manufacturing parts catalog into Rillet Products
   * — and it bought nothing, because Carbon has no per-item revenue account:
   * `post-sales-invoice` credits `accountDefault.salesAccount` for ALL
   * merchandise and `salesShippingRevenueAccount` for shipping. So one product
   * per revenue account reproduces the same GL exactly, with two products per
   * company instead of thousands.
   *
   * `kind` only distinguishes the two so their names read sensibly in Rillet;
   * the ACCOUNT is what makes a product distinct. Keyed by account + currency
   * because a product carries its own `price.amount.currency`.
   */
  public ensureShippingProduct(args: {
    shippingAccountId: string;
    baseCurrencyCode: string;
    baseCurrencyDecimals: number;
  }): Promise<string> {
    return this.ensureHelperProduct({
      kind: "shipping",
      revenueAccountId: args.shippingAccountId,
      baseCurrencyCode: args.baseCurrencyCode,
      baseCurrencyDecimals: args.baseCurrencyDecimals
    });
  }

  public ensureSalesProduct(args: {
    revenueAccountId: string;
    baseCurrencyCode: string;
    baseCurrencyDecimals: number;
  }): Promise<string> {
    return this.ensureHelperProduct({ kind: "sales", ...args });
  }

  private async ensureHelperProduct(args: {
    kind: "shipping" | "sales";
    revenueAccountId: string;
    baseCurrencyCode: string;
    baseCurrencyDecimals: number;
  }): Promise<string> {
    const helperId = `${args.revenueAccountId}:${args.baseCurrencyCode}`;
    const cacheKey = `${args.kind}:${helperId}`;
    let pending = this.helperProducts.get(cacheKey);
    if (!pending) {
      pending = this.resolveHelperProduct(args, helperId).catch((error) => {
        this.helperProducts.delete(cacheKey);
        throw error;
      });
      this.helperProducts.set(cacheKey, pending);
    }
    return pending;
  }

  private async resolveHelperProduct(
    args: {
      kind: "shipping" | "sales";
      revenueAccountId: string;
      baseCurrencyCode: string;
      baseCurrencyDecimals: number;
    },
    helperId: string
  ): Promise<string> {
    const shipping = args.kind === "shipping";
    const label = shipping ? "Shipping" : "Sales";
    if (!args.baseCurrencyCode.trim())
      throw new Error(`Missing ${args.kind}-product base currency`);
    const codes = await this.getAccountCodesById();
    const description = shipping ? "Customer shipping charges" : "Sales";
    const item: Accounting.Item = {
      id: helperId,
      code: `Carbon ${label} ${args.revenueAccountId} ${args.baseCurrencyCode}`,
      name: description,
      description,
      companyId: this.companyId,
      type: "Service",
      unitOfMeasureCode: "EA",
      unitCost: 0,
      unitSalePrice: 0,
      isPurchased: false,
      isSold: true,
      isTrackedAsInventory: false,
      updatedAt: datetime.timestamp()
    };
    const payload = mapItemToRilletProduct({
      item,
      accountCodesById: codes,
      revenueAccountId: args.revenueAccountId,
      currency: args.baseCurrencyCode,
      decimalPlaces: args.baseCurrencyDecimals
    });
    const mappingEntityType = shipping ? "shippingItem" : "salesItem";
    const mappedId = await this.mappingService.getExternalId(
      mappingEntityType,
      helperId,
      this.provider.id
    );
    if (mappedId) {
      const current = await this.rilletProvider.getProduct(mappedId);
      if (!current || current.name !== payload.name)
        throw new JournalEntrySyncError({
          errorCode: "UNMAPPED_ACCOUNTS",
          warning: true,
          message: `Cannot reuse ${label} Revenue product: its mapped product is missing or has an incompatible name`,
          metadata: { accountId: args.revenueAccountId, helperId }
        });
      if (
        current.account_code === payload.account_code &&
        current.status !== "INACTIVE" &&
        current.price.amount.currency === args.baseCurrencyCode &&
        current.price.type === "ONE_TIME" &&
        Number(current.price.amount.amount) === 0 &&
        !current.include_in_arr_mrr &&
        current.revenue_pattern === "EVEN_PERIOD"
      )
        return current.id;
      const updated = await writeDroppingUnregisteredReferences(
        mergeProductWrite(current, payload),
        (data) => this.rilletProvider.updateProduct(mappedId, data)
      );
      return updated.id;
    }
    const created = await writeDroppingUnregisteredReferences(payload, (data) =>
      this.rilletProvider.createProduct(
        data,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "product",
          // Shipping keeps its ORIGINAL unprefixed key so existing installs'
          // in-flight retries still dedupe against Rillet's stored response;
          // only the new sales kind is namespaced, so the two helper products
          // for one account cannot collide on a single key.
          localId: shipping ? helperId : `${args.kind}:${helperId}`
        })
      )
    );
    await withTriggersDisabled(this.database, async (tx) =>
      createMappingService(tx, this.companyId).link(
        mappingEntityType,
        helperId,
        this.provider.id,
        created.id,
        { metadata: { accountId: args.revenueAccountId, kind: args.kind } }
      )
    );
    return created.id;
  }

  // Cached per instance — a drain reuses one syncer across its claimed
  // operations, so mappings, the sales-account default and the base
  // currency are each fetched at most once
  private accountCodesByIdPromise?: Promise<Map<string, string>>;
  private revenueAccountIdPromise?: Promise<string | null>;
  private baseCurrencyPromise?: Promise<string>;
  private baseCurrencyDecimalsPromise?: Promise<number>;

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

  /**
   * The base currency's own `currency.decimalPlaces` — the product price is a
   * settlement amount, so its scale is the currency's, never an assumed 2.
   */
  private getBaseCurrencyDecimals(): Promise<number> {
    if (!this.baseCurrencyDecimalsPromise) {
      this.baseCurrencyDecimalsPromise = (async () =>
        loadCurrencyDecimalPlaces(this.database, {
          companyId: this.companyId,
          currencyCode: await this.getBaseCurrency()
        }))();
    }
    return this.baseCurrencyDecimalsPromise;
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
    const decimalPlaces = await this.getBaseCurrencyDecimals();

    return mapItemToRilletProduct({
      item: local,
      accountCodesById,
      revenueAccountId,
      currency,
      decimalPlaces
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
      const current = await this.rilletProvider.getProduct(existingRemoteId);
      if (!current)
        throw new Error(
          `Mapped Rillet product ${existingRemoteId} was not found`
        );
      const updated = await writeDroppingUnregisteredReferences(
        mergeProductWrite(current, data),
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
