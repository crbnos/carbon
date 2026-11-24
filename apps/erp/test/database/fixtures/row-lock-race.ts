// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { connectLocalTestDatabase } from "./local-database";

type Db = Kysely<KyselyDatabase>;

/** Runs every post at once, each on its own connection, while another
 *  connection holds `FOR UPDATE` on one row. The row is released only when
 *  every post waits on a lock, so they all read before any of them writes:
 *  without a lock of their own on that row, each acts on the same stale read.
 *  Returns the posts' results in order. */
export async function raceBehindRowLock<T>(
  row: { table: "trackedEntity"; id: string },
  posts: Array<(db: Db) => Promise<T>>
): Promise<T[]> {
  const holder = await connectLocalTestDatabase();
  const connections = await Promise.all(
    posts.map(() => connectLocalTestDatabase())
  );
  const started: Promise<T>[] = [];
  try {
    const pids = await Promise.all(
      connections.map(async (db) => {
        const result = await sql<{
          pid: number;
        }>`SELECT pg_backend_pid() AS pid`.execute(db);
        return result.rows[0]!.pid;
      })
    );
    await holder.transaction().execute(async (trx) => {
      await sql`SELECT 1 FROM ${sql.table(row.table)} WHERE "id" = ${row.id} FOR UPDATE`.execute(
        trx
      );
      started.push(...posts.map((post, i) => post(connections[i]!)));
      for (let attempt = 0; ; attempt++) {
        const waiting = await sql<{ count: number }>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE pid = ANY(${pids}) AND wait_event_type = 'Lock'`.execute(trx);
        if (waiting.rows[0]!.count === posts.length) break;
        if (attempt > 200) {
          throw new Error("The posts never all waited on a lock");
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    return await Promise.all(started);
  } finally {
    await Promise.allSettled(started);
    await Promise.all(connections.map((db) => db.destroy()));
    await holder.destroy();
  }
}
