// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The writers of one item's make method version statuses, racing on two
// connections. In a race, a held row lock makes a writer wait at its first write, so
// the interleaving is the one the test names. Runs against the local
// database; skips without one.

import { createServiceContext } from "@carbon/api/service-fn.server";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  createMakeMethodVersion,
  syncMakeMethod
} from "../../app/modules/items/items.service";
import {
  convertDocument,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";
import { methodImportFixture } from "./fixtures/method-import";

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

// Resolves once `running` settles or its connection waits on a lock.
async function waitForSettledOrBlocked(
  db: Kysely<KyselyDatabase>,
  running: Promise<unknown>,
  waitingPid: number
) {
  let settled = false;
  const settle = () => {
    settled = true;
  };
  void running.then(settle, settle);
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    if (settled) return;
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT cardinality(pg_blocking_pids(${waitingPid})) > 0 AS blocked
    `.execute(db);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected the write to finish or to wait for a lock");
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
  f: { companyId: string },
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

async function billOfMaterial(f: Fixture, makeMethodId: string) {
  const lines = await f.db
    .selectFrom("methodMaterial")
    .select(["itemId", "quantity"])
    .where("makeMethodId", "=", makeMethodId)
    .where("companyId", "=", f.companyId)
    .execute();
  return lines.map((line) => ({
    itemId: line.itemId,
    quantity: Number(line.quantity)
  }));
}

// The sync and a new version read the make method through PostgREST
// (`postgrestTest` hands each case the service-role client).

postgrestTest(
  "an Onshape sync into a Draft does not change it once it is Active",
  async (system) => {
    const f = await alwaysPostFixture();
    const holder = await connectLocalTestDatabase();
    const syncing = await connectLocalTestDatabase();
    const activating = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const held = signal();
    const release = signal();
    let holding: Promise<void> | undefined;
    const running: Promise<unknown>[] = [];
    try {
      const draft = await f.db
        .selectFrom("makeMethod")
        .select("id")
        .where("itemId", "=", f.assemblyId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const line = await f.db
        .insertInto("methodMaterial")
        .values({
          makeMethodId: draft.id,
          itemId: f.partId,
          itemType: "Part",
          quantity: 2,
          unitOfMeasureCode: "EA",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const syncPid = await backendPid(syncing);
      const activationPid = await backendPid(activating);

      // Holds the Draft's BOM line, which the sync deletes first.
      holding = holder.transaction().execute(async (trx) => {
        await trx
          .selectFrom("methodMaterial")
          .select("id")
          .where("id", "=", line.id)
          .where("companyId", "=", f.companyId)
          .forUpdate()
          .execute();
        held.resolve();
        await release.promise;
      });
      void holding.catch(() => {});
      await Promise.race([held.promise, holding]);

      const sync = syncMakeMethod(
        createServiceContext({
          actor: { type: "system", onBehalfOf: USER },
          company: { id: f.companyId, groupId: f.groupId },
          caller: system,
          system: () => system,
          pg: () => syncing,
          kv: () => {
            throw new Error("The sync reads no cache");
          }
        }),
        {
          type: "onshape",
          makeMethodId: draft.id,
          data: [
            {
              index: "1",
              id: f.partId,
              name: "Bracket",
              quantity: 3,
              replenishmentSystem: "Buy",
              defaultMethodType: "Pull from Inventory",
              data: {}
            }
          ]
        }
      );
      running.push(sync);
      void sync.catch(() => {});
      await waitForBlockedConnection(monitor, syncPid);

      // The BOM the version has when it becomes Active is the one it keeps.
      let activeBillOfMaterial: Awaited<ReturnType<typeof billOfMaterial>> =
        [];
      const activation = activate(f, activating, draft.id).then(
        async (result) => {
          activeBillOfMaterial = await billOfMaterial(f, draft.id);
          return result;
        }
      );
      running.push(activation);
      void activation.catch(() => {});
      await waitForSettledOrBlocked(monitor, activation, activationPid);

      release.resolve();
      await holding;
      await sync;
      expect((await activation).error).toBeNull();

      expect({
        status: (await statuses(f, { draft: draft.id })).draft,
        activeBillOfMaterial,
        billOfMaterial: await billOfMaterial(f, draft.id)
      }).toEqual({
        status: "Active",
        activeBillOfMaterial: [{ itemId: f.partId, quantity: 3 }],
        billOfMaterial: [{ itemId: f.partId, quantity: 3 }]
      });
    } finally {
      release.resolve();
      await holding?.catch(() => {});
      await Promise.allSettled(running);
      await holder.destroy();
      await syncing.destroy();
      await activating.destroy();
      await monitor.destroy();
      await f.cleanup();
    }
  }
);

// Ids that sort v1 < v3 < v2: the file names v2 first, and an activation
// locks the item's versions in id order.
databaseTest(
  "a method import into two versions and an activation of a third at once both complete",
  async () => {
    const f = await methodImportFixture();
    const holder = await connectLocalTestDatabase();
    const importing = await connectLocalTestDatabase();
    const activating = await connectLocalTestDatabase();
    const monitor = await connectLocalTestDatabase();
    const held = signal();
    const release = signal();
    let holding: Promise<void> | undefined;
    const running: Promise<unknown>[] = [];
    try {
      const assemblyId = f.itemId("ASSY");
      const v1 = await f.methodOf("ASSY");
      const v2 = `${assemblyId}-method-c`;
      const v3 = `${assemblyId}-method-b`;
      expect([v2, v3, v1].sort()).toEqual([v1, v3, v2]);
      await f.db
        .insertInto("makeMethod")
        .values(
          [
            { id: v2, version: 2 },
            { id: v3, version: 3 }
          ].map((method) => ({
            ...method,
            itemId: assemblyId,
            status: "Draft" as const,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
      const importPid = await backendPid(importing);
      const activationPid = await backendPid(activating);

      // Holds the component, whose key every BOM line written for it shares.
      holding = holder.transaction().execute(async (trx) => {
        await trx
          .selectFrom("item")
          .select("id")
          .where("id", "=", f.itemId("COMP-1"))
          .where("companyId", "=", f.companyId)
          .forUpdate()
          .execute();
        held.resolve();
        await release.promise;
      });
      void holding.catch(() => {});
      await Promise.race([held.promise, holding]);

      const line = (version: string) => ({
        rowType: "BOM",
        parentId: "ASSY",
        componentId: "COMP-1",
        quantity: "1",
        makeMethodVersion: version
      });
      const imported = f.run("bom", [line("2"), line("3")], importing);
      running.push(imported);
      void imported.catch(() => {});
      await waitForBlockedConnection(monitor, importPid);

      const activation = activate(f, activating, v1);
      running.push(activation);
      void activation.catch(() => {});
      await waitForBlockedConnection(monitor, activationPid);

      release.resolve();
      await holding;
      const summary = await imported;
      const activated = await activation;

      const lines = await f.db
        .selectFrom("methodMaterial")
        .select("makeMethodId")
        .where("makeMethodId", "in", [v2, v3])
        .where("companyId", "=", f.companyId)
        .orderBy("makeMethodId")
        .execute();
      const status = await f.db
        .selectFrom("makeMethod")
        .select("status")
        .where("id", "=", v1)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect({
        importErrors: summary.errors,
        activationError: activated.error?.message ?? null,
        linesOn: lines.map((row) => row.makeMethodId),
        v1: status.status
      }).toEqual({
        importErrors: [],
        activationError: null,
        linesOn: [v3, v2],
        v1: "Active"
      });
    } finally {
      release.resolve();
      await holding?.catch(() => {});
      await Promise.allSettled(running);
      await holder.destroy();
      await importing.destroy();
      await activating.destroy();
      await monitor.destroy();
      await f.cleanup();
    }
  }
);

// The New Version dialog offers to set the source Active when it is the
// item's only version; one activated since then must stay the only Active.
postgrestTest(
  "a new version leaves its Draft source Draft when another version is Active",
  async (system) => {
    const f = await alwaysPostFixture();
    try {
      const source = await f.db
        .selectFrom("makeMethod")
        .select("id")
        .where("itemId", "=", f.assemblyId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      const active = await f.db
        .insertInto("makeMethod")
        .values({
          itemId: f.assemblyId,
          version: 3,
          status: "Active",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const result = await createMakeMethodVersion(system, f.db, {
        copyFromId: source.id,
        version: 2,
        activate: true,
        companyId: f.companyId,
        createdBy: USER
      });

      expect(result.error).toBeNull();
      expect(
        await statuses(f, {
          source: source.id,
          created: result.data?.id ?? "",
          active: active.id
        })
      ).toEqual({ source: "Draft", created: "Draft", active: "Active" });
    } finally {
      await f.cleanup();
    }
  }
);
