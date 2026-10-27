// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { cascadePurchaseOrderDateToLines } from "../../app/modules/purchasing/purchasing.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

type LineSeed = {
  key: string;
  requiredDate?: string | null;
  receivedDate?: string | null;
  quantityReceived?: number;
  receivedComplete?: boolean;
};

async function purchaseOrder(
  f: Fixture,
  delivery: { receiptRequestedDate?: string; deliveryDate?: string },
  lines: LineSeed[]
): Promise<string> {
  const purchaseOrderId = `${f.prefix}-po-dates`;
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: "PO-DATES",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderDelivery")
      .values({
        id: purchaseOrderId,
        locationId: f.locationId,
        companyId: f.companyId,
        ...delivery
      })
      .execute();
    await trx
      .insertInto("purchaseOrderLine")
      .values(
        lines.map((line) => ({
          id: `${f.prefix}-pol-${line.key}`,
          purchaseOrderId,
          purchaseOrderLineType: "Part" as const,
          itemId: f.partId,
          purchaseQuantity: 10,
          quantityReceived: line.quantityReceived ?? 0,
          receivedComplete: line.receivedComplete ?? false,
          requiredDate: line.requiredDate ?? null,
          receivedDate: line.receivedDate ?? null,
          supplierUnitPrice: 10,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return purchaseOrderId;
}

async function lineDates(f: Fixture, purchaseOrderId: string) {
  const rows = await f.db
    .selectFrom("purchaseOrderLine")
    .select(["id", "requiredDate", "receivedDate"])
    .where("purchaseOrderId", "=", purchaseOrderId)
    .where("companyId", "=", f.companyId)
    .execute();
  return Object.fromEntries(
    rows.map((row) => [row.id.slice(`${f.prefix}-pol-`.length), row])
  );
}

databaseTest(
  "a new requested date moves the lines on the old date or none, and leaves the rest",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const purchaseOrderId = await purchaseOrder(
        f,
        { receiptRequestedDate: "2026-11-01" },
        [
          { key: "empty" },
          { key: "following", requiredDate: "2026-11-01" },
          { key: "own", requiredDate: "2026-11-15" },
          {
            key: "received",
            requiredDate: "2026-11-01",
            quantityReceived: 10,
            receivedComplete: true
          }
        ]
      );

      await cascadePurchaseOrderDateToLines(f.db, {
        companyId: f.companyId,
        userId: USER,
        purchaseOrderIds: [purchaseOrderId],
        field: "receiptRequestedDate",
        value: "2026-11-20"
      });

      const lines = await lineDates(f, purchaseOrderId);
      expect(lines.empty?.requiredDate).toBe("2026-11-20");
      expect(lines.following?.requiredDate).toBe("2026-11-20");
      expect(lines.own?.requiredDate).toBe("2026-11-15");
      expect(lines.received?.requiredDate).toBe("2026-11-01");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an order date that does not change leaves a line with no date empty",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const purchaseOrderId = await purchaseOrder(
        f,
        { receiptRequestedDate: "2026-11-01" },
        [{ key: "empty" }]
      );

      await cascadePurchaseOrderDateToLines(f.db, {
        companyId: f.companyId,
        userId: USER,
        purchaseOrderIds: [purchaseOrderId],
        field: "receiptRequestedDate",
        value: "2026-11-01"
      });

      const lines = await lineDates(f, purchaseOrderId);
      expect(lines.empty?.requiredDate).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the delivery date goes only to lines that have received something",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const purchaseOrderId = await purchaseOrder(f, {}, [
        { key: "partly", quantityReceived: 4 },
        { key: "nothing" }
      ]);

      await cascadePurchaseOrderDateToLines(f.db, {
        companyId: f.companyId,
        userId: USER,
        purchaseOrderIds: [purchaseOrderId],
        field: "deliveryDate",
        value: "2026-11-05"
      });

      const lines = await lineDates(f, purchaseOrderId);
      expect(lines.partly?.receivedDate).toBe("2026-11-05");
      expect(lines.nothing?.receivedDate).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);
