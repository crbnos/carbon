// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The peg writer against the local database. Each case runs in one
// transaction that is rolled back, so it leaves no row behind. Without a
// local SUPABASE_DB_URL the cases skip.

import {
  getPostgresClient,
  getProcessPool,
  type Kysely,
  type KyselyDatabase
} from "@carbon/database/client";
import { PostgresDriver, sql } from "kysely";
import { afterAll, expect, it } from "vitest";
import type { GroupPegInput } from "./mrp-pegging";
import { writeGroupPegs } from "./peg-writer";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const hasLocalDatabase = (() => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) return false;
  try {
    return LOCAL_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
})();

const db: Kysely<KyselyDatabase> | undefined = hasLocalDatabase
  ? getPostgresClient(getProcessPool(), PostgresDriver)
  : undefined;

afterAll(async () => {
  await db?.destroy();
});

class Rollback extends Error {}

/** Runs `fn` in a transaction with a planning group of 3 members, then rolls back. */
async function inGroup(
  fn: (
    trx: Kysely<KyselyDatabase>,
    group: {
      companyId: string;
      groupId: string;
      itemId: string;
      locationId: string;
      projectIds: string[];
    }
  ) => Promise<void>
) {
  await db!
    .transaction()
    .execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      const site = await trx
        .selectFrom("location as l")
        .innerJoin("item as i", "i.companyId", "l.companyId")
        .select(["l.companyId", "l.id as locationId", "i.id as itemId"])
        .limit(1)
        .executeTakeFirstOrThrow();
      const group = await trx
        .insertInto("planningGroup")
        .values({
          companyId: site.companyId,
          name: `Peg writer test ${Math.random()}`,
          locationId: site.locationId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const projects = await trx
        .insertInto("project")
        .values(
          ["P-101", "P-102", "P-103"].map((name) => ({
            companyId: site.companyId,
            name: `Peg writer test ${name}`,
            locationId: site.locationId,
            projectStock: true,
            planningGroupId: group.id,
            createdBy: "system"
          }))
        )
        .returning("id")
        .execute();
      await fn(trx, {
        companyId: site.companyId,
        groupId: group.id,
        itemId: site.itemId,
        locationId: site.locationId,
        projectIds: projects.map((project) => project.id)
      });
      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

function inputOf(
  group: Parameters<Parameters<typeof inGroup>[0]>[1],
  quantities: number[]
): GroupPegInput {
  return {
    planningGroupId: group.groupId,
    itemId: group.itemId,
    locationId: group.locationId,
    demands: group.projectIds.map((projectId, index) => ({
      projectId,
      projectElementId: null,
      priority: 100,
      sourceType: "Project Material" as const,
      sourceId: `pem-${index}`,
      needDate: `2026-11-0${index + 1}`,
      quantity: quantities[index]!
    })),
    supplies: [
      {
        supplyType: "Planning Action",
        supplyId: "pa-peg-writer-test",
        ownerProjectId: null,
        availableDate: "2026-10-26",
        quantity: 60
      }
    ]
  };
}

function write(
  trx: Kysely<KyselyDatabase>,
  group: Parameters<Parameters<typeof inGroup>[0]>[1],
  runId: string,
  quantities: number[]
) {
  return writeGroupPegs(trx, {
    companyId: group.companyId,
    userId: "system",
    runId,
    inputs: [inputOf(group, quantities)],
    priorityRuleByGroup: { [group.groupId]: "Earliest Need" },
    priorityByProject: {}
  });
}

it.skipIf(!hasLocalDatabase)(
  "writes no peg change when a second run has the same inputs",
  async () => {
    await inGroup(async (trx, group) => {
      const first = await write(trx, group, "run-1", [20, 30, 10]);
      expect(first).toMatchObject({ superseded: 0, inserted: 3 });

      const second = await write(trx, group, "run-2", [20, 30, 10]);
      expect(second).toEqual({
        superseded: 0,
        inserted: 0,
        exceptionsSet: 0,
        exceptionsCleared: 0
      });
    });
  },
  60_000
);

it.skipIf(!hasLocalDatabase)(
  "supersedes 1 row and inserts 1 row when one demand changes",
  async () => {
    await inGroup(async (trx, group) => {
      await write(trx, group, "run-1", [20, 30, 10]);
      const changed = await write(trx, group, "run-2", [20, 30, 5]);
      expect(changed).toMatchObject({ superseded: 1, inserted: 1 });

      const rows = await trx
        .selectFrom("projectPeg")
        .select([
          "projectId",
          "quantity",
          "createdByRunId",
          "supersededAt",
          "supersededByRunId"
        ])
        .where("planningGroupId", "=", group.groupId)
        .where("projectId", "=", group.projectIds[2]!)
        .orderBy("quantity", "desc")
        .execute();
      expect(
        rows.map((row) => [
          Number(row.quantity),
          row.createdByRunId,
          row.supersededByRunId,
          row.supersededAt === null
        ])
      ).toEqual([
        [10, "run-1", "run-2", false],
        [5, "run-2", null, true]
      ]);
    });
  },
  60_000
);
