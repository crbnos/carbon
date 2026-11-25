// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The invoice header writes of the properties panels, run as the operations:
// the due date a new issue date takes, a new customer with the ship-to it
// clears, and the party fields a post claims while they wait. Runs against
// the local stack; skipped without one.

import { createHash } from "node:crypto";
import { createServiceContext } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  updatePurchaseInvoiceField,
  updateSalesInvoiceField
} from "../../app/modules/invoicing/invoicing.server";
import { alwaysPostFixture, seed, USER } from "./fixtures/always-post";
import {
  connectLocalTestDatabase,
  withRefusedWrites
} from "./fixtures/local-database";
import { localApiKeyClient, postgrestTest } from "./fixtures/local-supabase";

/** The fixture's company with a second customer, a ship-to of the first, a
 *  Net 10 term, and one Draft invoice of the first customer per key, each on
 *  that term and shipping to that ship-to. */
async function invoiceFixture(keys: string[]) {
  const f = await alwaysPostFixture();
  const otherCustomerId = `${f.prefix}-customer-2`;
  const shipToId = `${f.prefix}-ship-to`;
  const termId = `${f.prefix}-net-10`;
  const invoiceIds = keys.map((key) => `${f.prefix}-invoice-${key}`);
  await seed(f, async (trx) => {
    await trx
      .insertInto("customer")
      .values({
        id: otherCustomerId,
        readableId: `${f.prefix}-C2`,
        name: `${f.prefix} customer 2`,
        companyId: f.companyId
      })
      .execute();
    const address = await trx
      .insertInto("address")
      .values({ addressLine1: "3 Main St", companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("customerLocation")
      .values({
        id: shipToId,
        name: "Dock",
        customerId: f.customerId,
        addressId: address.id,
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("paymentTerm")
      .values({
        id: termId,
        name: "Net 10",
        daysDue: 10,
        calculationMethod: "Net",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoice")
      .values(
        invoiceIds.map((id, i) => ({
          id,
          invoiceId: `INV-${keys[i]}`,
          customerId: f.customerId,
          paymentTermId: termId,
          currencyCode: "USD",
          exchangeRate: 1,
          status: "Draft" as const,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("salesInvoiceShipment")
      .values(
        invoiceIds.map((id) => ({
          id,
          customerLocationId: shipToId,
          shippingCost: 0,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });

  return {
    ...f,
    otherCustomerId,
    shipToId,
    termId,
    invoiceIds,
    /** Each invoice's customer and ship-to, by id. */
    async state() {
      return f.db
        .selectFrom("salesInvoice")
        .innerJoin("salesInvoiceShipment", (join) =>
          join
            .onRef("salesInvoiceShipment.id", "=", "salesInvoice.id")
            .onRef(
              "salesInvoiceShipment.companyId",
              "=",
              "salesInvoice.companyId"
            )
        )
        .select([
          "salesInvoice.id",
          "salesInvoice.customerId",
          "salesInvoiceShipment.customerLocationId"
        ])
        .where("salesInvoice.id", "in", invoiceIds)
        .where("salesInvoice.companyId", "=", f.companyId)
        .orderBy("salesInvoice.id")
        .execute();
    }
  };
}

type InvoiceFixture = Awaited<ReturnType<typeof invoiceFixture>>;

/** The operation's context: the system actor, with `caller` as the client
 *  row-level security applies to. */
function contextOf(
  f: InvoiceFixture,
  caller: SupabaseClient<Database>,
  system: SupabaseClient<Database>
) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: caller as never,
    system: () => system as never,
    pg: () => f.db as never,
    kv: () => {
      throw new Error("No kv in a database test");
    }
  });
}

/** A caller whose one grant is Edit on Sales Invoices. */
async function salesInvoicesKey(f: InvoiceFixture) {
  const rawKey = `crbn_invoice_${crypto.randomUUID()}`;
  const key = await f.db
    .insertInto("apiKey")
    .values({
      name: "Sales Invoices only",
      companyId: f.companyId,
      createdBy: USER,
      keyHash: createHash("sha256").update(rawKey).digest("hex"),
      scopes: JSON.stringify({})
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await f.db
    .insertInto("permission")
    .values({
      companyId: f.companyId,
      apiKeyId: key.id,
      module: "Invoicing",
      page: "invoicing.salesInvoices",
      level: "Edit",
      createdBy: USER
    } as never)
    .execute();
  return localApiKeyClient(rawKey)!;
}

/** Waits until a statement of another connection waits on a lock `holder`
 *  holds. Throws, before the holder releases it, when `done` settles first
 *  or no wait is seen: the run did not take the order the test is about. */
async function blockedBy(
  holder: Kysely<KyselyDatabase>,
  done: () => boolean
) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(holder);
  for (let attempt = 0; attempt < 200; attempt++) {
    if (done()) {
      throw new Error("The operation finished without waiting for the lock");
    }
    const waiting = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE ${rows[0]!.pid}::int = ANY(pg_blocking_pids(pid))`.execute(holder);
    if (waiting.rows[0]!.count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("No connection waited for the lock");
}

/** A Draft purchase invoice of the fixture's supplier, and a second
 *  supplier. */
async function purchaseInvoiceFixture(f: InvoiceFixture) {
  const purchaseInvoiceId = `${f.prefix}-purchase-invoice`;
  const otherSupplierId = `${f.prefix}-supplier-2`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("supplier")
      .values({
        id: otherSupplierId,
        readableId: `${f.prefix}-S2`,
        name: `${f.prefix} supplier 2`,
        companyId: f.companyId
      })
      .execute();
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseInvoice")
      .values({
        id: purchaseInvoiceId,
        invoiceId: "PI-1",
        supplierId: f.supplierId,
        invoiceSupplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return {
    purchaseInvoiceId,
    otherSupplierId,
    /** The invoice's supplier and invoice supplier. */
    async state() {
      return f.db
        .selectFrom("purchaseInvoice")
        .select(["supplierId", "invoiceSupplierId"])
        .where("id", "=", purchaseInvoiceId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
    }
  };
}

/** Runs `operation` while `holder` holds the post's claim (Draft to Pending)
 *  on `table`'s invoice, uncommitted: the operation reads Draft first. The
 *  claim commits once the operation waits on it. */
async function underPostClaim<R>(
  f: InvoiceFixture,
  table: "salesInvoice" | "purchaseInvoice",
  invoiceId: string,
  operation: () => Promise<R>
) {
  const holder = await connectLocalTestDatabase();
  try {
    let pending: Promise<R> | undefined;
    let settled = false;
    await holder.transaction().execute(async (trx) => {
      await trx
        .updateTable(table as "salesInvoice")
        .set({ status: "Pending" })
        .where("id", "=", invoiceId)
        .where("companyId", "=", f.companyId)
        .execute();
      pending = operation().finally(() => {
        settled = true;
      });
      await blockedBy(trx, () => settled);
    });
    return await pending!;
  } finally {
    await holder.destroy();
  }
}

postgrestTest(
  "a new issue date takes the invoice's term for an editor who cannot read payment terms",
  async (system) => {
    const f = await invoiceFixture(["1"]);
    try {
      const caller = await salesInvoicesKey(f);
      // Payment terms are Accounting's, Sales' and Purchasing's to read.
      const term = await caller
        .from("paymentTerm")
        .select("id")
        .eq("id", f.termId);
      expect(term.data).toEqual([]);

      const result = await updateSalesInvoiceField(
        contextOf(f, caller, system),
        { ids: f.invoiceIds, field: "dateIssued", value: "2026-11-02" }
      );
      expect(result).toEqual({ data: { ids: f.invoiceIds }, error: null });
      const dates = await f.db
        .selectFrom("salesInvoice")
        .select(["dateIssued", "dateDue"])
        .where("id", "=", f.invoiceIds[0]!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      // Net 10 from 2 November; the Net 30 fallback would be 2 December.
      expect(dates).toEqual({
        dateIssued: "2026-11-02",
        dateDue: "2026-11-12"
      });
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a new customer clears the ship-to of each invoice whose customer changes and keeps the others'",
  async (system) => {
    const f = await invoiceFixture(["1", "2"]);
    try {
      const [changing, unchanged] = f.invoiceIds as [string, string];
      await seed(f, (trx) =>
        trx
          .updateTable("salesInvoice")
          .set({ customerId: f.otherCustomerId })
          .where("id", "=", unchanged)
          .where("companyId", "=", f.companyId)
          .execute()
      );

      const result = await updateSalesInvoiceField(
        contextOf(f, system, system),
        { ids: f.invoiceIds, field: "customerId", value: f.otherCustomerId }
      );
      expect(result.error).toBeNull();
      expect([...result.data!.ids].sort()).toEqual(f.invoiceIds);
      expect(await f.state()).toEqual([
        {
          id: changing,
          customerId: f.otherCustomerId,
          customerLocationId: null
        },
        {
          id: unchanged,
          customerId: f.otherCustomerId,
          customerLocationId: f.shipToId
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a customer write the database refuses keeps the invoice's ship-to",
  async (system) => {
    const f = await invoiceFixture(["1"]);
    try {
      const result = await withRefusedWrites(
        f.db,
        "salesInvoice",
        sql`"customerId" = ${sql.lit(f.otherCustomerId)}`,
        () =>
          updateSalesInvoiceField(contextOf(f, system, system), {
            ids: f.invoiceIds,
            field: "customerId",
            value: f.otherCustomerId
          })
      );
      expect(result).toMatchObject({
        data: null,
        error: { category: "internal" }
      });
      expect(await f.state()).toEqual([
        {
          id: f.invoiceIds[0],
          customerId: f.customerId,
          customerLocationId: f.shipToId
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "an invoice a post claims while the customer change waits for it keeps its customer and ship-to",
  async (system) => {
    const f = await invoiceFixture(["1"]);
    try {
      const result = await underPostClaim(
        f,
        "salesInvoice",
        f.invoiceIds[0]!,
        () =>
          updateSalesInvoiceField(contextOf(f, system, system), {
            ids: f.invoiceIds,
            field: "customerId",
            value: f.otherCustomerId
          })
      );
      expect(result.error).toMatchObject({ category: "rule" });
      expect(await f.state()).toEqual([
        {
          id: f.invoiceIds[0],
          customerId: f.customerId,
          customerLocationId: f.shipToId
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "an invoice a post claims while the invoice customer change waits for it keeps its invoice customer",
  async (system) => {
    const f = await invoiceFixture(["1"]);
    try {
      const result = await underPostClaim(
        f,
        "salesInvoice",
        f.invoiceIds[0]!,
        () =>
          updateSalesInvoiceField(contextOf(f, system, system), {
            ids: f.invoiceIds,
            field: "invoiceCustomerId",
            value: f.otherCustomerId
          })
      );
      expect(result.error).toMatchObject({ category: "rule" });
      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select("invoiceCustomerId")
        .where("id", "=", f.invoiceIds[0]!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(invoice.invoiceCustomerId).not.toBe(f.otherCustomerId);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a purchase invoice a post claims while the invoice supplier change waits for it keeps its invoice supplier",
  async (system) => {
    const f = await invoiceFixture(["1"]);
    try {
      const p = await purchaseInvoiceFixture(f);
      const result = await underPostClaim(
        f,
        "purchaseInvoice",
        p.purchaseInvoiceId,
        () =>
          updatePurchaseInvoiceField(contextOf(f, system, system), {
            ids: [p.purchaseInvoiceId],
            field: "invoiceSupplierId",
            value: p.otherSupplierId
          })
      );
      expect(result.error).toMatchObject({ category: "rule" });
      expect(await p.state()).toEqual({
        supplierId: f.supplierId,
        invoiceSupplierId: f.supplierId
      });
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a purchase invoice a post claims while the supplier change waits for it keeps its supplier",
  async (system) => {
    const f = await invoiceFixture(["1"]);
    try {
      const p = await purchaseInvoiceFixture(f);
      const result = await underPostClaim(
        f,
        "purchaseInvoice",
        p.purchaseInvoiceId,
        () =>
          updatePurchaseInvoiceField(contextOf(f, system, system), {
            ids: [p.purchaseInvoiceId],
            field: "supplierId",
            value: p.otherSupplierId
          })
      );
      expect(result.error).toMatchObject({ category: "rule" });
      expect(await p.state()).toEqual({
        supplierId: f.supplierId,
        invoiceSupplierId: f.supplierId
      });
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a Draft purchase invoice takes a new invoice supplier, and a write that reaches no invoice is refused",
  async (system) => {
    const f = await invoiceFixture(["1"]);
    try {
      const p = await purchaseInvoiceFixture(f);
      const ctx = contextOf(f, system, system);
      const result = await updatePurchaseInvoiceField(ctx, {
        ids: [p.purchaseInvoiceId, `${f.prefix}-missing`],
        field: "invoiceSupplierId",
        value: p.otherSupplierId
      });
      expect(result).toEqual({
        data: { ids: [p.purchaseInvoiceId] },
        error: null
      });
      expect(await p.state()).toEqual({
        supplierId: f.supplierId,
        invoiceSupplierId: p.otherSupplierId
      });

      const none = await updatePurchaseInvoiceField(ctx, {
        ids: [`${f.prefix}-missing`],
        field: "supplierReference",
        value: "PO-9"
      });
      expect(none.error).toMatchObject({ category: "notFound" });
    } finally {
      await f.cleanup();
    }
  }
);
