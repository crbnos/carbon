// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "kysely";
import { CompiledQuery, Kysely, PostgresDialect, PostgresDriver } from "kysely";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { KyselyDatabase } from "./client.ts";
import { getNextSequence, getNextSequences } from "./sequence.ts";

// Runs against the local database, like the authz tests:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- sequence
//
// Each test runs inside one transaction that is always rolled back, so it
// writes nothing. The company is inserted with `session_replication_role =
// replica` (FKs and triggers off) so it needs no group behind it.
const url = process.env.SUPABASE_DB_URL;

class SavepointDriver extends PostgresDriver {
  override async beginTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("SAVEPOINT allocator"));
  }
  override async commitTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(
      CompiledQuery.raw("RELEASE SAVEPOINT allocator")
    );
  }
  override async rollbackTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(
      CompiledQuery.raw("ROLLBACK TO SAVEPOINT allocator")
    );
  }
}

describe.skipIf(!url)("getNextSequences against a migrated database", () => {
  const client = new Client({ connectionString: url });
  const config = {
    pool: {
      connect: async () => Object.assign(client, { release: () => undefined }),
      end: async () => undefined
    }
  };
  const dialect = new PostgresDialect(config);
  const db = new Kysely<KyselyDatabase>({
    dialect: {
      createAdapter: () => dialect.createAdapter(),
      createDriver: () => new SavepointDriver(config),
      createIntrospector: (k) => dialect.createIntrospector(k),
      createQueryCompiler: () => dialect.createQueryCompiler()
    }
  });

  const companyId = `t-${randomUUID().slice(0, 8)}-company`;
  const table = "sequenceTest";

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  async function begin(next: number, step: number) {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO "company" ("id", "name", "companyGroupId", "baseCurrencyCode", "timezone")
       VALUES ($1, $1, $1, 'USD', 'America/New_York')`,
      [companyId]
    );
    await client.query(
      `INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
       VALUES ($1, 'Sequence test', 'SQ-', '-X', $2, 4, $3, $4)`,
      [table, next, step, companyId]
    );
    await client.query("SET LOCAL session_replication_role = origin");
  }
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function storedNext() {
    const { rows } = await client.query<{ next: number }>(
      `SELECT "next" FROM "sequence" WHERE "table" = $1 AND "companyId" = $2`,
      [table, companyId]
    );
    return Number(rows[0]?.next);
  }

  it("allocates count numbers in order, one step apart, in one increment", async () => {
    await begin(5, 2);
    const numbers = await db
      .transaction()
      .execute((trx) => getNextSequences(trx, table, companyId, 3));
    expect(numbers).toEqual(["SQ-0007-X", "SQ-0009-X", "SQ-0011-X"]);
    expect(await storedNext()).toBe(11);
  });

  it("continues where getNextSequences stopped, one number at a time", async () => {
    await begin(5, 2);
    const [batch, single] = await db
      .transaction()
      .execute(async (trx) => [
        await getNextSequences(trx, table, companyId, 2),
        await getNextSequence(trx, table, companyId)
      ]);
    expect(batch).toEqual(["SQ-0007-X", "SQ-0009-X"]);
    expect(single).toBe("SQ-0011-X");
    expect(await storedNext()).toBe(11);
  });

  it("allocates nothing for a count of zero", async () => {
    await begin(5, 2);
    const numbers = await db
      .transaction()
      .execute((trx) => getNextSequences(trx, table, companyId, 0));
    expect(numbers).toEqual([]);
    expect(await storedNext()).toBe(5);
  });
});
