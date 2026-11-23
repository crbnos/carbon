// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import * as purchasing from "../../app/modules/purchasing/purchasing.server";
import { shortClosePurchaseOrderLine } from "../../app/modules/purchasing/purchasing.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

type Status = "Draft" | "Needs Approval" | "To Receive";

async function purchaseOrder(
  f: Fixture,
  status: Status,
  line: { quantityReceived?: number; receivedComplete?: boolean } = {}
) {
  const purchaseOrderId = `${f.prefix}-po-short-close`;
  const lineId = `${f.prefix}-pol-short-close`;
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
        purchaseOrderId: "PO-SHORT-CLOSE",
        status,
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
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("purchaseOrderLine")
      .values({
        id: lineId,
        purchaseOrderId,
        purchaseOrderLineType: "Part" as const,
        itemId: f.partId,
        purchaseQuantity: 10,
        quantityReceived: line.quantityReceived ?? 0,
        receivedComplete: line.receivedComplete ?? false,
        supplierUnitPrice: 10,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return { purchaseOrderId, lineId };
}

async function state(f: Fixture, purchaseOrderId: string, lineId: string) {
  const order = await f.db
    .selectFrom("purchaseOrder")
    .select("status")
    .where("id", "=", purchaseOrderId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const line = await f.db
    .selectFrom("purchaseOrderLine")
    .select(["receivedComplete", "invoicedComplete"])
    .where("id", "=", lineId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { status: order.status, ...line };
}

// The bypass TCK-31 reported: with every line short-closed the header
// recomputes to Completed, so an unreleased order was released with no
// approval. Called through the operation, the path MCP and the HTTP API take.
const refusals = [
  { status: "Draft", intent: "close", receivedComplete: false },
  { status: "Needs Approval", intent: "close", receivedComplete: false },
  { status: "Draft", intent: "reopen", receivedComplete: true }
] as const;

for (const { status, intent, receivedComplete } of refusals) {
  databaseTest(
    `${intent === "close" ? "stopping" : "resuming"} receiving on a ${status} order is refused and changes nothing`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        const { purchaseOrderId, lineId } = await purchaseOrder(f, status, {
          receivedComplete
        });

        const result = await purchasing.shortClosePurchaseOrderLine(
          f.service,
          { lineId, purchaseOrderId, intent }
        );

        expect(result.data).toBeNull();
        expect(result.error).toMatchObject({
          category: "rule",
          message:
            "Receiving can only be closed or reopened on a released purchase order"
        });
        expect(await state(f, purchaseOrderId, lineId)).toEqual({
          status,
          receivedComplete,
          invoicedComplete: false
        });
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "stopping receiving on a released order closes the line and recomputes the header",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const { purchaseOrderId, lineId } = await purchaseOrder(f, "To Receive", {
        quantityReceived: 4
      });

      const closed = await shortClosePurchaseOrderLine(f.db, {
        lineId,
        purchaseOrderId,
        companyId: f.companyId,
        userId: USER,
        intent: "close"
      });
      // 4 received and none invoiced: the remainder is written off, the
      // received part is still to bill.
      expect(closed).toEqual({ found: true, refusal: null, status: "To Invoice" });
      expect(await state(f, purchaseOrderId, lineId)).toEqual({
        status: "To Invoice",
        receivedComplete: true,
        invoicedComplete: false
      });

      const again = await shortClosePurchaseOrderLine(f.db, {
        lineId,
        purchaseOrderId,
        companyId: f.companyId,
        userId: USER,
        intent: "close"
      });
      expect(again.refusal).toBe("Receiving is already closed for this line");

      const reopened = await shortClosePurchaseOrderLine(f.db, {
        lineId,
        purchaseOrderId,
        companyId: f.companyId,
        userId: USER,
        intent: "reopen"
      });
      expect(reopened).toEqual({
        found: true,
        refusal: null,
        status: "To Receive and Invoice"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a line of another company is not found", async () => {
  const f = await alwaysPostFixture();
  try {
    const { purchaseOrderId, lineId } = await purchaseOrder(f, "To Receive");
    const result = await shortClosePurchaseOrderLine(f.db, {
      lineId,
      purchaseOrderId,
      companyId: "not-this-company",
      userId: USER,
      intent: "close"
    });
    expect(result).toEqual({ found: false, refusal: null, status: null });
    expect((await state(f, purchaseOrderId, lineId)).status).toBe("To Receive");
  } finally {
    await f.cleanup();
  }
});
