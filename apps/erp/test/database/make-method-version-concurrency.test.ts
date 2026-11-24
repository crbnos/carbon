// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Writers of one item's make method versions running at the same time. A
// held row lock makes each one wait at its first write, so every interleaving
// below is the one the comment names. Runs against the local database; skips
// without one.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  convertDocument,
  invokePosting
} from "../../app/modules/shared/shared.service";
import { alwaysPostFixture, type Fixture, seed, USER } from "./fixtures/always-post";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

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

// A second writer may wait on the first rather than on the held lock itself.
async function waitForBlockedConnection(
  db: Kysely<KyselyDatabase>,
  waitingPid: number
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT cardinality(pg_blocking_pids(${waitingPid})) > 0 AS blocked
    `.execute(db);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected database connection to wait for the held lock");
}

/** The assembly's trigger-made v1 set Active, and Drafts v2 and v3. */
async function threeVersions(f: Fixture) {
  const v1 = await f.db
    .selectFrom("makeMethod")
    .select("id")
    .where("itemId", "=", f.assemblyId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  let drafts: { id: string }[] = [];
  await seed(f, async (trx) => {
    await trx
      .updateTable("makeMethod")
      .set({ status: "Active" })
      .where("id", "=", v1.id)
      .where("companyId", "=", f.companyId)
      .execute();
    drafts = await trx
      .insertInto("makeMethod")
      .values(
        [2, 3].map((version) => ({
          itemId: f.assemblyId,
          version,
          status: "Draft" as const,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .returning("id")
      .execute();
  });
  return { v1: v1.id, v2: drafts[0]!.id, v3: drafts[1]!.id };
}

async function statuses(f: Fixture, ids: Record<string, string>) {
  const rows = await f.db
    .selectFrom("makeMethod")
    .select(["id", "status"])
    .where("id", "in", Object.values(ids))
    .where("companyId", "=", f.companyId)
    .execute();
  const byId = new Map(rows.map((row) => [row.id, row.status]));
  return Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [name, byId.get(id)])
  );
}

function activate(
  f: Fixture,
  db: Kysely<KyselyDatabase>,
  makeMethodId: string
) {
  return invokePosting(
    { db, companyId: f.companyId, userId: USER },
    "convert",
    { type: "methodVersionToActive", id: makeMethodId },
    convertDocument
  );
}

databaseTest(
  "two activations of one item's versions at once leave one version Active",
  async () => {
    const f = await alwaysPostFixture();
    const holder = await connectLocalTestDatabase();
    const first = await connectLocalTestDatabase();
    const second = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const held = signal();
    const release = signal();
    let holding: Promise<void> | undefined;
    const running: Promise<unknown>[] = [];
    try {
      const ids = await threeVersions(f);
      const firstPid = await backendPid(first);
      const secondPid = await backendPid(second);

      // Holds the Active v1, which both activations archive.
      holding = holder.transaction().execute(async (trx) => {
        await trx
          .selectFrom("makeMethod")
          .select("id")
          .where("id", "=", ids.v1)
          .where("companyId", "=", f.companyId)
          .forUpdate()
          .execute();
        held.resolve();
        await release.promise;
      });
      void holding.catch(() => {});
      await Promise.race([held.promise, holding]);

      const activatingV2 = activate(f, first, ids.v2);
      running.push(activatingV2);
      void activatingV2.catch(() => {});
      await waitForBlockedConnection(monitor, firstPid);

      const activatingV3 = activate(f, second, ids.v3);
      running.push(activatingV3);
      void activatingV3.catch(() => {});
      await waitForBlockedConnection(monitor, secondPid);

      release.resolve();
      await holding;
      expect((await activatingV2).error).toBeNull();
      expect((await activatingV3).error).toBeNull();

      // v3 waited for v2's activation, so it archived v2.
      expect(await statuses(f, ids)).toEqual({
        v1: "Archived",
        v2: "Archived",
        v3: "Active"
      });
    } finally {
      release.resolve();
      await holding?.catch(() => {});
      await Promise.allSettled(running);
      await holder.destroy();
      await first.destroy();
      await second.destroy();
      await monitor.destroy();
      await f.cleanup();
    }
  }
);
