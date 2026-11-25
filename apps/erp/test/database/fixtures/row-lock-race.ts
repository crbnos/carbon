// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { connectLocalTestDatabase } from "./local-database";

type Db = Kysely<KyselyDatabase>;

/** The server process of a one-connection pool. */
export async function backendPid(db: Db) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(db);
  return rows[0]!.pid;
}

/** Waits until `waiter` waits on a lock `blocker` holds, or until
 *  `finished()`: a post that never takes the lock does not wait, and
 *  finishes on what it read before. */
export async function waitUntilBlocked(
  monitor: Db,
  blocker: number,
  waiter: number,
  finished: () => boolean
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    if (finished()) return;
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE pid = ${waiter} AND ${blocker} = ANY(pg_blocking_pids(pid))
      ) AS blocked
    `.execute(monitor);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The post never waited on the lock");
}

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
    const pids = await Promise.all(connections.map(backendPid));
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
