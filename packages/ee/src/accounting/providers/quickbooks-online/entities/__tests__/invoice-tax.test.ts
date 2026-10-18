// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import type {
  BillTaxLine,
  CostingLine
} from "../../../../core/document-costing";
import type { SalesDocumentComponents } from "../../../../core/sales-document-components";
import { buildTaxCodeMappingLookup } from "../../../../core/tax-mapping";
import type { Qbo } from "../../models";
import type { QboProvider } from "../../provider";
import {
  loadQboInvoiceTaxCatalog,
  type QboInvoiceTaxCatalog,
  QboTaxContext,
  qboNonTaxableCode,
  qboTaxOptions,
  resolveQboInvoiceTax,
  resolveQboPurchaseTaxLines
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
        invoiceLineType: "Part",
        description: "Part",
        quantity: 1,
        unitAmount: 80,
        netAmount: 80,
        taxPercent: 0.1,
        taxAmount: 8,
        taxCodeId: null
      },
      {
        id: "addon",
        sourceLineId: "line",
        kind: "TaxableAddOn",
        itemId: "item",
        itemCode: "PART",
        invoiceLineType: "Part",
        description: "Addon",
        quantity: 1,
        unitAmount: 16,
        netAmount: 16,
        taxPercent: 0.1,
        taxAmount: 1.6,
        taxCodeId: null
      },
      {
        id: "shipping",
        sourceLineId: "line",
        kind: "LineShipping",
        itemId: "item",
        itemCode: "PART",
        invoiceLineType: "Part",
        description: "Shipping",
        quantity: 1,
        unitAmount: 8,
        netAmount: 8,
        taxPercent: 0.1,
        taxAmount: 0.8,
        taxCodeId: null
      },
      {
        id: "nontax",
        sourceLineId: "line",
        kind: "NonTaxableAddOn",
        itemId: "item",
        itemCode: "PART",
        invoiceLineType: "Part",
        description: "Non-tax addon",
        quantity: 1,
        unitAmount: 2.4,
        netAmount: 2.4,
        taxPercent: 0,
        taxAmount: 0,
        taxCodeId: null
      },
      {
        id: "header",
        sourceLineId: null,
        kind: "HeaderShipping",
        itemId: null,
        itemCode: null,
        invoiceLineType: null,
        description: "Shipping",
        quantity: 1,
        unitAmount: 4,
        netAmount: 4,
        taxPercent: 0,
        taxAmount: 0,
        taxCodeId: null
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
  let error: unknown;
  try {
    resolveQboInvoiceTax({ document: source, catalog: remote });
  } catch (caught) {
    error = caught;
  }
  expect(error, "Expected tax preflight to fail").toBeDefined();
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

describe("QuickBooks native invoice tax", () => {
  it("uses US transaction tax and documented taxable/non-taxable markers, grouping native tax once", () => {
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
  it("uses documented US non-tax markers for all-zero tax and omits empty native tax detail", () => {
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
  ])(
    "rejects %s tax setup without inventing an account/code or rate",
    (kind) => {
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
    }
  );
  it("fails rather than guessing jurisdiction", () => {
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

it("uses documented US markers without requiring marker rows in the tax catalog", () => {
  const source = document();
  const remote = catalog();
  remote.taxCodes = remote.taxCodes.filter(
    (code) => code.Id !== "TAX" && code.Id !== "NON"
  );
  expect(
    resolveQboInvoiceTax({
      document: source,
      catalog: remote
    }).lineTaxCodeRefs.get("merch")
  ).toEqual({ value: "TAX" });
  source.components.forEach((line) => {
    line.taxPercent = 0;
    line.taxAmount = 0;
  });
  source.totalTax = 0;
  expect(
    resolveQboInvoiceTax({
      document: source,
      catalog: { country: "US", taxCodes: [], taxRates: [] }
    })
  ).toMatchObject({ txnTaxDetail: undefined });
});

describe("qboTaxOptions", () => {
  it("offers single-rate codes of the direction with a 0..1 rate", () => {
    expect(qboTaxOptions(catalog("GB"), "sales")).toEqual([
      { id: "ten", name: "Ten percent", rate: 0.1, direction: "sales" },
      { id: "zero", name: "Zero", rate: 0, direction: "sales" }
    ]);
  });

  it("offers nothing for a direction the codes have no rate list for", () => {
    expect(qboTaxOptions(catalog("GB"), "purchase")).toEqual([]);
  });
});

/**
 * A UK company: two 20% sales codes (so a bare 20% is ambiguous), a 20%
 * purchase code, and three 0% codes of which "No VAT" is the non-taxable one.
 */
function gbCatalog(country = "GB"): QboInvoiceTaxCatalog {
  const code = (
    Id: string,
    Name: string,
    salesRate?: string,
    purchaseRate?: string
  ): Qbo.TaxCode => ({
    Id,
    Name,
    Active: true,
    ...(salesRate
      ? {
          SalesTaxRateList: {
            TaxRateDetail: [{ TaxRateRef: { value: salesRate } }]
          }
        }
      : {}),
    ...(purchaseRate
      ? {
          PurchaseTaxRateList: {
            TaxRateDetail: [{ TaxRateRef: { value: purchaseRate } }]
          }
        }
      : {})
  });
  return {
    country,
    taxCodes: [
      code("20S", "20.0% S", "r20s", "r20p"),
      code("20ECS", "20.0% ECS", "r20ecs"),
      code("0Z", "0.0% Z", "r0zs", "r0zp"),
      code("EX", "Exempt", "r0exs", "r0exp"),
      code("NOVAT", "No VAT", "r0ns", "r0np")
    ],
    taxRates: [
      { Id: "r20s", RateValue: 20 },
      { Id: "r20p", RateValue: 20 },
      { Id: "r20ecs", RateValue: 20 },
      { Id: "r0zs", RateValue: 0 },
      { Id: "r0zp", RateValue: 0 },
      { Id: "r0exs", RateValue: 0 },
      { Id: "r0exp", RateValue: 0 },
      { Id: "r0ns", RateValue: 0 },
      { Id: "r0np", RateValue: 0 }
    ]
  };
}

const MAPPINGS = buildTaxCodeMappingLookup([
  {
    taxCodeId: "tc_std",
    direction: "sales",
    externalId: "20S",
    externalName: "20.0% S",
    externalRate: 0.2
  },
  {
    taxCodeId: "tc_std",
    direction: "purchase",
    externalId: "20S",
    externalName: "20.0% S",
    externalRate: 0.2
  }
]);

function codedDocument(): SalesDocumentComponents {
  const source = document();
  source.components = [
    {
      ...source.components[0]!,
      taxPercent: 0.2,
      taxAmount: 16,
      taxCodeId: "tc_std"
    },
    // A non-taxable add-on carries no code.
    source.components[3]!,
    // Untaxed header shipping has no code.
    source.components[4]!
  ];
  source.totalTax = 16;
  return source;
}

describe("QuickBooks mapped tax codes on sales documents", () => {
  it("sends the mapped code where a bare 20% matches two codes", () => {
    const result = resolveQboInvoiceTax({
      document: codedDocument(),
      catalog: gbCatalog(),
      mappings: MAPPINGS
    });
    expect(Object.fromEntries(result.lineTaxCodeRefs)).toEqual({
      merch: { value: "20S" },
      // Several 0% codes: the untaxed amounts take the non-taxable one.
      nontax: { value: "NOVAT" },
      header: { value: "NOVAT" }
    });
    expect(result.txnTaxDetail).toEqual({
      TotalTax: 16,
      TaxLine: [
        {
          Amount: 16,
          DetailType: "TaxLineDetail",
          TaxLineDetail: {
            TaxRateRef: { value: "r20s" },
            NetAmountTaxable: 80,
            PercentBased: true,
            TaxPercent: 20
          }
        }
      ]
    });
  });

  it("refuses a code with no sales mapping, naming the code", () => {
    let error: unknown;
    try {
      resolveQboInvoiceTax({
        document: codedDocument(),
        catalog: gbCatalog(),
        mappings: new Map()
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      failure: {
        errorCode: "UNMAPPED_TAX_CODES",
        warning: true,
        metadata: { taxCodeId: "tc_std", direction: "sales" }
      }
    });
  });

  it("refuses a mapped code whose rate does not reproduce the line's tax", () => {
    const source = codedDocument();
    source.components[0]!.taxPercent = 0.1;
    source.components[0]!.taxAmount = 8;
    source.totalTax = 8;
    expect(() =>
      resolveQboInvoiceTax({
        document: source,
        catalog: gbCatalog(),
        mappings: MAPPINGS
      })
    ).toThrow(/UNMAPPED_TAX_CODES/);
  });

  it("keeps the US markers and sends the mapped code as the transaction code", () => {
    const us = catalog();
    const result = resolveQboInvoiceTax({
      document: codedDocument(),
      catalog: {
        ...us,
        taxCodes: [
          ...us.taxCodes,
          {
            Id: "state",
            Name: "State",
            SalesTaxRateList: {
              TaxRateDetail: [{ TaxRateRef: { value: "rate-state" } }]
            }
          }
        ],
        taxRates: [...us.taxRates, { Id: "rate-state", RateValue: 20 }]
      },
      mappings: buildTaxCodeMappingLookup([
        {
          taxCodeId: "tc_std",
          direction: "sales",
          externalId: "state",
          externalName: "State",
          externalRate: 0.2
        }
      ])
    });
    expect(Object.fromEntries(result.lineTaxCodeRefs)).toEqual({
      merch: { value: "TAX" },
      nontax: { value: "NON" },
      header: { value: "NON" }
    });
    expect(result.txnTaxDetail).toMatchObject({
      TxnTaxCodeRef: { value: "state" },
      TotalTax: 16
    });
  });
});

describe("qboNonTaxableCode", () => {
  it("prefers a code QuickBooks marks non-taxable with no rate", () => {
    const remote = gbCatalog();
    remote.taxCodes = [
      ...remote.taxCodes,
      { Id: "OOS", Name: "Outside scope", Active: true, Taxable: false }
    ];
    expect(qboNonTaxableCode(remote, "purchase", "doc").Id).toBe("OOS");
  });

  it("falls back to the 0% code named No VAT", () => {
    expect(qboNonTaxableCode(gbCatalog(), "purchase", "doc").Id).toBe("NOVAT");
  });

  it("refuses rather than choose between two candidates", () => {
    const remote = gbCatalog();
    remote.taxCodes = [
      ...remote.taxCodes,
      { Id: "NON", Name: "NON", Active: true }
    ];
    expect(() => qboNonTaxableCode(remote, "purchase", "doc")).toThrow(
      /UNMAPPED_TAX_CODES/
    );
  });
});

describe("resolveQboPurchaseTaxLines", () => {
  const leg = (id: string, amount: number): CostingLine => ({
    id,
    accountId: "acc",
    amount,
    description: null,
    tax: { taxCodeId: "tc_std", taxPercent: 0.2 }
  });
  const resolve = (lines: BillTaxLine[]) =>
    resolveQboPurchaseTaxLines({
      documentId: "bill",
      lines,
      decimalPlaces: 2,
      catalog: gbCatalog(),
      mappings: MAPPINGS
    });

  it("names the mapped code of a taxed line and the non-taxable code of the rest", () => {
    const taxed: BillTaxLine = {
      leg: leg("leg", 1100),
      amount: 500,
      tax: { taxCodeId: "tc_std", taxPercent: 0.2, taxAmount: 100 }
    };
    const rest: BillTaxLine = { leg: leg("leg", 1100), amount: 600, tax: null };
    expect(resolve([taxed, rest])).toEqual([
      {
        line: taxed,
        codeRef: { value: "20S" },
        rate: { Id: "r20p", RateValue: 20 }
      },
      { line: rest, codeRef: { value: "NOVAT" }, rate: null }
    ]);
  });

  it("refuses a line whose tax the mapped rate does not give", () => {
    expect(() =>
      resolve([
        {
          leg: leg("leg", 500),
          amount: 500,
          tax: { taxCodeId: "tc_std", taxPercent: 0.2, taxAmount: 90 }
        }
      ])
    ).toThrow(/UNMAPPED_TAX_CODES/);
  });
});

describe("QboTaxContext", () => {
  it("reads the mappings once, and again after a failed read", async () => {
    const results = [
      { data: null, error: "connection reset" },
      {
        data: [
          {
            taxCodeId: "tc_std",
            direction: "sales" as const,
            externalId: "20S",
            externalName: null,
            externalRate: 0.2
          }
        ],
        error: null
      }
    ];
    let reads = 0;
    const context = new QboTaxContext({
      catalog: async () => gbCatalog(),
      mappings: async () => results[reads++]!
    });
    await expect(context.mappings("doc")).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_TAX_CODES", warning: true }
    });
    expect(
      (await context.mappings("doc")).get("tc_std:sales")?.externalId
    ).toBe("20S");
    await context.mappings("doc");
    expect(reads).toBe(2);
  });
});
