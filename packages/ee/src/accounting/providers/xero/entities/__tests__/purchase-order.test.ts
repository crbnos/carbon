// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import type { Xero } from "../../models";
import { xeroItemCode } from "../item";
import {
  PurchaseOrderSyncer,
  type XeroPurchaseOrder,
  type XeroPurchaseOrderLine
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
  }> = []
) {
  const query = {
    selectFrom: () => query,
    select: () => query,
    where: () => query,
    executeTakeFirst: async () => itemRow,
    // The tax-code mapping read.
    execute: async () => taxMappings
  };
  const syncer = new PurchaseOrderSyncer({
    database: query as never,
    companyId: "company-1",
    provider: { id: "xero", listTaxRates: async () => XERO_TAX_RATES } as never,
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
      TaxAmount: 2.4
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
