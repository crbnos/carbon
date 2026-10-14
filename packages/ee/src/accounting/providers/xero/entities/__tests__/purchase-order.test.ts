// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { Accounting } from "../../../../core/types";
import type { Xero } from "../../models";
import { xeroItemCode } from "../item";
import { PurchaseOrderSyncer } from "../purchase-order";

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

function makePurchaseOrderSyncer(itemRow: {
  readableId: string;
  readableIdWithRevision: string | null;
}) {
  const query = {
    selectFrom: () => query,
    select: () => query,
    where: () => query,
    executeTakeFirst: async () => itemRow
  };
  const syncer = new PurchaseOrderSyncer({
    database: query as never,
    companyId: "company-1",
    provider: { id: "xero" } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "purchaseOrder"
  });
  const internals = syncer as unknown as Record<string, unknown>;
  internals.getRemoteId = async () => null;
  internals.ensureDependencySynced = async () => "xero-item-1";
  return syncer as unknown as {
    mapToRemote(local: Accounting.PurchaseOrder): Promise<Xero.PurchaseOrder>;
  };
}

const purchaseOrder = (
  line: Partial<Accounting.PurchaseOrder["lines"][number]>
): Accounting.PurchaseOrder =>
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
        totalAmount: 10,
        quantityReceived: null,
        quantityInvoiced: null,
        ...line
      }
    ]
  }) as unknown as Accounting.PurchaseOrder;

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
