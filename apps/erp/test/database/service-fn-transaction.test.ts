// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import {
  createServiceContext,
  defineServiceFn
} from "@carbon/api/service-fn.server";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  connectLocalTestDatabase,
  databaseTest,
  hasLocalDatabase
} from "./fixtures/local-database";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { z } from "zod";

let db: Kysely<KyselyDatabase>;

const unavailable = () => {
  throw new Error("not used by this test");
};

const contextOn = (pg: Kysely<KyselyDatabase>) =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: "system" },
    company: { id: "c1", groupId: "g1" },
    caller: unavailable as never,
    system: unavailable,
    pg: () => pg,
    kv: unavailable
  });

// A composed operation that writes, then refuses.
const writeThenRefuse = defineServiceFn({
  input: z.object({ id: z.string(), refuse: z.boolean() }),
  permission: {},
  async run(ctx, { id, refuse }) {
    await sql`INSERT INTO service_fn_tx_probe (id) VALUES (${id})`.execute(
      ctx.asSystem.pg
    );
    return refuse ? ctx.error("rule", "Refused after writing") : { id };
  }
});

const written = async (id: string) =>
  (
    await sql<{
      n: number;
    }>`SELECT count(*)::int AS n FROM service_fn_tx_probe WHERE id = ${id}`.execute(
      db
    )
  ).rows[0]?.n;

describe("ctx.transaction with a composed service function", () => {
  beforeAll(async () => {
    if (!hasLocalDatabase) return;
    db = await connectLocalTestDatabase();
    // One connection (the fixture's pool holds one), so the temp table is
    // the transaction's own.
    await sql`CREATE TEMP TABLE service_fn_tx_probe (id text)`.execute(db);
  });
  afterAll(async () => {
    await db?.destroy();
  });

  databaseTest("rolls back what it wrote when it refuses", async () => {
    const id = crypto.randomUUID();
    const result = await contextOn(db).transaction((tx) =>
      writeThenRefuse(tx, { id, refuse: true })
    );
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Refused after writing"
    });
    expect(await written(id)).toBe(0);
  });

  databaseTest("commits what it wrote when it succeeds", async () => {
    const id = crypto.randomUUID();
    const result = await contextOn(db).transaction((tx) =>
      writeThenRefuse(tx, { id, refuse: false })
    );
    expect(result.error).toBeNull();
    expect(await written(id)).toBe(1);
  });

  databaseTest("rolls back the outer transaction a joined refusal is returned from", async () => {
    const outer = crypto.randomUUID();
    const inner = crypto.randomUUID();
    const result = await contextOn(db).transaction(async (tx) => {
      await writeThenRefuse(tx, { id: outer, refuse: false });
      const joined = await tx.transaction((same) =>
        writeThenRefuse(same, { id: inner, refuse: true })
      );
      return joined.error ?? joined.data;
    });
    expect(result.error).toMatchObject({ category: "rule" });
    expect(await written(outer)).toBe(0);
    expect(await written(inner)).toBe(0);
  });
});
