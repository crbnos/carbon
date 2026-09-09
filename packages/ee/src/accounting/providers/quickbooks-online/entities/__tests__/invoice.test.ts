import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSalesDocumentComponents } from "../../../../core/sales-document-components";
import { SyncFactory } from "../../../../core/sync";
import type { Accounting } from "../../../../core/types";
import { Qbo } from "../../models";
import {
  buildQboInvoiceLines,
  deriveCarbonInvoiceStatus,
  QboSalesInvoiceSyncer
} from "../invoice";
import { QboItemSyncer } from "../item";
import { buildQboDocNumberFields, QBO_DOC_NUMBER_MAX_LENGTH } from "../shared";

const makeLine = (
  overrides?: Partial<Accounting.SalesInvoiceLine>
): Accounting.SalesInvoiceLine => ({
  id: "line-1",
  invoiceLineType: "Part",
  itemId: "item-1",
  itemCode: "PART-000123",
  description: "Widget Bracket",
  quantity: 3,
  unitPrice: 19.999,
  shippingCost: 0,
  addOnCost: 0,
  nonTaxableAddOnCost: 0,
  taxPercent: 0,
  lineAmount: 59.997,
  ...overrides
});

describe("buildQboInvoiceLines (invoice mapping fixture)", () => {
  it("builds SalesItemLineDetail lines with ItemRef + Qty/UnitPrice and a rounded Amount", () => {
    const lines = buildQboInvoiceLines(
      lineArguments([makeLine()], new Map([["item-1", "77"]]))
    );

    expect(lines).toEqual([
      {
        Description: "Widget Bracket",
        Amount: 60,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "77" },
          Qty: 3,
          UnitPrice: 19.999,
          TaxCodeRef: { value: "NON" }
        }
      }
    ]);
  });

  it("ships lines without an item without an ItemRef", () => {
    const lines = buildQboInvoiceLines(
      lineArguments(
        [
          makeLine({
            itemId: null,
            itemCode: null,
            description: "Expedite fee",
            quantity: 1,
            unitPrice: 50
          })
        ],
        new Map()
      )
    );

    expect(lines[0]?.SalesItemLineDetail?.ItemRef).toBeUndefined();
    expect(lines[0]?.Amount).toBe(50);
  });
});

describe("buildQboDocNumberFields (21-char DocNumber cap)", () => {
  it("uses DocNumber when the readable id fits (boundary: exactly 21 chars)", () => {
    const id = "I".repeat(QBO_DOC_NUMBER_MAX_LENGTH);
    expect(buildQboDocNumberFields(id)).toEqual({
      DocNumber: id,
      PrivateNote: undefined,
      source: "docNumber"
    });
  });

  it("moves a longer id to PrivateNote and lets QBO auto-number", () => {
    const id = "INV-000000000000000042"; // 22 chars
    expect(id.length).toBe(QBO_DOC_NUMBER_MAX_LENGTH + 1);

    const fields = buildQboDocNumberFields(id);
    expect(fields.DocNumber).toBeUndefined();
    expect(fields.PrivateNote).toBe(`Carbon ${id}`);
    expect(fields.source).toBe("privateNote");
  });

  it("joins an extra note onto the PrivateNote carrier", () => {
    const id = "I".repeat(QBO_DOC_NUMBER_MAX_LENGTH + 1);
    expect(buildQboDocNumberFields(id, "Ref PO-9").PrivateNote).toBe(
      `Carbon ${id} | Ref PO-9`
    );
    expect(buildQboDocNumberFields("INV-42", "Ref PO-9")).toEqual({
      DocNumber: "INV-42",
      PrivateNote: "Ref PO-9",
      source: "docNumber"
    });
  });
});

describe("deriveCarbonInvoiceStatus (pull status from Balance/TotalAmt)", () => {
  it("derives Paid / Partially Paid / Submitted from the balance", () => {
    expect(deriveCarbonInvoiceStatus(100, 0)).toBe("Paid");
    expect(deriveCarbonInvoiceStatus(100, 40)).toBe("Partially Paid");
    expect(deriveCarbonInvoiceStatus(100, 100)).toBe("Submitted");
  });

  it("returns undefined when QBO reports no balance", () => {
    expect(deriveCarbonInvoiceStatus(100, undefined)).toBeUndefined();
  });
});

function fullInvoice(): Accounting.SalesInvoice {
  return {
    id: "invoice",
    invoiceId: "INV-1",
    companyId: "company",
    customerId: "customer",
    customerExternalId: null,
    status: "Submitted",
    currencyCode: "EUR",
    exchangeRate: 0.8,
    baseCurrencyCode: "USD",
    baseCurrencyDecimalPlaces: 2,
    currencyDecimalPlaces: 2,
    headerShippingCost: 5,
    shippingRevenueAccountId: "acct-shipping",
    dateIssued: "2026-09-07",
    dateDue: null,
    datePaid: null,
    customerReference: null,
    subtotal: 133,
    totalTax: 13,
    totalDiscount: 0,
    totalAmount: 151,
    balance: 151,
    updatedAt: "2026-09-07T00:00:00.000Z",
    lines: [
      makeLine({
        id: "line",
        quantity: 1,
        unitPrice: 100,
        convertedUnitPrice: 80,
        shippingCost: 10,
        addOnCost: 20,
        nonTaxableAddOnCost: 3,
        taxPercent: 0.1
      })
    ]
  };
}
function setupInvoice(
  options: {
    missingShipping?: boolean;
    missingTax?: boolean;
    country?: string;
  } = {}
) {
  const country = options.country ?? "US";
  const provider = {
    id: "quickbooks",
    getSyncConfig: () => ({
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    }),
    getCompanyInfo: vi.fn(async () => ({ Country: country })),
    query: vi.fn(async (entity: string) =>
      entity === "TaxRate"
        ? [{ Id: "rate-ten", RateValue: 10 }]
        : [
            ...(options.missingTax
              ? []
              : [
                  {
                    Id: "ten",
                    SalesTaxRateList: {
                      TaxRateDetail: [{ TaxRateRef: { value: "rate-ten" } }]
                    }
                  }
                ]),
            ...(country === "US"
              ? [
                  { Id: "TAX", Taxable: true },
                  { Id: "NON", Taxable: false }
                ]
              : [{ Id: "zero", Taxable: false }])
          ]
    ),
    createInvoice: vi.fn(),
    updateInvoice: vi.fn()
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
          options.missingShipping
            ? []
            : [
                {
                  id: "mapping",
                  accountId: "acct-shipping",
                  externalId: "shipping-account",
                  metadata: null,
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
    companyId: "company",
    provider: provider as never,
    config: {
      enabled: true,
      direction: "push-to-accounting" as const,
      owner: "carbon" as const
    },
    entityType: "invoice" as const
  };
  const syncer = new QboSalesInvoiceSyncer(context);
  const ensureDependencySynced = vi.fn(
    async (type: string) => `${type}-remote`
  );
  (syncer as any).ensureDependencySynced = ensureDependencySynced;
  const itemSyncer = new QboItemSyncer({ ...context, entityType: "item" });
  const ensureShippingItem = vi.fn(async () => "shipping-item");
  itemSyncer.ensureShippingItem = ensureShippingItem;
  const factory = vi
    .spyOn(SyncFactory, "getSyncer")
    .mockReturnValue(itemSyncer);
  return {
    map: (source: Accounting.SalesInvoice) =>
      (syncer as any).mapToRemote(source) as Promise<Qbo.Invoice>,
    provider,
    ensureDependencySynced,
    ensureShippingItem,
    factory
  };
}
afterEach(() => vi.restoreAllMocks());
describe("QBO actual invoice component/tax preflight", () => {
  it.each([
    "US",
    "GB"
  ])("sends one native tax detail and shipping ItemRef with reciprocal FX for %s", async (country) => {
    const test = setupInvoice({ country });
    const payload = await test.map(fullInvoice());
    expect(payload).toMatchObject({
      CurrencyRef: { value: "EUR" },
      ExchangeRate: 1.25,
      TxnTaxDetail: { TotalTax: 10.4 }
    });
    expect(
      payload.Line.map((line) => [
        line.Amount,
        line.SalesItemLineDetail?.ItemRef?.value
      ])
    ).toEqual([
      [80, "item-remote"],
      [16, "item-remote"],
      [2.4, "item-remote"],
      [8, "shipping-item"],
      [4, "shipping-item"]
    ]);
    expect(
      payload.Line.every((line) => line.DetailType === "SalesItemLineDetail")
    ).toBe(true);
    expect(
      payload.Line.reduce((sum, line) => sum + line.Amount, 0) +
        payload.TxnTaxDetail!.TotalTax
    ).toBeCloseTo(120.8, 8);
    expect(
      Qbo.InvoiceSchema.parse({ ...payload, Id: "remote", SyncToken: "1" })
        .TxnTaxDetail?.TotalTax
    ).toBe(10.4);
    expect(test.ensureShippingItem).toHaveBeenCalledOnce();
    expect(test.provider.getCompanyInfo).toHaveBeenCalledOnce();
    expect(payload.GlobalTaxCalculation).toBe(
      country === "US" ? undefined : "TaxExcluded"
    );
  });
  it.each([
    "missingShipping",
    "missingTax"
  ] as const)("refuses %s before dependencies/helpers/invoice writes", async (option) => {
    const test = setupInvoice({ [option]: true });
    await expect(test.map(fullInvoice())).rejects.toMatchObject({
      failure: {
        errorCode:
          option === "missingTax" ? "UNMAPPED_TAX_CODES" : "UNMAPPED_ACCOUNTS",
        warning: true
      }
    });
    expect(test.ensureDependencySynced).not.toHaveBeenCalled();
    expect(test.ensureShippingItem).not.toHaveBeenCalled();
    expect(test.provider.createInvoice).not.toHaveBeenCalled();
    expect(test.provider.updateInvoice).not.toHaveBeenCalled();
  });
  it("rejects a non-finite reciprocal FX rate before provisioning", async () => {
    const source = fullInvoice();
    source.exchangeRate = Number.MIN_VALUE;
    source.lines[0]!.convertedUnitPrice = null;
    const test = setupInvoice();
    await expect(test.map(source)).rejects.toThrow(/exchange rate|finite/i);
    expect(test.ensureDependencySynced).not.toHaveBeenCalled();
  });
  it("does not provision a shipping helper for a zero shipping document", async () => {
    const source = fullInvoice();
    source.headerShippingCost = 0;
    source.subtotal = 123;
    source.totalTax = 12;
    source.totalAmount = 135;
    source.balance = 135;
    source.lines[0]!.shippingCost = 0;
    const test = setupInvoice();
    const payload = await test.map(source);
    expect(payload.Line).toHaveLength(3);
    expect(test.ensureShippingItem).not.toHaveBeenCalled();
    expect(test.factory).not.toHaveBeenCalled();
  });
});

function lineArguments(
  lines: Accounting.SalesInvoiceLine[],
  itemRemoteIds: ReadonlyMap<string, string>
) {
  const source = fullInvoice();
  const subtotal = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0
  );
  const document = buildSalesDocumentComponents({
    ...source,
    currencyCode: "USD",
    exchangeRate: 1,
    headerShippingCost: 0,
    shippingRevenueAccountId: "acct-shipping",
    lines,
    subtotal,
    totalTax: 0,
    totalAmount: subtotal,
    balance: subtotal
  });
  return {
    document,
    itemRemoteIds,
    shippingItemRemoteId: null,
    lineTaxCodeRefs: new Map(
      document.components.map((line) => [line.id, { value: "NON" }])
    )
  };
}

it("retries a failed tax catalog read on the same syncer and caches a later success", async () => {
  const test = setupInvoice();
  test.provider.getCompanyInfo.mockRejectedValueOnce(
    new Error("temporary provider outage")
  );
  await expect(test.map(fullInvoice())).rejects.toThrow(
    /temporary provider outage/
  );
  await expect(test.map(fullInvoice())).resolves.toMatchObject({
    TxnTaxDetail: { TotalTax: 10.4 }
  });
  await test.map(fullInvoice());
  expect(test.provider.getCompanyInfo).toHaveBeenCalledTimes(2);
});
