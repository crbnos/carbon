// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Inventory postings against the live database, before and after the
// company's accounting cutover. Before it, each journal is Provisional with no
// accounting period and no period is created; after it, the same posting is
// Posted in the period of the posting date.

import { expect } from "vitest";
import {
  alwaysPostFixture,
  expectPostedJournals,
  expectProvisionalJournals,
  type Fixture,
  newJournals,
  seed,
  stampCutover,
  stockPart,
  USER,
  unwrap
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";
import {
  postReceipt,
  postShipment
} from "../../app/modules/inventory/inventory.service";
import {
  invokePosting,
  invokeCreate
} from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";

/** Ships two parts back to the supplier on a purchase return order. */
async function shipPurchaseReturn(f: Fixture, key: string) {
  const purchaseReturnOrderId = `${f.prefix}-pro-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("purchaseReturnOrder")
      .values({
        id: purchaseReturnOrderId,
        purchaseReturnOrderId: `PRO-${key}`,
        supplierId: f.supplierId,
        currencyCode: "USD",
        orderDate: f.today,
        locationId: f.locationId,
        status: "To Ship",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseReturnOrderLine")
      .values({
        purchaseReturnOrderId,
        itemId: f.partId,
        quantity: 2,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const shipment = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "shipmentFromPurchaseReturnOrder",
      purchaseReturnOrderId,
      locationId: f.locationId
    })
  );
  return newJournals(f, async () =>
    unwrap(
      await invokePosting(
        handlesOf(f.ctx),
        "post-shipment",
        { type: "post", shipmentId: shipment.id },
        postShipment
      )
    )
  );
}

/** Receives two parts back from the customer on a sales return order with
 *  no linked shipment, so at the part's current cost. */
async function receiveSalesReturn(
  f: Fixture,
  key: string,
  beforePost?: () => Promise<void>
) {
  const salesReturnOrderId = `${f.prefix}-rma-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("salesReturnOrder")
      .values({
        id: salesReturnOrderId,
        salesReturnOrderId: `RMA-${key}`,
        customerId: f.customerId,
        currencyCode: "USD",
        orderDate: f.today,
        locationId: f.locationId,
        status: "To Receive",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesReturnOrderLine")
      .values({
        salesReturnOrderId,
        itemId: f.partId,
        quantity: 2,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const receipt = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "receiptFromSalesReturnOrder",
      salesReturnOrderId,
      locationId: f.locationId
    })
  );
  await beforePost?.();
  return newJournals(f, async () =>
    unwrap(
      await invokePosting(
        handlesOf(f.ctx),
        "post-receipt",
        { type: "post", receiptId: receipt.id },
        postReceipt
      )
    )
  );
}

/** Receives two parts at the fixture's location on a warehouse transfer
 *  from the other location whose line has shipped. */
async function receiveTransfer(f: Fixture, key: string) {
  const warehouseTransferId = `${f.prefix}-transfer-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("warehouseTransfer")
      .values({
        id: warehouseTransferId,
        transferId: `WT-${key}`,
        fromLocationId: f.otherLocationId,
        toLocationId: f.locationId,
        status: "To Receive",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("warehouseTransferLine")
      .values({
        transferId: warehouseTransferId,
        itemId: f.partId,
        quantity: 2,
        shippedQuantity: 2,
        fromLocationId: f.otherLocationId,
        toLocationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const receipt = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "receiptFromInboundTransfer",
      warehouseTransferId
    })
  );
  return newJournals(f, async () =>
    unwrap(
      await invokePosting(
        handlesOf(f.ctx),
        "post-receipt",
        { type: "post", receiptId: receipt.id },
        postReceipt
      )
    )
  );
}

databaseTest(
  "a purchase return shipment writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);

      const provisional = await shipPurchaseReturn(f, "1");
      await expectProvisionalJournals(
        f,
        provisional,
        "Purchase Return Shipment"
      );

      const periodId = await stampCutover(f);
      const posted = await shipPurchaseReturn(f, "2");
      await expectPostedJournals(
        f,
        posted,
        "Purchase Return Shipment",
        periodId
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales return receipt writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const provisional = await receiveSalesReturn(f, "1");
      await expectProvisionalJournals(f, provisional, "Sales Return Receipt");

      const periodId = await stampCutover(f);
      const posted = await receiveSalesReturn(f, "2");
      await expectPostedJournals(f, posted, "Sales Return Receipt", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales return receipt refuses when it cannot read the account defaults, rather than post with no journal",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await expect(
        receiveSalesReturn(f, "1", async () => {
          await f.db
            .deleteFrom("accountDefault")
            .where("companyId", "=", f.companyId)
            .execute();
        })
      ).rejects.toThrow("Error getting account defaults");
      const receipts = await f.db
        .selectFrom("receipt")
        .select("status")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(receipts.map((receipt) => receipt.status)).not.toContain("Posted");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a transfer receipt writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10, f.otherLocationId);

      const provisional = await receiveTransfer(f, "1");
      await expectProvisionalJournals(f, provisional, "Transfer Receipt");

      const periodId = await stampCutover(f);
      const posted = await receiveTransfer(f, "2");
      await expectPostedJournals(f, posted, "Transfer Receipt", periodId);
    } finally {
      await f.cleanup();
    }
  }
);
