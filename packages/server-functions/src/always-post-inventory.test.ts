// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Inventory postings against the live database, before and after the
// company's accounting cutover. Before it, each journal is Provisional with no
// accounting period and no period is created; after it, the same posting is
// Posted in the period of the posting date.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  expectPostedJournals,
  expectProvisionalJournals,
  type Fixture,
  journalLinesOf,
  newJournals,
  seed,
  stampCutover,
  stockPart,
  USER,
  unwrap
} from "./always-post-test-fixture";
import correctStockMovement from "./correct-stock-movement";
import create from "./create";
import { importStockQuantities } from "./import-csv/stock-quantity-import";
import { databaseTest } from "./local-database-test-fixture";
import postInventoryCount from "./post-inventory-count";
import postNonConformance from "./post-nonconformance";
import postReceipt from "./post-receipt";
import postShipment from "./post-shipment";

/** A nonconformance at the fixture's location. */
async function nonConformance(f: Fixture, key: string): Promise<string> {
  const id = `${f.prefix}-ncr-${key}`;
  await seed(f, async (trx) => {
    const type = await trx
      .insertInto("nonConformanceType")
      .values({
        name: `${f.prefix} damage ${key}`,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("nonConformance")
      .values({
        id,
        nonConformanceId: `NCR-${key}`,
        name: "Damaged brackets",
        source: "Internal",
        locationId: f.locationId,
        nonConformanceTypeId: type.id,
        openDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return id;
}

/** Scraps two parts on the nonconformance. */
async function scrapOnNonConformance(f: Fixture, documentId: string) {
  return newJournals(f, async () =>
    unwrap(
      await postNonConformance(f.ctx, {
        documentType: "Non-Conformance",
        documentId,
        movements: [
          { itemId: f.partId, locationId: f.locationId, quantity: -2 }
        ]
      })
    )
  );
}

/** A Pending count of the part with a snapshot of 0 and 3 counted. */
async function pendingCount(f: Fixture, key: string): Promise<string> {
  const id = `${f.prefix}-count-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("inventoryCount")
      .values({
        id,
        inventoryCountId: `IC-${key}`,
        locationId: f.locationId,
        status: "Pending",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("inventoryCountLine")
      .values({
        inventoryCountId: id,
        itemId: f.partId,
        locationId: f.locationId,
        systemQuantity: 0,
        countedQuantity: 3,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return id;
}

/** The latest positive adjustment of the part. */
async function latestPositiveAdjustment(f: Fixture): Promise<string> {
  const row = await f.db
    .selectFrom("itemLedger")
    .select("id")
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", f.partId)
    .where("entryType", "=", "Positive Adjmt.")
    .where("correctionOfItemLedgerId", "is", null)
    .orderBy("entryNumber", "desc")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Imports 3 of the part as opening stock. */
async function importThree(f: Fixture) {
  const summary = {
    inserted: 0,
    updated: 0,
    errors: [] as { row: number; reason: string }[],
    skipped: [] as { row: number; reason: string }[]
  };
  await importStockQuantities(
    f.db,
    // The stock importer never reads its Supabase client.
    undefined as unknown as SupabaseClient<Database>,
    {
      table: "inventoryQuantity",
      mappedRecords: [
        {
          readableId: `${f.prefix}-PART`,
          locationId: f.locationId,
          quantity: "3"
        }
      ],
      companyId: f.companyId,
      userId: USER,
      summary
    }
  );
  expect(summary.errors).toEqual([]);
  expect(summary.skipped).toEqual([]);
}

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
    await create(f.ctx, {
      type: "shipmentFromPurchaseReturnOrder",
      purchaseReturnOrderId,
      locationId: f.locationId
    })
  );
  return newJournals(f, async () =>
    unwrap(await postShipment(f.ctx, { type: "post", shipmentId: shipment.id }))
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
    await create(f.ctx, {
      type: "receiptFromSalesReturnOrder",
      salesReturnOrderId,
      locationId: f.locationId
    })
  );
  await beforePost?.();
  return newJournals(f, async () =>
    unwrap(await postReceipt(f.ctx, { type: "post", receiptId: receipt.id }))
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
    await create(f.ctx, {
      type: "receiptFromInboundTransfer",
      warehouseTransferId
    })
  );
  return newJournals(f, async () =>
    unwrap(await postReceipt(f.ctx, { type: "post", receiptId: receipt.id }))
  );
}

databaseTest(
  "a nonconformance scrap writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);

      const before = await nonConformance(f, "1");
      const provisional = await scrapOnNonConformance(f, before);
      await expectProvisionalJournals(f, provisional, "Non-Conformance");
      expect(await journalLinesOf(f, provisional)).toEqual([
        {
          accountId: f.account("inventory"),
          amount: -20,
          accountDefaultRole: null,
          documentType: "Non-Conformance"
        },
        {
          accountId: f.account("scrap"),
          amount: 20,
          accountDefaultRole: null,
          documentType: "Non-Conformance"
        }
      ]);

      const periodId = await stampCutover(f);
      const after = await nonConformance(f, "2");
      const posted = await scrapOnNonConformance(f, after);
      await expectPostedJournals(f, posted, "Non-Conformance", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a nonconformance scrap with no scrap account default posts to the variance account before the cutover",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      await stockPart(f, 10);

      const journals = await scrapOnNonConformance(
        f,
        await nonConformance(f, "1")
      );
      await expectProvisionalJournals(f, journals, "Non-Conformance");
      expect(await journalLinesOf(f, journals)).toEqual([
        {
          accountId: f.account("adjustment-variance"),
          amount: 20,
          accountDefaultRole: null,
          documentType: "Non-Conformance"
        },
        {
          accountId: f.account("inventory"),
          amount: -20,
          accountDefaultRole: null,
          documentType: "Non-Conformance"
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an inventory count writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const before = await pendingCount(f, "1");
      const provisional = await newJournals(f, async () =>
        unwrap(await postInventoryCount(f.ctx, { inventoryCountId: before }))
      );
      await expectProvisionalJournals(f, provisional, "Inventory Adjustment");

      const periodId = await stampCutover(f);
      const after = await pendingCount(f, "2");
      const posted = await newJournals(f, async () =>
        unwrap(await postInventoryCount(f.ctx, { inventoryCountId: after }))
      );
      await expectPostedJournals(f, posted, "Inventory Adjustment", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a stock movement correction writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // A positive adjustment of 5 that should have been 6.
      await stockPart(f, 5);
      const before = await latestPositiveAdjustment(f);
      const provisional = await newJournals(f, async () =>
        unwrap(
          await correctStockMovement(f.ctx, {
            itemLedgerId: before,
            correctedQuantity: 6
          })
        )
      );
      await expectProvisionalJournals(f, provisional, "Inventory Adjustment");

      const periodId = await stampCutover(f);
      await stockPart(f, 5);
      const after = await latestPositiveAdjustment(f);
      expect(after).not.toBe(before);
      const posted = await newJournals(f, async () =>
        unwrap(
          await correctStockMovement(f.ctx, {
            itemLedgerId: after,
            correctedQuantity: 6
          })
        )
      );
      await expectPostedJournals(f, posted, "Inventory Adjustment", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a stock quantity CSV import writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const provisional = await newJournals(f, () => importThree(f));
      await expectProvisionalJournals(f, provisional, "Inventory Adjustment");

      const periodId = await stampCutover(f);
      const posted = await newJournals(f, () => importThree(f));
      await expectPostedJournals(f, posted, "Inventory Adjustment", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

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
