// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import {
  accountMappingRows,
  fakeDatabase
} from "../../../../core/fake-database-test-fixture";
import type { Rillet, RilletProductWrite } from "../../models";
import { buildRilletIdempotencyKey } from "../../provider";
import { RilletItemSyncer } from "../item";
import { toRilletMoney } from "../shared";

describe("Rillet monetary decimal strings", () => {
  it.each([
    [1e21, 2, "1000000000000000000000.00"],
    [1.005, 2, "1.01"],
    [-2.5, 3, "-2.500"],
    [0, 0, "0"]
  ] as const)(
    "serializes %s at %s decimals without exponent notation or grouping",
    (amount, decimals, expected) => {
      expect(toRilletMoney(amount, "USD", decimals)).toEqual({
        amount: expected,
        currency: "USD"
      });
    }
  );
});

const product = (overrides: Partial<Rillet.Product> = {}): Rillet.Product => ({
  id: "shipping-product",
  name: "Carbon Shipping acct-shipping USD",
  description: "Customer shipping charges",
  price: { type: "ONE_TIME", amount: { amount: "0.00", currency: "USD" } },
  account_code: "4010",
  status: "ACTIVE",
  include_in_arr_mrr: false,
  revenue_pattern: "EVEN_PERIOD",
  ...overrides
});
const mapping = (entityType: string, entityId: string, externalId: string) => ({
  entityType,
  entityId,
  integration: "rillet",
  companyId: "company-1",
  externalId
});

function setup(
  args: {
    /** The product the shipping helper is already mapped to. */
    mappedId?: string;
    current?: Rillet.Product;
    codes?: Record<string, string>;
    mappings?: Array<Record<string, unknown>>;
  } = {}
) {
  const db = fakeDatabase({
    externalIntegrationMapping: [
      ...accountMappingRows(
        args.codes ?? { "acct-shipping": "4010" },
        "rillet"
      ),
      ...(args.mappedId
        ? [mapping("shippingItem", "acct-shipping:USD", args.mappedId)]
        : []),
      ...(args.mappings ?? [])
    ]
  });
  const getProduct = vi.fn(async (_id: string) => args.current ?? product());
  const createProduct = vi.fn(
    async (_payload: RilletProductWrite, _key?: string) => product()
  );
  const updateProduct = vi.fn(
    async (_id: string, payload: RilletProductWrite) => ({
      id: "shipping-product",
      ...payload
    })
  );
  const syncer = new RilletItemSyncer({
    database: db.database,
    companyId: "company-1",
    provider: {
      id: "rillet",
      getProduct,
      createProduct,
      updateProduct
    } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "item"
  });
  return {
    syncer,
    db,
    getProduct,
    createProduct,
    updateProduct,
    helperLinks: () =>
      db
        .rows("externalIntegrationMapping")
        .filter((row) => row.entityType === "shippingItem")
  };
}
const shipping = {
  shippingAccountId: "acct-shipping",
  baseCurrencyCode: "USD",
  baseCurrencyDecimals: 2
};

describe("Rillet shipping product helper", () => {
  it("creates a nominal sales product under the shipping account using account+base-currency identity", async () => {
    const test = setup();
    expect(await test.syncer.ensureShippingProduct(shipping)).toBe(
      "shipping-product"
    );
    expect(await test.syncer.ensureShippingProduct(shipping)).toBe(
      "shipping-product"
    );
    expect(test.createProduct).toHaveBeenCalledOnce();
    expect(test.createProduct.mock.calls[0]?.[0]).toMatchObject({
      name: "Carbon Shipping acct-shipping USD",
      account_code: "4010",
      status: "ACTIVE",
      include_in_arr_mrr: false,
      revenue_pattern: "EVEN_PERIOD",
      price: { type: "ONE_TIME", amount: { amount: "0.00", currency: "USD" } }
    });
    expect(test.createProduct.mock.calls[0]?.[1]).toBe(
      buildRilletIdempotencyKey({
        companyId: "company-1",
        operation: "product",
        localId: "acct-shipping:USD"
      })
    );
    expect(test.helperLinks()).toMatchObject([
      {
        entityType: "shippingItem",
        entityId: "acct-shipping:USD",
        integration: "rillet",
        companyId: "company-1",
        externalId: "shipping-product",
        metadata: { accountId: "acct-shipping", kind: "shipping" }
      }
    ]);
  });
  it("reuses an owned compatible mapping without another create", async () => {
    const test = setup({ mappedId: "shipping-product" });
    expect(await test.syncer.ensureShippingProduct(shipping)).toBe(
      "shipping-product"
    );
    expect(test.createProduct).not.toHaveBeenCalled();
  });
  it("retries a lost local link using the same entity-scoped idempotency key", async () => {
    const test = setup();
    test.db.failNextWrite(
      "externalIntegrationMapping",
      new Error("link failed")
    );
    await expect(test.syncer.ensureShippingProduct(shipping)).rejects.toThrow(
      "link failed"
    );
    expect(await test.syncer.ensureShippingProduct(shipping)).toBe(
      "shipping-product"
    );
    expect(test.createProduct).toHaveBeenCalledTimes(2);
    expect(test.createProduct.mock.calls[0]?.[1]).toBe(
      test.createProduct.mock.calls[1]?.[1]
    );
  });
  it("reads and merges a full owned product before reconverging its shipping account", async () => {
    const current = {
      ...product({
        account_code: "old",
        external_references: [{ type: "other", id: "keep" }]
      }),
      unrelated: { retained: true }
    };
    const test = setup({ mappedId: "shipping-product", current });
    await test.syncer.ensureShippingProduct(shipping);
    expect(test.getProduct).toHaveBeenCalledWith("shipping-product");
    expect(test.updateProduct.mock.calls[0]?.[1]).toMatchObject({
      account_code: "4010",
      unrelated: { retained: true },
      external_references: expect.arrayContaining([
        { type: "other", id: "keep" }
      ])
    });
  });
  it("reconverges an owned helper's nominal price and recurring-revenue flags", async () => {
    const test = setup({
      mappedId: "shipping-product",
      current: product({
        include_in_arr_mrr: true,
        price: { type: "ONE_TIME", amount: { amount: "9.00", currency: "USD" } }
      })
    });
    await test.syncer.ensureShippingProduct(shipping);
    expect(test.updateProduct.mock.calls[0]?.[1]).toMatchObject({
      include_in_arr_mrr: false,
      price: { amount: { amount: "0.00", currency: "USD" } }
    });
  });
  it("serializes nominal product price at the authoritative base currency precision", async () => {
    const test = setup();
    await test.syncer.ensureShippingProduct({
      ...shipping,
      baseCurrencyCode: "BHD",
      baseCurrencyDecimals: 3
    });
    expect(test.createProduct.mock.calls[0]?.[0].price.amount).toEqual({
      amount: "0.000",
      currency: "BHD"
    });
    expect(test.helperLinks()[0]?.entityId).toBe("acct-shipping:BHD");
  });
  it("refuses an unmapped shipping account before any provider write", async () => {
    const test = setup({ codes: {} });
    await expect(
      test.syncer.ensureShippingProduct(shipping)
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
    });
    expect(test.createProduct).not.toHaveBeenCalled();
    expect(test.updateProduct).not.toHaveBeenCalled();
  });
  it("preserves unrelated full-product fields on the existing merchandise update path too", async () => {
    const test = setup({
      current: { ...product(), unrelated: "keep" } as Rillet.Product,
      mappings: [mapping("item", "local-item", "shipping-product")]
    });
    const changed = { ...product(), description: "Updated description" };
    await (
      test.syncer as unknown as {
        upsertRemote(data: RilletProductWrite, id: string): Promise<string>;
      }
    ).upsertRemote(changed, "local-item");
    expect(test.getProduct).toHaveBeenCalledOnce();
    expect(test.updateProduct.mock.calls[0]?.[1]).toMatchObject({
      description: "Updated description",
      unrelated: "keep"
    });
  });
});

/**
 * The merchandise path resolves the product price scale from the company's own
 * base currency row (company.baseCurrencyCode -> currency.decimalPlaces), the
 * same authoritative source the bill syncer threads through. A hardcoded
 * 2-decimal serialization gives a JPY price cents it cannot have and truncates
 * a 3-decimal BHD price.
 */
function makeMerchandiseSyncer(
  baseCurrencyCode: string,
  decimalPlaces: number
) {
  const db = fakeDatabase({
    company: [{ id: "company-1", baseCurrencyCode, companyGroupId: "group-1" }],
    currency: [
      { code: baseCurrencyCode, companyGroupId: "group-1", decimalPlaces }
    ],
    accountDefault: [{ companyId: "company-1", salesAccount: "acct-sales" }],
    externalIntegrationMapping: accountMappingRows(
      { "acct-sales": "4000" },
      "rillet"
    )
  });
  return new RilletItemSyncer({
    database: db.database,
    companyId: "company-1",
    provider: { id: "rillet" } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "item"
  });
}

const merchandiseItem = {
  id: "item-1",
  code: "PART-1",
  name: "Part 1",
  description: "Part 1",
  companyId: "company-1",
  type: "Part" as const,
  unitOfMeasureCode: "EA",
  unitCost: 0,
  unitSalePrice: 1000,
  isPurchased: true,
  isSold: true,
  isTrackedAsInventory: false,
  updatedAt: "2026-09-09T00:00:00.000Z"
};

describe("Rillet merchandise product price precision", () => {
  it("serializes a 0-decimal base currency (JPY) at its own scale", async () => {
    const syncer = makeMerchandiseSyncer("JPY", 0);
    const payload = await (
      syncer as unknown as {
        mapToRemote(item: unknown): Promise<RilletProductWrite>;
      }
    ).mapToRemote(merchandiseItem);

    expect(payload.price.amount).toEqual({ amount: "1000", currency: "JPY" });
  });

  it("keeps the third decimal of a 3-decimal base currency (BHD)", async () => {
    const syncer = makeMerchandiseSyncer("BHD", 3);
    const payload = await (
      syncer as unknown as {
        mapToRemote(item: unknown): Promise<RilletProductWrite>;
      }
    ).mapToRemote({ ...merchandiseItem, unitSalePrice: 0.563 });

    expect(payload.price.amount).toEqual({ amount: "0.563", currency: "BHD" });
  });
});
