// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Two posts, or two voids, of one receipt, shipment or purchase invoice at
// once: a double click, two tabs, an API retry. The claim before the posting
// lets a second request through on a Pending document, so each test holds the
// document's row from a third connection until both requests wait on it,
// then lets them go. The document must be posted, or voided, exactly once.
// The purchase invoice's operation is tested on its own too: its claim, and a
// failure after its post has committed.

import { createServiceContext } from "@carbon/api/service-fn.server";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect, it } from "vitest";
import {
  postReceipt,
  postShipment
} from "../../app/modules/inventory/inventory.service";
import { postPurchaseInvoice as postPurchaseInvoiceOperation } from "../../app/modules/invoicing/invoicing.server";
import { postPurchaseInvoice } from "../../app/modules/invoicing/invoicing.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  seed,
  stockPart,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const client = hasLocalDatabase ? localServiceRoleClient() : null;

/**
 * The operation's context: the system on behalf of the test user, over the
 * local PostgREST. With `failAfterPost`, its system client fails the company
 * settings read: the operation's first step after the post has committed,
 * which decides whether to update purchase prices.
 */
function operationContext(f: Fixture, { failAfterPost = false } = {}) {
  const system = failAfterPost
    ? new Proxy(client!, {
        get(target, key, receiver) {
          if (key !== "from") return Reflect.get(target, key, receiver);
          return (table: string) => {
            if (table === "companySettings") {
              throw new Error("The company settings read failed");
            }
            return target.from(table as never);
          };
        }
      })
    : client!;
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client!,
    system: () => system,
    pg: () => f.db,
    kv: () => {
      throw new Error("No post operation reads the cache");
    }
  });
}

type Document = "receipt" | "shipment" | "purchaseInvoice";
type Outcome = { data: unknown; error: { message: string } | null };

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function backendPid(db: Kysely<KyselyDatabase>) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(db);
  return rows[0]!.pid;
}

/** How many connections wait on `blockerPid`, directly or behind another waiter. */
async function waitingBehind(db: Kysely<KyselyDatabase>, blockerPid: number) {
  const { rows } = await sql<{ waiting: number }>`
    WITH RECURSIVE chain(pid) AS (
      SELECT ${blockerPid}::int
      UNION
      SELECT a.pid FROM pg_stat_activity a
      JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
    )
    SELECT (count(*) - 1)::int AS waiting FROM chain
  `.execute(db);
  return rows[0]?.waiting ?? 0;
}

/**
 * Runs `request` twice, on two connections, while a third holds the
 * document's row FOR NO KEY UPDATE: every lock and status write on the row
 * waits, an FK check on it does not. Released once both requests wait on it
 * (or one has already returned), so both have read the document by then.
 */
async function twoAtOnce(
  f: Fixture,
  document: { table: Document; id: string },
  request: (handles: ReturnType<typeof handlesOf>) => Promise<Outcome>
): Promise<Outcome[]> {
  const holder = await connectLocalTestDatabase();
  const second = await connectLocalTestDatabase();
  const monitor = await connectLocalTestDatabase();
  const held = signal();
  const release = signal();
  let holding: Promise<void> | undefined;
  try {
    const holderPid = await backendPid(holder);
    holding = holder.transaction().execute(async (trx) => {
      await sql`SELECT id FROM ${sql.table(document.table)} WHERE id = ${document.id} FOR NO KEY UPDATE`.execute(
        trx
      );
      held.resolve();
      await release.promise;
    });
    void holding.catch(() => {});
    await Promise.race([held.promise, holding]);

    let settled = 0;
    const requests = [
      request(handlesOf(f.ctx)),
      request(handlesOf({ ...f.ctx, db: second }))
    ].map((running) =>
      running.then(
        (outcome) => {
          settled++;
          return outcome;
        },
        (thrown: unknown) => {
          settled++;
          return {
            data: null,
            error: {
              message: thrown instanceof Error ? thrown.message : String(thrown)
            }
          };
        }
      )
    );

    const deadline = performance.now() + 30_000;
    while ((await waitingBehind(monitor, holderPid)) + settled < 2) {
      if (performance.now() > deadline) {
        throw new Error("Expected both requests to wait on the document");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    release.resolve();
    await holding;
    return await Promise.all(requests);
  } finally {
    release.resolve();
    await holding?.catch(() => {});
    await holder.destroy();
    await second.destroy();
    await monitor.destroy();
  }
}

const receiptPosting =
  (type: "post" | "void", receiptId: string) =>
  (handles: ReturnType<typeof handlesOf>) =>
    invokePosting(handles, "post-receipt", { type, receiptId }, postReceipt);

const shipmentPosting =
  (type: "post" | "void", shipmentId: string) =>
  (handles: ReturnType<typeof handlesOf>) =>
    invokePosting(handles, "post-shipment", { type, shipmentId }, postShipment);

/** As the postReceipt and postShipment operations leave it: both claims pass on Pending. */
async function claim(f: Fixture, table: Document, id: string) {
  await f.db
    .updateTable(table)
    .set({ status: "Pending" })
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
    .execute();
}

async function statusOf(f: Fixture, table: Document, id: string) {
  const row = await f.db
    .selectFrom(table)
    .select("status")
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row.status;
}

/**
 * What the document left behind: its status, the stock it moved at the
 * fixture's location and its journal lines. A transfer writes both legs under
 * one document, so the location keeps the in-transit leg out of the sum.
 */
async function effectOf(f: Fixture, table: Document, documentId: string) {
  const ledger = await f.db
    .selectFrom("itemLedger")
    .select((eb) => eb.fn.sum<string>("quantity").as("quantity"))
    .where("documentId", "=", documentId)
    .where("locationId", "=", f.locationId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const journal = await f.db
    .selectFrom("journalLine")
    .select((eb) => eb.fn.countAll<string>().as("lines"))
    .where("documentId", "=", documentId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return {
    status: await statusOf(f, table, documentId),
    stock: Number(ledger.quantity ?? 0),
    journalLines: Number(journal.lines)
  };
}

const succeeded = (outcomes: Outcome[]) =>
  outcomes.filter((outcome) => !outcome.error).length;

/** A Draft receipt of two parts, at the fixture's location, of a transfer whose line has shipped. */
async function draftTransferReceipt(f: Fixture, key: string) {
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
  return receipt.id;
}

/** A Draft shipment of four parts on a new sales order. */
async function draftSalesOrderShipment(f: Fixture, key: string) {
  const salesOrderId = `${f.prefix}-so-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("salesOrder")
      .values({
        id: salesOrderId,
        salesOrderId: `SO-${key}`,
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesOrderShipment")
      .values({ id: salesOrderId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("salesOrderLine")
      .values({
        salesOrderId,
        salesOrderLineType: "Part",
        itemId: f.partId,
        saleQuantity: 4,
        unitPrice: 25,
        methodType: "Pull from Inventory",
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const shipment = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "shipmentFromSalesOrder",
      salesOrderId,
      locationId: f.locationId
    })
  );
  return shipment.id;
}

/** A Draft shipment of three parts back to the supplier on a new purchase order. */
async function draftPurchaseOrderShipment(f: Fixture, key: string) {
  const purchaseOrderId = `${f.prefix}-po-ship-${key}`;
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
        purchaseOrderId: `PO-SHIP-${key}`,
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "To Receive and Invoice",
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
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.partId,
        purchaseQuantity: 3,
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
  const shipment = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "shipmentFromPurchaseOrder",
      purchaseOrderId,
      locationId: f.locationId
    })
  );
  return shipment.id;
}

/** A Draft shipment of two parts from the fixture's location to the other one. */
async function draftTransferShipment(f: Fixture, key: string) {
  const warehouseTransferId = `${f.prefix}-transfer-out-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("warehouseTransfer")
      .values({
        id: warehouseTransferId,
        transferId: `WT-OUT-${key}`,
        fromLocationId: f.locationId,
        toLocationId: f.otherLocationId,
        status: "To Ship and Receive",
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
        fromLocationId: f.locationId,
        toLocationId: f.otherLocationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const shipment = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "shipmentFromWarehouseTransfer",
      warehouseTransferId
    })
  );
  return shipment.id;
}

/** A Draft shipment of two parts back to the customer, on a return received and dispositioned Return to Customer. */
async function draftSalesReturnShipment(f: Fixture, key: string) {
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
  unwrap(await receiptPosting("post", receipt.id)(handlesOf(f.ctx)));
  await f.db
    .updateTable("salesReturnOrderLine")
    .set({ disposition: "Return to Customer" })
    .where("salesReturnOrderId", "=", salesReturnOrderId)
    .where("companyId", "=", f.companyId)
    .execute();
  const shipment = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "shipmentFromSalesReturnOrder",
      salesReturnOrderId,
      locationId: f.locationId
    })
  );
  return shipment.id;
}

/** A Draft shipment of two parts back to the supplier on a purchase return order. */
async function draftPurchaseReturnShipment(f: Fixture, key: string) {
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
  return shipment.id;
}

/** A Draft purchase invoice with one G/L Account line of 60 on supplies. */
async function draftPurchaseInvoice(f: Fixture, key: string) {
  const invoiceId = `${f.prefix}-purchase-invoice-${key}`;
  await seed(f, async (trx) => {
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseInvoice")
      .values({
        id: invoiceId,
        invoiceId: `PI-${key}`,
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseInvoiceDelivery")
      .values({ id: invoiceId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("purchaseInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "G/L Account",
        accountId: f.account("supplies"),
        quantity: 1,
        supplierUnitPrice: 60,
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return invoiceId;
}

// Each test first runs the operation once on a sibling document: two at once
// must leave exactly what one leaves.
const RECEIPTS = [
  ["purchase order", draftReceiptFromPurchaseOrder],
  ["inbound transfer", draftTransferReceipt]
] as const;

for (const [source, draft] of RECEIPTS) {
  databaseTest(
    `two posts of one ${source} receipt at once post it once`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        await stockPart(f, 30, f.otherLocationId);
        const solo = await draft(f, "solo");
        await claim(f, "receipt", solo);
        unwrap(await receiptPosting("post", solo)(handlesOf(f.ctx)));
        const receiptId = await draft(f, "race");
        await claim(f, "receipt", receiptId);

        const outcomes = await twoAtOnce(
          f,
          { table: "receipt", id: receiptId },
          receiptPosting("post", receiptId)
        );

        expect({
          posted: succeeded(outcomes),
          ...(await effectOf(f, "receipt", receiptId))
        }).toEqual({ posted: 1, ...(await effectOf(f, "receipt", solo)) });
      } finally {
        await f.cleanup();
      }
    }
  );
}

const SHIPMENTS = [
  ["sales order", draftSalesOrderShipment],
  ["purchase order", draftPurchaseOrderShipment],
  ["outbound transfer", draftTransferShipment],
  ["sales return order", draftSalesReturnShipment],
  ["purchase return order", draftPurchaseReturnShipment]
] as const;

for (const [source, draft] of SHIPMENTS) {
  databaseTest(
    `two posts of one ${source} shipment at once post it once`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        await stockPart(f, 30);
        const solo = await draft(f, "solo");
        await claim(f, "shipment", solo);
        unwrap(await shipmentPosting("post", solo)(handlesOf(f.ctx)));
        const shipmentId = await draft(f, "race");
        await claim(f, "shipment", shipmentId);

        const outcomes = await twoAtOnce(
          f,
          { table: "shipment", id: shipmentId },
          shipmentPosting("post", shipmentId)
        );

        expect({
          posted: succeeded(outcomes),
          ...(await effectOf(f, "shipment", shipmentId))
        }).toEqual({ posted: 1, ...(await effectOf(f, "shipment", solo)) });
      } finally {
        await f.cleanup();
      }
    }
  );

  databaseTest(
    `two voids of one ${source} shipment at once reverse it once`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        await stockPart(f, 30);
        const solo = await draft(f, "solo");
        unwrap(await shipmentPosting("post", solo)(handlesOf(f.ctx)));
        unwrap(await shipmentPosting("void", solo)(handlesOf(f.ctx)));
        const shipmentId = await draft(f, "race");
        unwrap(await shipmentPosting("post", shipmentId)(handlesOf(f.ctx)));

        const outcomes = await twoAtOnce(
          f,
          { table: "shipment", id: shipmentId },
          shipmentPosting("void", shipmentId)
        );

        expect({
          voided: succeeded(outcomes),
          ...(await effectOf(f, "shipment", shipmentId))
        }).toEqual({ voided: 1, ...(await effectOf(f, "shipment", solo)) });
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "two posts of one purchase invoice at once post it once",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await draftPurchaseInvoice(f, "race");
      await claim(f, "purchaseInvoice", invoiceId);

      const outcomes = await twoAtOnce(
        f,
        { table: "purchaseInvoice", id: invoiceId },
        (handles) =>
          invokePosting(
            handles,
            "post-purchase-invoice",
            { type: "post", invoiceId },
            postPurchaseInvoice
          )
      );

      expect({
        posted: succeeded(outcomes),
        ...(await effectOf(f, "purchaseInvoice", invoiceId))
      }).toEqual({ posted: 1, status: "Open", stock: 0, journalLines: 2 });
    } finally {
      await f.cleanup();
    }
  }
);

it.skipIf(!client)(
  "a post of a purchase invoice another post has claimed is refused and leaves it to that post",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await draftPurchaseInvoice(f, "claimed");
      await claim(f, "purchaseInvoice", invoiceId);

      const result = await postPurchaseInvoiceOperation(operationContext(f), {
        invoiceId
      });

      expect({
        refused: result.error?.category,
        ...(await effectOf(f, "purchaseInvoice", invoiceId))
      }).toEqual({
        refused: "conflict",
        status: "Pending",
        stock: 0,
        journalLines: 0
      });
    } finally {
      await f.cleanup();
    }
  },
  60_000
);

it.skipIf(!client)(
  "a purchase invoice whose operation fails after the post has committed stays posted",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await draftPurchaseInvoice(f, "late-failure");

      const result = await postPurchaseInvoiceOperation(
        operationContext(f, { failAfterPost: true }),
        { invoiceId }
      );

      expect({
        failed: Boolean(result.error),
        ...(await effectOf(f, "purchaseInvoice", invoiceId))
      }).toEqual({
        failed: true,
        status: "Open",
        stock: 0,
        journalLines: 2
      });
    } finally {
      await f.cleanup();
    }
  },
  60_000
);

// A purchase order shipment sends parts out for outside processing and books
// no stock movement, so its void has none to reverse.
databaseTest(
  "voiding a purchase order shipment moves no stock, as its post moved none",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 30);
      const shipmentId = await draftPurchaseOrderShipment(f, "void-stock");
      unwrap(await shipmentPosting("post", shipmentId)(handlesOf(f.ctx)));
      const afterPost = await effectOf(f, "shipment", shipmentId);

      unwrap(await shipmentPosting("void", shipmentId)(handlesOf(f.ctx)));

      const line = await f.db
        .selectFrom("purchaseOrderLine")
        .innerJoin("shipmentLine", "shipmentLine.lineId", "purchaseOrderLine.id")
        .select("purchaseOrderLine.quantityShipped")
        .where("shipmentLine.shipmentId", "=", shipmentId)
        .where("purchaseOrderLine.companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect({
        afterPost,
        afterVoid: await effectOf(f, "shipment", shipmentId),
        quantityShipped: Number(line.quantityShipped)
      }).toEqual({
        afterPost: { status: "Posted", stock: 0, journalLines: 0 },
        afterVoid: { status: "Voided", stock: 0, journalLines: 0 },
        quantityShipped: 0
      });
    } finally {
      await f.cleanup();
    }
  }
);
