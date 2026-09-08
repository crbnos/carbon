import { beforeEach, describe, expect, it, vi } from "vitest";
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
  ] as const)("serializes %s at %s decimals without exponent notation or grouping", (amount, decimals, expected) => {
    expect(toRilletMoney(amount, "USD", decimals)).toEqual({
      amount: expected,
      currency: "USD"
    });
  });
});

const { links, control } = vi.hoisted(() => ({
  links: [] as Array<Record<string, unknown>>,
  control: { failOnce: false }
}));
vi.mock("../../../../core/utils", async (original) => ({
  ...(await original<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    callback: (tx: unknown) => Promise<unknown>
  ) => {
    const builder: any = {
      values(value: Record<string, unknown>) {
        links.push(value);
        return builder;
      },
      onConflict() {
        return builder;
      },
      async execute() {
        if (control.failOnce) {
          control.failOnce = false;
          throw new Error("link failed");
        }
        return [];
      }
    };
    return callback({ insertInto: () => builder });
  }
}));
beforeEach(() => {
  links.length = 0;
  control.failOnce = false;
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
function setup(
  args: {
    mappedId?: string;
    current?: Rillet.Product;
    codes?: Map<string, string>;
  } = {}
) {
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
    database: {} as never,
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
  (syncer as any).mappingService = {
    getExternalId: vi.fn(async () => args.mappedId ?? null)
  };
  (syncer as any).getAccountCodesById = async () =>
    args.codes ?? new Map([["acct-shipping", "4010"]]);
  return { syncer, getProduct, createProduct, updateProduct };
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
    expect(links[0]).toMatchObject({
      entityType: "shippingItem",
      entityId: "acct-shipping:USD",
      integration: "rillet",
      companyId: "company-1",
      externalId: "shipping-product",
      metadata: { accountId: "acct-shipping", kind: "shipping" }
    });
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
    control.failOnce = true;
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
    expect(links[0]?.entityId).toBe("acct-shipping:BHD");
  });
  it("refuses an unmapped shipping account before any provider write", async () => {
    const test = setup({ codes: new Map() });
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
      current: { ...product(), unrelated: "keep" } as Rillet.Product
    });
    (test.syncer as any).getRemoteId = async () => "shipping-product";
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
