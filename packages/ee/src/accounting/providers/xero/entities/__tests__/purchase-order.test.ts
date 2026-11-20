// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import type { Xero } from "../../models";
import { xeroItemCode } from "../item";
import {
  PurchaseOrderSyncer,
  type XeroPurchaseOrder,
  type XeroPurchaseOrderLine,
  xeroPurchaseOrderLineParts
} from "../purchase-order";

/**
 * A PO line names its item by `ItemCode`, which Xero resolves against the
 * items it holds. The item syncer pushes a revised item as
 * `readableIdWithRevision` (`PRT-001374.A`), so a line sending the bare
 * `readableId` is refused with "Item code 'PRT-001374' is not valid".
 */

describe("xeroItemCode", () => {
  it("uses the revisioned id when the item has one", () => {
    expect(
      xeroItemCode({
        readableId: "PRT-001374",
        readableIdWithRevision: "PRT-001374.A"
      })
    ).toBe("PRT-001374.A");
  });

  it("falls back to the readable id", () => {
    expect(
      xeroItemCode({ readableId: "PRT-001374", readableIdWithRevision: null })
    ).toBe("PRT-001374");
  });
});

/** The organisation's tax rates, as GET /TaxRates returns them. */
const XERO_TAX_RATES: Xero.TaxRate[] = [
  {
    TaxType: "OUTPUT2",
    Name: "20% (VAT on Income)",
    EffectiveRate: 20,
    CanApplyToRevenue: true,
    CanApplyToExpenses: false
  },
  {
    TaxType: "INPUT2",
    Name: "20% (VAT on Expenses)",
    EffectiveRate: 20,
    CanApplyToRevenue: false,
    CanApplyToExpenses: true,
    CanApplyToLiabilities: false
  },
  {
    TaxType: "ZERORATEDINPUT",
    Name: "Zero Rated Expenses",
    EffectiveRate: 0,
    CanApplyToRevenue: false,
    CanApplyToExpenses: true
  },
  { TaxType: "NONE", Name: "No VAT", EffectiveRate: 0 }
];

function makePurchaseOrderSyncer(
  itemRow: {
    readableId: string;
    readableIdWithRevision: string | null;
  },
  taxMappings: Array<{
    entityId: string;
    externalId: string;
    metadata: unknown;
  }> = [],
  options: {
    /** Account-mapping rows (Carbon account → Xero code). */
    accountMappings?: Array<{ accountId: string; externalCode: string }>;
    chart?: Xero.Account[];
  } = {}
) {
  const database = {
    selectFrom: (table: string) => {
      const query: Record<string, unknown> = {
        select: () => query,
        where: () => query,
        leftJoin: () => query,
        orderBy: () => query,
        executeTakeFirst: async () => itemRow,
        execute: async () =>
          table === "externalIntegrationMapping as m"
            ? (options.accountMappings ?? []).map((row) => ({
                id: `m-${row.accountId}`,
                accountId: row.accountId,
                externalId: `${row.accountId}-remote`,
                metadata: { externalCode: row.externalCode }
              }))
            : // The tax-code mapping read.
              taxMappings
      };
      return query;
    }
  };
  const syncer = new PurchaseOrderSyncer({
    database: database as never,
    companyId: "company-1",
    provider: {
      id: "xero",
      listChartOfAccounts: async () => options.chart ?? [],
      listTaxRates: async () => XERO_TAX_RATES
    } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "purchaseOrder"
  });
  const internals = syncer as unknown as Record<string, unknown>;
  internals.getRemoteId = async () => null;
  internals.ensureDependencySynced = vi.fn(async () => "xero-item-1");
  return syncer as unknown as {
    mapToRemote(local: XeroPurchaseOrder): Promise<Xero.PurchaseOrder>;
    ensureDependencySynced: unknown;
  };
}

const purchaseOrder = (
  line: Partial<XeroPurchaseOrderLine>
): XeroPurchaseOrder =>
  ({
    id: "po-1",
    companyId: "company-1",
    purchaseOrderId: "PO000709",
    supplierId: "supplier-1",
    supplierExternalId: "xero-contact-1",
    status: "To Receive",
    orderDate: "2026-09-30",
    currencyCode: "GBP",
    exchangeRate: 1,
    subtotal: 10,
    totalTax: 0,
    totalAmount: 10,
    supplierReference: null,
    currencyDecimalPlaces: 2,
    lines: [
      {
        id: "line-1",
        description: "Bracket",
        quantity: 1,
        unitPrice: 10,
        itemId: "item-1",
        itemCode: null,
        accountNumber: null,
        taxPercent: null,
        taxAmount: null,
        taxCodeId: null,
        shippingCost: 0,
        totalAmount: 10,
        quantityReceived: null,
        quantityInvoiced: null,
        ...line
      }
    ]
  }) as unknown as XeroPurchaseOrder;

describe("Xero PurchaseOrderSyncer.mapToRemote (line ItemCode)", () => {
  it("sends the code the item was pushed under, revision included", async () => {
    const payload = await makePurchaseOrderSyncer({
      readableId: "PRT-001374",
      readableIdWithRevision: "PRT-001374.A"
    }).mapToRemote(purchaseOrder({}));

    expect(payload.LineItems?.[0]?.ItemCode).toBe("PRT-001374.A");
  });

  it("sends no ItemCode on a line without an item", async () => {
    const payload = await makePurchaseOrderSyncer({
      readableId: "unused",
      readableIdWithRevision: null
    }).mapToRemote(purchaseOrder({ itemId: null }));

    expect(payload.LineItems?.[0]?.ItemCode).toBeUndefined();
  });
});

describe("Xero PurchaseOrderSyncer.mapToRemote (TaxType)", () => {
  const item = { readableId: "PRT-1", readableIdWithRevision: null };

  it("sends NONE on an untaxed line", async () => {
    const payload = await makePurchaseOrderSyncer(item).mapToRemote(
      purchaseOrder({})
    );
    expect(payload.LineItems?.[0]?.TaxType).toBe("NONE");
    expect(payload.LineAmountTypes).toBeUndefined();
  });

  it("sends the code's mapped purchase TaxType on a taxed line", async () => {
    const payload = await makePurchaseOrderSyncer(item, [
      {
        entityId: "tc_uk20:purchase",
        externalId: "INPUT2",
        metadata: { externalName: "20% (VAT on Expenses)", externalRate: 0.2 }
      }
    ]).mapToRemote(
      // £10 + £2 shipping, taxed at 20%: £2.40.
      purchaseOrder({
        taxCodeId: "tc_uk20",
        taxPercent: 0.2,
        taxAmount: 2.4,
        shippingCost: 2
      })
    );
    expect(payload.LineItems?.[0]).toMatchObject({
      TaxType: "INPUT2",
      TaxAmount: 2
    });
    expect(payload.LineItems?.[1]).toMatchObject({
      TaxType: "INPUT2",
      TaxAmount: 0.4
    });
  });

  it("sends a zero-rated line at its mapped rate, Exclusive", async () => {
    const payload = await makePurchaseOrderSyncer(item, [
      {
        entityId: "tc_uk0:purchase",
        externalId: "ZERORATEDINPUT",
        metadata: { externalName: "Zero Rated Expenses", externalRate: 0 }
      }
    ]).mapToRemote(
      purchaseOrder({ taxCodeId: "tc_uk0", taxPercent: 0, taxAmount: 0 })
    );
    expect(payload.LineAmountTypes).toBe("Exclusive");
    expect(payload.LineItems?.[0]).toMatchObject({
      TaxType: "ZERORATEDINPUT",
      TaxAmount: 0
    });
  });

  it("matches a legacy 20% line to the one 20% expense rate", async () => {
    const payload = await makePurchaseOrderSyncer(item).mapToRemote(
      purchaseOrder({ taxPercent: 0.2, taxAmount: 2 })
    );
    expect(payload.LineItems?.[0]?.TaxType).toBe("INPUT2");
  });

  it("stops an unmapped code with the Warning before the item is provisioned", async () => {
    const syncer = makePurchaseOrderSyncer(item);
    await expect(
      syncer.mapToRemote(
        purchaseOrder({ taxCodeId: "tc_uk20", taxPercent: 0.2, taxAmount: 2 })
      )
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_TAX_CODES", warning: true }
    });
    expect(syncer.ensureDependencySynced).not.toHaveBeenCalled();
  });
});

const UK20 = {
  entityId: "tc_uk20:purchase",
  externalId: "INPUT2",
  metadata: { externalName: "20% (VAT on Expenses)", externalRate: 0.2 }
};

describe("Xero PurchaseOrderSyncer.mapToRemote (account-class check)", () => {
  const item = { readableId: "PRT-1", readableIdWithRevision: null };
  // Carbon's account number 2100 is also a liability code in this Xero chart.
  const chart = [
    { Code: "2100", Class: "LIABILITY" },
    { Code: "5000", Class: "EXPENSE" }
  ] as Xero.Account[];
  const taxedLine = {
    taxCodeId: "tc_uk20",
    taxPercent: 0.2,
    taxAmount: 2,
    accountId: "acct_cogs",
    accountNumber: "2100"
  };

  it("does not refuse a line whose Carbon account number merely matches a Xero code", async () => {
    const payload = await makePurchaseOrderSyncer(item, [UK20], {
      chart,
      accountMappings: [{ accountId: "acct_cogs", externalCode: "5000" }]
    }).mapToRemote(purchaseOrder(taxedLine));
    expect(payload.LineItems?.[0]?.TaxType).toBe("INPUT2");
  });

  it("does not refuse a line whose account has no mapping", async () => {
    const payload = await makePurchaseOrderSyncer(item, [UK20], {
      chart
    }).mapToRemote(purchaseOrder(taxedLine));
    expect(payload.LineItems?.[0]?.TaxType).toBe("INPUT2");
  });

  it("refuses a line whose account mapping names that same Xero liability code", async () => {
    await expect(
      makePurchaseOrderSyncer(item, [UK20], {
        chart,
        accountMappings: [{ accountId: "acct_cogs", externalCode: "2100" }]
      }).mapToRemote(purchaseOrder(taxedLine))
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_TAX_CODES", warning: true }
    });
  });
});

describe("Xero PurchaseOrderSyncer.mapToRemote (order currency and shipping)", () => {
  const item = { readableId: "PRT-1", readableIdWithRevision: null };

  it("sends shipping as its own line, each line's tax on its own LineAmount", async () => {
    // EUR 10 + EUR 2 shipping at 20%: EUR 2.40 on the line.
    const payload = await makePurchaseOrderSyncer(item, [UK20]).mapToRemote({
      ...purchaseOrder({
        taxCodeId: "tc_uk20",
        taxPercent: 0.2,
        taxAmount: 2.4,
        shippingCost: 2
      }),
      currencyCode: "EUR",
      exchangeRate: 1.17
    });
    expect(payload.CurrencyCode).toBe("EUR");
    expect(
      payload.LineItems?.map((line) => [
        line.Description,
        line.Quantity,
        line.UnitAmount,
        line.LineAmount,
        line.TaxType,
        line.TaxAmount,
        line.ItemCode
      ])
    ).toEqual([
      ["Bracket", 1, 10, 10, "INPUT2", 2, "PRT-1"],
      ["Shipping: Bracket", 1, 2, 2, "INPUT2", 0.4, undefined]
    ]);
  });
});

describe("xeroPurchaseOrderLineParts", () => {
  const line = (
    overrides: Partial<XeroPurchaseOrderLine>
  ): XeroPurchaseOrderLine =>
    purchaseOrder(overrides).lines[0] as XeroPurchaseOrderLine;

  it("keeps a line with no shipping as one part", () => {
    expect(
      xeroPurchaseOrderLineParts(
        line({ taxCodeId: "tc_uk20", taxPercent: 0.2, taxAmount: 2 }),
        2
      )
    ).toEqual([
      {
        shipping: false,
        taxCodeId: "tc_uk20",
        taxPercent: 0.2,
        netAmount: 10,
        taxAmount: 2
      }
    ]);
  });

  it("splits the tax between goods and shipping, each within a penny of net x rate", () => {
    // 10.03 + 2.53 at 20%: 2.006 + 0.506, the supplier charged 2.51.
    const parts = xeroPurchaseOrderLineParts(
      line({
        totalAmount: 10.03,
        shippingCost: 2.53,
        taxPercent: 0.2,
        taxAmount: 2.51
      }),
      2
    );
    expect(parts.map((part) => [part.netAmount, part.taxAmount])).toEqual([
      [10.03, 2],
      [2.53, 0.51]
    ]);
  });

  it("sends an untaxed line's shipping untaxed", () => {
    expect(
      xeroPurchaseOrderLineParts(line({ shippingCost: 5 }), 2).map((part) => [
        part.netAmount,
        part.taxAmount
      ])
    ).toEqual([
      [10, 0],
      [5, 0]
    ]);
  });
});
