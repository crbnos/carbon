// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A record's properties panel saves one custom field at a time. Each save sets
// only its own fields, merged into the stored map in one UPDATE, so two people
// editing different fields of one record keep both changes.

import { createHash } from "node:crypto";
import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { expect } from "vitest";
import { setRecordCustomFields } from "../../app/modules/settings/settings.server";
import { DataType } from "../../app/modules/shared/types";
import {
  connectLocalTestDatabase,
  removeTestRows
} from "./fixtures/local-database";
import { localApiKeyClient, postgrestTest } from "./fixtures/local-supabase";

const USER = "system";

async function companyFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `cfv-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const customerId = `${prefix}-customer`;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD"
      })
      .execute();
    await trx
      .insertInto("customField")
      .values([
        { id: "color", dataTypeId: DataType.Text },
        { id: "size", dataTypeId: DataType.Text },
        { id: "due", dataTypeId: DataType.Date },
        { id: "tone", dataTypeId: DataType.List, listOptions: ["Red"] }
      ].map((field) => ({
        ...field,
        id: `${prefix}-${field.id}`,
        name: field.id,
        table: "customer",
        companyId,
        createdBy: USER
      })))
      .execute();
    await trx
      .insertInto("customer")
      .values({
        id: customerId,
        name: prefix,
        companyId,
        customFields: JSON.stringify({
          [`${prefix}-color`]: "Blue",
          [`${prefix}-size`]: "S",
          [`${prefix}-due`]: "2026-01-01"
        })
      })
      .execute();
  });

  /** An API key whose one grant is `level` on Customers. */
  async function keyWith(level: "View" | "Edit") {
    const rawKey = `crbn_cfv_${crypto.randomUUID()}`;
    const key = await db
      .insertInto("apiKey")
      .values({
        name: `Customers ${level}`,
        companyId,
        createdBy: USER,
        keyHash: createHash("sha256").update(rawKey).digest("hex"),
        scopes: JSON.stringify({})
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("permission")
      .values({
        companyId,
        apiKeyId: key.id,
        module: "Sales",
        page: "sales.customers",
        level,
        createdBy: USER
      } as never)
      .execute();
    return localApiKeyClient(rawKey)!;
  }

  return {
    db,
    companyId,
    groupId,
    customerId,
    field: (name: "color" | "size" | "due" | "tone") => `${prefix}-${name}`,
    keyWith,
    async stored() {
      const row = await db
        .selectFrom("customer")
        .select("customFields")
        .where("id", "=", customerId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      return row.customFields;
    },
    async cleanup() {
      await removeTestRows(db, async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}

type Fixture = Awaited<ReturnType<typeof companyFixture>>;

function contextOf(f: Fixture, caller: unknown, system: unknown) {
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

const save = (f: Fixture, ctx: ReturnType<typeof contextOf>, values: object) =>
  setRecordCustomFields(ctx, {
    table: "customer",
    ids: [f.customerId],
    customFields: values as Record<string, unknown>
  });

postgrestTest(
  "two saves of different fields of one record both stand, and a null clears one",
  async (system) => {
    const f = await companyFixture();
    try {
      const ctx = contextOf(f, await f.keyWith("Edit"), system);

      const first = await save(f, ctx, { [f.field("color")]: "Red" });
      const second = await save(f, ctx, { [f.field("size")]: "L" });
      expect([first.error, second.error]).toEqual([null, null]);
      expect(await f.stored()).toEqual({
        [f.field("color")]: "Red",
        [f.field("size")]: "L",
        [f.field("due")]: "2026-01-01"
      });

      const cleared = await save(f, ctx, { [f.field("due")]: null });
      expect(cleared.error).toBeNull();
      expect(await f.stored()).toEqual({
        [f.field("color")]: "Red",
        [f.field("size")]: "L"
      });
    } finally {
      await f.cleanup();
    }
  }
);

// Both saves wait on the record's row lock, then run: each UPDATE merges into
// the row as the other left it, not as it was when the save began.
postgrestTest(
  "two saves that wait on one record both stand",
  async (system) => {
    const f = await companyFixture();
    const holder = await connectLocalTestDatabase();
    try {
      const ctx = contextOf(f, await f.keyWith("Edit"), system);
      const started: Promise<unknown>[] = [];
      await holder.transaction().execute(async (trx) => {
        await sql`SELECT 1 FROM "customer" WHERE "id" = ${f.customerId} FOR UPDATE`.execute(
          trx
        );
        started.push(
          save(f, ctx, { [f.field("color")]: "Red" }),
          save(f, ctx, { [f.field("size")]: "L" })
        );
        // pg_stat_activity is read once per transaction unless cleared. The
        // first save waits on this lock, the second on the first.
        for (let attempt = 0; ; attempt++) {
          await sql`SELECT pg_stat_clear_snapshot()`.execute(trx);
          const waiting = await sql<{ count: number }>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE "datname" = current_database()
              AND "wait_event_type" = 'Lock'
              AND "query" LIKE '%set_record_custom_fields%'`.execute(trx);
          if (waiting.rows[0]!.count === 2) break;
          if (attempt > 100) {
            throw new Error("The saves never waited on the lock");
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      const results = (await Promise.all(started)) as { error: unknown }[];
      expect(results.map((result) => result.error)).toEqual([null, null]);
      expect(await f.stored()).toEqual({
        [f.field("color")]: "Red",
        [f.field("size")]: "L",
        [f.field("due")]: "2026-01-01"
      });
    } finally {
      await holder.destroy();
      await f.cleanup();
    }
  }
);

// A List keeps a value its options have since dropped. Sent back unchanged
// beside another field, it is taken but not written, so a save that changed
// it while this one waited on the record stands.
postgrestTest(
  "a stored value sent back unchanged leaves alone a save made while it waited",
  async (system) => {
    const f = await companyFixture();
    const holder = await connectLocalTestDatabase();
    const tone = f.field("tone");
    try {
      const ctx = contextOf(f, await f.keyWith("Edit"), system);
      const merge = (values: Record<string, string>) =>
        sql`UPDATE "customer"
          SET "customFields" = "customFields"::jsonb || ${JSON.stringify(values)}::jsonb
          WHERE "id" = ${f.customerId} AND "companyId" = ${f.companyId}`;
      await merge({ [tone]: "Blue" }).execute(f.db);

      let saving!: Promise<{ error: unknown }>;
      await holder.transaction().execute(async (trx) => {
        // Another save sets Red and holds the record until this one waits.
        await merge({ [tone]: "Red" }).execute(trx);
        saving = save(f, ctx, { [tone]: "Blue", [f.field("size")]: "L" });
        for (let attempt = 0; ; attempt++) {
          await sql`SELECT pg_stat_clear_snapshot()`.execute(trx);
          const waiting = await sql<{ count: number }>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE "datname" = current_database()
              AND "wait_event_type" = 'Lock'
              AND "query" LIKE '%set_record_custom_fields%'`.execute(trx);
          if (waiting.rows[0]!.count === 1) break;
          if (attempt > 100) {
            throw new Error("The save never waited on the lock");
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });

      expect((await saving).error).toBeNull();
      expect(await f.stored()).toEqual({
        [f.field("color")]: "Blue",
        [f.field("size")]: "L",
        [f.field("due")]: "2026-01-01",
        [tone]: "Red"
      });
    } finally {
      await holder.destroy();
      await f.cleanup();
    }
  }
);

// The save runs as its caller: row-level security still decides which
// records it may change.
postgrestTest(
  "the save changes no record for a caller row-level security refuses",
  async () => {
    const f = await companyFixture();
    try {
      const viewer = await f.keyWith("View");
      const { data, error } = await viewer.rpc("set_record_custom_fields", {
        p_table: "customer",
        p_ids: [f.customerId],
        p_scope_column: "companyId",
        p_scope_id: f.companyId,
        p_set: { [f.field("color")]: "Red" },
        p_clear: [],
        p_updated_by: USER
      });
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(await f.stored()).toEqual({
        [f.field("color")]: "Blue",
        [f.field("size")]: "S",
        [f.field("due")]: "2026-01-01"
      });
    } finally {
      await f.cleanup();
    }
  }
);
