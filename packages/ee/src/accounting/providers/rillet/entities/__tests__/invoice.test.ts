import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSalesDocumentComponents } from "../../../../core/sales-document-components";
import { SyncFactory } from "../../../../core/sync";
import type { Accounting } from "../../../../core/types";
import { Rillet } from "../../models";
import {
  mapSalesInvoiceToRilletInvoice,
  RilletSalesInvoiceSyncer
} from "../invoice";
import { RilletItemSyncer } from "../item";
import { RILLET_CUSTOMER_CUSTOM_REFERENCE_TYPE } from "../shared";

function invoice(): Accounting.SalesInvoice {
  return {
    id: "si_1",
    invoiceId: "INV-0001",
    companyId: "company-1",
    customerId: "cust-1",
    customerExternalId: "rillet-cust-1",
    status: "Submitted",
    currencyCode: "USD",
    baseCurrencyCode: "USD",
    baseCurrencyDecimalPlaces: 2,
    currencyDecimalPlaces: 2,
    headerShippingCost: 0,
    shippingRevenueAccountId: "acct-shipping",
    exchangeRate: 1,
    dateIssued: "2026-08-12",
    dateDue: "2026-09-11",
    datePaid: null,
    customerReference: null,
    subtotal: 100,
    totalTax: 0,
    totalDiscount: 0,
    totalAmount: 100,
    balance: 100,
    lines: [
      {
        id: "sil_1",
        invoiceLineType: "Part",
        itemId: "item-1",
        itemCode: "PART-001",
        description: "Widget",
        quantity: 2,
        unitPrice: 50,
        shippingCost: 0,
        addOnCost: 0,
        nonTaxableAddOnCost: 0,
        taxPercent: 0,
        lineAmount: 100
      }
    ],
    updatedAt: "2026-08-12T00:00:00.000Z"
  };
}

describe("mapSalesInvoiceToRilletInvoice — external references", () => {
  it("tags the invoice and every item with a CUSTOMER_CUSTOM reference (rev-rec accepted type)", () => {
    const payload = mapSalesInvoiceToRilletInvoice({
      invoice: invoice(),
      document: buildSalesDocumentComponents(invoice()),
      shippingProductRemoteId: null,
      shippingAccountCode: null,
      customerRemoteId: "rillet-cust-1",
      itemRemoteIds: new Map([["item-1", "rillet-prod-1"]]),
      subsidiaryId: null,
      companyId: "company-1",
      documentUrl: "https://erp.example.test/x/sales-invoice/si_1"
    });

    // Invoice-level: keeps the carbon audit refs AND adds the rev-rec-accepted
    // CUSTOMER_CUSTOM reference so a Revenue-Recognition org accepts the invoice.
    expect(
      payload.external_references?.some(
        (ref) =>
          ref.type === RILLET_CUSTOMER_CUSTOM_REFERENCE_TYPE &&
          ref.id === "si_1"
      )
    ).toBe(true);

    // Every item carries a CUSTOMER_CUSTOM ref keyed by the Carbon line id
    // (rev-rec requires an accepted reference on the invoice items too).
    expect(payload.items).toHaveLength(1);
    expect(
      payload.items[0]?.external_references.some(
        (ref) =>
          ref.type === RILLET_CUSTOMER_CUSTOM_REFERENCE_TYPE &&
          ref.id === "sil_1:Merchandise"
      )
    ).toBe(true);
  });
});

function charges(): Accounting.SalesInvoice {
  const source = invoice();
  return {
    ...source,
    currencyCode: "EUR",
    exchangeRate: 0.8,
    headerShippingCost: 5,
    shippingRevenueAccountId: "acct-shipping",
    subtotal: 133,
    totalTax: 13,
    totalAmount: 151,
    balance: 151,
    lines: [
      {
        ...source.lines[0]!,
        quantity: 1,
        unitPrice: 100,
        convertedUnitPrice: 80,
        shippingCost: 10,
        addOnCost: 20,
        nonTaxableAddOnCost: 3,
        taxPercent: 0.1
      }
    ]
  };
}
function mapArguments(source = charges()) {
  return {
    invoice: source,
    document: buildSalesDocumentComponents(source),
    customerRemoteId: "customer-remote",
    itemRemoteIds: new Map([["item-1", "product"]]),
    shippingProductRemoteId: "shipping-product",
    shippingAccountCode: "4010",
    subsidiaryId: null,
    companyId: "company-1",
    documentUrl: "https://erp.example.test/x/sales-invoice/si_1"
  };
}
describe("Rillet AR_ONLY native sales components", () => {
  it("exports the document currency components with shipping revenue override and native header tax exactly once", () => {
    const payload = mapSalesInvoiceToRilletInvoice(mapArguments());
    expect(
      payload.items.map((line) => [
        line.product_id,
        line.total_amount.amount,
        line.revenue?.account_code
      ])
    ).toEqual([
      ["product", "80.00", undefined],
      ["product", "16.00", undefined],
      ["product", "2.40", undefined],
      ["shipping-product", "8.00", "4010"],
      ["shipping-product", "4.00", "4010"]
    ]);
    expect(payload.tax_amount).toEqual({ amount: "10.40", currency: "EUR" });
    expect(payload.items.every((line) => !line.tax_amount)).toBe(true);
    expect(
      payload.items.every((line) => line.total_amount.currency === "EUR")
    ).toBe(true);
    expect(payload).not.toHaveProperty("exchange_rate");
    expect(payload.scope).toBe("AR_ONLY");
    expect(
      Rillet.InvoiceSchema.parse({ ...payload, id: "remote" }).items[3]?.revenue
        ?.account_code
    ).toBe("4010");
    expect(
      new Set(
        payload.items.flatMap((line) =>
          line.external_references.map((ref) => ref.id)
        )
      ).size
    ).toBe(5);
  });
  it.each([
    0, 3
  ])("uses %i decimal serialization for document net/native tax", (decimals) => {
    const source = charges();
    source.currencyDecimalPlaces = decimals;
    const payload = mapSalesInvoiceToRilletInvoice(mapArguments(source));
    expect(payload.tax_amount?.amount).toBe(decimals === 0 ? "10" : "10.400");
    // Merchandise converts to exactly 80 at rate 0.8, so largest-remainder
    // leaves it alone; the JPY rounding unit goes to the non-taxable add-on,
    // whose 2.4 is the only component carrying a fractional remainder.
    expect(payload.items[0]?.total_amount.amount).toBe(
      decimals === 0 ? "80" : "80.000"
    );
  });
  it("requires actual products for all nonshipping components and never uses the shipping product as fallback", () => {
    const source = charges();
    source.lines[0]!.itemId = null;
    expect(() => mapSalesInvoiceToRilletInvoice(mapArguments(source))).toThrow(
      /require.*product|no item/i
    );
    expect(() =>
      mapSalesInvoiceToRilletInvoice({
        ...mapArguments(),
        itemRemoteIds: new Map()
      })
    ).toThrow(/not been synced|mapping/i);
  });
});

vi.mock("@carbon/env", () => ({ getAppUrl: () => "https://erp.example.test" }));
afterEach(() => vi.restoreAllMocks());
function setupInvoice(missingShipping = false) {
  const provider = {
    id: "rillet",
    subsidiaryId: null,
    getSyncConfig: () => ({
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    }),
    createInvoice: vi.fn()
  };
  const database = {
    selectFrom(table: string) {
      const query: any = {
        select: () => query,
        innerJoin: () => query,
        leftJoin: () => query,
        where: () => query,
        orderBy: () => query,
        executeTakeFirst: async () =>
          table === "accountDefault"
            ? { salesShippingRevenueAccount: "replacement-shipping" }
            : {
                id: "acct-shipping",
                class: "Revenue",
                active: true,
                isGroup: false
              },
        execute: async () =>
          missingShipping
            ? []
            : [
                {
                  id: "map",
                  accountId: "acct-shipping",
                  externalId: "shipping-account",
                  metadata: { externalCode: "4010" },
                  lastSyncedAt: null,
                  accountNumber: "4010",
                  accountName: "Shipping"
                }
              ]
      };
      return query;
    }
  };
  const context = {
    database: database as never,
    companyId: "company-1",
    provider: provider as never,
    config: {
      enabled: true,
      direction: "push-to-accounting" as const,
      owner: "carbon" as const
    },
    entityType: "invoice" as const
  };
  const syncer = new RilletSalesInvoiceSyncer(context);
  const ensureDependencySynced = vi.fn(
    async (type: string) => `${type}-remote`
  );
  (syncer as any).ensureDependencySynced = ensureDependencySynced;
  const itemSyncer = new RilletItemSyncer({ ...context, entityType: "item" });
  const ensureShippingProduct = vi.fn(async () => "shipping-product");
  itemSyncer.ensureShippingProduct = ensureShippingProduct;
  const factory = vi
    .spyOn(SyncFactory, "getSyncer")
    .mockReturnValue(itemSyncer);
  return {
    map: (source: Accounting.SalesInvoice) =>
      (syncer as any).mapToRemote(source),
    ensureDependencySynced,
    ensureShippingProduct,
    factory,
    provider
  };
}
describe("Rillet actual invoice preflight", () => {
  it("resolves the existing item syncer for shipping only after preflight", async () => {
    const test = setupInvoice();
    const payload = await test.map(charges());
    expect(test.ensureShippingProduct).toHaveBeenCalledWith({
      shippingAccountId: "acct-shipping",
      baseCurrencyCode: "USD",
      baseCurrencyDecimals: 2
    });
    expect(payload.items).toHaveLength(5);
    expect(payload.tax_amount.amount).toBe("10.40");
  });
  it("fails shipping account mapping before dependencies or provider document writes", async () => {
    const test = setupInvoice(true);
    await expect(test.map(charges())).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
    });
    expect(test.ensureDependencySynced).not.toHaveBeenCalled();
    expect(test.ensureShippingProduct).not.toHaveBeenCalled();
    expect(test.provider.createInvoice).not.toHaveBeenCalled();
  });
  it("preflights unsupported no-item components before provisioning anything", async () => {
    const test = setupInvoice();
    const source = charges();
    source.lines[0]!.itemId = null;
    await expect(test.map(source)).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
    });
    expect(test.ensureDependencySynced).not.toHaveBeenCalled();
    expect(test.ensureShippingProduct).not.toHaveBeenCalled();
  });
  it("does not create a shipping helper for an invoice without shipping", async () => {
    const test = setupInvoice();
    const payload = await test.map(invoice());
    expect(payload.items).toHaveLength(1);
    expect(test.factory).not.toHaveBeenCalled();
    expect(test.ensureShippingProduct).not.toHaveBeenCalled();
  });
});
