// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The sales invoice header writes of the properties panel, run as the
// operation: the due date a new issue date takes, and a new customer with the
// ship-to it clears. Runs against the local stack; skipped without one.

import { createHash } from "node:crypto";
import { createServiceContext } from "@carbon/api/service-fn.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { expect } from "vitest";
import { updateSalesInvoiceField } from "../../app/modules/invoicing/invoicing.server";
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
 *  holds, or `done` settles first. */
async function blockedBy(
  holder: Kysely<KyselyDatabase>,
  done: () => boolean
) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(holder);
  for (let attempt = 0; attempt < 200 && !done(); attempt++) {
    const waiting = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE ${rows[0]!.pid}::int = ANY(pg_blocking_pids(pid))`.execute(holder);
    if (waiting.rows[0]!.count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
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
    const holder = await connectLocalTestDatabase();
    try {
      let change: ReturnType<typeof updateSalesInvoiceField> | undefined;
      let settled = false;
      // The post's claim (Draft to Pending) holds the invoice until it
      // commits; the change starts after the claim and reads Draft first.
      await holder.transaction().execute(async (trx) => {
        await trx
          .updateTable("salesInvoice")
          .set({ status: "Pending" })
          .where("id", "=", f.invoiceIds[0]!)
          .where("companyId", "=", f.companyId)
          .execute();
        change = updateSalesInvoiceField(contextOf(f, system, system), {
          ids: f.invoiceIds,
          field: "customerId",
          value: f.otherCustomerId
        }).finally(() => {
          settled = true;
        });
        await blockedBy(trx, () => settled);
      });

      const result = await change!;
      expect(result.error).toMatchObject({ category: "rule" });
      expect(await f.state()).toEqual([
        {
          id: f.invoiceIds[0],
          customerId: f.customerId,
          customerLocationId: f.shipToId
        }
      ]);
    } finally {
      await holder.destroy();
      await f.cleanup();
    }
  }
);
