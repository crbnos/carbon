import { describe, expect, it, vi } from "vitest";
import type { SalesDocumentComponents } from "../../../../core/sales-document-components";
import type { Qbo } from "../../models";
import type { QboProvider } from "../../provider";
import {
  loadQboInvoiceTaxCatalog,
  type QboInvoiceTaxCatalog,
  resolveQboInvoiceTax
} from "../invoice-tax";

function document(): SalesDocumentComponents {
  return {
    invoiceId: "invoice",
    currencyCode: "EUR",
    decimalPlaces: 2,
    subtotal: 110.4,
    totalTax: 10.4,
    totalAmount: 120.8,
    balance: 120.8,
    components: [
      {
        id: "merch",
        sourceLineId: "line",
        kind: "Merchandise",
        itemId: "item",
        itemCode: "PART",
        description: "Part",
        quantity: 1,
        unitAmount: 80,
        netAmount: 80,
        taxPercent: 0.1,
        taxAmount: 8
      },
      {
        id: "addon",
        sourceLineId: "line",
        kind: "TaxableAddOn",
        itemId: "item",
        itemCode: "PART",
        description: "Addon",
        quantity: 1,
        unitAmount: 16,
        netAmount: 16,
        taxPercent: 0.1,
        taxAmount: 1.6
      },
      {
        id: "shipping",
        sourceLineId: "line",
        kind: "LineShipping",
        itemId: "item",
        itemCode: "PART",
        description: "Shipping",
        quantity: 1,
        unitAmount: 8,
        netAmount: 8,
        taxPercent: 0.1,
        taxAmount: 0.8
      },
      {
        id: "nontax",
        sourceLineId: "line",
        kind: "NonTaxableAddOn",
        itemId: "item",
        itemCode: "PART",
        description: "Non-tax addon",
        quantity: 1,
        unitAmount: 2.4,
        netAmount: 2.4,
        taxPercent: 0,
        taxAmount: 0
      },
      {
        id: "header",
        sourceLineId: null,
        kind: "HeaderShipping",
        itemId: null,
        itemCode: null,
        description: "Shipping",
        quantity: 1,
        unitAmount: 4,
        netAmount: 4,
        taxPercent: 0,
        taxAmount: 0
      }
    ]
  };
}
function catalog(country = "US"): {
  country: string;
  taxCodes: Qbo.TaxCode[];
  taxRates: Qbo.TaxRate[];
} {
  return {
    country,
    taxCodes: [
      {
        Id: "ten",
        Name: "Ten percent",
        Active: true,
        SalesTaxRateList: {
          TaxRateDetail: [
            {
              TaxRateRef: { value: "rate-ten" },
              TaxTypeApplicable: "TaxOnAmount",
              TaxOrder: 0
            }
          ]
        }
      },
      ...(country === "US"
        ? [
            { Id: "TAX", Active: true, Taxable: true },
            { Id: "NON", Active: true, Taxable: false }
          ]
        : [
            {
              Id: "zero",
              Name: "Zero",
              Active: true,
              SalesTaxRateList: {
                TaxRateDetail: [{ TaxRateRef: { value: "rate-zero" } }]
              }
            }
          ])
    ],
    taxRates: [
      { Id: "rate-ten", RateValue: 10, Active: true },
      { Id: "rate-zero", RateValue: 0, Active: true }
    ]
  };
}
function expectWarning(
  source: SalesDocumentComponents,
  remote: QboInvoiceTaxCatalog,
  reason?: RegExp
) {
  try {
    resolveQboInvoiceTax({ document: source, catalog: remote });
    expect.fail("Expected tax preflight to fail");
  } catch (error) {
    expect(error).toMatchObject({
      name: "JournalEntrySyncError",
      failure: {
        errorCode: "UNMAPPED_TAX_CODES",
        warning: true,
        metadata: {
          invoiceId: "invoice",
          requestedRates: expect.any(Array),
          candidateTaxCodeIds: expect.any(Array),
          reason: expect.any(String)
        }
      }
    });
    if (reason) expect(String(error)).toMatch(reason);
  }
}

describe("QuickBooks native invoice tax", () => {
  it("uses US transaction tax and actual taxable/non-taxable catalog markers, grouping native tax once", () => {
    const result = resolveQboInvoiceTax({
      document: document(),
      catalog: catalog()
    });
    expect(Object.fromEntries(result.lineTaxCodeRefs)).toEqual({
      merch: { value: "TAX" },
      addon: { value: "TAX" },
      shipping: { value: "TAX" },
      nontax: { value: "NON" },
      header: { value: "NON" }
    });
    expect(result.txnTaxDetail).toEqual({
      TxnTaxCodeRef: { value: "ten" },
      TotalTax: 10.4,
      TaxLine: [
        {
          Amount: 10.4,
          DetailType: "TaxLineDetail",
          TaxLineDetail: {
            TaxRateRef: { value: "rate-ten" },
            NetAmountTaxable: 104,
            PercentBased: true,
            TaxPercent: 10
          }
        }
      ]
    });
  });
  it("uses global sales tax codes and real member rate IDs without a US transaction code", () => {
    const result = resolveQboInvoiceTax({
      document: document(),
      catalog: catalog("GB")
    });
    expect(result.lineTaxCodeRefs.get("merch")).toEqual({ value: "ten" });
    expect(result.lineTaxCodeRefs.get("header")).toEqual({ value: "zero" });
    expect(result.txnTaxDetail?.TxnTaxCodeRef).toBeUndefined();
    expect(
      result.txnTaxDetail?.TaxLine?.[0]?.TaxLineDetail?.TaxRateRef
    ).toEqual({ value: "rate-ten" });
    expect(result.txnTaxDetail?.TotalTax).toBe(10.4);
  });
  it("accepts an actual global non-taxable code without fabricating a zero rate", () => {
    const remote = catalog("GB");
    remote.taxCodes = [
      ...remote.taxCodes.filter((code) => code.Id !== "zero"),
      { Id: "exempt", Active: true, Taxable: false }
    ];
    const result = resolveQboInvoiceTax({
      document: document(),
      catalog: remote
    });
    expect(result.lineTaxCodeRefs.get("header")).toEqual({ value: "exempt" });
    expect(result.txnTaxDetail?.TaxLine).toHaveLength(1);
  });
  it("supports distinct simple global sales rates and refuses incompatible US transaction codes", () => {
    const source = document();
    source.components[0]!.taxPercent = 0.2;
    source.components[0]!.taxAmount = 16;
    source.totalTax = 18.4;
    source.totalAmount = 128.8;
    const remote = catalog("CA");
    remote.taxCodes.push({
      Id: "twenty",
      SalesTaxRateList: {
        TaxRateDetail: [{ TaxRateRef: { value: "rate-twenty" } }]
      }
    });
    remote.taxRates.push({ Id: "rate-twenty", RateValue: 20 });
    const result = resolveQboInvoiceTax({ document: source, catalog: remote });
    expect(result.txnTaxDetail?.TaxLine).toHaveLength(2);
    expect(result.txnTaxDetail?.TotalTax).toBe(18.4);
    expectWarning(
      source,
      { ...remote, country: "US" },
      /multiple|transaction/i
    );
  });
  it("uses catalog non-tax markers for all-zero tax and omits empty native tax detail", () => {
    const source = document();
    source.components.forEach((line) => {
      line.taxPercent = 0;
      line.taxAmount = 0;
    });
    source.totalTax = 0;
    source.totalAmount = source.subtotal;
    const result = resolveQboInvoiceTax({
      document: source,
      catalog: catalog()
    });
    expect(result.lineTaxCodeRefs.size).toBe(source.components.length);
    expect(
      [...result.lineTaxCodeRefs.values()].every((ref) => ref.value === "NON")
    ).toBe(true);
    expect(result.txnTaxDetail).toBeUndefined();
  });
  it.each([
    "missing",
    "duplicate",
    "inactive",
    "purchase-only",
    "compound",
    "tax-on-tax",
    "dated"
  ])("rejects %s tax setup without inventing an account/code or rate", (kind) => {
    const remote = catalog();
    if (kind === "missing") remote.taxRates = [];
    if (kind === "duplicate")
      remote.taxCodes.push({ ...remote.taxCodes[0]!, Id: "duplicate" });
    if (kind === "inactive") remote.taxRates[0]!.Active = false;
    if (kind === "purchase-only") {
      remote.taxCodes[0]!.PurchaseTaxRateList =
        remote.taxCodes[0]!.SalesTaxRateList;
      delete remote.taxCodes[0]!.SalesTaxRateList;
    }
    if (kind === "compound")
      remote.taxCodes[0]!.SalesTaxRateList!.TaxRateDetail.push({
        TaxRateRef: { value: "rate-zero" }
      });
    if (kind === "tax-on-tax")
      remote.taxCodes[0]!.SalesTaxRateList!
        .TaxRateDetail[0]!.TaxTypeApplicable = "TaxOnTax";
    if (kind === "dated")
      remote.taxRates[0]!.EffectiveTaxRate = [
        { EffectiveDate: "2026-01-01", RateValue: 10 }
      ];
    expectWarning(document(), remote);
  });
  it("fails rather than fabricating missing zero-tax markers or guessing jurisdiction", () => {
    const remote = catalog();
    remote.taxCodes = remote.taxCodes.filter((code) => code.Id !== "NON");
    expectWarning(document(), remote);
    expectWarning(document(), { ...catalog(), country: "" });
  });
  it("rejects source tax amounts that cannot be reproduced by the resolved percentage", () => {
    const source = document();
    source.components[0]!.taxAmount = 12;
    source.totalTax = 14.4;
    expectWarning(source, catalog(), /reproduc|reconcil/i);
  });
});

describe("loadQboInvoiceTaxCatalog", () => {
  it("loads company jurisdiction and both complete provider query catalogs and filters inactive rows", async () => {
    const getCompanyInfo = vi.fn(async () => ({ Country: "GB" }));
    const query = vi.fn(async (entity: string) =>
      entity === "TaxCode"
        ? [{ Id: "active" }, { Id: "inactive", Active: false }]
        : [{ Id: "rate", RateValue: 10 }]
    );
    expect(
      await loadQboInvoiceTaxCatalog({
        getCompanyInfo,
        query
      } as unknown as QboProvider)
    ).toEqual({
      country: "GB",
      taxCodes: [{ Id: "active" }],
      taxRates: [{ Id: "rate", RateValue: 10 }]
    });
    expect(query.mock.calls).toEqual([["TaxCode"], ["TaxRate"]]);
    expect(getCompanyInfo).toHaveBeenCalledOnce();
  });
  it("propagates catalog read errors and refuses absent company jurisdiction", async () => {
    const provider = {
      getCompanyInfo: async () => ({ Country: "US" }),
      query: async () => {
        throw new Error("catalog unavailable");
      }
    };
    await expect(
      loadQboInvoiceTaxCatalog(provider as unknown as QboProvider)
    ).rejects.toThrow("catalog unavailable");
    await expect(
      loadQboInvoiceTaxCatalog({
        getCompanyInfo: async () => null,
        query: async () => []
      } as unknown as QboProvider)
    ).rejects.toThrow(/jurisdiction|country/i);
  });
});
