// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The sales operations write as the system
// with ids from the caller's body, so each must refuse another company's rows.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { expect, it } from "vitest";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import * as sales from "../../app/modules/sales/sales.server";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const test = (name: string, fn: () => Promise<void>) =>
  it.skipIf(!client)(name, fn, 60_000);

// Two companies, in groups of their own, each with a customer, a part and a
// sales RFQ of one line.
async function fixture() {
  const db = await connectLocalTestDatabase();
  const p = `sgtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const company = (key: "own" | "other") => ({
    id: `${p}-${key}`,
    groupId: `${p}-${key}-group`,
    customer: `${p}-${key}-customer`,
    item: `${p}-${key}-item`,
    rfq: `${p}-${key}-rfq`,
    line: `${p}-${key}-line`
  });
  const own = company("own");
  const other = company("other");

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    for (const c of [own, other]) {
      await sql`
        INSERT INTO "companyGroup" (id, name, "createdBy") VALUES (${c.groupId}, ${c.id}, 'system')
      `.execute(trx);
      await sql`
        INSERT INTO "company" (id, name, "companyGroupId", "baseCurrencyCode")
        VALUES (${c.id}, ${c.id}, ${c.groupId}, 'USD')
      `.execute(trx);
      await sql`
        INSERT INTO "customer" (id, name, "companyId", "createdBy")
        VALUES (${c.customer}, 'Customer', ${c.id}, 'system')
      `.execute(trx);
      await sql`
        INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
        VALUES ('EA', 'Each', ${c.id}, 'system')
      `.execute(trx);
      await sql`
        INSERT INTO "item" (id, "readableId", name, type, "replenishmentSystem",
          "defaultMethodType", "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
        VALUES (${c.item}, 'P-1', 'Part', 'Part', 'Make', 'Make to Order', 'Inventory', 'EA',
          ${c.id}, 'system')
      `.execute(trx);
      await sql`
        INSERT INTO "salesRfq" (id, "rfqId", "customerId", "companyId", "createdBy")
        VALUES (${c.rfq}, 'RFQ-T', ${c.customer}, ${c.id}, 'system')
      `.execute(trx);
      await sql`
        INSERT INTO "salesRfqLine" (id, "salesRfqId", "customerPartId", "unitOfMeasureCode",
          "companyId", "createdBy")
        VALUES (${c.line}, ${c.rfq}, 'CP-1', 'EA', ${c.id}, 'system')
      `.execute(trx);
    }
  });

  return {
    db,
    own,
    other,
    ctx: createServiceContext({
      actor: { type: "system", onBehalfOf: "system" },
      company: { id: own.id, groupId: own.groupId },
      caller: client!,
      system: () => client!,
      pg: () => db,
      kv: () => {
        throw new Error("No operation here reads the cache");
      }
    }),
    lineItem: async (lineId: string) =>
      (
        await db
          .selectFrom("salesRfqLine")
          .select("itemId")
          .where("id", "=", lineId)
          .executeTakeFirstOrThrow()
      ).itemId,
    customerParts: () =>
      db
        .selectFrom("customerPartToItem")
        .select(["customerId", "itemId", "customerPartId"])
        .where("companyId", "in", [own.id, other.id])
        .execute(),
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .deleteFrom("company")
          .where("id", "in", [own.id, other.id])
          .execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "in", [own.groupId, other.groupId])
          .execute();
        for (const id of [own.id, other.id]) {
          await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${id}`)}`.execute(
            trx
          );
          await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${id}`)}`.execute(
            trx
          );
        }
      });
      await db.destroy();
    }
  };
}

test("an RFQ line maps to the company's item and records the customer's part", async () => {
  const f = await fixture();
  try {
    const result = await sales.mapSalesRfqLines(f.ctx, {
      rfqId: f.own.rfq,
      customerId: f.own.customer,
      mappings: [
        {
          lineId: f.own.line,
          action: "map",
          itemId: f.own.item,
          customerPartId: "CP-1"
        }
      ]
    });

    expect(result.error).toBeNull();
    expect(result.data?.failed).toBe(0);
    expect(await f.lineItem(f.own.line)).toBe(f.own.item);
    expect(await f.customerParts()).toEqual([
      { customerId: f.own.customer, itemId: f.own.item, customerPartId: "CP-1" }
    ]);
  } finally {
    await f.cleanup();
  }
});

test("mapping refuses a line of another RFQ", async () => {
  const f = await fixture();
  try {
    const result = await sales.mapSalesRfqLines(f.ctx, {
      rfqId: f.own.rfq,
      mappings: [{ lineId: f.other.line, action: "map", itemId: f.own.item }]
    });

    expect(result.error).toMatchObject({ category: "notFound" });
    expect(await f.lineItem(f.other.line)).toBeNull();
  } finally {
    await f.cleanup();
  }
});

test("mapping refuses another company's item", async () => {
  const f = await fixture();
  try {
    const result = await sales.mapSalesRfqLines(f.ctx, {
      rfqId: f.own.rfq,
      mappings: [{ lineId: f.own.line, action: "map", itemId: f.other.item }]
    });

    expect(result.error).toMatchObject({ category: "notFound" });
    expect(await f.lineItem(f.own.line)).toBeNull();
  } finally {
    await f.cleanup();
  }
});

test("mapping refuses another company's customer before writing", async () => {
  const f = await fixture();
  try {
    const result = await sales.mapSalesRfqLines(f.ctx, {
      rfqId: f.own.rfq,
      customerId: f.other.customer,
      mappings: [
        {
          lineId: f.own.line,
          action: "map",
          itemId: f.own.item,
          customerPartId: "CP-1"
        }
      ]
    });

    expect(result.error).toMatchObject({ category: "notFound" });
    expect(await f.lineItem(f.own.line)).toBeNull();
    expect(await f.customerParts()).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test("a customer bank account takes only its own columns from the body", async () => {
  const f = await fixture();
  try {
    const created = await sales.createCustomerBankAccount(f.ctx, {
      customerId: f.own.customer,
      name: "Operating",
      bankName: "Bank",
      bankAddress: "1 Bank Way",
      countryCode: "US",
      accountNumber: "123456789",
      isPrimary: true,
      active: false,
      createdAt: "2001-01-01T00:00:00Z"
    });
    expect(created.error).toBeNull();

    const row = await f.db
      .selectFrom("customerBankAccount")
      .select(["id", "isPrimary", "active", "createdAt"])
      .where("customerId", "=", f.own.customer)
      .executeTakeFirstOrThrow();
    expect(row.isPrimary).toBe(false);
    expect(row.active).toBe(true);
    expect(String(row.createdAt)).not.toContain("2001");

    const updated = await sales.updateCustomerBankAccount(f.ctx, {
      id: row.id,
      customerId: f.own.customer,
      name: "Operating",
      bankName: "Bank",
      bankAddress: "1 Bank Way",
      countryCode: "US",
      accountNumber: "123456789",
      isPrimary: true
    });
    expect(updated.error).toBeNull();
    const after = await f.db
      .selectFrom("customerBankAccount")
      .select(["isPrimary"])
      .where("id", "=", row.id)
      .executeTakeFirstOrThrow();
    expect(after.isPrimary).toBe(false);
  } finally {
    await f.cleanup();
  }
});
