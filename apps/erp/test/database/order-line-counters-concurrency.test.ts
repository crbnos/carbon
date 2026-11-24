// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Two documents posting against one order line at once, against the live
// database. Each post reads the line before its transaction; a third
// connection holds the line's row lock so both posts have read it before
// either writes. The line's counter must still count both documents.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import { postReceipt } from "../../app/modules/inventory/inventory.service";
import {
  postPurchaseInvoice,
  postSalesInvoice
} from "../../app/modules/invoicing/invoicing.service";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  copyDraftReceipt,
  draftReceiptFromPurchaseOrder,
  type Fixture,
  seed,
  shipSalesOrder,
  stockPart,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import {
  deadlocked,
  outcomeOf,
  race,
  raceRounds,
  raceTimeout
} from "./fixtures/race";
import { serviceReturnFixture } from "./fixtures/service-return";
import { operationContext, postgrestTest } from "./fixtures/local-supabase";

async function backendPid(db: Kysely<KyselyDatabase>) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(db);
  return rows[0]!.pid;
}

/** Waits until every one of `pids` waits on a lock held by `holders`, or
 *  by anyone when `holders` is empty. */
async function waitUntilWaiting(
  db: Kysely<KyselyDatabase>,
  pids: number[],
  holders: number[] = []
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const { rows } = await sql<{ waiting: number }>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE pid = ANY(${pids}::int[])
        AND (
          cardinality(${holders}::int[]) = 0
            AND cardinality(pg_blocking_pids(pid)) > 0
          OR pg_blocking_pids(pid) && ${holders}::int[]
        )
    `.execute(db);
    if (rows[0]?.waiting === pids.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected the connections to wait for the held lock");
}

type Result = { error: unknown };

/** A refusal's message, or a database failure's SQLSTATE (40P01 is a
 *  deadlock); null when the call succeeded. */
function failure(result: Result): string | null {
  const error = result.error as
    | { message?: string; code?: string; cause?: { code?: string } }
    | null;
  if (!error) return null;
  return error.message || error.code || error.cause?.code || "failed";
}

/**
 * Holds `lineId`'s row lock in `table` on a third connection, starts each
 * post on its own connection, waits until both wait on a lock, then lets go.
 */
async function raceOnLine(
  f: Fixture,
  table: "salesOrderLine" | "purchaseOrderLine",
  lineId: string,
  posts: ((db: Kysely<KyselyDatabase>) => Promise<Result>)[]
): Promise<Result[]> {
  const holder = await connectLocalTestDatabase();
  const monitor = await connectLocalTestDatabase();
  const connections = [f.db];
  for (let i = 1; i < posts.length; i++) {
    connections.push(await connectLocalTestDatabase());
  }
  let release!: () => void;
  const released = new Promise<void>((done) => {
    release = done;
  });
  let held!: () => void;
  const holding = new Promise<void>((done) => {
    held = done;
  });
  const holdingLock = holder.transaction().execute(async (trx) => {
    await sql`SELECT 1 FROM ${sql.table(table)} WHERE id = ${lineId} FOR NO KEY UPDATE`.execute(
      trx
    );
    held();
    await released;
  });
  void holdingLock.catch(() => {});
  try {
    await Promise.race([holding, holdingLock]);
    const pids = await Promise.all(connections.map(backendPid));
    const running = posts.map((post, i) => post(connections[i]!));
    for (const run of running) void run.catch(() => {});
    await waitUntilWaiting(monitor, pids);
    release();
    await holdingLock;
    return await Promise.all(running);
  } finally {
    release();
    await holdingLock.catch(() => {});
    await holder.destroy();
    await monitor.destroy();
    for (const db of connections.slice(1)) await db.destroy();
  }
}

/** Two Draft invoices of 2 each against the shipped order line of 4. */
async function twoInvoicesOnOneOrderLine(f: Fixture) {
  await stockPart(f, 10);
  await shipSalesOrder(f, "race");
  const line = await f.db
    .selectFrom("salesOrderLine")
    .select("id")
    .where("salesOrderId", "=", `${f.prefix}-so-race`)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const invoiceIds = [`${f.prefix}-invoice-a`, `${f.prefix}-invoice-b`];
  await seed(f, async (trx) => {
    for (const [index, invoiceId] of invoiceIds.entries()) {
      await trx
        .insertInto("salesInvoice")
        .values({
          id: invoiceId,
          invoiceId: `INV-${index + 1}`,
          customerId: f.customerId,
          currencyCode: "USD",
          exchangeRate: 1,
          status: "Draft",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesInvoiceShipment")
        .values({
          id: invoiceId,
          shippingCost: 0,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesInvoiceLine")
        .values({
          invoiceId,
          invoiceLineType: "Part",
          itemId: f.partId,
          salesOrderLineId: line.id,
          quantity: 2,
          unitPrice: 25,
          exchangeRate: 1,
          unitOfMeasureCode: "EA",
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    }
  });
  return { lineId: line.id, invoiceIds };
}

/** Two Draft receipts of 4 each against the purchase order line of 10. */
async function twoReceiptsOfOneOrderLine(f: Fixture) {
  const first = await draftReceiptFromPurchaseOrder(f, "race");
  await f.db
    .updateTable("receiptLine")
    .set({ receivedQuantity: 4 })
    .where("receiptId", "=", first)
    .where("companyId", "=", f.companyId)
    .execute();
  // A second Draft receipt of the same line.
  const second = await copyDraftReceipt(f, first, "b");
  const line = await f.db
    .selectFrom("purchaseOrderLine")
    .select("id")
    .where("purchaseOrderId", "=", `${f.prefix}-po-race`)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { lineId: line.id, receiptIds: [first, second] };
}

databaseTest(
  "two sales invoices posted at once on one order line both count in quantityInvoiced",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const { lineId, invoiceIds } = await twoInvoicesOnOneOrderLine(f);
      await raceOnLine(
        f,
        "salesOrderLine",
        lineId,
        invoiceIds.map(
          (invoiceId) => (db) =>
            invokePosting(
              handlesOf({ db, companyId: f.companyId, userId: USER }),
              "post-sales-invoice",
              { type: "post", invoiceId },
              postSalesInvoice
            )
        )
      );

      const [line, posted] = await Promise.all([
        f.db
          .selectFrom("salesOrderLine")
          .select(["quantityInvoiced", "invoicedComplete", "saleQuantity"])
          .where("id", "=", lineId)
          .executeTakeFirstOrThrow(),
        f.db
          .selectFrom("salesInvoiceLine")
          .innerJoin("salesInvoice", "salesInvoice.id", "salesInvoiceLine.invoiceId")
          .select((eb) => eb.fn.sum<string>("salesInvoiceLine.quantity").as("quantity"))
          .where("salesInvoiceLine.salesOrderLineId", "=", lineId)
          .where("salesInvoice.status", "not in", ["Draft", "Pending", "Voided"])
          .executeTakeFirstOrThrow()
      ]);
      const invoiced = Number(posted.quantity ?? 0);
      expect(invoiced).toBeGreaterThan(0);
      expect({
        quantityInvoiced: Number(line.quantityInvoiced),
        invoicedComplete: line.invoicedComplete
      }).toEqual({
        quantityInvoiced: invoiced,
        invoicedComplete: invoiced >= Number(line.saleQuantity)
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "two receipts posted at once on one purchase order line both count in quantityReceived",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const { lineId, receiptIds } = await twoReceiptsOfOneOrderLine(f);
      await raceOnLine(
        f,
        "purchaseOrderLine",
        lineId,
        receiptIds.map(
          (receiptId) => (db) =>
            invokePosting(
              handlesOf({ db, companyId: f.companyId, userId: USER }),
              "post-receipt",
              { type: "post", receiptId },
              postReceipt
            )
        )
      );

      const [line, posted] = await Promise.all([
        f.db
          .selectFrom("purchaseOrderLine")
          .select(["quantityReceived", "receivedComplete", "purchaseQuantity"])
          .where("id", "=", lineId)
          .executeTakeFirstOrThrow(),
        f.db
          .selectFrom("receiptLine")
          .innerJoin("receipt", "receipt.id", "receiptLine.receiptId")
          .select((eb) => eb.fn.sum<string>("receiptLine.receivedQuantity").as("quantity"))
          .where("receiptLine.lineId", "=", lineId)
          .where("receipt.status", "=", "Posted")
          .executeTakeFirstOrThrow()
      ]);
      const received = Number(posted.quantity ?? 0);
      expect(received).toBeGreaterThan(0);
      expect({
        quantityReceived: Number(line.quantityReceived),
        receivedComplete: line.receivedComplete
      }).toEqual({
        quantityReceived: received,
        receivedComplete: received >= Number(line.purchaseQuantity)
      });
    } finally {
      await f.cleanup();
    }
  }
);

// A void writes the return line, then locks the return order to set its
// status; a post locks the order, then writes the line. Neither may wait on
// the other. The post's receipt also returns a second item; a third
// connection holds that item's row, so the post stops on its cost layer's
// foreign key check, between its order lock and its line write, while the
// void runs.
databaseTest(
  "a return receipt void and a post of another receipt on the same return line do not deadlock",
  async () => {
    const f = await serviceReturnFixture();
    const voider = await connectLocalTestDatabase();
    const holder = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    let release!: () => void;
    const released = new Promise<void>((done) => {
      release = done;
    });
    let holdingLock: Promise<void> | undefined;
    try {
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.unitItemId, returnType: "Return to Stock" },
        { itemId: f.stockItemId, returnType: "Return to Stock" }
      ]);
      const [shared, postOnly] = lineIds as [string, string];
      await f.db
        .updateTable("salesReturnOrderLine")
        .set({ quantity: 2 })
        .where("id", "=", shared)
        .execute();
      const handles = handlesOf(f.ctx);
      /** A Draft receipt of one unit of each line in `received`. */
      const receiptOf = async (received: string[]) => {
        const created = await invokeCreate(handles, {
          type: "receiptFromSalesReturnOrder",
          salesReturnOrderId: rmaId,
          locationId: f.locationId
        });
        if (created.error) throw created.error;
        for (const lineId of [shared, postOnly]) {
          await f.db
            .updateTable("receiptLine")
            .set({ receivedQuantity: received.includes(lineId) ? 1 : 0 })
            .where("receiptId", "=", created.data.id)
            .where("lineId", "=", lineId)
            .execute();
        }
        return created.data.id;
      };
      const posted = await receiptOf([shared]);
      expect((await f.postReceipt("post", posted)).error).toBeNull();
      const draft = await receiptOf([shared, postOnly]);
      const [holderPid, postPid, voidPid] = await Promise.all([
        backendPid(holder),
        backendPid(f.db),
        backendPid(voider)
      ]);

      let held!: () => void;
      const holding = new Promise<void>((done) => {
        held = done;
      });
      holdingLock = holder.transaction().execute(async (trx) => {
        await sql`SELECT 1 FROM "item" WHERE id = ${f.stockItemId} FOR UPDATE`.execute(
          trx
        );
        held();
        await released;
      });
      void holdingLock.catch(() => {});
      await Promise.race([holding, holdingLock]);
      const posting = invokePosting(
        handles,
        "post-receipt",
        { type: "post", receiptId: draft },
        postReceipt
      );
      void posting.catch(() => {});
      await waitUntilWaiting(monitor, [postPid], [holderPid]);

      const voiding = invokePosting(
        handlesOf({ db: voider, companyId: f.companyId, userId: f.ctx.userId }),
        "post-receipt",
        { type: "void", receiptId: posted },
        postReceipt
      );
      void voiding.catch(() => {});
      await waitUntilWaiting(monitor, [voidPid], [postPid]);

      release();
      await holdingLock;
      const [post, voided] = await Promise.all([posting, voiding]);

      expect({ post: failure(post), void: failure(voided) }).toEqual({
        post: null,
        void: null
      });
      expect(await f.returnLines(rmaId)).toEqual([
        { id: shared, quantityReceived: 1, quantityShipped: 0 },
        { id: postOnly, quantityReceived: 1, quantityShipped: 0 }
      ]);
    } finally {
      release();
      await holdingLock?.catch(() => {});
      await voider.destroy();
      await holder.destroy();
      await monitor.destroy();
      await f.cleanup();
    }
  }
);

/** A Draft invoice of `quantity` of the part on the purchase order line. */
async function draftPurchaseOrderInvoice(
  f: Fixture,
  purchaseOrderId: string,
  purchaseOrderLineId: string,
  quantity: number
) {
  const invoiceId = `${f.prefix}-purchase-invoice`;
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
        invoiceId: "PI-1",
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
        invoiceLineType: "Part",
        itemId: f.partId,
        purchaseOrderId,
        purchaseOrderLineId,
        quantity,
        supplierUnitPrice: 10,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        purchaseUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return invoiceId;
}

// Before 9359b57e9e a purchase invoice post locked the order, then wrote its
// line; a receipt post wrote the line, then the order. A third connection
// holds the order, so the invoice post waits on it and the receipt post
// writes the line before it waits on it too; released, the invoice post takes
// the order and waits on the line the receipt post holds.
// The invoice post's funds gate reads the order through PostgREST.
postgrestTest(
  "a purchase invoice post and a receipt post on one purchase order line at once do not deadlock, and the line counts both",
  async (client) => {
    const f = await alwaysPostFixture();
    const invoicer = await connectLocalTestDatabase();
    const receiver = await connectLocalTestDatabase();
    const holder = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    let release!: () => void;
    const released = new Promise<void>((done) => {
      release = done;
    });
    let holdingLock: Promise<void> | undefined;
    const running: Promise<unknown>[] = [];
    try {
      const purchaseOrderId = `${f.prefix}-po-race`;
      const receiptId = await draftReceiptFromPurchaseOrder(f, "race");
      await f.db
        .updateTable("receiptLine")
        .set({ receivedQuantity: 4 })
        .where("receiptId", "=", receiptId)
        .where("companyId", "=", f.companyId)
        .execute();
      const line = await f.db
        .selectFrom("purchaseOrderLine")
        .select("id")
        .where("purchaseOrderId", "=", purchaseOrderId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const invoiceId = await draftPurchaseOrderInvoice(
        f,
        purchaseOrderId,
        line.id,
        3
      );
      const [holderPid, invoicePid, receiptPid] = await Promise.all(
        [holder, invoicer, receiver].map(backendPid)
      );

      let held!: () => void;
      const holding = new Promise<void>((done) => {
        held = done;
      });
      holdingLock = holder.transaction().execute(async (trx) => {
        await sql`SELECT 1 FROM "purchaseOrder" WHERE id = ${purchaseOrderId} FOR NO KEY UPDATE`.execute(
          trx
        );
        held();
        await released;
      });
      void holdingLock.catch(() => {});
      await Promise.race([holding, holdingLock]);

      const invoicing = outcomeOf(() =>
        invokePosting(
          operationContext(f, client, USER, invoicer),
          "post-purchase-invoice",
          { type: "post", invoiceId },
          postPurchaseInvoice
        )
      );
      running.push(invoicing);
      await waitUntilWaiting(monitor, [invoicePid], [holderPid]);

      const receiving = outcomeOf(() =>
        invokePosting(
          handlesOf({ db: receiver, companyId: f.companyId, userId: USER }),
          "post-receipt",
          { type: "post", receiptId },
          postReceipt
        )
      );
      running.push(receiving);
      await waitUntilWaiting(monitor, [receiptPid]);

      release();
      await holdingLock;
      const outcomes = { invoice: await invoicing, receipt: await receiving };
      expect(deadlocked(outcomes)).toEqual([]);
      // The invoice post took the order first. A receipt post that read the
      // line before the invoice wrote it is refused, to be posted again.
      expect(outcomes.invoice.ok).toBe(true);
      if (!outcomes.receipt.ok) {
        expect(
          (
            await invokePosting(
              handlesOf(f.ctx),
              "post-receipt",
              { type: "post", receiptId },
              postReceipt
            )
          ).error
        ).toBeNull();
      }

      const [counters, received, invoiced] = await Promise.all([
        f.db
          .selectFrom("purchaseOrderLine")
          .select(["quantityReceived", "quantityInvoiced"])
          .where("id", "=", line.id)
          .executeTakeFirstOrThrow(),
        f.db
          .selectFrom("receiptLine")
          .innerJoin("receipt", "receipt.id", "receiptLine.receiptId")
          .select((eb) =>
            eb.fn.sum<string>("receiptLine.receivedQuantity").as("quantity")
          )
          .where("receiptLine.lineId", "=", line.id)
          .where("receipt.status", "=", "Posted")
          .executeTakeFirstOrThrow(),
        f.db
          .selectFrom("purchaseInvoiceLine")
          .innerJoin(
            "purchaseInvoice",
            "purchaseInvoice.id",
            "purchaseInvoiceLine.invoiceId"
          )
          .select((eb) =>
            eb.fn.sum<string>("purchaseInvoiceLine.quantity").as("quantity")
          )
          .where("purchaseInvoiceLine.purchaseOrderLineId", "=", line.id)
          .where("purchaseInvoice.status", "not in", [
            "Draft",
            "Pending",
            "Voided"
          ])
          .executeTakeFirstOrThrow()
      ]);
      expect({
        quantityReceived: Number(counters.quantityReceived),
        quantityInvoiced: Number(counters.quantityInvoiced),
        posted: {
          received: Number(received.quantity ?? 0),
          invoiced: Number(invoiced.quantity ?? 0)
        }
      }).toEqual({
        quantityReceived: 4,
        quantityInvoiced: 3,
        posted: { received: 4, invoiced: 3 }
      });
    } finally {
      release();
      await holdingLock?.catch(() => {});
      await Promise.allSettled(running);
      for (const db of [invoicer, receiver, holder, monitor]) {
        await db.destroy();
      }
      await f.cleanup();
    }
  }
);

const COUNTER_ROUNDS = raceRounds(6);

// Each round posts a receipt of one unit, then races two more posts against
// its void, all on the line of 10: over the rounds the line fills up, so the
// later rounds also flip receivedComplete.
databaseTest(
  "two receipts posting into one purchase order line and a void of a third at once leave quantityReceived the sum of the posted receipts",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const template = await draftReceiptFromPurchaseOrder(f, "counters");
      await f.db
        .updateTable("receiptLine")
        .set({ receivedQuantity: 1 })
        .where("receiptId", "=", template)
        .where("companyId", "=", f.companyId)
        .execute();
      const line = await f.db
        .selectFrom("purchaseOrderLine")
        .select("id")
        .where("purchaseOrderId", "=", `${f.prefix}-po-counters`)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const receiptPosting = (
        db: Kysely<KyselyDatabase>,
        type: "post" | "void",
        receiptId: string
      ) =>
        invokePosting(
          handlesOf({ db, companyId: f.companyId, userId: USER }),
          "post-receipt",
          { type, receiptId },
          postReceipt
        );

      await race({
        rounds: COUNTER_ROUNDS,
        // A post reads the line before its transaction: the spread lets the
        // void commit between one post's read and its write in some rounds.
        maxDelayMs: 100,
        setup: async (round) => {
          const [first, second, voided] = await Promise.all(
            ["a", "b", "c"].map((key) =>
              copyDraftReceipt(f, template, `${round}${key}`)
            )
          );
          const posted = await receiptPosting(f.db, "post", voided!);
          expect(posted.error).toBeNull();
          return { first: first!, second: second!, voided: voided! };
        },
        operations: {
          firstPost: (db, { first }) => receiptPosting(db, "post", first),
          secondPost: (db, { second }) => receiptPosting(db, "post", second),
          void: (db, { voided }) => receiptPosting(db, "void", voided)
        },
        invariant: async (_, outcomes) => {
          const [counters, posted] = await Promise.all([
            f.db
              .selectFrom("purchaseOrderLine")
              .select(["quantityReceived", "receivedComplete", "purchaseQuantity"])
              .where("id", "=", line.id)
              .executeTakeFirstOrThrow(),
            f.db
              .selectFrom("receiptLine")
              .innerJoin("receipt", "receipt.id", "receiptLine.receiptId")
              .select((eb) =>
                eb.fn.sum<string>("receiptLine.receivedQuantity").as("quantity")
              )
              .where("receiptLine.lineId", "=", line.id)
              .where("receipt.status", "=", "Posted")
              .executeTakeFirstOrThrow()
          ]);
          const received = Number(posted.quantity ?? 0);
          expect({
            deadlocked: deadlocked(outcomes),
            quantityReceived: Number(counters.quantityReceived),
            receivedComplete: counters.receivedComplete
          }).toEqual({
            deadlocked: [],
            quantityReceived: received,
            receivedComplete: received >= Number(counters.purchaseQuantity)
          });
        }
      });
    } finally {
      await f.cleanup();
    }
  },
  raceTimeout(COUNTER_ROUNDS, 1_000)
);
